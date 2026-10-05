<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { Message, Modal } from '@arco-design/web-vue'
import { useSchemeStore } from '../store/scheme'
import { CONDITION_TOPICS, diffSnapshots } from '../versioning/engine'
import type { Unit } from '../versioning/model'

const store = useSchemeStore()

const UNIT_AUTHORS: Record<Unit, string> = { 建设: '张惟', 交通: '郑航', 公交: '顾敏', 应急: '夏川' }
const UNITS: Unit[] = ['建设', '交通', '公交', '应急']

// ---- 会签条件提交：起草时锁定基准版本，提交时校验，后到者冲突保留现场 ----
const form = reactive({ unit: '交通' as Unit, segmentId: 'ST-01', topic: CONDITION_TOPICS[0] as string, content: '', condition: '' })
const formBaseVersion = ref(store.scheme.version)

function submit() {
  if (!form.content.trim()) { Message.warning('请填写意见内容'); return }
  const result = store.submitCondition({
    key: `${form.segmentId}:${form.topic}`,
    segmentId: form.segmentId,
    unit: form.unit,
    author: UNIT_AUTHORS[form.unit],
    content: form.content.trim(),
    condition: form.condition.trim() || undefined,
  }, formBaseVersion.value)
  if (result.ok) {
    Message.success(`已生效，方案升级到 v${result.version}`)
    form.content = ''
    form.condition = ''
    formBaseVersion.value = result.version
  } else {
    Message.warning(`提交冲突：先到者已在 v${result.held.conflictWith.version} 生效，你的稿件已保留现场`)
  }
}

/** 演示：另一单位基于同一版本抢先提交同一条件 */
function simulateRival() {
  const rival = UNITS.find((unit) => unit !== form.unit)!
  const result = store.submitCondition({
    key: `${form.segmentId}:${form.topic}`,
    segmentId: form.segmentId,
    unit: rival,
    author: UNIT_AUTHORS[rival],
    content: `（模拟并行提交）${rival}单位就${form.topic}提出的会签条件。`,
    condition: '按先到者生效规则占位。',
  }, store.scheme.version)
  if (result.ok) Message.info(`${rival}单位已抢先提交同一条件，方案升级到 v${result.version}`)
}

function resubmit(heldId: string) {
  const result = store.resubmitHeld(heldId)
  if (result?.ok) Message.success(`已基于当前版本重新提交，作为同一条件的补充意见入档（v${result.version}）`)
  else Message.error('重新提交仍然冲突，请稍后再试')
}

// ---- 会签处理 ----
function resolve(id: string, status: '已接受' | '已退回') {
  store.resolveComment(id, status)
}

// ---- 阶段复核 ----
const reviewStageId = ref('ST-02')
const reviewChecks = computed(() => store.checksFor(reviewStageId.value))
const reviewBlocked = computed(() => reviewChecks.value.some((check) => check.status === '有效' && check.level === '高'))
function passReview() {
  store.passReview(reviewStageId.value)
  Message.success(`${reviewStageId.value} 复核通过，已批准`)
}
const failModal = reactive({ visible: false, target: 0 })
function openFailModal() {
  failModal.target = store.scheme.version - 1
  failModal.visible = true
}
function confirmFail() {
  store.failReview(reviewStageId.value, failModal.target)
  failModal.visible = false
  Message.warning(`复核失败，已按版本号恢复至 v${failModal.target} 的内容`)
}

// ---- 版本历史与比较 ----
const orderedVersions = computed(() => [...store.versions].reverse())
const compareVersion = ref(store.scheme.version)
const compareEntry = computed(() => store.versions.find((item) => item.version === compareVersion.value))
const diffItems = computed(() => compareEntry.value ? diffSnapshots(compareEntry.value.snapshot, store.state.current) : [])
function restore(version: number) {
  Modal.confirm({
    title: `按版本号恢复至 v${version}`,
    content: '将以该版本快照生成新的头版本，现有历史全部保留。',
    onOk: () => { store.restoreVersion(version); Message.success(`已恢复至 v${version} 的内容`) },
  })
}

