import { seedState } from "../src/domain/seed";
import {
  closeRelease,
  endOccupancy,
  registerDeviceEvent,
  recomputeRelease,
  resolveAnomaly,
  resolveConflict,
  switchShift,
  syncBatches,
} from "../src/domain/engine";
import type { AppState } from "../src/domain/types";

let s: AppState = seedState();
const failures: string[] = [];

function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) {
    console.log(`  ok  ${name}`);
  } else {
    failures.push(name);
    console.log(`FAIL  ${name}`, extra === undefined ? "" : JSON.stringify(extra));
  }
}

const outbox = (st: AppState, id: string, nth = 0) =>
  st.outbox.filter((b) => b.id === id)[nth];
const liveRelease = (st: AppState, batchId: string) =>
  st.releases.filter((r) => r.batchId === batchId && !r.stale).at(-1);

// 1) 回网同步
s = syncBatches(s);
check("B-002 同字段两边改过 → 挂起待确认", outbox(s, "B-002")?.status === "held");
check("B-002 生成冲突单（处理备注）", s.conflicts.length === 1 && s.conflicts[0].field === "note" && s.conflicts[0].status === "pending");
check("B-002 单边改动自动合并（压差取线上14、粒子取离线3100）",
  s.batches["B-002"]?.fields.pressureDiff === 14 && s.batches["B-002"]?.fields.particle05 === 3100);
check("B-002 挂起期间不出放行单", !s.releases.some((r) => r.batchId === "B-002"));
check("B-003 已接收", outbox(s, "B-003")?.status === "received");
check("B-003 容量不足被阻断，阻断对象列出",
  liveRelease(s, "B-003")?.conclusion === "blocked" &&
  liveRelease(s, "B-003")?.blockers.some((b) => b.kind === "capacity_full" && b.message.includes("B-000")) === true);
check("B-005 层流台同时段他房间 → 失败", outbox(s, "B-005")?.status === "failed");
check("B-005 未产生占用单", !s.occupancies.some((o) => o.batchId === "B-005"));
check("B-001 重传 → 幂等拦截", outbox(s, "B-001")?.status === "duplicate");
check("B-001 未被重复接收", Object.keys(s.batches).length === 4);
check("阻断对象写入审计", s.audit.some((a) => (a.blockers ?? []).some((b) => b.kind === "capacity_full")));

// 2) 冲突需下一班确认
const before = s.conflicts[0].status;
s = resolveConflict(s, s.conflicts[0].id, "offline");
check("同班确认被拒", s.conflicts[0].status === "pending" && before === "pending");
s = switchShift(s, "中班");
s = resolveConflict(s, s.conflicts[0].id, "offline");
check("下一班确认通过，采用离线值", s.conflicts[0].status === "resolved" && s.batches["B-002"].fields.note === "离线复测完成，粒子正常");
check("确认后补评估：CR-1201 未结异常 → 阻断",
  liveRelease(s, "B-002")?.conclusion === "blocked" &&
  liveRelease(s, "B-002")?.blockers.some((b) => b.refId === "AN-5001") === true);

// 3) 异常结案 → 该房间放行单自动重估
s = resolveAnomaly(s, "AN-5001");
check("AN-5001 结案后 B-001 放行", liveRelease(s, "B-001")?.conclusion === "pass");
check("AN-5001 结案后 B-002 放行", liveRelease(s, "B-002")?.conclusion === "pass");

// 4) 设备校准 → 旧快照放行结论失效重算（原始采样保留）
const rawBefore = s.batches["B-002"].fields.particle05;
s = registerDeviceEvent(s, "DEV-LF01", "calibration", "厂务工程师");
check("DEV-LF01 快照 v3→v4，系数 1.2", s.devices.find((d) => d.id === "DEV-LF01")?.snapshotVersion === 4);
check("B-001 旧结论失效，新结论不放行（3000×1.2=3600>3520）",
  liveRelease(s, "B-001")?.conclusion === "fail" && liveRelease(s, "B-001")?.snapshotVersion === 4 &&
  s.releases.some((r) => r.batchId === "B-001" && r.stale));
check("B-002 旧结论失效，新结论不放行（3100×1.2=3720>3520）", liveRelease(s, "B-002")?.conclusion === "fail");
check("原始采样保留不变", s.batches["B-002"].fields.particle05 === rawBefore);
check("DEV-LF02 的放行单不受影响", liveRelease(s, "B-000")?.conclusion === "pass" && liveRelease(s, "B-000")?.snapshotVersion === 1);

// 5) 释放占用 → 失败批次单独重试
s = endOccupancy(s, "OCC-0002");
s = syncBatches(s, ["B-005"]);
check("B-005 重试成功", outbox(s, "B-005")?.status === "received");
check("B-005 放行（Y-0302 无异常、容量充足）", liveRelease(s, "B-005")?.conclusion === "pass");

// 6) 结案释放容量 → 阻断单重估放行
s = closeRelease(s, "R-0001");
const b003 = liveRelease(s, "B-003");
s = recomputeRelease(s, b003!.id, "班组长", "容量释放后重估");
check("B-000 结案后 B-003 重估放行", liveRelease(s, "B-003")?.conclusion === "pass");

console.log(failures.length === 0 ? "\n全部通过" : `\n${failures.length} 项失败`);
process.exit(failures.length === 0 ? 0 : 1);
