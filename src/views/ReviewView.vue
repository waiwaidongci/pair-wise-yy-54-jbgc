<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useMutation } from '@vue/apollo-composable'
import { COMMENTS_MUTATION } from '../graphql'
import { useSchemeStore } from '../store/scheme'
import type { SubmissionInput } from '../types'

const store = useSchemeStore()
const { mutate } = useMutation(COMMENTS_MUTATION)

const form = reactive({
  segmentId: 'ST-02',
  unit: '交通' as SubmissionInput['unit'],
  author: '郑航',
  content: '',
  condition: '',
})
const lastConflict = ref<string>('')

function resolve(id: string, status: '已接受' | '已退回') {
  store.resolveComment(id, status)
  void mutate({ id, status })
}

/** 提交会签条件：携带当前所见版本号，版本不一致即冲突 */
function submit() {
  const baseVersion = store.scheme.version
  const r = store.submitCondition({ ...form, baseVersion })
  if (r.ok) {
    lastConflict.value = ''
    form.content = ''
    form.condition = ''
  } else {
    lastConflict.value = `冲突：您基于 v${r.conflict.baseVersion} 提交，但方案已到 v${r.conflict.currentVersion}（${r.conflict.winner.author} 已先提交 ${r.conflict.winner.id}）。您的稿件已保留，未被覆盖。`
  }
}

