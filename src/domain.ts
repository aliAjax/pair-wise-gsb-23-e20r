import type {
  AppState,
  AuditEvent,
  AuditType,
  BatchRec,
  BlockReason,
  Conclusion,
  DeviceSnapshot,
  FieldConflictRec,
  MaintenanceEvent,
  OccupancyClaim,
  SampleRec,
  ServerBatch,
  SlotId,
} from "./types";

/* ---------------------------------- 常量 ---------------------------------- */

export const SLOTS: { id: SlotId; label: string; span: string }[] = [
  { id: "A", label: "A 段", span: "08:00–10:30" },
  { id: "B", label: "B 段", span: "10:30–13:00" },
  { id: "C", label: "C 段", span: "13:00–15:30" },
];

export const HOODS = [
  { id: "LF-01", label: "层流台 LF-01" },
  { id: "LF-03", label: "层流台 LF-03" },
  { id: "LF-04", label: "层流台 LF-04" },
];

const DAY = "2026-09-30";
const BASE_CLOCK = `${DAY}T15:20:00+08:00`;
const CALIB_EXPIRE = "2026-10-28T09:00:00+08:00";
const FILTER_DATE = "2026-08-11T09:00:00+08:00";

export const PARTICLE_UNIT = "粒/m³";

/* ---------------------------------- 工具 ---------------------------------- */

export const fmt = (iso: string) => iso.replace(`${DAY}T`, "").replace("+08:00", "");

const snap = (takenAt: string): DeviceSnapshot => ({
  takenAt,
  calibrationExpire: CALIB_EXPIRE,
  filterReplacedAt: FILTER_DATE,
});

let seedSeq = 0;
const seedAudit = (at: string, type: AuditType, message: string, targets: string[]): AuditEvent => ({
  id: ++seedSeq,
  at,
  type,
  message,
  targets,
});

const pendingConclusion = (): Conclusion => ({ kind: "PENDING", reasons: [] });

/* ---------------------------------- 种子 ---------------------------------- */

function sample(
  id: string,
  roomId: string,
  hoodId: string,
  slotId: SlotId,
  hhmm: string,
  particle05: number,
  humidity = 46,
  pressureDiff = 15,
): SampleRec {
  return {
    id,
    roomId,
    hoodId,
    slotId,
    collectedAt: `${DAY}T${hhmm}:00+08:00`,
    particle05,
    humidity,
    pressureDiff,
    snapshot: snap(`${DAY}T${hhmm}:00+08:00`),
    stale: false,
  };
}

function offlineBatch(init: Omit<BatchRec, "attempts" | "syncState" | "conclusion">): BatchRec {
  return {
    ...init,
    syncState: "PENDING",
    attempts: 0,
    conclusion: pendingConclusion(),
  };
}

