// 离线采样回网合并 —— 领域模型

export type SlotId = "A" | "B" | "C";

/** 离线采集时点随批保存的设备快照 */
export interface DeviceSnapshot {
  /** 快照采集时间 */
  takenAt: string;
  /** 校准有效期至 */
  calibrationExpire: string;
  /** 滤芯更换日期 */
  filterReplacedAt: string;
}

export interface SampleRec {
  id: string;
  roomId: string;
  hoodId: string;
  slotId: SlotId;
  /** 采集时点 */
  collectedAt: string;
  /** 0.5um 粒子计数（粒/m³） */
  particle05: number;
  humidity: number;
  pressureDiff: number;
  snapshot: DeviceSnapshot;
  /** 校准/滤芯维护登记后，引用旧快照的原始采样仅作保留标记，数据不删改 */
  stale: boolean;
}

export interface AnomalyRec {
  id: string;
  title: string;
  open: boolean;
}

export interface RoomRec {
  id: string;
  name: string;
  cleanClass: string;
  capacity: number;
  occupied: number;
  particleLimit: number;
  anomalies: AnomalyRec[];
}

export type BlockCode =
  | "HOOD_CONFLICT"
  | "OPEN_ANOMALY"
  | "CAPACITY"
  | "PARTICLE"
  | "STALE_SNAPSHOT";

export interface BlockReason {
  code: BlockCode;
  text: string;
  /** 阻断对象（页面与审计均逐项列出） */
  targets: string[];
}

export type ConclusionKind = "PENDING" | "APPROVED" | "BLOCKED" | "INVALIDATED";

export interface Conclusion {
  kind: ConclusionKind;
  at?: string;
  reasons: BlockReason[];
  /** 由 APPROVED 被维护登记即时作废 */
  former?: "APPROVED";
  /** 重算结果 */
  recomputed?: "NEED_RESAMPLE";
}

export type SyncState = "PENDING" | "FAILED" | "RECEIVED";

export interface BatchRec {
  /** 批次号（幂等键） */
  id: string;
  inspector: string;
  roomId: string;
  hoodId: string;
  slotId: SlotId;
  /** 本批占用容量点 */
  load: number;
  /** 离线端当前值 */
  note: string;
  /** 断网前服务器基线值 */
  baseNote: string;
  /** 回网后发现当班（服务器）改过的值 */
  serverNote?: string;
  samples: SampleRec[];
  syncState: SyncState;
  attempts: number;
  /** 演练用：首次同步必失败，之后可单独重试 */
  failFirstAttempt: boolean;
  receivedAt?: string;
  conclusion: Conclusion;
}

/** 服务器既有的已放行批次（其结论同样可能因维护登记失效） */
export interface ServerBatch {
  id: string;
  roomId: string;
  hoodId: string;
  approvedAt: string;
  sampleSummary: string;
  snapshotTakenAt: string;
  stale: boolean;
  conclusion: Conclusion;
}

export type ClaimSource = "SERVER" | "RECEIVED" | "BLOCKED" | "PENDING";

export interface OccupancyClaim {
  hoodId: string;
  slotId: SlotId;
  roomId: string;
  batchId: string;
  source: ClaimSource;
}

export type ConflictStatus = "PENDING" | "KEPT_OFFLINE" | "KEPT_SERVER";

export interface FieldConflictRec {
  id: string;
  batchId: string;
  field: string;
  offlineValue: string;
  serverValue: string;
  status: ConflictStatus;
  resolvedAt?: string;
}

export type MaintenanceType = "CALIBRATION" | "FILTER";

export interface MaintenanceEvent {
  id: string;
  hoodId: string;
  type: MaintenanceType;
  label: string;
  registered: boolean;
  at?: string;
}

export type AuditType =
  | "SYNC"
  | "BLOCK"
  | "CONFLICT"
  | "MAINT"
  | "INVALIDATE"
  | "DUPLICATE"
  | "RESOLVE";

export interface AuditEvent {
  id: number;
  at: string;
  type: AuditType;
  message: string;
  targets: string[];
}

export interface AppState {
  online: boolean;
  clock: string;
  seq: number;
  rooms: RoomRec[];
  batches: BatchRec[];
  serverBatches: ServerBatch[];
  occupancy: OccupancyClaim[];
  conflicts: FieldConflictRec[];
  maintenance: MaintenanceEvent[];
  audit: AuditEvent[];
}
