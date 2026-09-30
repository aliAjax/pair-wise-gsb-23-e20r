export type IsoClass = "ISO 5" | "ISO 6" | "ISO 7";
export type Conclusion = "pass" | "fail" | "blocked";
export type DeviceEventKind = "calibration" | "filter_maintenance";

/** ISO 14644-1 ≥0.5µm 粒子上限（个/m³） */
export const ISO_LIMITS: Record<IsoClass, number> = {
  "ISO 5": 3520,
  "ISO 6": 35200,
  "ISO 7": 352000,
};

export const CONCLUSION_TEXT: Record<Conclusion, string> = {
  pass: "放行",
  fail: "不放行",
  blocked: "阻断",
};

export const SHIFTS = ["早班", "中班", "夜班"];

/** 采样专业字段（三方合并的最小粒度） */
export interface SampleFields {
  particle05: number; // ≥0.5µm 粒子计数（个/m³，原始值）
  temperature: number; // ℃
  humidity: number; // %RH
  pressureDiff: number; // Pa
  note: string; // 处理备注
}

export const FIELD_LABELS: Record<keyof SampleFields, string> = {
  particle05: "0.5µm粒子计数",
  temperature: "温度",
  humidity: "湿度",
  pressureDiff: "压差",
  note: "处理备注",
};

/** 采集时点落盘的设备快照 */
export interface DeviceSnapshot {
  deviceId: string;
  version: number;
  particleCorrection: number; // 校准修正系数
  filterAgeHours: number; // 滤芯已用时长
  capturedAt: string;
}

export interface Room {
  id: string;
  name: string;
  isoClass: IsoClass;
  capacity: number; // 同时在室放行批次上限
}

export interface Hood {
  id: string;
  name: string;
  deviceId: string;
}

export interface Device {
  id: string;
  name: string;
  snapshotVersion: number;
  particleCorrection: number;
  filterAgeHours: number;
}

/** 巡检员离线终端里的回传批次 */
export interface OutboxBatch {
  id: string;
  roomId: string;
  hoodId: string;
  slotStart: string;
  slotEnd: string;
  collectedAt: string; // 采集时点
  updatedAt: string; // 离线最后修改时点
  snapshot: DeviceSnapshot;
  fields: SampleFields;
  baseFields: SampleFields; // 出发时基准值，用于三方合并
  status: "pending" | "received" | "held" | "failed" | "duplicate";
  error?: string;
}

/** 线上已接收（合并后）的批次，原始采样永久保留 */
export interface MergedBatch {
  id: string;
  roomId: string;
  hoodId: string;
  slotStart: string;
  slotEnd: string;
  collectedAt: string;
  receivedAt: string;
  snapshot: DeviceSnapshot;
  fields: SampleFields;
  baseFields: SampleFields;
  source: "offline" | "online";
}

/** 线上预登记草稿（离线期间被线上改过，等待与回传合并） */
export interface DraftRecord {
  batchId: string;
  fields: SampleFields;
  baseFields: SampleFields;
  updatedAt: string;
}

/** 层流台占用单：同一层流台同一时段只能归一个房间 */
export interface Occupancy {
  id: string;
  hoodId: string;
  roomId: string;
  start: string;
  end: string;
  batchId?: string;
  source: "online" | "offline";
  active: boolean;
}

export interface Anomaly {
  id: string;
  roomId: string;
  title: string;
  resolved: boolean;
}

/** 阻断对象：页面与审计共用 */
export interface Blocker {
  kind: "unresolved_anomaly" | "capacity_full";
  refId: string;
  message: string;
}

export interface ReleaseOrder {
  id: string;
  batchId: string;
  roomId: string;
  conclusion: Conclusion;
  snapshotVersion: number; // 评估时使用的设备快照版本
  correction: number; // 评估时使用的修正系数
  adjustedParticle: number; // 修正后粒子值
  blockers: Blocker[];
  reasons: string[]; // 质量超限原因
  computedAt: string;
  trigger: string;
  stale: boolean; // 引用旧快照被判失效
  closed: boolean; // 结案释放容量
  supersededBy?: string;
}

/** 同字段两边改过的双版冲突单 */
export interface FieldConflict {
  id: string;
  batchId: string;
  field: keyof SampleFields;
  fieldLabel: string;
  offlineValue: string | number;
  serverValue: string | number;
  offlineUpdatedAt: string;
  serverUpdatedAt: string;
  createdShift: string; // 产生时的班次，需下一班确认
  status: "pending" | "resolved";
  resolution?: "offline" | "server";
}

export interface DeviceEvent {
  id: string;
  deviceId: string;
  kind: DeviceEventKind;
  at: string;
  operator: string;
  fromVersion: number;
  toVersion: number;
}

export interface AuditEntry {
  id: string;
  at: string;
  actor: string;
  action: string;
  detail: string;
  blockers?: Blocker[];
}

export interface AppState {
  shift: string;
  tick: number; // 逻辑时钟（分钟步进）
  seq: number; // 单据号序列
  rooms: Room[];
  hoods: Hood[];
  devices: Device[];
  anomalies: Anomaly[];
  occupancies: Occupancy[];
  outbox: OutboxBatch[];
  batches: Record<string, MergedBatch>;
  drafts: Record<string, DraftRecord>;
  conflicts: FieldConflict[];
  releases: ReleaseOrder[];
  deviceEvents: DeviceEvent[];
  audit: AuditEntry[];
}
