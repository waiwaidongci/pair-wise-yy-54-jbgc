import type { Actor, ConditionPayload, SubmitResult, VersionedScheme } from './model'
import * as engine from './engine'
import { legacySeed } from './seed'

const STORAGE_KEY = 'yy54-road-scheme-v2'
const LEGACY_STORAGE_KEY = 'yy54-road-scheme-v1'

/** 重算批处理模拟耗时，让“失效 → 重算 → 有效”在界面上可见 */
const RECALC_DELAY = 600

function load(): VersionedScheme {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (raw) return JSON.parse(raw)
  // 旧数据没有版本锚点：按原有内容迁移成首版，旧 key 保留存档
  const legacy = localStorage.getItem(LEGACY_STORAGE_KEY)
  const scheme = engine.migrateLegacy(legacy ? JSON.parse(legacy) : legacySeed)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(scheme))
  return scheme
}

/**
 * 方案后端（前端模拟）：所有写操作唯一入口，保证
 * 封路范围 / 绕行路线 / 会签条件挂在同一个方案版本上。
 */
class SchemeBackend {
  state: VersionedScheme = load()
  private listeners = new Set<() => void>()
  private timer: ReturnType<typeof setTimeout> | undefined

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private persistAndNotify() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state))
    this.listeners.forEach((listener) => listener())
  }

  /** 受影响检测先置为失效，随后按当前方案内容重算 */
  private scheduleRecompute() {
    clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      engine.recomputeInvalidated(this.state)
      this.persistAndNotify()
    }, RECALC_DELAY)
  }

  applyStagePatch(stageId: string, patch: Parameters<typeof engine.applyStagePatch>[2], actor: Actor, summary?: string) {
    const entry = engine.applyStagePatch(this.state, stageId, patch, actor, summary)
    if (entry) {
      this.persistAndNotify()
      if (entry.invalidatedChecks.length) this.scheduleRecompute()
    }
    return entry
  }

  submitCondition(payload: ConditionPayload, baseVersion: number): SubmitResult {
    const result = engine.submitCondition(this.state, payload, baseVersion)
    this.persistAndNotify()
    return result
  }

  resubmitHeld(heldId: string) {
    const result = engine.resubmitHeld(this.state, heldId)
    if (result) this.persistAndNotify()
    return result
  }

  discardHeld(heldId: string) {
    engine.discardHeld(this.state, heldId)
    this.persistAndNotify()
  }

  resolveComment(commentId: string, status: '已接受' | '已退回', actor: Actor) {
    const entry = engine.resolveComment(this.state, commentId, status, actor)
    if (entry) this.persistAndNotify()
    return entry
  }

  restoreVersion(target: number, actor: Actor, summary?: string, tweak?: Parameters<typeof engine.restoreVersion>[4]) {
    const entry = engine.restoreVersion(this.state, target, actor, summary, tweak)
    if (entry) {
      this.persistAndNotify()
      this.scheduleRecompute()
    }
    return entry
  }
}

export const backend = new SchemeBackend()

/** 当前操作人（演示环境固定为建设组） */
export const CURRENT_USER: Actor = { unit: '建设', author: '张惟' }
