// 规则引擎冒烟测试：npx tsx scripts/smoke.ts
import { buildSeed, evaluate, occupancyView, reducer } from "../src/domain";
import type { AppState } from "../src/types";

let pass = 0;
let fail = 0;

function check(name: string, cond: boolean, extra = "") {
  if (cond) {
    pass += 1;
    console.log(`  ✓ ${name}`);
  } else {
    fail += 1;
    console.error(`  ✗ ${name} ${extra}`);
  }
}

const get = (s: AppState, id: string) => s.batches.find((b) => b.id === id)!;

// 初始：离线、4 个待合并批次
let s = buildSeed();
check("初始为离线模式", s.online === false);
check("4 个待同步批次", s.batches.every((b) => b.syncState === "PENDING"));

// 预检：B-2401 撞当班 LF-01/A（CR-2107 vs CR-1201）
check(
  "预检 B-2401 层流台占用冲突",
  evaluate(s, get(s, "B-2401")).some((r) => r.code === "HOOD_CONFLICT"),
);
// B-2402 容量不足（CR-2107: 2+2>3）
check("预检 B-2402 容量不足", evaluate(s, get(s, "B-2402")).some((r) => r.code === "CAPACITY"));
// B-2404 未结异常 + 粒子超限 + 离线互斥（B-2402 先占 LF-03/B）
const r2404 = evaluate(s, get(s, "B-2404"));
check("预检 B-2404 未结异常", r2404.some((r) => r.code === "OPEN_ANOMALY"));
check("预检 B-2404 粒子超限", r2404.some((r) => r.code === "PARTICLE"));
check("预检 B-2404 离线占用互斥", r2404.some((r) => r.code === "HOOD_CONFLICT"));
// B-2403 无阻断
check("预检 B-2403 无阻断", evaluate(s, get(s, "B-2403")).length === 0);

// 离线时点合并无效
const before = JSON.stringify(s);
s = reducer(s, { type: "SYNC_ALL" });
check("离线时合并被拒绝", JSON.stringify(s) === before);

// 回网 + 合并全部
s = reducer(s, { type: "TOGGLE_ONLINE" });
s = reducer(s, { type: "SYNC_ALL" });
check("B-2401 首次同步失败", get(s, "B-2401").syncState === "FAILED");
check("失败批次不计入已接收", get(s, "B-2401").attempts === 1);
check("B-2402 已接收但阻断", get(s, "B-2402").syncState === "RECEIVED" && get(s, "B-2402").conclusion.kind === "BLOCKED");
check("B-2403 自动放行", get(s, "B-2403").conclusion.kind === "APPROVED");
check("B-2404 已接收且三类阻断", get(s, "B-2404").conclusion.kind === "BLOCKED" && get(s, "B-2404").conclusion.reasons.length === 3);

// 阻断对象可枚举
const blockTargets = get(s, "B-2404").conclusion.reasons.flatMap((r) => r.targets);
check("阻断对象非空且列出 EX-77 与采样号", blockTargets.some((t) => t.includes("EX-77")) && blockTargets.some((t) => t.includes("S-2404-2")));

// 同字段两边改过 → 冲突保留两版（B-2404 首传即生成，B-2401 重试成功后生成）
const cf4 = s.conflicts.find((c) => c.batchId === "B-2404");
check("B-2404 生成一条待确认字段冲突", !!cf4 && cf4.status === "PENDING");
check("两版值都保留", cf4!.offlineValue.includes("申请放行") && cf4!.serverValue.includes("保持观察"));

// 单独重试 B-2401 → 接收并阻断（占用冲突）
s = reducer(s, { type: "RETRY", id: "B-2401" });
check("重试后 B-2401 已接收", get(s, "B-2401").syncState === "RECEIVED");
check("重试后 B-2401 阻断于层流台冲突", get(s, "B-2401").conclusion.kind === "BLOCKED" && get(s, "B-2401").conclusion.reasons.some((r) => r.code === "HOOD_CONFLICT"));
const cf1 = s.conflicts.find((c) => c.batchId === "B-2401");
check("重试后 B-2401 也生成待确认字段冲突", !!cf1 && cf1.status === "PENDING");

// 再次重试（已接收）→ 幂等，审计记 DUPLICATE，尝试次数不增
const attempts = get(s, "B-2401").attempts;
s = reducer(s, { type: "RETRY", id: "B-2401" });
check("已接收批次不重复接收", get(s, "B-2401").attempts === attempts && s.audit.some((a) => a.type === "DUPLICATE"));

// 下一班确认冲突
s = reducer(s, { type: "RESOLVE", conflictId: cf4!.id, choice: "offline" });
check("下一班确认后采用离线版", s.conflicts.find((c) => c.id === cf4!.id)!.status === "KEPT_OFFLINE" && get(s, "B-2404").note.includes("申请放行"));

// 占用矩阵：LF-01/A 与 LF-03/B 标冲突
const view = occupancyView(s);
check("矩阵标记 LF-01/A 冲突", view.some((c) => c.hoodId === "LF-01" && c.slotId === "A" && c.conflict));
check("矩阵标记 LF-03/B 冲突", view.some((c) => c.hoodId === "LF-03" && c.slotId === "B" && c.conflict));
check("矩阵 LF-03/C 无冲突", view.filter((c) => c.hoodId === "LF-03" && c.slotId === "C").every((c) => !c.conflict));

// 登记 LF-03 滤芯维护：B-2403（已放行）即时失效重算，原始采样保留
const origSamples = get(s, "B-2403").samples.map((x) => ({ ...x }));
s = reducer(s, { type: "MAINT", id: "M-FILTER-03" });
check("B-2403 放行结论即时失效", get(s, "B-2403").conclusion.kind === "INVALIDATED" && get(s, "B-2403").conclusion.recomputed === "NEED_RESAMPLE");
check("B-2403 原始采样保留且时点/数值未改", get(s, "B-2403").samples.every((x, i) => x.collectedAt === origSamples[i].collectedAt && x.particle05 === origSamples[i].particle05));
check("B-2403 采样被标旧快照", get(s, "B-2403").samples.every((x) => x.stale));
check("当班 B-2388（LF-03）一并失效", s.serverBatches.find((b) => b.id === "B-2388")!.conclusion.kind === "INVALIDATED");
check("当班 B-2390（LF-01）不受影响", s.serverBatches.find((b) => b.id === "B-2390")!.conclusion.kind === "APPROVED");
check("维护事件登记后不可重复登记", s.maintenance.find((m) => m.id === "M-FILTER-03")!.registered);
const clockAtMaint = s.clock;
s = reducer(s, { type: "MAINT", id: "M-FILTER-03" });
check("重复登记不产生新事件", s.clock === clockAtMaint);
// 待合并/阻断批次重算出现 STALE_SNAPSHOT 阻断
check("B-2402 重算增加旧快照阻断", evaluate(s, get(s, "B-2402")).some((r) => r.code === "STALE_SNAPSHOT"));
check("B-2401（LF-01）不受 LF-03 维护影响", !evaluate(s, get(s, "B-2401")).some((r) => r.code === "STALE_SNAPSHOT"));

// 时钟保持 UTC+8 显示（15:2x）
check("沙盘时钟为 UTC+8 当天下午", s.clock.includes("2026-09-30T15:"), s.clock);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
