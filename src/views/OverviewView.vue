<script setup lang="ts">
import { computed, ref } from 'vue'
import { useMutation, useQuery } from '@vue/apollo-composable'
import { COMMENTS_MUTATION, SCHEME_QUERY } from '../graphql'
import { useSchemeStore } from '../store/scheme'

const store = useSchemeStore()
const { mutate } = useMutation(COMMENTS_MUTATION)
const { result, loading, error } = useQuery(SCHEME_QUERY)
const compare = ref(['ST-01', 'ST-02'])

const stats = computed(() => [
  { label: '施工阶段', value: store.scheme.stages.length, note: '跨 42 天' },
  { label: '生效冲突', value: store.conflicts.filter((item) => item.level === '高').length, note: '需阶段审批前解决' },
  { label: '待处理条件', value: store.scheme.comments.filter((item) => item.status === '待处理').length, note: '公交单位尚有 1 条' },
  { label: '方案版本', value: `v${store.scheme.version}`, note: store.scheme.migrated ? '旧数据已迁移锚定' : '每次几何修改留痕' },
])

function resolve(id: string, status: '已接受' | '已退回') {
  store.resolveComment(id, status)
  void mutate({ id, status })
}
function fmtTime(iso: string) {
  const d = new Date(iso)
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
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
  <section class="page-head compact"><div><p class="eyebrow">条件会签与版本批复</p><h1>路段意见与阶段审批</h1><p>各方意见锚定具体路段和方案版本，一段调整后受影响的公交、绕行、救护、相邻工程失效重算，其他单位确认结果保留。</p></div><a-button type="primary" @click="exportNotice">导出公开通告包</a-button></section>
  <div class="review-grid">
    <article class="card">
      <div class="panel-head"><div><h2>会签意见</h2><p>原意见不可覆盖，处理动作进入审计记录</p></div><a-tag color="orange">{{ store.scheme.comments.filter((item) => item.status === '待处理').length }} 待处理</a-tag></div>
      <button v-for="comment in store.scheme.comments" :key="comment.id" class="comment" :class="{ active: store.selectedCommentId === comment.id }" @click="store.selectedCommentId = comment.id">
        <div class="comment-head"><span>{{ comment.unit }}</span><b>{{ comment.author }}</b><a-tag :color="comment.status === '已接受' ? 'green' : comment.status === '已退回' ? 'red' : 'orange'">{{ comment.status }}</a-tag></div>
        <p>{{ comment.content }}</p><small v-if="comment.condition">条件：{{ comment.condition }}</small><em>锚点 {{ comment.segmentId }} · {{ comment.id }}</em>
      </button>

      <div class="panel-head derived-head"><div><h2>衍生分析覆盖</h2><p>由路段驱动，调整后失效重算</p></div><a-tag v-if="store.recalculating" color="blue">重算中…</a-tag></div>
      <div v-for="d in store.scheme.derived" :key="d.id" class="derived" :class="d.status">
        <div><b>{{ d.label }}</b><small>锚点 {{ d.segmentId }} · 基于 v{{ d.basedOnVersion }}</small></div>
        <a-tag :color="d.status === 'fresh' ? 'green' : d.status === 'stale' ? 'orange' : 'blue'">{{ d.status === 'fresh' ? '已重算' : d.status === 'stale' ? '已失效' : '重算中' }}</a-tag>
        <p>{{ d.summary }}</p>
      </div>
    </article>
    <div class="right">
      <article class="card">
        <div class="panel-head"><div><h2>阶段条件处理</h2><p>{{ store.selectedComment?.segmentId }} · {{ store.selectedComment?.unit }}</p></div></div>
        <div v-if="store.selectedComment" class="condition"><b>要求条件</b><p>{{ store.selectedComment.condition || '无附加条件' }}</p><b>影响解释</b><p>{{ store.selectedComment.content }}</p></div>
        <a-space><a-button status="danger" :disabled="store.selectedComment?.status !== '待处理'" @click="resolve(store.selectedComment!.id, '已退回')">退回方案</a-button><a-button type="primary" :disabled="store.selectedComment?.status !== '待处理'" @click="resolve(store.selectedComment!.id, '已接受')">接受条件</a-button></a-space>
      </article>

      <article class="card">
        <div class="panel-head"><div><h2>方案版本历史</h2><p>每次修改留锚点，可按版本号恢复</p></div><a-tag color="blue">当前 v{{ store.scheme.version }}</a-tag></div>
        <div class="version-list">
          <div v-for="entry in [...store.versionLog].reverse()" :key="entry.version" :class="{ selected: entry.version === store.scheme.version }">
            <b>v{{ entry.version }} · {{ entry.author }}</b><small>{{ fmtTime(entry.timestamp) }}</small>
            <p>{{ entry.summary }}</p>
            <a-button v-if="entry.version !== store.scheme.version" size="mini" @click="store.restoreVersion(entry.version)">恢复此版本</a-button>
          </div>
        </div>
      </article>

      <article class="card">
        <div class="panel-head"><div><h2>阶段复核</h2><p>复核失败后按提交时版本号恢复</p></div>
          <a-tag :color="store.scheme.reviewStatus === '通过' ? 'green' : store.scheme.reviewStatus === '复核失败' ? 'red' : store.scheme.reviewStatus === '复核中' ? 'blue' : 'default'">{{ store.scheme.reviewStatus }}</a-tag>
        </div>
        <p v-if="store.scheme.reviewBaseVersion != null" class="review-base">复核基线版本：v{{ store.scheme.reviewBaseVersion }}</p>
        <a-space>
          <a-button :disabled="store.scheme.reviewStatus === '复核中'" @click="store.submitForReview()">提交阶段审批</a-button>
          <a-button type="primary" :disabled="store.scheme.reviewStatus !== '复核中'" @click="store.review(true)">复核通过</a-button>
          <a-button status="danger" :disabled="store.scheme.reviewStatus !== '复核中'" @click="store.review(false)">复核失败并恢复</a-button>
        </a-space>
      </article>
    </div>
  </div>
</template>

<style scoped>
.review-grid{display:grid;grid-template-columns:1fr 1.15fr;gap:16px}.right{display:grid;gap:16px;height:fit-content}.panel-head{display:flex;justify-content:space-between;margin-bottom:12px}.panel-head h2{font-size:17px;margin:0 0 4px}.panel-head p{color:#7a8798;font-size:12px;margin:0}.comment{display:block;width:100%;text-align:left;border:1px solid #e7ebf1;background:#fff;border-radius:7px;padding:13px;margin-bottom:9px;color:inherit;cursor:pointer}.comment:hover,.comment.active{border-color:#2563eb;background:#f5f8ff}.comment-head{display:flex;align-items:center;gap:8px}.comment-head>span{display:grid;place-items:center;width:36px;height:36px;border-radius:6px;background:#eef2f7;font-weight:800}.comment-head b{flex:1}.comment p{margin:9px 0 5px;color:#475569}.comment small,.comment em{display:block;color:#7a8798}.comment em{margin-top:6px;font-style:normal}.condition p{color:#475569}.derived-head{margin-top:18px}.derived{display:flex;flex-wrap:wrap;align-items:center;gap:8px;border:1px solid #edf0f5;border-radius:6px;padding:10px;margin-bottom:8px}.derived>div{flex:1;min-width:140px}.derived b,.derived small{display:block}.derived small{color:#7a8798;margin-top:2px}.derived p{width:100%;margin:4px 0 0;color:#475569;font-size:13px}.derived.stale{background:#fffbeb;border-color:#fde68a}.derived.calculating{background:#eff6ff;border-color:#bfdbfe}.version-list>div{padding:11px;border:1px solid #edf0f5;border-radius:6px;margin-bottom:7px}.version-list>div.selected{border-color:#2563eb;background:#f5f8ff}.version-list b,.version-list small{display:block}.version-list small{color:#7a8798;margin-top:3px}.version-list p{margin:7px 0 0;color:#475569}.review-base{color:#7a8798;font-size:13px;margin:0 0 10px}
@media(max-width:980px){.review-grid{grid-template-columns:1fr}}
</style>