export function buildSeed(): AppState {
  const rooms: AppState["rooms"] = [
    {
      id: "CR-1201",
      name: "芯片间 CR-1201",
      cleanClass: "ISO 5",
      capacity: 2,
      occupied: 1,
      particleLimit: 3520,
      anomalies: [],
    },
    {
      id: "CR-2107",
      name: "封装间 CR-2107",
      cleanClass: "ISO 6",
      capacity: 3,
      occupied: 2,
      particleLimit: 35200,
      anomalies: [],
    },
    {
      id: "CR-3302",
      name: "测试间 CR-3302",
      cleanClass: "ISO 7",
      capacity: 4,
      occupied: 3,
      particleLimit: 352000,
      anomalies: [
        { id: "EX-77", title: "压差传感器待校验（EX-77）", open: true },
      ],
    },
    {
      id: "Y-0302",
      name: "黄光区 Y-0302",
      cleanClass: "黄光区",
      capacity: 2,
      occupied: 1,
      particleLimit: 35200,
      anomalies: [],
    },
  ];

  const batches: BatchRec[] = [
    // 1) 首次同步必失败（单独重试）；重试成功但撞层流台占用，且放行备注两边都改过
    offlineBatch({
      id: "B-2401",
      inspector: "巡检员 周岭",
      roomId: "CR-1201",
      hoodId: "LF-01",
      slotId: "A",
      load: 1,
      note: "离线复测粒子正常，建议放行",
      baseNote: "A段初测待复核",
      serverNote: "当班复核：压差偏低，暂缓",
      failFirstAttempt: true,
      samples: [
        sample("S-2401-1", "CR-1201", "LF-01", "A", "08:20", 2180, 45, 12),
        sample("S-2401-2", "CR-1201", "LF-01", "A", "09:40", 2410, 46, 13),
      ],
    }),
    // 2) 与离线 B-2404 抢同一台同一时段；且房间容量不足
    offlineBatch({
      id: "B-2402",
      inspector: "巡检员 周岭",
      roomId: "CR-2107",
      hoodId: "LF-03",
      slotId: "B",
      load: 2,
      note: "B段两批样品，等待合并",
      baseNote: "B段两批样品，等待合并",
      failFirstAttempt: false,
      samples: [
        sample("S-2402-1", "CR-2107", "LF-03", "B", "11:05", 12800, 47, 15),
        sample("S-2402-2", "CR-2107", "LF-03", "B", "12:20", 14600, 48, 16),
      ],
    }),
    // 3) 无阻断，直接放行（之后登记 LF-03 滤芯维护会使其即时失效重算）
    offlineBatch({
      id: "B-2403",
      inspector: "巡检员 周岭",
      roomId: "Y-0302",
      hoodId: "LF-03",
      slotId: "C",
      load: 1,
      note: "黄光区C段，指标稳定",
      baseNote: "黄光区C段，指标稳定",
      failFirstAttempt: false,
      samples: [
        sample("S-2403-1", "Y-0302", "LF-03", "C", "13:30", 9800, 45, 16),
        sample("S-2403-2", "Y-0302", "LF-03", "C", "14:50", 11200, 46, 15),
      ],
    }),
    // 4) 撞 B-2402、房间有未结异常、粒子超限；备注两边都改过
    offlineBatch({
      id: "B-2404",
      inspector: "巡检员 周岭",
      roomId: "CR-3302",
      hoodId: "LF-03",
      slotId: "B",
      load: 1,
      note: "离线加测一组，申请放行",
      baseNote: "B段测试间原记录",
      serverNote: "当班更新：湿度回升，保持观察",
      failFirstAttempt: false,
      samples: [
        sample("S-2404-1", "CR-3302", "LF-03", "B", "11:10", 268000, 52, 9),
        sample("S-2404-2", "CR-3302", "LF-03", "B", "12:35", 391500, 53, 8),
      ],
    }),
  ];

  const serverBatches: ServerBatch[] = [
    {
      id: "B-2388",
      roomId: "CR-2107",
      hoodId: "LF-03",
      approvedAt: `${DAY}T07:50:00+08:00`,
      sampleSummary: "早班 B 段预放行 2 批",
      snapshotTakenAt: `${DAY}T07:20:00+08:00`,
      stale: false,
      conclusion: { kind: "APPROVED", at: `${DAY}T07:50:00+08:00`, reasons: [] },
    },
    {
      id: "B-2390",
      roomId: "CR-2107",
      hoodId: "LF-01",
      approvedAt: `${DAY}T07:40:00+08:00`,
      sampleSummary: "早班 A 段预放行 1 批（LF-01 归封装间使用）",
      snapshotTakenAt: `${DAY}T07:10:00+08:00`,
      stale: false,
      conclusion: { kind: "APPROVED", at: `${DAY}T07:40:00+08:00`, reasons: [] },
    },
  ];

  // 当班（服务器）侧的层流台占用登记
  const occupancy: OccupancyClaim[] = [
    { hoodId: "LF-01", slotId: "A", roomId: "CR-2107", batchId: "B-2390", source: "SERVER" },
    { hoodId: "LF-04", slotId: "A", roomId: "Y-0302", batchId: "B-2392", source: "SERVER" },
    { hoodId: "LF-04", slotId: "B", roomId: "Y-0302", batchId: "B-2395", source: "SERVER" },
  ];

  const maintenance: MaintenanceEvent[] = [
    { id: "M-CAL-01", hoodId: "LF-01", type: "CALIBRATION", label: "LF-01 设备校准登记", registered: false },
    { id: "M-FILTER-03", hoodId: "LF-03", type: "FILTER", label: "LF-03 高效滤芯更换登记", registered: false },
  ];

  const audit: AuditEvent[] = [
    seedAudit(`${DAY}T07:40:00+08:00`, "SYNC", "当班批次 B-2390 已接收放行（A 段 / LF-01）", ["B-2390"]),
    seedAudit(`${DAY}T07:50:00+08:00`, "SYNC", "当班批次 B-2388 已接收放行（B 段 / LF-03）", ["B-2388"]),
    seedAudit(`${DAY}T08:05:00+08:00`, "SYNC", "巡检终端进入离线模式，开始离线采样", ["终端-周岭"]),
    seedAudit(`${DAY}T15:10:00+08:00`, "CONFLICT", "当班修改 B-2401 放行备注，等待回网合并", ["B-2401.放行备注"]),
    seedAudit(`${DAY}T15:12:00+08:00`, "CONFLICT", "当班修改 B-2404 放行备注，等待回网合并", ["B-2404.放行备注"]),
  ];

  return {
    online: false,
    clock: BASE_CLOCK,
    seq: seedSeq,
    rooms,
    batches,
    serverBatches,
    occupancy,
    conflicts: [],
    maintenance,
    audit,
  };
}