function exportNotice() {
  const text = [`${store.scheme.project} 施工封路公开通告`, `范围：${store.scheme.area}`, `版本：v${store.scheme.version}`, '', ...store.scheme.stages.map((stage) => `${stage.start} 至 ${stage.end}｜${stage.name}｜${stage.lanes}`), '', '绕行建议：', ...store.scheme.detours.map((route) => `${route.name}，增加约 ${route.extraMinutes} 分钟`), '', '本通告由建设、交通、公交、应急单位联合确认。'].join('\n')
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = `封路公开通告-${store.scheme.id}-v${store.scheme.version}.txt`
  link.click()
  URL.revokeObjectURL(link.href)
}
</script>

<template>
  <section class="page-head compact"><div><p class="eyebrow">条件会签与版本批复</p><h1>路段意见与阶段审批</h1><p>意见锚定具体路段与方案版本；同一条件两家单位同时提交时先到者生效，后到者冲突保留现场。</p></div><a-button type="primary" @click="exportNotice">导出公开通告包</a-button></section>
  <div class="review-grid">
    <div class="left">
      <article class="card">
        <div class="panel-head"><div><h2>会签意见</h2><p>原意见不可覆盖，处理动作进入审计记录</p></div><a-tag color="orange">{{ store.scheme.comments.filter((item) => item.status === '待处理').length }} 待处理</a-tag></div>
        <button v-for="comment in store.scheme.comments" :key="comment.id" class="comment" :class="{ active: store.selectedCommentId === comment.id }" @click="store.selectedCommentId = comment.id">
          <div class="comment-head"><span>{{ comment.unit }}</span><b>{{ comment.author }}</b><a-tag v-if="store.commentStale(comment)" color="orangered">锚点过期 · 需复核</a-tag><a-tag :color="comment.status === '已接受' ? 'green' : comment.status === '已退回' ? 'red' : 'orange'">{{ comment.status }}</a-tag></div>
          <p>{{ comment.content }}</p><small v-if="comment.condition">条件：{{ comment.condition }}</small><em>锚点 {{ comment.segmentId }} · 提交于 v{{ comment.versionAnchor }}<template v-if="comment.resolvedVersion"> · 处理于 v{{ comment.resolvedVersion }}</template></em>
        </button>
      </article>

      <article class="card">
        <div class="panel-head"><div><h2>提交会签条件</h2><p>基于方案 v{{ formBaseVersion }} 起草；提交前若他人先提交，将拿到冲突并保留现场</p></div></div>
        <a-form layout="vertical" :model="form">
          <div class="three">
            <a-form-item label="单位"><a-select v-model="form.unit"><a-option v-for="unit in UNITS" :key="unit" :value="unit">{{ unit }}</a-option></a-select></a-form-item>
            <a-form-item label="分段"><a-select v-model="form.segmentId"><a-option v-for="stage in store.scheme.stages" :key="stage.id" :value="stage.id">{{ stage.id }}</a-option></a-select></a-form-item>
            <a-form-item label="条件主题"><a-select v-model="form.topic"><a-option v-for="topic in CONDITION_TOPICS" :key="topic" :value="topic">{{ topic }}</a-option></a-select></a-form-item>
          </div>
          <a-form-item label="意见内容"><a-textarea v-model="form.content" :auto-size="{ minRows: 2 }" placeholder="影响说明…" /></a-form-item>
          <a-form-item label="要求条件"><a-input v-model="form.condition" placeholder="可选项，如：保留 4 米应急通道" /></a-form-item>
        </a-form>
        <a-space>
          <a-button type="primary" @click="submit">提交条件</a-button>
          <a-button @click="formBaseVersion = store.scheme.version">刷新基准至 v{{ store.scheme.version }}</a-button>
          <a-button status="warning" @click="simulateRival">模拟他单位同时提交同一条件</a-button>
        </a-space>
      </article>

      <article v-if="store.held.length" class="card held-card">
        <div class="panel-head"><div><h2>冲突保留现场</h2><p>后到者稿件不丢弃，可基于最新版本重新提交</p></div><a-tag color="red">{{ store.held.length }} 份保留</a-tag></div>
        <div v-for="item in store.held" :key="item.id" class="held">
          <div class="held-head"><b>{{ item.payload.unit }} · {{ item.payload.author }}</b><span>{{ item.payload.segmentId }} · {{ item.payload.key.split(':')[1] }}</span></div>
          <p>{{ item.payload.content }}</p>
          <small>基于 v{{ item.baseVersion }} 起草，提交时方案已到 v{{ item.currentVersion }}；先到者：{{ item.conflictWith.unit }} · {{ item.conflictWith.author }}（v{{ item.conflictWith.version }} 生效）</small>
          <a-space style="margin-top:8px"><a-button size="small" type="primary" @click="resubmit(item.id)">基于 v{{ store.scheme.version }} 重新提交</a-button><a-button size="small" status="danger" @click="store.discardHeld(item.id)">放弃稿件</a-button></a-space>
        </div>
      </article>
    </div>

    <div class="right">
      <article class="card">
        <div class="panel-head"><div><h2>阶段条件处理</h2><p>{{ store.selectedComment?.segmentId }} · {{ store.selectedComment?.unit }}</p></div></div>
        <div v-if="store.selectedComment" class="condition"><b>要求条件</b><p>{{ store.selectedComment.condition || '无附加条件' }}</p><b>影响解释</b><p>{{ store.selectedComment.content }}</p></div>
        <a-space><a-button status="danger" :disabled="store.selectedComment?.status !== '待处理'" @click="resolve(store.selectedComment!.id, '已退回')">退回方案</a-button><a-button type="primary" :disabled="store.selectedComment?.status !== '待处理'" @click="resolve(store.selectedComment!.id, '已接受')">接受条件</a-button></a-space>
      </article>

      <article class="card">
        <div class="panel-head"><div><h2>阶段复核</h2><p>存在高风险检测时不可通过；复核失败按版本号恢复</p></div></div>
        <a-form layout="vertical" :model="{ reviewStageId }">
          <a-form-item label="复核阶段"><a-select v-model="reviewStageId"><a-option v-for="stage in store.scheme.stages" :key="stage.id" :value="stage.id">{{ stage.id }} · {{ stage.name }}</a-option></a-select></a-form-item>
        </a-form>
        <div class="review-checks">
          <div v-for="check in reviewChecks" :key="check.id" class="review-check">
            <a-tag :color="check.status === '重算中' ? 'orange' : check.level === '高' ? 'red' : check.level === '中' ? 'orange' : 'green'">{{ check.status === '重算中' ? '重算中' : check.level }}</a-tag>
            <span>{{ check.kind }} · {{ check.title }}</span>
          </div>
        </div>
        <a-space>
          <a-tooltip :content="reviewBlocked ? '存在高风险检测项，需先调整方案' : ''"><a-button type="primary" :disabled="reviewBlocked" @click="passReview">复核通过</a-button></a-tooltip>
          <a-tooltip :content="store.versions.length < 2 ? '暂无历史版本可恢复' : ''"><a-button status="danger" :disabled="store.versions.length < 2" @click="openFailModal">复核不通过</a-button></a-tooltip>
        </a-space>
      </article>

      <article class="card">
        <div class="panel-head"><div><h2>版本历史</h2><p>每次变更整体快照，可按版本号恢复</p></div><a-tag>当前 v{{ store.scheme.version }}</a-tag></div>
        <div class="version-list">
          <div v-for="entry in orderedVersions" :key="entry.version" :class="{ selected: compareVersion === entry.version }" @click="compareVersion = entry.version">
            <div class="version-head"><b>v{{ entry.version }} · {{ entry.cause }}</b><a-tag size="small">{{ entry.unit }} · {{ entry.author }}</a-tag></div>
            <small>{{ entry.createdAt }}</small>
            <p>{{ entry.summary }}</p>
            <small v-if="entry.invalidatedChecks.length" class="invalid">失效重算 {{ entry.invalidatedChecks.length }} 项检测</small>
            <a-button v-if="entry.version !== store.scheme.version" size="mini" type="text" @click.stop="restore(entry.version)">恢复此版本</a-button>
          </div>
        </div>
        <a-divider />
        <h3>与当前版本（v{{ store.scheme.version }}）差异</h3>
        <template v-if="diffItems.length">
          <div v-for="(item, index) in diffItems" :key="index" class="diff"><a-tag :color="item.type === '新增' ? 'green' : item.type === '删除' ? 'gray' : 'red'">{{ item.type }}</a-tag><span>{{ item.text }}</span></div>
        </template>
        <p v-else class="empty">所选版本与当前内容一致</p>
      </article>
    </div>
  </div>

  <a-modal v-model:visible="failModal.visible" title="复核失败 · 按版本号恢复" @ok="confirmFail">
    <p class="fail-tip">{{ reviewStageId }} 复核不通过，选择要恢复到的历史版本（恢复后该阶段标记为退回）：</p>
    <a-select v-model="failModal.target" style="width:100%">
      <a-option v-for="entry in orderedVersions.filter((item) => item.version < store.scheme.version)" :key="entry.version" :value="entry.version">v{{ entry.version }} · {{ entry.summary }}</a-option>
    </a-select>
  </a-modal>
