export type Unit = '建设' | '交通' | '公交' | '应急'
export type StageStatus = '待协商' | '条件通过' | '已批准' | '退回'
export type CommentStatus = '待处理' | '已接受' | '已退回'
export type CheckKind = '公交覆盖' | '绕行时延' | '救护通道' | '相邻工程'
export type CheckStatus = '有效' | '重算中'
export type Level = '高' | '中' | '低'
export type VersionCause = '迁移' | '编辑' | '条件提交' | '会签处理' | '版本恢复'

export interface ClosureStage {
  id: string
  name: string
  start: string
  end: string
  lanes: string
  status: StageStatus
  route: [number, number][]
  /** 最后一次修改该分段时的方案版本号 */
  versionAnchor: number
}

export interface DetourRoute {
  id: string
  name: string
  /** 关联的施工分段，路段调整时据此级联重算绕行时延 */
  stageId: string
  distance: number
  extraMinutes: number
  coordinates: [number, number][]
  versionAnchor: number
}

export interface SegmentComment {
  id: string
  /** 同一条件标识：分段 + 主题，两家单位提交同一条件时据此判定冲突 */
  key: string
  segmentId: string
  unit: Unit
  author: string
  content: string
  condition?: string
  status: CommentStatus
  /** 提交时的方案版本号 */
  versionAnchor: number
  /** 会签处理时的方案版本号，低于分段锚点即视为锚点过期 */
  resolvedVersion?: number
}

export interface SchemeCore {
  stages: ClosureStage[]
  detours: DetourRoute[]
  comments: SegmentComment[]
}

export interface ImpactCheck {
  id: string
  kind: CheckKind
  segmentId: string
  level: Level
  title: string
  detail: string
  status: CheckStatus
  /** 计算所基于的方案版本号 */
  computedVersion: number
}

export interface VersionEntry {
  version: number
  cause: VersionCause
  author: string
  unit: Unit | '系统'
  summary: string
  createdAt: string
  /** 本次变更导致失效重算的影响检测 */
  invalidatedChecks: string[]
  snapshot: SchemeCore
}

export interface ConditionPayload {
  key: string
  segmentId: string
  unit: Unit
  author: string
  content: string
  condition?: string
}

export interface HeldSubmission {
  id: string
  payload: ConditionPayload
  /** 提交者起草时基于的版本 */
  baseVersion: number
  /** 冲突发生时的当前版本 */
  currentVersion: number
  /** 先到者（已生效的提交） */
  conflictWith: { unit: Unit | '系统'; author: string; version: number }
  heldAt: string
}

export interface SchemeMeta {
  id: string
  project: string
  contractor: string
  area: string
}

export interface VersionedScheme {
  meta: SchemeMeta
  version: number
  current: SchemeCore
  checks: ImpactCheck[]
  versions: VersionEntry[]
  /** 冲突后保留现场的提交 */
  held: HeldSubmission[]
  log: string[]
}

export type SubmitResult =
  | { ok: true; version: number }
  | { ok: false; held: HeldSubmission }

export interface Actor {
  unit: Unit
  author: string
}