/* -------------------------------- 规则引擎 -------------------------------- */

function latestMaintenance(state: AppState, hoodId: string): MaintenanceEvent | undefined {
  return state.maintenance.find((m) => m.registered && m.hoodId === hoodId);
}

/** 校准或滤芯维护登记后，引用旧快照的放行结论立即失效；原始采样仅标记保留 */
function staleReasonForBatch(state: AppState, b: BatchRec): BlockReason | undefined {
  const m = latestMaintenance(state, b.hoodId);
  if (!m) return undefined;
  const oldest = b.samples.reduce((min, s) => (s.collectedAt < min ? s.collectedAt : min), b.samples[0].collectedAt);
  if (oldest >= (m.at ?? "")) return undefined;
  const label = m.type === "CALIBRATION" ? "设备校准" : "滤芯维护";
  return {
    code: "STALE_SNAPSHOT",
    text: `引用 ${fmt(oldest)} 旧设备快照（${label}登记于 ${fmt(m.at!)}），结论失效需重采重算`,
    targets: b.samples.map((s) => s.id),
  };
}

function staleReasonForServer(state: AppState, sb: ServerBatch): BlockReason | undefined {
  const m = latestMaintenance(state, sb.hoodId);
  if (!m || sb.snapshotTakenAt >= (m.at ?? "")) return undefined;
  const label = m.type === "CALIBRATION" ? "设备校准" : "滤芯维护";
  return {
    code: "STALE_SNAPSHOT",
    text: `引用 ${fmt(sb.snapshotTakenAt)} 旧快照（${label}登记于 ${fmt(m.at!)}），结论失效需重采重算`,
    targets: [sb.id],
  };
}

/** 同一层流台同一时段只能归一个房间：找出先占用方 */
export function hoodConflict(
  state: AppState,
  b: BatchRec,
): { kind: "SERVER" | "OFFLINE"; roomId: string; batchId: string } | undefined {
  for (const c of state.occupancy) {
    if (c.hoodId === b.hoodId && c.slotId === b.slotId && c.batchId !== b.id && c.roomId !== b.roomId) {
      return { kind: c.source === "SERVER" ? "SERVER" : "OFFLINE", roomId: c.roomId, batchId: c.batchId };
    }
  }
  for (const other of state.batches) {
    if (
      other.id !== b.id &&
      other.hoodId === b.hoodId &&
      other.slotId === b.slotId &&
      other.roomId !== b.roomId &&
      other.syncState === "RECEIVED"
    ) {
      return { kind: "OFFLINE", roomId: other.roomId, batchId: other.id };
    }
  }
  // 同处于待合并队列的离线批次互斥（按批次号稳定排序，先到先得）
  for (const other of state.batches) {
    if (
      other.id !== b.id &&
      other.id < b.id &&
      other.hoodId === b.hoodId &&
      other.slotId === b.slotId &&
      other.roomId !== b.roomId &&
      other.syncState !== "RECEIVED"
    ) {
      return { kind: "OFFLINE", roomId: other.roomId, batchId: other.id };
    }
  }
  return undefined;
}