</template>

<style scoped>
.review-grid{display:grid;grid-template-columns:1fr 1.15fr;gap:16px}.left,.right{display:grid;gap:16px;height:fit-content}.panel-head{display:flex;justify-content:space-between;margin-bottom:12px}.panel-head h2{font-size:17px;margin:0 0 4px}.panel-head p{color:#7a8798;font-size:12px;margin:0}.comment{display:block;width:100%;text-align:left;border:1px solid #e7ebf1;background:#fff;border-radius:7px;padding:13px;margin-bottom:9px;color:inherit;cursor:pointer}.comment:hover,.comment.active{border-color:#2563eb;background:#f5f8ff}.comment-head{display:flex;align-items:center;gap:8px}.comment-head>span{display:grid;place-items:center;width:36px;height:36px;border-radius:6px;background:#eef2f7;font-weight:800}.comment-head b{flex:1}.comment p{margin:9px 0 5px;color:#475569}.comment small,.comment em{display:block;color:#7a8798}.comment em{margin-top:6px;font-style:normal}.three{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px}.held-card{border-color:#fca5a5}.held{border:1px dashed #fca5a5;border-radius:7px;padding:12px;margin-bottom:9px;background:#fff7f7}.held-head{display:flex;justify-content:space-between;color:#475569}.held p{margin:8px 0;color:#475569}.held small{color:#b91c1c}.condition p{color:#475569}.review-checks{margin-bottom:12px}.review-check{display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #f1f5f9;font-size:13px}.version-list>div{padding:11px;border:1px solid #edf0f5;border-radius:6px;margin-bottom:7px;cursor:pointer}.version-list>div.selected{border-color:#2563eb;background:#f5f8ff}.version-head{display:flex;justify-content:space-between;align-items:center}.version-list small{display:block;color:#7a8798;margin-top:3px}.version-list small.invalid{color:#d97706}.version-list p{margin:7px 0 0;color:#475569}.diff{display:flex;gap:10px;padding:10px 0;border-bottom:1px solid #edf0f5}.empty{color:#94a3b8;font-size:13px}.fail-tip{color:#475569;margin-bottom:12px}
@media(max-width:980px){.review-grid{grid-template-columns:1fr}}
</style>
