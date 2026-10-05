import type {
  Actor, CheckKind, ClosureStage, ConditionPayload, DetourRoute, HeldSubmission,
  ImpactCheck, Level, SchemeCore, SegmentComment, SubmitResult, Unit, VersionedScheme, VersionEntry,
} from './model'

export const CHECK_KINDS: CheckKind[] = ['公交覆盖', '绕行时延', '救护通道', '相邻工程']

/** 会签条件主题，与分段 id 组合成条件 key */
export const CONDITION_TOPICS = ['公交站点', '应急通道', '信号配时', '围挡范围'] as const

/** 相邻工程窗口（外部数据源，方案版本之外保持不变） */
const ADJACENT_PROJECTS = [
  { name: '江海大道雨污分流工程', start: '2026-10-26', end: '2026-10-30', note: '江海大道东段同步占用慢车道' },
  { name: '云河路地铁接驳站施工', start: '2026-11-10', end: '2026-11-20', note: '云河路西段新增围挡' },
]

const BUS_THRESHOLD = 500
const DELAY_THRESHOLD = 15

function now(): string {
  return new Date().toLocaleString('zh-CN', { hour12: false })
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

// ---------------------------------------------------------------------------
// 影响检测：四类派生数据全部由分段几何 / 时间 / 车道方案确定性算出
// ---------------------------------------------------------------------------

function computeCheck(kind: CheckKind, stage: ClosureStage, core: SchemeCore): Pick<ImpactCheck, 'level' | 'title' | 'detail'> {
  if (kind === '公交覆盖') {
    let gap = 380
    if (stage.lanes.includes('公交')) gap += 300
    if (stage.lanes.includes('收窄')) gap += 300
    if (stage.lanes.includes('全封闭')) gap += 240
    const level: Level = gap >= 650 ? '高' : gap >= BUS_THRESHOLD ? '中' : '低'
    return {
      level,
      title: gap > BUS_THRESHOLD ? '公交站点覆盖缺口' : '公交站点覆盖达标',
      detail: `17 路、806 路临时站步行距离约 ${gap} 米（阈值 ${BUS_THRESHOLD} 米）${gap > BUS_THRESHOLD ? '，超出老年乘客可接受范围' : '，在可接受范围内'}。`,
    }
  }
  if (kind === '绕行时延') {
    const linked = core.detours.filter((route) => route.stageId === stage.id)
    const base = linked.length ? Math.max(...linked.map((route) => route.extraMinutes)) : 0
    const extra = stage.lanes.includes('全封闭') ? 8 : stage.lanes.includes('收窄') ? 4 : stage.lanes.includes('公交') ? 13 : 0
    const delay = base + extra
    const level: Level = delay >= 18 ? '高' : delay >= 12 ? '中' : '低'
    return {
      level,
      title: delay > DELAY_THRESHOLD ? '绕行延误超阈值' : '绕行时延可接受',
      detail: `高峰绕行新增约 ${delay} 分钟（阈值 ${DELAY_THRESHOLD} 分钟）${linked.length ? `，按 ${linked.map((route) => route.name).join('、')} 测算` : '，本段无关联绕行路线'}。`,
    }
  }
  if (kind === '救护通道') {
    if (stage.lanes.includes('全封闭')) {
      return { level: '高', title: '救护通道中断风险', detail: '全封闭期间将切断区域急救中心南门通道，必须保留 4 米应急通道并每 15 分钟巡查一次。' }
    }
    if (stage.lanes.includes('收窄') || stage.lanes.includes('占用')) {
      return { level: '中', title: '救护通行需引导', detail: '车道收窄期间救护车辆可低速通过，需安排现场引导岗。' }
    }
    return { level: '低', title: '救护通道贯通', detail: '急救中心南门通道保持贯通，无需额外措施。' }
  }
  const hit = ADJACENT_PROJECTS.find((project) => !(stage.end < project.start || stage.start > project.end))
  if (hit) {
    return { level: '高', title: '相邻工程时间重叠', detail: `与${hit.name}（${hit.start} 至 ${hit.end}，${hit.note}）工期重叠，建议错峰或联合导改。` }
  }
  return { level: '低', title: '相邻工程无冲突', detail: '与相邻工程施工窗口无时间重叠。' }
}

function buildChecks(core: SchemeCore, version: number): ImpactCheck[] {
  return core.stages.flatMap((stage) =>
    CHECK_KINDS.map((kind) => ({
      id: `CK-${stage.id}-${kind}`,
      kind,
      segmentId: stage.id,
      status: '有效' as const,
      computedVersion: version,
      ...computeCheck(kind, stage, core),
    })),
  )
}

/** 把失效检测按当前方案内容重算（模拟检测服务跑完一批） */
export function recomputeInvalidated(scheme: VersionedScheme): string[] {
  const done: string[] = []
  for (const check of scheme.checks) {
    if (check.status !== '重算中') continue
    const stage = scheme.current.stages.find((item) => item.id === check.segmentId)
    if (!stage) continue
    Object.assign(check, computeCheck(check.kind, stage, scheme.current), {
      status: '有效' as const,
      computedVersion: scheme.version,
    })
    done.push(check.id)
  }
  return done
}

function invalidateChecks(scheme: VersionedScheme, stageIds: string[]): string[] {
  const ids = scheme.checks.filter((check) => stageIds.includes(check.segmentId)).map((check) => check.id)
  for (const check of scheme.checks) {
    if (ids.includes(check.id)) check.status = '重算中'
  }
  return ids
}

function pushVersion(scheme: VersionedScheme, cause: VersionEntry['cause'], actor: Actor | '系统', summary: string, invalidatedChecks: string[]): VersionEntry {
  const entry: VersionEntry = {
    version: scheme.version,
    cause,
    author: actor === '系统' ? '系统' : actor.author,
    unit: actor === '系统' ? '系统' : actor.unit,
    summary,
    createdAt: now(),
    invalidatedChecks,
    snapshot: clone(scheme.current),
  }
  scheme.versions.push(entry)
  scheme.log.push(`[${entry.createdAt}] v${entry.version} · ${entry.cause} · ${summary}`)
  return entry
}

// ---------------------------------------------------------------------------
// 迁移：旧数据没有版本锚点，按原有内容迁移成首版
// ---------------------------------------------------------------------------

function inferTopic(comment: { content: string; condition?: string }): string {
  const text = `${comment.content}${comment.condition ?? ''}`
  if (/公交|站点|导乘/.test(text)) return '公交站点'
  if (/急救|应急|救护|通道/.test(text)) return '应急通道'
  if (/信号|配时|延误/.test(text)) return '信号配时'
  return '围挡范围'
}

function nearestStageId(detour: { coordinates: [number, number][] }, stages: ClosureStage[]): string {
  let best = stages[0]?.id ?? ''
  let bestDist = Number.POSITIVE_INFINITY
  for (const stage of stages) {
    for (const a of detour.coordinates) {
      for (const b of stage.route) {
        const dist = (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2
        if (dist < bestDist) { bestDist = dist; best = stage.id }
      }
    }
  }
  return best
}

export function migrateLegacy(raw: any): VersionedScheme {
  const stages: ClosureStage[] = (raw.stages ?? []).map((stage: any) => ({ ...stage, versionAnchor: 1 }))
  const detours: DetourRoute[] = (raw.detours ?? []).map((route: any) => ({
    ...route,
    stageId: route.stageId ?? nearestStageId(route, stages),
    versionAnchor: 1,
  }))
  const comments: SegmentComment[] = (raw.comments ?? []).map((comment: any) => ({
    ...comment,
    key: comment.key ?? `${comment.segmentId}:${inferTopic(comment)}`,
    versionAnchor: 1,
    resolvedVersion: comment.status && comment.status !== '待处理' ? 1 : undefined,
  }))
  const core: SchemeCore = { stages, detours, comments }
  const scheme: VersionedScheme = {
    meta: { id: raw.id, project: raw.project, contractor: raw.contractor, area: raw.area },
    version: 1,
    current: core,
    checks: buildChecks(core, 1),
    versions: [],
    held: [],
    log: [],
  }
  pushVersion(scheme, '迁移', '系统', `旧数据无版本锚点（原标注 v${raw.version ?? '?'}），按原有内容迁移为首版，封路范围、绕行路线与会签条件接入同一方案版本`, [])
  return scheme
}

// ---------------------------------------------------------------------------
// 分段调整：失效重算受影响检测，其他单位确认结果保留
// ---------------------------------------------------------------------------

const RECALC_KEYS: (keyof ClosureStage)[] = ['start', 'end', 'lanes', 'route']

export function applyStagePatch(scheme: VersionedScheme, stageId: string, patch: Partial<ClosureStage>, actor: Actor, summary?: string): VersionEntry | null {
  const stage = scheme.current.stages.find((item) => item.id === stageId)
  if (!stage) return null
  scheme.version += 1
  Object.assign(stage, patch)
  stage.versionAnchor = scheme.version
  const affectsChecks = RECALC_KEYS.some((key) => key in patch)
  const invalidated = affectsChecks ? invalidateChecks(scheme, [stageId]) : []
  return pushVersion(scheme, '编辑', actor, summary ?? `调整 ${stage.name}`, invalidated)
}

// ---------------------------------------------------------------------------
// 会签条件提交：先到者生效，后到者拿到冲突并保留现场
// ---------------------------------------------------------------------------

function nextCommentId(core: SchemeCore): string {
  const max = core.comments.reduce((acc, comment) => {
    const num = Number(comment.id.replace(/\D/g, ''))
    return Number.isFinite(num) ? Math.max(acc, num) : acc
  }, 0)
  return `CM-${max + 1}`
}

export function submitCondition(scheme: VersionedScheme, payload: ConditionPayload, baseVersion: number): SubmitResult {
  if (baseVersion !== scheme.version) {
    // 起草期间已有他人提交（同一条件先到者生效），后到者保留现场
    const winner = scheme.current.comments.find((comment) => comment.key === payload.key)
    const head = scheme.versions[scheme.versions.length - 1]
    const held: HeldSubmission = {
      id: `HELD-${scheme.held.length + 1}-${Date.now() % 1000}`,
      payload: clone(payload),
      baseVersion,
      currentVersion: scheme.version,
      conflictWith: winner
        ? { unit: winner.unit, author: winner.author, version: winner.versionAnchor }
        : { unit: head?.unit ?? '系统', author: head?.author ?? '系统', version: scheme.version },
      heldAt: now(),
    }
    scheme.held.push(held)
    scheme.log.push(`[${held.heldAt}] 冲突保留 · ${payload.unit} 基于 v${baseVersion} 提交「${payload.key}」，当前已到 v${scheme.version}`)
    return { ok: false, held }
  }
  scheme.version += 1
  const comment: SegmentComment = { id: nextCommentId(scheme.current), ...clone(payload), status: '待处理', versionAnchor: scheme.version }
  scheme.current.comments.push(comment)
  pushVersion(scheme, '条件提交', { unit: payload.unit, author: payload.author }, `${payload.unit} 提交 ${payload.segmentId} 会签条件（${payload.key.split(':')[1]}）`, [])
  return { ok: true, version: scheme.version }
}

/** 冲突保留的提交基于当前版本重新提交，作为同一条件的补充会签意见入档 */
export function resubmitHeld(scheme: VersionedScheme, heldId: string): SubmitResult | null {
  const index = scheme.held.findIndex((item) => item.id === heldId)
  if (index < 0) return null
  const held = scheme.held[index]
  const result = submitCondition(scheme, held.payload, scheme.version)
  if (result.ok) scheme.held.splice(index, 1)
  return result
}

export function discardHeld(scheme: VersionedScheme, heldId: string): void {
  scheme.held = scheme.held.filter((item) => item.id !== heldId)
}

// ---------------------------------------------------------------------------
// 会签处理与复核
// ---------------------------------------------------------------------------

export function resolveComment(scheme: VersionedScheme, commentId: string, status: '已接受' | '已退回', actor: Actor): VersionEntry | null {
  const comment = scheme.current.comments.find((item) => item.id === commentId)
  if (!comment) return null
  scheme.version += 1
  comment.status = status
  comment.resolvedVersion = scheme.version
  return pushVersion(scheme, '会签处理', actor, `${actor.unit} 将 ${comment.segmentId} 条件标记为${status}`, [])
}

/** 复核失败后按版本号恢复：以历史版本快照生成新的头版本，历史不丢 */
export function restoreVersion(scheme: VersionedScheme, target: number, actor: Actor, summary?: string, tweak?: (core: SchemeCore) => void): VersionEntry | null {
  const entry = scheme.versions.find((item) => item.version === target)
  if (!entry) return null
  scheme.version += 1
  scheme.current = clone(entry.snapshot)
  tweak?.(scheme.current)
  const invalidated = invalidateChecks(scheme, scheme.current.stages.map((stage) => stage.id))
  return pushVersion(scheme, '版本恢复', actor, summary ?? `按版本号恢复至 v${target}`, invalidated)
}

// ---------------------------------------------------------------------------
// 版本比较
// ---------------------------------------------------------------------------

export interface DiffItem {
  type: '新增' | '删除' | '修改'
  text: string
}

export function diffSnapshots(before: SchemeCore, after: SchemeCore): DiffItem[] {
  const items: DiffItem[] = []
  for (const stage of after.stages) {
    const old = before.stages.find((item) => item.id === stage.id)
    if (!old) { items.push({ type: '新增', text: `${stage.id} ${stage.name}` }); continue }
    if (old.name !== stage.name) items.push({ type: '修改', text: `${stage.id} 名称：${old.name} → ${stage.name}` })
    if (old.start !== stage.start || old.end !== stage.end) items.push({ type: '修改', text: `${stage.id} 时间：${old.start}~${old.end} → ${stage.start}~${stage.end}` })
    if (old.lanes !== stage.lanes) items.push({ type: '修改', text: `${stage.id} 车道方案：${old.lanes} → ${stage.lanes}` })
    if (JSON.stringify(old.route) !== JSON.stringify(stage.route)) items.push({ type: '修改', text: `${stage.id} 封路边界几何调整` })
    if (old.status !== stage.status) items.push({ type: '修改', text: `${stage.id} 状态：${old.status} → ${stage.status}` })
  }
  for (const stage of before.stages) {
    if (!after.stages.some((item) => item.id === stage.id)) items.push({ type: '删除', text: `${stage.id} ${stage.name}` })
  }
  for (const route of after.detours) {
    const old = before.detours.find((item) => item.id === route.id)
    if (!old) { items.push({ type: '新增', text: `绕行 ${route.name}` }); continue }
    if (old.extraMinutes !== route.extraMinutes || old.distance !== route.distance) {
      items.push({ type: '修改', text: `绕行 ${route.name}：${old.distance}km/${old.extraMinutes}min → ${route.distance}km/${route.extraMinutes}min` })
    }
  }
  for (const route of before.detours) {
    if (!after.detours.some((item) => item.id === route.id)) items.push({ type: '删除', text: `绕行 ${route.name}` })
  }
  const added = after.comments.filter((comment) => !before.comments.some((item) => item.id === comment.id))
  for (const comment of added) items.push({ type: '新增', text: `会签 ${comment.segmentId}（${comment.unit}）：${comment.content.slice(0, 24)}…` })
  for (const comment of after.comments) {
    const old = before.comments.find((item) => item.id === comment.id)
    if (old && old.status !== comment.status) items.push({ type: '修改', text: `会签 ${comment.segmentId}（${comment.unit}）：${old.status} → ${comment.status}` })
  }
  return items
}