/** 放行阻断评估：未结异常 / 容量不足 / 粒子超限 / 旧快照 / 层流台占用 */
export function evaluate(state: AppState, b: BatchRec): BlockReason[] {
  const reasons: BlockReason[] = [];
  const room = state.rooms.find((r) => r.id === b.roomId)!;
  const slot = SLOTS.find((s) => s.id === b.slotId)!;

  const open = room.anomalies.filter((a) => a.open);
  if (open.length) {
    reasons.push({
      code: "OPEN_ANOMALY",
      text: `房间存在未结异常（${open.length} 项）`,
      targets: open.map((a) => `${a.id} ${a.title}`),
    });
  }

  if (room.occupied + b.load > room.capacity) {
    reasons.push({
      code: "CAPACITY",
      text: `容量不足：已占用 ${room.occupied} + 本批 ${b.load} > 容量 ${room.capacity}`,
      targets: [`${room.id} 容量 ${room.capacity}`],
    });
  }

  const over = b.samples.filter((s) => s.particle05 > room.particleLimit);
  if (over.length) {
    const worst = over.reduce((w, s) => (s.particle05 > w.particle05 ? s : w), over[0]);
    reasons.push({
      code: "PARTICLE",
      text: `0.5μm 粒子超 ${room.cleanClass} 阈值 ${room.particleLimit.toLocaleString()} ${PARTICLE_UNIT}`,
      targets: over.map((s) => `${s.id} ${s.particle05.toLocaleString()} @${fmt(s.collectedAt)}（峰值 ${worst.id}）`),
    });
  }

  const stale = staleReasonForBatch(state, b);
  if (stale) reasons.push(stale);

  const hc = hoodConflict(state, b);
  if (hc) {
    const otherRoom = state.rooms.find((r) => r.id === hc.roomId);
    reasons.push({
      code: "HOOD_CONFLICT",
      text: `${b.hoodId} ${slot.label}（${slot.span}）已归属 ${hc.roomId}（批次 ${hc.batchId}，${hc.kind === "SERVER" ? "当班占用" : "离线合并占用"}），不能同时归 ${b.roomId}`,
      targets: [`${b.hoodId} ${slot.label} → ${hc.roomId} ${otherRoom?.name ?? ""} / ${hc.batchId}`],
    });
  }

  return reasons;
}

/* --------------------------------- 审计 ---------------------------------- */

const pushAudit = (
  state: AppState,
  type: AuditType,
  message: string,
  targets: string[],
): AuditEvent => {
  const ev: AuditEvent = { id: ++state.seq, at: state.clock, type, message, targets };
  state.audit.unshift(ev);
  return ev;
};

/* ------------------------------- 合并处理 -------------------------------- */

function noteConflictExists(state: AppState, batchId: string): boolean {
  return state.conflicts.some((c) => c.batchId === batchId && c.field === "放行备注" && c.status === "PENDING");
}

function ensureNoteConflict(state: AppState, b: BatchRec): void {
  const bothChanged = b.note !== b.baseNote && b.serverNote !== undefined && b.serverNote !== b.baseNote;
  if (bothChanged && !noteConflictExists(state, b.id)) {
    state.conflicts.push({
      id: `C-${b.id}-NOTE`,
      batchId: b.id,
      field: "放行备注",
      offlineValue: b.note,
      serverValue: b.serverNote!,
      status: "PENDING",
    });
    pushAudit(
      state,
      "CONFLICT",
      `批次 ${b.id}「放行备注」两边都改过，保留两版待下一班确认`,
      [`${b.id}.放行备注（离线版）`, `${b.id}.放行备注（当班版）`],
    );
  }
}

