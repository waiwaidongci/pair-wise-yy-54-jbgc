export type StageStatus = '待协商' | '条件通过' | '已批准' | '退回'

export interface ClosureStage {
  id: string
  name: string
  start: string
  end: string
  lanes: string
  status: StageStatus
  route: [number, number][]
}

export interface DetourRoute {
  id: string
  name: string
  distance: number
  extraMinutes: number
  coordinates: [number, number][]
}

export interface SegmentComment {
  id: string
  segmentId: string
  unit: '建设' | '交通' | '公交' | '应急'
  author: string
  content: string
  condition?: string
  status: '待处理' | '已接受' | '已退回'
  createdAt?: string
}

/** 衍生分析项：由某个施工段驱动，调整后失效并重算 */
export type DerivedType = 'bus' | 'detour' | 'ambulance' | 'adjacent'
export type DerivedStatus = 'fresh' | 'stale' | 'calculating'

export interface DerivedItem {
  id: string
  type: DerivedType
  label: string
  segmentId: string
  status: DerivedStatus
  basedOnVersion: number
  summary: string
  metrics: Record<string, number | string>
}

export type ReviewStatus = '未提交' | '复核中' | '通过' | '复核失败'

/** 会签条件提交：携带所见版本号用于乐观并发控制 */
export interface SubmissionInput {
  segmentId: string
  unit: '建设' | '交通' | '公交' | '应急'
  author: string
  content: string
  condition: string
  baseVersion: number
}

/** 后到者拿到的冲突：保留现场，不覆盖 */
export interface SubmissionConflict {
  id: string
  at: string
  baseVersion: number
  currentVersion: number
  submission: SubmissionInput
  winner: { id: string; author: string; at: string }
}

/** 版本快照：方案在某一版本的完整内容（不含版本日志本身） */
export interface SchemeSnapshot {
  id: string
  project: string
  contractor: string
  area: string
  version: number
  stages: ClosureStage[]
  detours: DetourRoute[]
  comments: SegmentComment[]
  derived: DerivedItem[]
}

export interface SchemeVersion {
  version: number
  timestamp: string
  author: string
  summary: string
  snapshot: SchemeSnapshot
}

export interface Scheme {
  id: string
  project: string
  contractor: string
  area: string
  version: number
  stages: ClosureStage[]
  detours: DetourRoute[]
  comments: SegmentComment[]
  derived: DerivedItem[]
  reviewStatus: ReviewStatus
  reviewBaseVersion: number | null
  migrated: boolean
}
