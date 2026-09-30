import type {
  AppState,
  Blocker,
  Conclusion,
  DeviceEvent,
  DeviceEventKind,
  FieldConflict,
  MergedBatch,
  ReleaseOrder,
  SampleFields,
} from "./types";
import { CONCLUSION_TEXT, FIELD_LABELS, ISO_LIMITS } from "./types";

const BASE_TS = Date.parse("2026-09-30T10:30:00+08:00");

export const fmtTime = (s: string) => s.slice(11, 16);
export const fmtDT = (s: string) => s.slice(0, 16).replace("T", " ");
export const fmtRange = (a: string, b: string) => `${fmtTime(a)}–${fmtTime(b)}`;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** 类型安全的字段写入（合并/冲突确认共用） */
function setField(target: SampleFields, key: keyof SampleFields, value: string | number): void {
  switch (key) {
    case "particle05":
      target.particle05 = Number(value);
      break;
    case "temperature":
      target.temperature = Number(value);
      break;
    case "humidity":
      target.humidity = Number(value);
      break;
    case "pressureDiff":
      target.pressureDiff = Number(value);
      break;
    case "note":
      target.note = String(value);
      break;
  }
}

/** 逻辑时钟：每次业务动作步进 1 分钟，保证审计有序 */
function isoNow(s: AppState): string {
  const t = BASE_TS + s.tick * 60_000;
  s.tick += 1;
  return new Date(t + 8 * 3_600_000).toISOString().slice(0, 16) + ":00+08:00";
}

function nextId(s: AppState, prefix: string): string {
  s.seq += 1;
  return `${prefix}-${String(s.seq).padStart(4, "0")}`;
}

function audit(s: AppState, actor: string, action: string, detail: string, blockers?: Blocker[]) {
  s.audit.unshift({ id: nextId(s, "AUD"), at: isoNow(s), actor, action, detail, blockers });
}

/** 时段重叠（端点相接不算重叠） */
export function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return Date.parse(aStart) < Date.parse(bEnd) && Date.parse(bStart) < Date.parse(aEnd);
}

/**
 * 三方字段合并：以出发基准值比较，两边都改且不一致 → 保留两版生成冲突单；
 * 仅一边改 → 采用改动方；都没改 → 保持线上值。
 */
export function mergeFields(
  base: SampleFields,
  server: SampleFields,
  offline: SampleFields
): {
  merged: SampleFields;
  conflicts: { field: keyof SampleFields; serverValue: string | number; offlineValue: string | number }[];
} {
  const merged = { ...server };
  const conflicts: { field: keyof SampleFields; serverValue: string | number; offlineValue: string | number }[] = [];
  (Object.keys(base) as (keyof SampleFields)[]).forEach((k) => {
    const serverChanged = server[k] !== base[k];
    const offlineChanged = offline[k] !== base[k];
    if (serverChanged && offlineChanged && server[k] !== offline[k]) {
      conflicts.push({ field: k, serverValue: server[k], offlineValue: offline[k] });
      // merged 暂留线上值，两版都记入冲突单待下一班确认
    } else if (offlineChanged) {
      setField(merged, k, offline[k]);
    }
  });
  return { merged, conflicts };
}

interface EvalResult {
  conclusion: Conclusion;
  blockers: Blocker[];
  reasons: string[];
  adjusted: number;
}

