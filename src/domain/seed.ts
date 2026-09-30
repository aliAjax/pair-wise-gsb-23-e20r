import type { AppState, SampleFields } from "./types";

const T = (h: number, m = 0) =>
  `2026-09-30T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00+08:00`;

const fields = (
  particle05: number,
  temperature: number,
  humidity: number,
  pressureDiff: number,
  note: string
): SampleFields => ({ particle05, temperature, humidity, pressureDiff, note });

/**
 * 演示数据，覆盖全部规则：
 * - B-002：线上预登记 + 离线回传同改「处理备注」→ 双版冲突待下一班确认
 * - B-003：CR-2107 容量 1/1 → 容量不足阻断
 * - B-005：LF-02 同时段已归 CR-2107 → 层流台占用冲突，释放后可重试
 * - B-001（重传）：已接收批次重复回传 → 幂等拦截
 * - R-0002：CR-1201 未结异常 AN-5001 → 阻断对象入页面与审计
 * - DEV-LF01 校准后修正系数 1→1.2：引用 v3 旧快照的放行结论失效重算
 */
export function seedState(): AppState {
  return {
    shift: "早班",
    tick: 0,
    seq: 100,
    rooms: [
      { id: "CR-1201", name: "CR-1201 光刻间", isoClass: "ISO 5", capacity: 2 },
      { id: "CR-2107", name: "CR-2107 蚀刻间", isoClass: "ISO 6", capacity: 1 },
      { id: "Y-0302", name: "Y-0302 黄光区", isoClass: "ISO 7", capacity: 3 },
    ],
    hoods: [
      { id: "LF-01", name: "层流台 LF-01", deviceId: "DEV-LF01" },
      { id: "LF-02", name: "层流台 LF-02", deviceId: "DEV-LF02" },
    ],
    devices: [
      { id: "DEV-LF01", name: "LF-01 粒子计数器", snapshotVersion: 3, particleCorrection: 1, filterAgeHours: 320 },
      { id: "DEV-LF02", name: "LF-02 粒子计数器", snapshotVersion: 1, particleCorrection: 1, filterAgeHours: 120 },
    ],
    anomalies: [
      { id: "AN-5001", roomId: "CR-1201", title: "压差波动超限（>20Pa）", resolved: false },
      { id: "AN-5002", roomId: "Y-0302", title: "湿度接近上限", resolved: true },
    ],
    occupancies: [
      { id: "OCC-0001", hoodId: "LF-01", roomId: "CR-1201", start: T(8), end: T(9, 30), batchId: "B-001", source: "online", active: true },
      { id: "OCC-0002", hoodId: "LF-02", roomId: "CR-2107", start: T(8), end: T(12), batchId: "B-000", source: "online", active: true },
    ],
    batches: {
      "B-000": {
        id: "B-000",
        roomId: "CR-2107",
        hoodId: "LF-02",
        slotStart: T(8),
        slotEnd: T(12),
        collectedAt: T(8, 10),
        receivedAt: T(8, 20),
        snapshot: { deviceId: "DEV-LF02", version: 1, particleCorrection: 1, filterAgeHours: 120, capturedAt: T(8, 5) },
        fields: fields(30000, 22.1, 46, 15, "早班例行采样"),
        baseFields: fields(30000, 22.1, 46, 15, "早班例行采样"),
        source: "online",
      },
      "B-001": {
        id: "B-001",
        roomId: "CR-1201",
        hoodId: "LF-01",
        slotStart: T(8),
        slotEnd: T(9, 30),
        collectedAt: T(8, 20),
        receivedAt: T(8, 35),
        snapshot: { deviceId: "DEV-LF01", version: 3, particleCorrection: 1, filterAgeHours: 320, capturedAt: T(8, 15) },
        fields: fields(3000, 22.0, 45, 12, "0.5µm粒子正常，压差待复核"),
        baseFields: fields(3000, 22.0, 45, 12, "0.5µm粒子正常，压差待复核"),
        source: "online",
      },
    },
    drafts: {
      "B-002": {
        batchId: "B-002",
        baseFields: fields(0, 22, 45, 12, "（空白预登记）"),
        fields: fields(0, 22, 45, 14, "线上预登记：等待巡检回传"),
        updatedAt: T(9, 12),
      },
    },
    outbox: [
      {
        id: "B-002",
        roomId: "CR-1201",
        hoodId: "LF-01",
        slotStart: T(9, 30),
        slotEnd: T(10, 30),
        collectedAt: T(9, 40),
        updatedAt: T(9, 45),
        snapshot: { deviceId: "DEV-LF01", version: 3, particleCorrection: 1, filterAgeHours: 320, capturedAt: T(9, 35) },
        baseFields: fields(0, 22, 45, 12, "（空白预登记）"),
        fields: fields(3100, 22.4, 47, 12, "离线复测完成，粒子正常"),
        status: "pending",
      },
      {
        id: "B-003",
        roomId: "CR-2107",
        hoodId: "LF-02",
        slotStart: T(10),
        slotEnd: T(11),
        collectedAt: T(10, 5),
        updatedAt: T(10, 6),
        snapshot: { deviceId: "DEV-LF02", version: 1, particleCorrection: 1, filterAgeHours: 120, capturedAt: T(10, 2) },
        baseFields: fields(28000, 22.2, 44, 16, "中班前加采"),
        fields: fields(28000, 22.2, 44, 16, "中班前加采"),
        status: "pending",
      },
      {
        id: "B-005",
        roomId: "Y-0302",
        hoodId: "LF-02",
        slotStart: T(9),
        slotEnd: T(10),
        collectedAt: T(9, 12),
        updatedAt: T(9, 13),
        snapshot: { deviceId: "DEV-LF02", version: 1, particleCorrection: 1, filterAgeHours: 120, capturedAt: T(9, 5) },
        baseFields: fields(5100, 22.8, 49, 11, "黄光区巡检"),
        fields: fields(5100, 22.8, 49, 11, "黄光区巡检"),
        status: "pending",
      },
      {
        id: "B-001",
        roomId: "CR-1201",
        hoodId: "LF-01",
        slotStart: T(8),
        slotEnd: T(9, 30),
        collectedAt: T(8, 20),
        updatedAt: T(8, 21),
        snapshot: { deviceId: "DEV-LF01", version: 3, particleCorrection: 1, filterAgeHours: 320, capturedAt: T(8, 15) },
        baseFields: fields(3000, 22.0, 45, 12, "0.5µm粒子正常，压差待复核"),
        fields: fields(3000, 22.0, 45, 12, "0.5µm粒子正常，压差待复核"),
        status: "pending",
      },
    ],
    conflicts: [],
    releases: [
      {
        id: "R-0001",
        batchId: "B-000",
        roomId: "CR-2107",
        conclusion: "pass",
        snapshotVersion: 1,
        correction: 1,
        adjustedParticle: 30000,
        blockers: [],
        reasons: [],
        computedAt: T(8, 25),
        trigger: "早班例行评估",
        stale: false,
        closed: false,
      },
      {
        id: "R-0002",
        batchId: "B-001",
        roomId: "CR-1201",
        conclusion: "blocked",
        snapshotVersion: 3,
        correction: 1,
        adjustedParticle: 3000,
        blockers: [
          {
            kind: "unresolved_anomaly",
            refId: "AN-5001",
            message: "房间 CR-1201 存在未结异常 AN-5001：压差波动超限（>20Pa）",
          },
        ],
        reasons: [],
        computedAt: T(8, 36),
        trigger: "早班例行评估",
        stale: false,
        closed: false,
      },
    ],
    deviceEvents: [],
    audit: [
      {
        id: "AUD-0003",
        at: T(9, 12),
        actor: "班组长",
        action: "线上预登记",
        detail: "批次 B-002 线上预登记：压差改为 14Pa、备注更新，等待巡检离线数据回传合并",
      },
      {
        id: "AUD-0002",
        at: T(8, 36),
        actor: "系统",
        action: "放行评估 · 阻断",
        detail: "批次 B-001（CR-1201）按设备快照 v3（修正系数 1）评估：早班例行评估",
        blockers: [
          {
            kind: "unresolved_anomaly",
            refId: "AN-5001",
            message: "房间 CR-1201 存在未结异常 AN-5001：压差波动超限（>20Pa）",
          },
        ],
      },
      {
        id: "AUD-0001",
        at: T(8, 25),
        actor: "系统",
        action: "放行评估 · 放行",
        detail: "批次 B-000（CR-2107）按设备快照 v1（修正系数 1）评估：早班例行评估",
      },
    ],
  };
}
