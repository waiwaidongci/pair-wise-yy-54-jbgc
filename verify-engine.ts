import { migrateLegacy, applyStagePatch, recomputeInvalidated, submitCondition, resubmitHeld, restoreVersion, diffSnapshots } from './src/versioning/engine'
import { legacySeed } from './src/versioning/seed'

const actor = { unit: '建设' as const, author: '张惟' }
let pass = 0, fail = 0
function ok(cond: boolean, name: string) { if (cond) { pass++; console.log(`  ✓ ${name}`) } else { fail++; console.log(`  ✗ ${name}`) } }

// 1. 旧数据迁移为首版
const s = migrateLegacy(legacySeed)
console.log('1. 迁移')
ok(s.version === 1, '版本号为 1')
ok(s.current.stages.every((st) => st.versionAnchor === 1), '全部分段锚点 v1')
ok(s.current.comments.every((c) => c.key.includes(':')), '会签条件生成条件 key')
ok(s.current.detours.every((d) => d.stageId), '绕行路线挂到分段')
ok(s.checks.length === 12, `四类检测 × 三阶段 = ${s.checks.length}`)
ok(s.versions.length === 1 && s.versions[0].cause === '迁移', '迁移版本入档')
ok(s.current.comments[0].content === legacySeed.comments[0].content, '原有内容保留')

// 2. 路段调整 → 受影响检测失效重算，其他单位确认保留
console.log('2. 级联重算')
const before = s.checks.find((c) => c.segmentId === 'ST-02' && c.kind === '救护通道')!
ok(before.level === '高', 'ST-02 全封闭 → 救护通道高风险')
applyStagePatch(s, 'ST-02', { lanes: '22:00–05:00 半幅施工，保留 4 米应急通道', status: '待协商' }, actor)
ok(s.version === 2, '版本号 +1')
const stale = s.checks.filter((c) => c.status === '重算中')
ok(stale.length === 4 && stale.every((c) => c.segmentId === 'ST-02'), '仅 ST-02 四项检测失效')
ok(s.versions[1].invalidatedChecks.length === 4, '失效清单记入版本')
recomputeInvalidated(s)
const after = s.checks.find((c) => c.segmentId === 'ST-02' && c.kind === '救护通道')!
ok(after.status === '有效' && after.level === '低' && after.computedVersion === 2, `救护通道重算为 ${after.level}`)
ok(s.checks.filter((c) => c.segmentId === 'ST-01').every((c) => c.computedVersion === 1), 'ST-01 检测不受影响')
const cm42 = s.current.comments.find((c) => c.id === 'CM-42')!
ok(cm42.status === '已接受', '应急单位已接受的确认结果保留')

// 3. 两家单位同时提交同一条件：先到者生效，后到者冲突保留现场
console.log('3. 并发冲突')
const payloadA = { key: 'ST-01:公交站点', segmentId: 'ST-01', unit: '公交' as const, author: '顾敏', content: '甲方案' }
const payloadB = { key: 'ST-01:公交站点', segmentId: 'ST-01', unit: '交通' as const, author: '郑航', content: '乙方案' }
const base = s.version
const r1 = submitCondition(s, payloadA, base)
ok(r1.ok === true, '先到者生效')
const r2 = submitCondition(s, payloadB, base)
ok(r2.ok === false && r2.held.payload.content === '乙方案', '后到者拿到冲突并保留现场')
ok(!r2.ok && r2.held.conflictWith.unit === '公交', '冲突指向先到者')
ok(s.held.length === 1, '保留现场入列')
const r3 = resubmitHeld(s, s.held[0].id)
ok(r3?.ok === true && s.held.length === 0, '基于新版本重新提交成功')
ok(s.current.comments.filter((c) => c.key === 'ST-01:公交站点').length === 3, '两份意见与旧数据迁移的条件都入档')

// 4. 复核失败后按版本号恢复
console.log('4. 版本恢复')
const v2lanes = s.versions.find((v) => v.version === 2)!.snapshot.stages.find((st) => st.id === 'ST-02')!.lanes
applyStagePatch(s, 'ST-02', { lanes: '全封闭' }, actor)
restoreVersion(s, 2, actor, '复核失败恢复', (core) => { core.stages.find((st) => st.id === 'ST-02')!.status = '退回' })
const restored = s.current.stages.find((st) => st.id === 'ST-02')!
ok(restored.lanes === v2lanes, '内容按 v2 快照恢复')
ok(restored.status === '退回', '恢复后标记退回')
ok(s.versions[s.versions.length - 1].cause === '版本恢复', '恢复动作入档为新版本')
ok(s.checks.every((c) => c.status === '重算中'), '恢复后全部检测失效待重算')

// 5. 版本比较
console.log('5. 版本比较')
const diff = diffSnapshots(s.versions[0].snapshot, s.current)
ok(diff.length > 0, `差异 ${diff.length} 项`)

console.log(`\n${pass} 通过, ${fail} 失败`)
process.exit(fail ? 1 : 0)