/** 放行评估：未结异常 / 容量不足 → 阻断；阈值超限 → 不放行 */
function evaluateBatch(s: AppState, batch: MergedBatch, correction: number): EvalResult {
  const room = s.rooms.find((r) => r.id === batch.roomId);
  if (!room) throw new Error(`未知房间 ${batch.roomId}`);
  const blockers: Blocker[] = [];

  for (const a of s.anomalies.filter((x) => x.roomId === room.id && !x.resolved)) {
    blockers.push({
      kind: "unresolved_anomaly",
      refId: a.id,
      message: `房间 ${room.id} 存在未结异常 ${a.id}：${a.title}`,
    });
  }

  const activePasses = s.releases.filter(
    (r) => !r.stale && !r.closed && r.conclusion === "pass" && r.roomId === room.id && r.batchId !== batch.id
  );
  if (activePasses.length >= room.capacity) {
    blockers.push({
      kind: "capacity_full",
      refId: room.id,
      message: `房间 ${room.id} 在室放行 ${activePasses.length}/${room.capacity}（${activePasses
        .map((r) => r.batchId)
        .join("、")}），容量不足`,
    });
  }

  const limit = ISO_LIMITS[room.isoClass];
  const adjusted = Math.round(batch.fields.particle05 * correction);
  const reasons: string[] = [];
  if (adjusted > limit) {
    reasons.push(
      `0.5µm粒子修正后 ${adjusted}/m³ 超过 ${room.isoClass} 上限 ${limit}/m³（原始 ${batch.fields.particle05} × 系数 ${correction}）`
    );
  }
  const f = batch.fields;
  if (f.temperature < 18 || f.temperature > 26) reasons.push(`温度 ${f.temperature}℃ 超出 18–26℃`);
  if (f.humidity < 30 || f.humidity > 60) reasons.push(`湿度 ${f.humidity}%RH 超出 30–60%RH`);
  if (f.pressureDiff < 5 || f.pressureDiff > 20) reasons.push(`压差 ${f.pressureDiff}Pa 超出 5–20Pa`);

  const conclusion: Conclusion = blockers.length > 0 ? "blocked" : reasons.length > 0 ? "fail" : "pass";
  return { conclusion, blockers, reasons, adjusted };
}

/** 按设备当前快照出具放行单 */
function issueRelease(s: AppState, batch: MergedBatch, actor: string, trigger: string): ReleaseOrder {
  const device = s.devices.find((d) => d.id === batch.snapshot.deviceId);
  const correction = device ? device.particleCorrection : batch.snapshot.particleCorrection;
  const version = device ? device.snapshotVersion : batch.snapshot.version;
  const ev = evaluateBatch(s, batch, correction);
  const order: ReleaseOrder = {
    id: nextId(s, "R"),
    batchId: batch.id,
    roomId: batch.roomId,
    conclusion: ev.conclusion,
    snapshotVersion: version,
    correction,
    adjustedParticle: ev.adjusted,
    blockers: ev.blockers,
    reasons: ev.reasons,
    computedAt: isoNow(s),
    trigger,
    stale: false,
    closed: false,
  };
  s.releases.push(order);
  audit(
    s,
    actor,
    `放行评估 · ${CONCLUSION_TEXT[ev.conclusion]}`,
    `批次 ${batch.id}（${batch.roomId}）按设备快照 v${version}（修正系数 ${correction}）评估：${trigger}${
      ev.reasons.length ? "。" + ev.reasons.join("；") : ""
    }`,
    ev.blockers.length ? ev.blockers : undefined
  );
  return order;
}

/** 旧结论失效 → 按当前快照立即重算，原始采样保留 */
function recomputeInPlace(s: AppState, releaseId: string, actor: string, trigger: string): void {
  const old = s.releases.find((r) => r.id === releaseId);
  if (!old || old.stale || old.closed) return;
  const batch = s.batches[old.batchId];
  if (!batch) return;
  old.stale = true;
  const order = issueRelease(s, batch, actor, trigger);
  old.supersededBy = order.id;
  audit(
    s,
    actor,
    "结论失效重算",
    `放行单 ${old.id}（批次 ${old.batchId}）原结论「${CONCLUSION_TEXT[old.conclusion]}」已失效，按设备快照 v${order.snapshotVersion} 重算为「${CONCLUSION_TEXT[order.conclusion]}」。原始采样记录保留。`,
    order.blockers.length ? order.blockers : undefined
  );
}

/* ------------------------------ 对外动作 ------------------------------ */