/** 模拟两家单位同时提交同一条件：先到者生效，后到者拿到冲突并保留现场 */
function demoConcurrent() {
  const base = store.scheme.version
  const r1 = store.submitCondition({
    segmentId: 'ST-02', unit: '交通', author: '郑航',
    content: '夜间施工期间江海大道口信号配时需调整，建议增加 2 名疏导员。',
    condition: '调整信号配时并安排疏导员。', baseVersion: base,
  })
  const r2 = store.submitCondition({
    segmentId: 'ST-02', unit: '应急', author: '夏川',
    content: '夜间全封闭切断急救通道，需保留 4 米应急通道并每 15 分钟巡查。',
    condition: '保留 4 米应急通道。', baseVersion: base,
  })
  if (r1.ok && !r2.ok) {
    lastConflict.value = `并发演示：${r1.comment.author} 先提交先生效（${r1.comment.id}）；${r2.conflict.submission.author} 后到，拿到冲突并保留现场（基于 v${r2.conflict.baseVersion}，当前 v${r2.conflict.currentVersion}）。`
  }
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
  <section class="page-head compact"><div><p class="eyebrow">条件会签与版本批复</p><h1>路段意见与阶段审批</h1><p>各方意见锚定具体路段和几何版本，审批人可逐项接受、退回并导出公开通告包。</p></div><a-button type="primary" @click="exportNotice">导出公开通告包</a-button></section>
  <div class="review-grid">
    <article class="card">
      <div class="panel-head"><div><h2>会签意见</h2><p>原意见不可覆盖，处理动作进入审计记录</p></div><a-tag color="orange">{{ store.scheme.comments.filter((item) => item.status === '待处理').length }} 待处理</a-tag></div>
      <button v-for="comment in store.scheme.comments" :key="comment.id" class="comment" :class="{ active: store.selectedCommentId === comment.id }" @click="store.selectedCommentId = comment.id">
        <div class="comment-head"><span>{{ comment.unit }}</span><b>{{ comment.author }}</b><a-tag :color="comment.status === '已接受' ? 'green' : comment.status === '已退回' ? 'red' : 'orange'">{{ comment.status }}</a-tag></div>
        <p>{{ comment.content }}</p><small v-if="comment.condition">条件：{{ comment.condition }}</small><em>锚点 {{ comment.segmentId }} · {{ comment.id }}</em>
      </button>
    </article>
    <div class="right">
      <article class="card">
        <div class="panel-head"><div><h2>阶段条件处理</h2><p>{{ store.selectedComment?.segmentId }} · {{ store.selectedComment?.unit }}</p></div></div>
        <div v-if="store.selectedComment" class="condition"><b>要求条件</b><p>{{ store.selectedComment.condition || '无附加条件' }}</p><b>影响解释</b><p>{{ store.selectedComment.content }}</p></div>
        <a-space><a-button status="danger" :disabled="store.selectedComment?.status !== '待处理'" @click="resolve(store.selectedComment!.id, '已退回')">退回方案</a-button><a-button type="primary" :disabled="store.selectedComment?.status !== '待处理'" @click="resolve(store.selectedComment!.id, '已接受')">接受条件</a-button></a-space>
      </article>

      <article class="card">
        <div class="panel-head"><div><h2>提交会签条件</h2><p>携带所见版本号，先到者生效、后到者保留现场</p></div></div>
        <a-form layout="vertical" :model="form">
          <div class="two">
            <a-form-item label="锚定路段"><a-select v-model="form.segmentId"><a-option v-for="s in store.scheme.stages" :key="s.id" :value="s.id">{{ s.id }}</a-option></a-select></a-form-item>
            <a-form-item label="单位"><a-select v-model="form.unit"><a-option value="建设">建设</a-option><a-option value="交通">交通</a-option><a-option value="公交">公交</a-option><a-option value="应急">应急</a-option></a-select></a-form-item>
          </div>
          <a-form-item label="作者"><a-input v-model="form.author" /></a-form-item>
          <a-form-item label="意见内容"><a-textarea v-model="form.content" placeholder="针对该路段的意见…" /></a-form-item>
          <a-form-item label="附加条件"><a-textarea v-model="form.condition" placeholder="需要满足的条件…" /></a-form-item>
          <a-space>
            <a-button type="primary" @click="submit">提交条件（基于 v{{ store.scheme.version }}）</a-button>
            <a-button @click="demoConcurrent">模拟两家单位同时提交</a-button>
          </a-space>
        </a-form>
        <a-alert v-if="lastConflict" type="warning" class="conflict-alert" :title="lastConflict" />
        <div v-if="store.submissionConflicts.length" class="conflict-list">
          <h3>提交冲突（保留现场）</h3>
          <div v-for="c in store.submissionConflicts" :key="c.id" class="conflict-item">
            <b>{{ c.submission.unit }} · {{ c.submission.author }}</b><small>基于 v{{ c.baseVersion }} → 当前 v{{ c.currentVersion }}</small>
            <p>{{ c.submission.content }}</p><em>先到者：{{ c.winner.author }}（{{ c.winner.id }}）</em>
          </div>
        </div>
      </article>
    </div>
  </div>
</template>

<style scoped>
.review-grid{display:grid;grid-template-columns:1fr 1.15fr;gap:16px}.right{display:grid;gap:16px;height:fit-content}.panel-head{display:flex;justify-content:space-between;margin-bottom:12px}.panel-head h2{font-size:17px;margin:0 0 4px}.panel-head p{color:#7a8798;font-size:12px;margin:0}.comment{display:block;width:100%;text-align:left;border:1px solid #e7ebf1;background:#fff;border-radius:7px;padding:13px;margin-bottom:9px;color:inherit;cursor:pointer}.comment:hover,.comment.active{border-color:#2563eb;background:#f5f8ff}.comment-head{display:flex;align-items:center;gap:8px}.comment-head>span{display:grid;place-items:center;width:36px;height:36px;border-radius:6px;background:#eef2f7;font-weight:800}.comment-head b{flex:1}.comment p{margin:9px 0 5px;color:#475569}.comment small,.comment em{display:block;color:#7a8798}.comment em{margin-top:6px;font-style:normal}.condition p{color:#475569}.two{display:grid;grid-template-columns:1fr 1fr;gap:8px}.conflict-alert{margin-top:12px}.conflict-list{margin-top:14px}.conflict-list h3{font-size:14px;margin:0 0 8px}.conflict-item{border:1px solid #fde68a;background:#fffbeb;border-radius:6px;padding:10px;margin-bottom:8px}.conflict-item b,.conflict-item small{display:block}.conflict-item small{color:#7a8798;margin-top:2px}.conflict-item p{margin:6px 0;color:#475569;font-size:13px}.conflict-item em{color:#b45309;font-style:normal;font-size:12px}
@media(max-width:980px){.review-grid{grid-template-columns:1fr}}
</style>
