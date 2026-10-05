import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type {
  ClosureStage,
  DerivedItem,
  Scheme,
  SchemeSnapshot,
  SchemeVersion,
  SegmentComment,
  SubmissionConflict,
  SubmissionInput,
} from '../types'

const STORAGE_KEY = 'yy54-road-scheme-v2'

const seed: Scheme = {
  id: 'RC-2026-0918', project: '云河路快速化改造', contractor: '市政建设集团第三工程处', area: '云河路 / 江海大道', version: 7,
  stages: [
    { id: 'ST-01', name: '第一阶段 · 东半幅围挡', start: '2026-10-08', end: '2026-10-22', lanes: '双向 4 车道收窄为 2 车道', status: '条件通过', route: [[121.470,31.228],[121.482,31.231],[121.496,31.235]] },
    { id: 'ST-02', name: '第二阶段 · 路口夜间施工', start: '2026-10-23', end: '2026-11-05', lanes: '22:00–05:00 全封闭', status: '待协商', route: [[121.496,31.235],[121.508,31.238],[121.516,31.242]] },
    { id: 'ST-03', name: '第三阶段 · 西半幅恢复', start: '2026-11-06', end: '2026-11-18', lanes: '西侧公交专用道临时占用', status: '退回', route: [[121.452,31.224],[121.462,31.226],[121.470,31.228]] },
  ],
  detours: [
    { id: 'DR-01', name: '江海大道—滨河路绕行', distance: 4.8, extraMinutes: 11, coordinates: [[121.470,31.228],[121.478,31.214],[121.502,31.218],[121.516,31.242]] },
    { id: 'DR-02', name: '云河路辅道保通', distance: 2.3, extraMinutes: 6, coordinates: [[121.452,31.224],[121.462,31.219],[121.496,31.235]] },
  ],
  comments: [
    { id: 'CM-41', segmentId: 'ST-01', unit: '公交', author: '顾敏', content: '17 路、806 路临时站点与云河路站距离 680 米，超过老年乘客可接受步行距离。', condition: '需在江海大道口增设临时站并配置导乘人员。', status: '待处理' },
    { id: 'CM-42', segmentId: 'ST-02', unit: '应急', author: '夏川', content: '夜间全封闭期间，区域急救中心南门通道被切断。', condition: '保留 4 米应急通道，路口导改每 15 分钟巡查一次。', status: '已接受' },
    { id: 'CM-43', segmentId: 'ST-03', unit: '交通', author: '郑航', content: '公交专用道占用导致高峰小时延误增加 19 分钟，超过方案阈值。', condition: '缩减围挡 1.5 米并调整信号配时。', status: '已退回' },
  ],
  derived: [
    { id: 'DRV-BUS', type: 'bus', label: '公交覆盖', segmentId: 'ST-01', status: 'fresh', basedOnVersion: 7, summary: '17 路与 806 路临时站距现状站 680 米，已超过 500 米阈值', metrics: { gap: 680, covered: 8, threshold: 500 } },
    { id: 'DRV-DETOUR', type: 'detour', label: '绕行时延', segmentId: 'ST-03', status: 'fresh', basedOnVersion: 7, summary: '高峰绕行新增 19 分钟，超过方案设定的 15 分钟阈值', metrics: { extraMinutes: 19, threshold: 15 } },
    { id: 'DRV-AMB', type: 'ambulance', label: '救护通道', segmentId: 'ST-02', status: 'fresh', basedOnVersion: 7, summary: '夜间全封闭将切断区域急救中心南门，必须保留 4 米应急通道', metrics: { corridorOpen: 0 } },
    { id: 'DRV-ADJ', type: 'adjacent', label: '相邻工程', segmentId: 'ST-02', status: 'fresh', basedOnVersion: 7, summary: '10 月 26–30 日江海大道东段同步占用慢车道，建议错峰 4 天', metrics: { overlapDays: 5 } },
  ],
  reviewStatus: '未提交',
  reviewBaseVersion: null,
  migrated: false,
}