/** 回网同步：合并房间采样、层流台占用与批次放行单 */
export function syncBatches(state: AppState, ids?: string[]): AppState {
  const s = structuredClone(state);
  const targets = s.outbox.filter(
    (b) => (b.status === "pending" || b.status === "failed") && (!ids || ids.includes(b.id))
  );
  if (targets.length === 0) {
    audit(s, "系统", "回网同步", "没有待同步的离线批次");
    return s;
  }
  audit(s, "巡检员", "回网同步", `回网合并 ${targets.length} 个离线批次：房间采样 + 层流台占用 + 批次放行单`);

  for (const b of targets) {
    b.error = undefined;

    // 幂等：已接收批次不能重复
    if (s.batches[b.id]) {
      b.status = "duplicate";
      audit(s, "系统", "重复批次拦截", `批次 ${b.id} 已接收过，重复回传已忽略（已接收批次不能重复）`);
      continue;
    }

    // 同一层流台同一时段只能归一个房间
    const clash = s.occupancies.find(
      (o) => o.active && o.hoodId === b.hoodId && o.roomId !== b.roomId && overlaps(o.start, o.end, b.slotStart, b.slotEnd)
    );
    if (clash) {
      b.status = "failed";
      b.error = `层流台 ${b.hoodId} 时段 ${fmtRange(b.slotStart, b.slotEnd)} 已归房间 ${clash.roomId}（占用单 ${clash.id}）`;
      audit(
        s,
        "系统",
        "层流台占用冲突",
        `批次 ${b.id} 接收失败：同一层流台同一时段只能归一个房间。${b.error}。可释放占用后单独重试`
      );
      continue;
    }

    // 与线上预登记三方合并
    const draft = s.drafts[b.id];
    let merged = b.fields;
    const held: FieldConflict[] = [];
    if (draft) {
      const res = mergeFields(draft.baseFields, draft.fields, b.fields);
      merged = res.merged;
      for (const c of res.conflicts) {
        held.push({
          id: nextId(s, "CF"),
          batchId: b.id,
          field: c.field,
          fieldLabel: FIELD_LABELS[c.field],
          offlineValue: c.offlineValue,
          serverValue: c.serverValue,
          offlineUpdatedAt: b.updatedAt,
          serverUpdatedAt: draft.updatedAt,
          createdShift: s.shift,
          status: "pending",
        });
      }
      delete s.drafts[b.id];
    }

    const batch: MergedBatch = {
      id: b.id,
      roomId: b.roomId,
      hoodId: b.hoodId,
      slotStart: b.slotStart,
      slotEnd: b.slotEnd,
      collectedAt: b.collectedAt,
      receivedAt: isoNow(s),
      snapshot: b.snapshot,
      fields: merged,
      baseFields: b.baseFields,
      source: "offline",
    };
    s.batches[b.id] = batch;
    s.occupancies.push({
      id: nextId(s, "OCC"),
      hoodId: b.hoodId,
      roomId: b.roomId,
      start: b.slotStart,
      end: b.slotEnd,
      batchId: b.id,
      source: "offline",
      active: true,
    });

    if (held.length > 0) {
      s.conflicts.push(...held);
      b.status = "held";
      audit(
        s,
        "系统",
        "字段冲突挂起",
        `批次 ${b.id} 已接收，字段「${held
          .map((c) => c.fieldLabel)
          .join("、")}」离线/线上两边均改过，保留两版待下一班确认，放行暂缓`
      );
    } else {
      b.status = "received";
      audit(
        s,
        "系统",
        "批次接收",
        `批次 ${b.id} 合并接收（采集时点 ${fmtDT(b.collectedAt)}，设备快照 v${b.snapshot.version}），层流台 ${b.hoodId} 占用已登记`
      );
      issueRelease(s, batch, "系统", "离线批次同步接收");
    }
  }
  return s;
}

/** 冲突单确认：仅允许下一班处理，确认后补齐放行评估 */
export function resolveConflict(state: AppState, conflictId: string, choice: "offline" | "server"): AppState {
  const s = structuredClone(state);
  const c = s.conflicts.find((x) => x.id === conflictId);
  if (!c || c.status !== "pending") return s;
  if (s.shift === c.createdShift) {
    audit(s, "系统", "确认被拒", `冲突 ${c.id} 产生于${c.createdShift}，需下一班确认，当前仍为${s.shift}`);
    return s;
  }
  const batch = s.batches[c.batchId];
  if (!batch) return s;
  const value = choice === "offline" ? c.offlineValue : c.serverValue;
  setField(batch.fields, c.field, value);
  c.status = "resolved";
  c.resolution = choice;
  audit(
    s,
    "班组长",
    "冲突确认",
    `批次 ${c.batchId} 字段「${c.fieldLabel}」采用${choice === "offline" ? "离线" : "线上"}值：${value}（另一版「${
      choice === "offline" ? c.serverValue : c.offlineValue
    }」保留于冲突单）`
  );
  const remaining = s.conflicts.some((x) => x.batchId === c.batchId && x.status === "pending");
  if (!remaining) {
    const ob = s.outbox.find((o) => o.id === c.batchId);
    if (ob && ob.status === "held") ob.status = "received";
    issueRelease(s, batch, "系统", "字段冲突经下一班确认后");
  }
  return s;
}

