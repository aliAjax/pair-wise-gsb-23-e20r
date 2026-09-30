import type { BatchRec, BlockReason, ServerBatch } from "../types";
import { CODE_LABEL, evaluate, fmt, serverStaleReason, SLOTS } from "../domain";
import type { Store } from "../store";
import { Badge, TargetList } from "./ui";

const REASON_TONE: Record<BlockReason["code"], "red" | "amber" | "violet"> = {
  HOOD_CONFLICT: "red",
  OPEN_ANOMALY: "red",
  CAPACITY: "amber",
  PARTICLE: "red",
  STALE_SNAPSHOT: "violet",
};

function ReasonBlock({ reason }: { reason: BlockReason }) {
  return (
    <div className="reason-block">
      <p className="reason-head">
        <Badge tone={REASON_TONE[reason.code]}>{CODE_LABEL[reason.code]}</Badge>
        <span>{reason.text}</span>
      </p>
      <TargetList targets={reason.targets} />
    </div>
  );
}

function SampleRows({ batch, limit }: { batch: BatchRec; limit: number }) {
  return (
    <div className="sample-table">
      {batch.samples.map((s) => (
        <div className="sample-row" key={s.id}>
          <div className="sample-main">
            <strong>{s.id}</strong>
            <span>采集 {fmt(s.collectedAt)}</span>
            <span className={s.particle05 > limit ? "particle-over" : ""}>
              0.5μm {s.particle05.toLocaleString()} / 阈值 {limit.toLocaleString()}
            </span>
            <span>湿度 {s.humidity}%</span>
            <span>压差 {s.pressureDiff}Pa</span>
            {s.stale && <Badge tone="violet">旧快照·原始采样保留</Badge>}
          </div>
          <div className="snapshot">
            <span>设备快照 @{fmt(s.snapshot.takenAt)}</span>
            <span>校准有效至 {s.snapshot.calibrationExpire.slice(0, 10)}</span>
            <span>滤芯更换 {s.snapshot.filterReplacedAt.slice(0, 10)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function conclusionTone(b: BatchRec): "teal" | "red" | "violet" | "gray" {
  if (b.conclusion.kind === "APPROVED") return "teal";
  if (b.conclusion.kind === "BLOCKED") return "red";
  if (b.conclusion.kind === "INVALIDATED") return "violet";
  return "gray";
}

const CONCLUSION_TEXT = {
  PENDING: "待合并（预检）",
  APPROVED: "已放行",
  BLOCKED: "已接收·放行阻断",
  INVALIDATED: "结论已失效",
};

function BatchCard({ store, batch }: { store: Store; batch: BatchRec }) {
  const { state, dispatch } = store;
  const room = state.rooms.find((r) => r.id === batch.roomId)!;
  const slot = SLOTS.find((s) => s.id === batch.slotId)!;
  const preview = evaluate(state, batch);
  const isReceived = batch.syncState === "RECEIVED";
  const shownReasons = isReceived ? batch.conclusion.reasons : preview;

  return (
    <article className="batch-card">
      <header className="batch-head">
        <div>
          <h3>{batch.id}</h3>
          <p className="batch-meta">
            {batch.inspector} · {room.name}（{room.cleanClass}） · {batch.hoodId} · {slot.label}（{slot.span}） ·
            容量占用 {batch.load}
          </p>
        </div>
        <div className="batch-badges">
          {batch.syncState === "PENDING" && <Badge tone="amber">待同步</Badge>}
          {batch.syncState === "FAILED" && <Badge tone="red">同步失败</Badge>}
          {batch.syncState === "RECEIVED" && <Badge tone="blue">已接收</Badge>}
          <Badge tone={conclusionTone(batch)}>{CONCLUSION_TEXT[batch.conclusion.kind]}</Badge>
        </div>
      </header>

      <div className="note-line">
        <span className="note-label">放行备注</span>
        <span>{batch.note}</span>
        {batch.serverNote !== undefined && batch.serverNote !== batch.baseNote && (
          <Badge tone="amber">当班另改</Badge>
        )}
      </div>

      <SampleRows batch={batch} limit={room.particleLimit} />

      {!isReceived && shownReasons.length > 0 && (
        <div className="preview-box">
          <p className="preview-title">回网预检（{preview.length} 类阻断风险）</p>
          {shownReasons.map((r) => (
            <ReasonBlock key={r.code} reason={r} />
          ))}
        </div>
      )}

      {isReceived && batch.conclusion.kind === "BLOCKED" && (
        <div className="block-box">
          <p className="preview-title">阻断对象（{batch.conclusion.reasons.length} 类原因）</p>
          {batch.conclusion.reasons.map((r) => (
            <ReasonBlock key={r.code} reason={r} />
          ))}
        </div>
      )}

      {batch.conclusion.kind === "INVALIDATED" && (
        <div className="invalid-box">
          <Badge tone="violet">重算：需重采重算</Badge>
          <span>原放行结论已于 {fmt(batch.conclusion.at!)} 即时失效；上方原始采样全部保留、未删改。</span>
        </div>
      )}

      <footer className="batch-foot">
        <span className="attempts">尝试 {batch.attempts} 次{batch.receivedAt ? ` · 接收于 ${fmt(batch.receivedAt)}` : ""}</span>
        {batch.syncState === "FAILED" && (
          <button
            className="primary-action"
            disabled={!state.online}
            onClick={() => dispatch({ type: "RETRY", id: batch.id })}
          >
            单独重试{state.online ? "" : "（需先回网）"}
          </button>
        )}
      </footer>
    </article>
  );
}

function ServerBatchRow({ store, sb }: { store: Store; sb: ServerBatch }) {
  const room = store.state.rooms.find((r) => r.id === sb.roomId);
  const reason = serverStaleReason(store.state, sb);
  return (
    <div className="server-row">
      <strong>{sb.id}</strong>
      <span>{room?.name ?? sb.roomId}</span>
      <span>{sb.hoodId}</span>
      <span>{sb.sampleSummary}</span>
      <span>放行 {fmt(sb.approvedAt)}</span>
      {sb.conclusion.kind === "APPROVED" ? (
        <Badge tone="teal">当班已放行</Badge>
      ) : (
        <Badge tone="violet">失效待重算</Badge>
      )}
      {reason && (
        <div className="server-stale">
          <ReasonBlock reason={reason} />
        </div>
      )}
    </div>
  );
}

export function BatchesPanel({ store }: { store: Store }) {
  const { state, dispatch } = store;
  const pending = state.batches.filter((b) => b.syncState !== "RECEIVED").length;
  const received = state.batches.filter((b) => b.syncState === "RECEIVED").length;

  return (
    <div className="stack">
      <section className="panel">
        <div className="section-heading">
          <div>
            <p>合并队列</p>
            <h2>离线批次放行单</h2>
          </div>
          <div className="sync-controls">
            <button
              className={state.online ? "link-on" : "link-off"}
              onClick={() => dispatch({ type: "TOGGLE_ONLINE" })}
            >
              {state.online ? "● 已回网（点击切离线）" : "○ 离线中（点击回网）"}
            </button>
            <button
              className="primary-action"
              disabled={!state.online || pending === 0}
              onClick={() => dispatch({ type: "SYNC_ALL" })}
            >
              回网合并全部{pending ? `（${pending} 待处理）` : "（已接收）"}
            </button>
          </div>
        </div>
        <p className="hint">
          已接收 {received} / 共 {state.batches.length} 批；同批号重复合并会被幂等忽略，失败批次只重试自身。
        </p>
        <div className="batch-list">
          {state.batches.map((b) => (
            <BatchCard key={b.id} store={store} batch={b} />
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p>当班侧</p>
            <h2>服务器既有放行单</h2>
          </div>
        </div>
        <div className="server-list">
          {state.serverBatches.map((sb) => (
            <ServerBatchRow key={sb.id} store={store} sb={sb} />
          ))}
        </div>
      </section>
    </div>
  );
}