function overlapDays(aStart: string, aEnd: string, bStart: string, bEnd: string): number {
  const s = Math.max(new Date(aStart).getTime(), new Date(bStart).getTime())
  const e = Math.min(new Date(aEnd).getTime(), new Date(bEnd).getTime())
  if (Number.isNaN(s) || Number.isNaN(e) || e < s) return 0
  return Math.round((e - s) / 86400000) + 1
}

/** 依据路段几何与日期重算衍生分析项，结果确定性可复现 */
function recomputeDerived(item: DerivedItem, scheme: Scheme): { summary: string; metrics: Record<string, number | string> } {
  const stage = scheme.stages.find((s) => s.id === item.segmentId)
  if (!stage) return { summary: '路段已调整，等待重算', metrics: {} }
  const routeLen = stage.route.length
  switch (item.type) {
    case 'bus': {
      const gap = Math.max(120, Math.round(380 + routeLen * 42 + (stage.name.includes('夜间') ? 60 : 0)))
      const covered = Math.max(2, 12 - Math.floor(gap / 150))
      return { summary: `封路后公交站点覆盖缺口 ${gap} 米，影响站点 ${covered} 个`, metrics: { gap, covered, threshold: 500 } }
    }
    case 'detour': {
      const extra = Math.max(3, Math.round(6 + routeLen * 1.4 + (stage.lanes.includes('全封闭') ? 7 : 0)))
      return { summary: `绕行时延新增 ${extra} 分钟，${extra > 15 ? '超过 15 分钟阈值' : '在阈值内'}`, metrics: { extraMinutes: extra, threshold: 15 } }
    }
    case 'ambulance': {
      const blocked = stage.name.includes('夜间') || stage.lanes.includes('全封闭')
      return { summary: blocked ? '夜间全封闭切断救护通道，需保留 4 米应急通道' : '救护通道保持畅通', metrics: { corridorOpen: blocked ? 0 : 1 } }
    }
    case 'adjacent': {
      const overlap = overlapDays(stage.start, stage.end, '2026-10-26', '2026-10-30')
      return { summary: overlap > 0 ? `相邻雨污分流工程时间重叠 ${overlap} 天，建议错峰` : '相邻工程无时间重叠', metrics: { overlapDays: overlap } }
    }
  }
}