/** 设备校准 / 滤芯维护登记：引用旧快照的放行结论立即失效重算 */
export function registerDeviceEvent(
  state: AppState,
  deviceId: string,
  kind: DeviceEventKind,
  operator: string
): AppState {
  const s = structuredClone(state);
  const dev = s.devices.find((d) => d.id === deviceId);
  if (!dev) return s;
  const from = dev.snapshotVersion;
  dev.snapshotVersion += 1;
  if (kind === "calibration") {
    dev.particleCorrection = round2(dev.particleCorrection * 1.2);
  } else {
    dev.filterAgeHours = 0;
    dev.particleCorrection = round2(dev.particleCorrection * 1.05);
  }
  const ev: DeviceEvent = {
    id: nextId(s, "EV"),
    deviceId,
    kind,
    at: isoNow(s),
    operator,
    fromVersion: from,
    toVersion: dev.snapshotVersion,
  };
  s.deviceEvents.push(ev);
  const kindText = kind === "calibration" ? "校准" : "滤芯维护";
  audit(
    s,
    operator,
    "设备事件登记",
    `${dev.name}（${deviceId}）登记${kindText}：快照 v${from} → v${dev.snapshotVersion}，粒子修正系数 → ${dev.particleCorrection}${
      kind === "filter_maintenance" ? "，滤芯时长清零" : ""
    }`
  );
  const affected = s.releases.filter(
    (r) =>
      !r.stale &&
      !r.closed &&
      r.snapshotVersion < dev.snapshotVersion &&
      s.batches[r.batchId]?.snapshot.deviceId === deviceId
  );
  for (const r of [...affected]) {
    recomputeInPlace(s, r.id, "系统", `设备 ${deviceId} ${kindText}后旧快照 v${r.snapshotVersion} 失效`);
  }
  if (affected.length === 0) {
    audit(s, "系统", "无受影响放行单", `${kindText}不影响现有放行结论`);
  }
  return s;
}

/** 异常结案：该房间受阻放行单立即重新评估 */
export function resolveAnomaly(state: AppState, anomalyId: string): AppState {
  const s = structuredClone(state);
  const a = s.anomalies.find((x) => x.id === anomalyId);
  if (!a || a.resolved) return s;
  a.resolved = true;
  audit(s, "厂务工程师", "异常结案", `异常 ${a.id}（${a.roomId}）已结案：${a.title}，重新评估该房间受阻放行单`);
  const affected = s.releases.filter((r) => !r.stale && !r.closed && r.roomId === a.roomId);
  for (const r of [...affected]) {
    recomputeInPlace(s, r.id, "系统", `异常 ${a.id} 结案后重新评估`);
  }
  return s;
}

/** 释放层流台占用，冲突批次可重试 */
export function endOccupancy(state: AppState, occupancyId: string): AppState {
  const s = structuredClone(state);
  const o = s.occupancies.find((x) => x.id === occupancyId);
  if (!o || !o.active) return s;
  o.active = false;
  audit(
    s,
    "巡检员",
    "释放层流台",
    `占用单 ${o.id}：层流台 ${o.hoodId} 在房间 ${o.roomId} 的时段 ${fmtRange(o.start, o.end)} 已结束，冲突批次可重试`
  );
  return s;
}

/** 手动重新评估（阻断/不放行单） */
export function recomputeRelease(state: AppState, releaseId: string, actor: string, trigger: string): AppState {
  const s = structuredClone(state);
  recomputeInPlace(s, releaseId, actor, trigger);
  return s;
}

/** 放行结案：批次离室，释放房间容量 */
export function closeRelease(state: AppState, releaseId: string): AppState {
  const s = structuredClone(state);
  const r = s.releases.find((x) => x.id === releaseId);
  if (!r || r.stale || r.closed || r.conclusion !== "pass") return s;
  r.closed = true;
  audit(s, "班组长", "放行结案", `放行单 ${r.id}（批次 ${r.batchId}，${r.roomId}）结案，释放房间容量`);
  return s;
}

export function switchShift(state: AppState, shift: string): AppState {
  const s = structuredClone(state);
  if (s.shift === shift) return s;
  audit(s, "系统", "班次切换", `${s.shift} → ${shift}；此前产生的待确认冲突可由本班处理`);
  s.shift = shift;
  return s;
}