function bumpClock(state: AppState, minutes: number): void {
  const t = new Date(state.clock);
  t.setMinutes(t.getMinutes() + minutes);
  // 沙盘统一按 UTC+8 渲染，避免 toISOString 产生时区漂移
  const east8 = new Date(t.getTime() + 8 * 3600 * 1000);
  state.clock = east8.toISOString().replace(/\.\d{3}Z$/, "+08:00");
}

/** 单个批次的同步尝试（失败批次单独重试；已接收批次幂等不重复） */
function attemptSync(state: AppState, b: BatchRec): void {
  if (b.syncState === "RECEIVED") {
    pushAudit(state, "DUPLICATE", `批次 ${b.id} 已接收，重复合并被忽略`, [b.id]);
    return;
  }

  b.attempts += 1;
  if (b.failFirstAttempt && b.attempts === 1) {
    b.syncState = "FAILED";
    pushAudit(state, "SYNC", `批次 ${b.id} 首次同步失败（网络抖动），可单独重试`, [b.id]);
    return;
  }

  b.syncState = "RECEIVED";
  b.receivedAt = state.clock;

  ensureNoteConflict(state, b);

  const reasons = evaluate(state, b);
  if (reasons.length) {
    b.conclusion = { kind: "BLOCKED", at: state.clock, reasons };
    state.occupancy.push({
      hoodId: b.hoodId,
      slotId: b.slotId,
      roomId: b.roomId,
      batchId: b.id,
      source: "BLOCKED",
    });
    pushAudit(state, "BLOCK", `批次 ${b.id} 已接收但放行被阻断（${reasons.length} 类原因）`, reasons.flatMap((r) => r.targets));
  } else {
    b.conclusion = { kind: "APPROVED", at: state.clock, reasons: [] };
    state.occupancy.push({
      hoodId: b.hoodId,
      slotId: b.slotId,
      roomId: b.roomId,
      batchId: b.id,
      source: "RECEIVED",
    });
    pushAudit(state, "SYNC", `批次 ${b.id} 接收并自动放行`, [b.id, `${b.hoodId} ${b.slotId} 段 → ${b.roomId}`]);
  }
}

/* ----------------------------- 维护即时失效 ------------------------------ */

/** 设备校准 / 滤芯维护登记：引用旧快照的放行结论立即失效重算，原始采样保留 */
function applyMaintenance(state: AppState, m: MaintenanceEvent): void {
  m.registered = true;
  m.at = state.clock;

  const targets: string[] = [];

  for (const b of state.batches) {
    if (b.hoodId !== m.hoodId) continue;
    const oldest = b.samples.reduce(
      (min, s) => (s.collectedAt < min ? s.collectedAt : min),
      b.samples[0].collectedAt,
    );
    if (oldest >= state.clock) continue;
    const sampleIds = b.samples.map((s) => s.id);
    targets.push(...sampleIds.map((id) => `${id}（原始采样保留）`));
    b.samples.forEach((s) => {
      s.stale = true;
    });
    if (b.conclusion.kind === "APPROVED") {
      b.conclusion = {
        kind: "INVALIDATED",
        at: state.clock,
        former: "APPROVED",
        recomputed: "NEED_RESAMPLE",
        reasons: [],
      };
    }
  }

  for (const sb of state.serverBatches) {
    if (sb.hoodId !== m.hoodId) continue;
    if (sb.snapshotTakenAt < state.clock) {
      sb.stale = true;
      targets.push(`${sb.id}（当班已放行，原始采样保留）`);
      if (sb.conclusion.kind === "APPROVED") {
        sb.conclusion = {
          kind: "INVALIDATED",
          at: state.clock,
          former: "APPROVED",
          recomputed: "NEED_RESAMPLE",
          reasons: [],
        };
      }
    }
  }

  pushAudit(
    state,
    "MAINT",
    `${m.label}完成，引用旧快照的放行结论立即失效、安排重采重算（原始采样不删改）`,
    targets.length ? targets : [m.hoodId],
  );
}

/* --------------------------------- Reducer -------------------------------- */

export type Action =
  | { type: "TOGGLE_ONLINE" }
  | { type: "TICK" }
  | { type: "SYNC_ALL" }
  | { type: "RETRY"; id: string }
  | { type: "RESOLVE"; conflictId: string; choice: "offline" | "server" }
  | { type: "MAINT"; id: string }
  | { type: "RESET" };