export const useSchemeStore = defineStore('scheme', () => {
  const scheme = ref<Scheme>(structuredClone(seed))
  const versionLog = ref<SchemeVersion[]>([])
  const history = ref<string[]>([])
  const submissionConflicts = ref<SubmissionConflict[]>([])
  const recalculating = ref(false)
  const selectedStageId = ref('ST-01')
  const selectedCommentId = ref('CM-41')
  const drawing = ref(false)
  const draftRoute = ref<[number, number][]>([])

  const selectedStage = computed(() => scheme.value.stages.find((item) => item.id === selectedStageId.value))
  const selectedComment = computed(() => scheme.value.comments.find((item) => item.id === selectedCommentId.value))
  const dirty = computed(() => history.value.length > 0)
  const latestVersion = computed(() => versionLog.value[versionLog.value.length - 1]?.version ?? scheme.value.version)
  const currentVersionEntry = computed(() => versionLog.value.find((e) => e.version === scheme.value.version))

  /** 规则检测结果：由衍生分析项驱动，失效项给出“结果失效”提示 */
  const conflicts = computed(() => {
    const out: { id: string; level: '高' | '中'; segmentId: string; title: string; detail: string }[] = []
    for (const d of scheme.value.derived) {
      if (d.status === 'stale' || d.status === 'calculating') {
        out.push({ id: `${d.id}-stale`, level: '中', segmentId: d.segmentId, title: `${d.label}结果已失效`, detail: `基于 v${d.basedOnVersion}，路段调整后正在重算…` })
        continue
      }
      const m = d.metrics
      if (d.type === 'bus' && Number(m.gap) > 500) out.push({ id: d.id, level: '中', segmentId: d.segmentId, title: '公交站点覆盖缺口', detail: d.summary })
      else if (d.type === 'detour' && Number(m.extraMinutes) > 15) out.push({ id: d.id, level: '高', segmentId: d.segmentId, title: '绕行延误超阈值', detail: d.summary })
      else if (d.type === 'ambulance' && Number(m.corridorOpen) === 0) out.push({ id: d.id, level: '高', segmentId: d.segmentId, title: '救护通道中断风险', detail: d.summary })
      else if (d.type === 'adjacent' && Number(m.overlapDays) > 0) out.push({ id: d.id, level: '高', segmentId: d.segmentId, title: '相邻工程时间重叠', detail: d.summary })
    }
    return out
  })

  function snapshot(): SchemeSnapshot {
    const s = scheme.value
    return {
      id: s.id, project: s.project, contractor: s.contractor, area: s.area, version: s.version,
      stages: JSON.parse(JSON.stringify(s.stages)),
      detours: JSON.parse(JSON.stringify(s.detours)),
      comments: JSON.parse(JSON.stringify(s.comments)),
      derived: JSON.parse(JSON.stringify(s.derived)),
    }
  }

  function persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      scheme: scheme.value, versionLog: versionLog.value,
      history: history.value, submissionConflicts: submissionConflicts.value,
    }))
  }

  /** 旧数据没有版本锚点：按原有内容迁移成首版，内容不丢、锚点补齐 */
  function migrateIfNeeded() {
    if (versionLog.value.length > 0) return
    scheme.value.version = 1
    scheme.value.migrated = true
    scheme.value.derived.forEach((d) => { d.basedOnVersion = 1 })
    versionLog.value = [{
      version: 1, timestamp: new Date().toISOString(), author: '系统迁移',
      summary: '旧数据无版本锚点，按原有内容迁移为首版',
      snapshot: snapshot(),
    }]
    persist()
  }

  /** 统一提交：先压入撤销栈，应用变更，再生成新版本锚点 */
  function commit(author: string, summary: string, fn: () => void) {
    history.value.push(JSON.stringify(scheme.value))
    fn()
    scheme.value.version += 1
    versionLog.value.push({
      version: scheme.value.version, timestamp: new Date().toISOString(),
      author, summary, snapshot: snapshot(),
    })
    persist()
  }

  /** 路段调整后：受影响的衍生项失效并重算，其他单位已确认结果保留 */
  function recalcDerived(segmentId: string) {
    recalculating.value = true
    scheme.value.derived.forEach((d) => { if (d.segmentId === segmentId) d.status = 'stale' })
    persist()
    window.setTimeout(() => {
      for (const d of scheme.value.derived) {
        if (d.segmentId !== segmentId) continue
        const fresh = recomputeDerived(d, scheme.value)
        d.status = 'fresh'
        d.basedOnVersion = scheme.value.version
        d.summary = fresh.summary
        d.metrics = fresh.metrics
      }
      recalculating.value = false
      persist()
    }, 650)
  }

  function startDraw() { drawing.value = true; draftRoute.value = [] }
  function addPoint(point: [number, number]) { if (drawing.value) draftRoute.value.push(point) }
  function finishDraw() {
    if (draftRoute.value.length >= 2) {
      const stage = selectedStage.value
      if (stage) {
        const segmentId = stage.id
        commit('建设组', `重绘阶段 ${stage.id} 封路范围`, () => {
          stage.route = [...draftRoute.value]
          stage.status = '待协商'
        })
        recalcDerived(segmentId)
      }
    }
    drawing.value = false
    draftRoute.value = []
  }
  function updateStage(patch: Partial<ClosureStage>) {
    const stage = selectedStage.value
    if (!stage) return
    const segmentId = stage.id
    commit('建设组', `调整阶段 ${stage.id} 条件`, () => {
      Object.assign(stage, patch)
      stage.status = '待协商'
    })
    recalcDerived(segmentId)
  }
  function resolveComment(id: string, status: SegmentComment['status']) {
    const comment = scheme.value.comments.find((item) => item.id === id)
    if (!comment) return
    commit('审批组', `处理会签意见 ${id}`, () => { comment.status = status })
  }

  /**
   * 两家单位同时提交同一条件：先到者生效，后到者拿到冲突并保留现场。
   * 提交携带所见版本号，版本不一致即判冲突，不覆盖、不丢稿。
   */
  function submitCondition(input: SubmissionInput): { ok: true; comment: SegmentComment } | { ok: false; conflict: SubmissionConflict } {
    if (input.baseVersion !== scheme.value.version) {
      const winner = scheme.value.comments[scheme.value.comments.length - 1]
      const conflict: SubmissionConflict = {
        id: `SC-${Date.now()}`,
        at: new Date().toISOString(),
        baseVersion: input.baseVersion,
        currentVersion: scheme.value.version,
        submission: { ...input },
        winner: winner ? { id: winner.id, author: winner.author, at: winner.createdAt ?? '' } : { id: '', author: '', at: '' },
      }
      submissionConflicts.value.unshift(conflict)
      persist()
      return { ok: false, conflict }
    }
    const comment: SegmentComment = {
      id: `CM-${String(scheme.value.comments.length + 41).padStart(2, '0')}`,
      segmentId: input.segmentId,
      unit: input.unit,
      author: input.author,
      content: input.content,
      condition: input.condition || undefined,
      status: '待处理',
      createdAt: new Date().toISOString(),
    }
    commit(input.author, `提交会签条件 ${comment.id}`, () => {
      scheme.value.comments.push(comment)
    })
    return { ok: true, comment }
  }

  /** 提交阶段审批：记录复核基线版本，复核失败后按该版本号恢复 */
  function submitForReview() {
    scheme.value.reviewBaseVersion = scheme.value.version
    scheme.value.reviewStatus = '复核中'
    persist()
  }
  function review(pass: boolean) {
    if (pass) {
      scheme.value.reviewStatus = '通过'
    } else {
      const base = scheme.value.reviewBaseVersion
      if (base != null) restoreVersion(base)
      scheme.value.reviewStatus = '复核失败'
    }
    persist()
  }

  /** 按版本号恢复：用该版本快照覆盖当前内容，版本号回到该版本 */
  function restoreVersion(version: number) {
    const entry = versionLog.value.find((e) => e.version === version)
    if (!entry) return
    const snap = entry.snapshot
    history.value.push(JSON.stringify(scheme.value))
    scheme.value.stages = JSON.parse(JSON.stringify(snap.stages))
    scheme.value.detours = JSON.parse(JSON.stringify(snap.detours))
    scheme.value.comments = JSON.parse(JSON.stringify(snap.comments))
    scheme.value.derived = JSON.parse(JSON.stringify(snap.derived))
    scheme.value.version = version
    scheme.value.reviewStatus = '未提交'
    scheme.value.reviewBaseVersion = null
    persist()
  }

  function undo() {
    const previous = history.value.pop()
    if (!previous) return
    const prev = JSON.parse(previous) as Scheme
    scheme.value.stages = structuredClone(prev.stages)
    scheme.value.detours = structuredClone(prev.detours)
    scheme.value.comments = structuredClone(prev.comments)
    scheme.value.derived = structuredClone(prev.derived)
    scheme.value.version = prev.version
    scheme.value.reviewStatus = prev.reviewStatus
    scheme.value.reviewBaseVersion = prev.reviewBaseVersion
    versionLog.value.pop()
    persist()
  }

  function restore() {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      try {
        const data = JSON.parse(raw)
        if (data.scheme) {
          scheme.value = { ...structuredClone(seed), ...data.scheme }
          versionLog.value = data.versionLog ?? []
          history.value = data.history ?? []
          submissionConflicts.value = data.submissionConflicts ?? []
        }
      } catch { /* 损坏数据忽略，走种子 */ }
    }
    migrateIfNeeded()
  }

  restore()
  return {
    scheme, versionLog, history, submissionConflicts, recalculating,
    selectedStageId, selectedCommentId, selectedStage, selectedComment,
    drawing, draftRoute, conflicts, dirty, latestVersion, currentVersionEntry,
    startDraw, addPoint, finishDraw, updateStage, resolveComment,
    submitCondition, submitForReview, review, restoreVersion, undo,
  }
})
