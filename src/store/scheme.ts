import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { ConditionPayload, SegmentComment, VersionedScheme } from '../versioning/model'
import { backend, CURRENT_USER } from '../versioning/backend'

export const useSchemeStore = defineStore('scheme', () => {
  const state = ref<VersionedScheme>(structuredClone(backend.state))
  backend.subscribe(() => { state.value = structuredClone(backend.state) })

  const selectedStageId = ref('ST-01')
  const selectedCommentId = ref('CM-41')
  const drawing = ref(false)
  const draftRoute = ref<[number, number][]>([])

  /** 兼容旧视图的结构：元信息 + 当前版本内容 */
  const scheme = computed(() => ({
    ...state.value.meta,
    version: state.value.version,
    stages: state.value.current.stages,
    detours: state.value.current.detours,
    comments: state.value.current.comments,
  }))
  const versions = computed(() => state.value.versions)
  const checks = computed(() => state.value.checks)
  const held = computed(() => state.value.held)
  const log = computed(() => state.value.log)
  const headVersion = computed(() => state.value.versions[state.value.versions.length - 1])
  const selectedStage = computed(() => state.value.current.stages.find((item) => item.id === selectedStageId.value))
  const selectedComment = computed(() => state.value.current.comments.find((item) => item.id === selectedCommentId.value))
  /** 生效中的中高风险检测 */
  const conflicts = computed(() => state.value.checks.filter((check) => check.level !== '低'))
  const dirty = computed(() => state.value.version > 1)

  function checksFor(stageId: string) {
    return state.value.checks.filter((check) => check.segmentId === stageId)
  }

  /** 会签确认结果保留，但分段在确认之后又被调整过时标记锚点过期 */
  function commentStale(comment: SegmentComment) {
    const stage = state.value.current.stages.find((item) => item.id === comment.segmentId)
    if (!stage || comment.status === '待处理') return false
    return (comment.resolvedVersion ?? comment.versionAnchor) < stage.versionAnchor
  }

  function startDraw() { drawing.value = true; draftRoute.value = [] }
  function addPoint(point: [number, number]) { if (drawing.value) draftRoute.value.push(point) }
  function finishDraw() {
    if (draftRoute.value.length >= 2 && selectedStageId.value) {
      backend.applyStagePatch(selectedStageId.value, { route: [...draftRoute.value], status: '待协商' }, CURRENT_USER, `重绘 ${selectedStageId.value} 封路边界`)
    }
    drawing.value = false
    draftRoute.value = []
  }
  function updateStage(patch: Record<string, unknown>) {
    if (!selectedStageId.value) return
    backend.applyStagePatch(selectedStageId.value, { ...patch, status: '待协商' }, CURRENT_USER)
  }
  function resolveComment(id: string, status: '已接受' | '已退回') {
    backend.resolveComment(id, status, CURRENT_USER)
  }
  function submitCondition(payload: ConditionPayload, baseVersion: number) {
    return backend.submitCondition(payload, baseVersion)
  }
  function resubmitHeld(heldId: string) { return backend.resubmitHeld(heldId) }
  function discardHeld(heldId: string) { backend.discardHeld(heldId) }
  /** 复核失败后按版本号恢复 */
  function restoreVersion(target: number, summary?: string) {
    return backend.restoreVersion(target, CURRENT_USER, summary)
  }
  function failReview(stageId: string, target: number) {
    const stage = state.value.current.stages.find((item) => item.id === stageId)
    return backend.restoreVersion(target, CURRENT_USER, `复核失败：${stage?.name ?? stageId} 按版本号恢复至 v${target}`, (core) => {
      const item = core.stages.find((entry) => entry.id === stageId)
      if (item) item.status = '退回'
    })
  }
  function passReview(stageId: string) {
    const stage = state.value.current.stages.find((item) => item.id === stageId)
    backend.applyStagePatch(stageId, { status: '已批准' }, CURRENT_USER, `复核通过：${stage?.name ?? stageId}`)
  }
  /** 撤销 = 按版本号恢复到上一版 */
  function undo() {
    if (state.value.version > 1) backend.restoreVersion(state.value.version - 1, CURRENT_USER, '撤销最近一次变更')
  }

  return {
    state, scheme, versions, checks, held, log, headVersion, conflicts, dirty,
    selectedStageId, selectedCommentId, selectedStage, selectedComment, drawing, draftRoute,
    checksFor, commentStale, startDraw, addPoint, finishDraw, updateStage, resolveComment,
    submitCondition, resubmitHeld, discardHeld, restoreVersion, failReview, passReview, undo,
  }
})