export function reducer(prev: AppState, action: Action): AppState {
  const state: AppState = structuredClone(prev);

  switch (action.type) {
    case "TOGGLE_ONLINE":
      state.online = !state.online;
      break;

    case "TICK":
      bumpClock(state, 1);
      break;

    case "SYNC_ALL": {
      if (!state.online) return prev;
      const pending = state.batches.filter((b) => b.syncState !== "RECEIVED");
      if (!pending.length) return prev;
      pending.forEach((b, i) => {
        if (i > 0) bumpClock(state, 1);
        attemptSync(state, b);
      });
      break;
    }

    case "RETRY": {
      const b = state.batches.find((x) => x.id === action.id);
      if (!b || !state.online) return prev;
      if (b.syncState === "RECEIVED") {
        // 已接收批次不能重复：幂等忽略并留痕
        pushAudit(state, "DUPLICATE", `批次 ${b.id} 已接收，重复合并被忽略`, [b.id]);
        return state;
      }
      if (b.syncState !== "FAILED") return prev;
      bumpClock(state, 1);
      attemptSync(state, b);
      break;
    }

    case "RESOLVE": {
      const c = state.conflicts.find((x) => x.id === action.conflictId);
      if (!c || c.status !== "PENDING") return prev;
      const keep = action.choice === "offline" ? c.offlineValue : c.serverValue;
      const b = state.batches.find((x) => x.id === c.batchId);
      if (b) b.note = keep;
      c.status = action.choice === "offline" ? "KEPT_OFFLINE" : "KEPT_SERVER";
      c.resolvedAt = state.clock;
      pushAudit(
        state,
        "RESOLVE",
        `批次 ${c.batchId}「${c.field}」下一班确认：保留${action.choice === "offline" ? "离线版" : "当班版"}`,
        [`${c.batchId}.${c.field}`],
      );
      break;
    }

    case "MAINT": {
      const m = state.maintenance.find((x) => x.id === action.id);
      if (!m || m.registered) return prev;
      bumpClock(state, 2);
      applyMaintenance(state, m);
      break;
    }

    case "RESET":
      seedSeq = 0;
      return buildSeed();

    default:
      return prev;
  }

  return state;
}

/* ------------------------------- 视图选择器 ------------------------------- */

export interface ClaimVM {
  key: string;
  hoodId: string;
  slotId: SlotId;
  roomId: string;
  batchId: string;
  source: OccupancyClaim["source"];
  conflict: boolean;
}

/** 层流台占用矩阵：同一格出现两个房间即为占用冲突 */
export function occupancyView(state: AppState): ClaimVM[] {
  const claims: OccupancyClaim[] = [...state.occupancy];

  for (const b of state.batches) {
    const exists = claims.some((c) => c.batchId === b.id);
    if (!exists) {
      claims.push({
        hoodId: b.hoodId,
        slotId: b.slotId,
        roomId: b.roomId,
        batchId: b.id,
        source: "PENDING",
      });
    }
  }

  return claims.map((c) => {
    const clash = claims.some(
      (o) =>
        o !== c &&
        o.hoodId === c.hoodId &&
        o.slotId === c.slotId &&
        o.roomId !== c.roomId,
    );
    return {
      key: `${c.hoodId}-${c.slotId}-${c.batchId}`,
      hoodId: c.hoodId,
      slotId: c.slotId,
      roomId: c.roomId,
      batchId: c.batchId,
      source: c.source,
      conflict: clash,
    };
  });
}

export function serverStaleReason(state: AppState, sb: ServerBatch): BlockReason | undefined {
  return staleReasonForServer(state, sb);
}

export const CODE_LABEL: Record<string, string> = {
  HOOD_CONFLICT: "层流台同时段占用冲突",
  OPEN_ANOMALY: "房间有未结异常",
  CAPACITY: "房间容量不足",
  PARTICLE: "粒子计数超限",
  STALE_SNAPSHOT: "引用旧设备快照",
};
