import { useState } from "react";
import "./styles.css";
import type { AppState, Blocker, OutboxBatch, ReleaseOrder } from "./domain/types";
import { CONCLUSION_TEXT, ISO_LIMITS, SHIFTS } from "./domain/types";
import { seedState } from "./domain/seed";
import {
  closeRelease,
  endOccupancy,
  fmtDT,
  fmtRange,
  fmtTime,
  recomputeRelease,
  registerDeviceEvent,
  resolveAnomaly,
  resolveConflict,
  switchShift,
  syncBatches,
} from "./domain/engine";

const OUTBOX_META: Record<OutboxBatch["status"], { text: string; cls: string }> = {
  pending: { text: "待同步", cls: "chip-info" },
  received: { text: "已接收", cls: "chip-pass" },
  held: { text: "冲突待确认", cls: "chip-blocked" },
  failed: { text: "失败待重试", cls: "chip-fail" },
  duplicate: { text: "重复已忽略", cls: "chip-muted" },
};

const CONCLUSION_CLS: Record<ReleaseOrder["conclusion"], string> = {
  pass: "chip-pass",
  fail: "chip-fail",
  blocked: "chip-blocked",
};

function Blockers({ items }: { items?: Blocker[] }) {
  if (!items || items.length === 0) return null;
  return (
    <ul className="blockers">
      {items.map((b) => (
        <li key={b.kind + b.refId}>⛔ {b.message}</li>
      ))}
    </ul>
  );
}

function MetricCard({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <article className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <i className={tone} />
    </article>
  );
}

function App() {
  const [state, setState] = useState<AppState>(() => seedState());
  const [evtDevice, setEvtDevice] = useState("DEV-LF01");
  const [evtKind, setEvtKind] = useState<"calibration" | "filter_maintenance">("calibration");
  const [evtOperator, setEvtOperator] = useState("厂务工程师");

  const act = (fn: (s: AppState) => AppState) => setState((s) => fn(s));

  const pendingSync = state.outbox.filter((b) => b.status === "pending" || b.status === "failed").length;
  const pendingConflicts = state.conflicts.filter((c) => c.status === "pending");
  const blockedReleases = state.releases.filter((r) => !r.stale && !r.closed && r.conclusion === "blocked");
  const liveReleases = [...state.releases].reverse();
  const batches = Object.values(state.batches).sort((a, b) => a.collectedAt.localeCompare(b.collectedAt));

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">hxwl-09 · port 5109 · 离线同步与批次放行</p>
          <h1>洁净室离线采样回传与放行合并</h1>
          <p className="subtitle">
            巡检员离线采样回网后，合并房间采样、层流台占用与批次放行单：同一层流台同一时段只归一个房间；
            同字段两边改过保留两版待下一班确认；设备校准/滤芯维护后引用旧快照的放行结论立即失效重算，原始采样保留；
            失败批次单独重试、已接收批次不重复；未结异常或容量不足的房间不放行，阻断对象同步进入页面与审计。
          </p>
        </div>
        <div className="stack-card">
          <span>当前班次（冲突需下一班确认）</span>
          <div className="shift-switch">
            {SHIFTS.map((s) => (
              <button
                key={s}
                className={state.shift === s ? "active" : ""}
                onClick={() => act((st) => switchShift(st, s))}
              >
                {s}
              </button>
            ))}
          </div>
          <button className="primary-action" onClick={() => act((st) => syncBatches(st))}>
            回网同步（{pendingSync} 批待处理）
          </button>
        </div>
      </section>

      <section className="metrics-grid">
        <MetricCard label="待同步/失败批次" value={pendingSync} tone="status-ok" />
        <MetricCard label="字段冲突待确认" value={pendingConflicts.length} tone="status-watch" />
        <MetricCard label="阻断中放行单" value={blockedReleases.length} tone="status-danger" />
        <MetricCard label="设备事件" value={state.deviceEvents.length} tone="status-ok" />
      </section>

      <div className="grid-2">
        <div className="stack">
          <section className="panel">
            <div className="section-heading">
              <div>
                <p>离线回传</p>
                <h2>巡检员批次（采集时点 + 设备快照）</h2>
              </div>
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>批次</th>
                    <th>房间</th>
                    <th>层流台</th>
                    <th>占用时段</th>
                    <th>采集时点</th>
                    <th>快照</th>
                    <th>状态</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {state.outbox.map((b, i) => {
                    const meta = OUTBOX_META[b.status];
                    return (
                      <tr key={b.id + "-" + i}>
                        <td>{b.id}</td>
                        <td>{b.roomId}</td>
                        <td>{b.hoodId}</td>
                        <td>{fmtRange(b.slotStart, b.slotEnd)}</td>
                        <td>{fmtDT(b.collectedAt)}</td>
                        <td>v{b.snapshot.version}</td>
                        <td>
                          <span className={`chip ${meta.cls}`}>{meta.text}</span>
                          {b.error && <div className="error-text">{b.error}</div>}
                        </td>
                        <td>
                          {b.status === "failed" && (
                            <button className="btn-small" onClick={() => act((st) => syncBatches(st, [b.id]))}>
                              单独重试
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="hint">已接收批次重复回传将被幂等拦截；失败批次可单独重试，不影响其余批次。</p>
          </section>

          <section className="panel">
            <div className="section-heading">
              <div>
                <p>层流台占用</p>
                <h2>同一层流台同一时段只归一个房间</h2>
              </div>
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>占用单</th>
                    <th>层流台</th>
                    <th>归属房间</th>
                    <th>时段</th>
                    <th>来源</th>
                    <th>状态</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {state.occupancies.map((o) => (
                    <tr key={o.id}>
                      <td>{o.id}</td>
                      <td>{o.hoodId}</td>
                      <td>{o.roomId}</td>
                      <td>{fmtRange(o.start, o.end)}</td>
                      <td>{o.source === "online" ? "线上" : "离线回传"}</td>
                      <td>
                        <span className={`chip ${o.active ? "chip-info" : "chip-muted"}`}>
                          {o.active ? "占用中" : "已结束"}
                        </span>
                      </td>
                      <td>
                        {o.active && (
                          <button className="btn-small" onClick={() => act((st) => endOccupancy(st, o.id))}>
                            结束占用
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="panel">
            <div className="section-heading">
              <div>
                <p>设备快照与维护</p>
                <h2>校准 / 滤芯维护登记</h2>
              </div>
            </div>
            <div className="stack">
              {state.devices.map((d) => (
                <div className="card-row" key={d.id}>
                  <div className="row-head">
                    <strong>{d.name}</strong>
                    <span className="chip chip-info">快照 v{d.snapshotVersion}</span>
                  </div>
                  <p className="hint">
                    粒子修正系数 {d.particleCorrection} · 滤芯已用 {d.filterAgeHours}h
                  </p>
                </div>
              ))}
            </div>
            <form
              className="form-row"
              onSubmit={(e) => {
                e.preventDefault();
                act((st) => registerDeviceEvent(st, evtDevice, evtKind, evtOperator || "厂务工程师"));
              }}
            >
              <label>
                <span>设备</span>
                <select value={evtDevice} onChange={(e) => setEvtDevice(e.target.value)}>
                  {state.devices.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.id}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>事件</span>
                <select value={evtKind} onChange={(e) => setEvtKind(e.target.value as typeof evtKind)}>
                  <option value="calibration">校准</option>
                  <option value="filter_maintenance">滤芯维护</option>
                </select>
              </label>
              <label>
                <span>登记人</span>
                <input value={evtOperator} onChange={(e) => setEvtOperator(e.target.value)} />
              </label>
              <button className="primary-action" type="submit">
                登记并失效重算
              </button>
            </form>
            {state.deviceEvents.length > 0 && (
              <p className="hint">
                {state.deviceEvents
                  .map((e) => `${e.id} ${e.deviceId} ${e.kind === "calibration" ? "校准" : "滤芯维护"} v${e.fromVersion}→v${e.toVersion}`)
                  .join("；")}
              </p>
            )}
          </section>
        </div>

        <div className="stack">
          <section className="panel">
            <div className="section-heading">
              <div>
                <p>批次放行单</p>
                <h2>未结异常 / 容量不足一律阻断</h2>
              </div>
            </div>
            <div className="chips muted">
              {state.rooms.map((r) => {
                const n = state.releases.filter(
                  (x) => !x.stale && !x.closed && x.conclusion === "pass" && x.roomId === r.id
                ).length;
                return (
                  <button key={r.id} type="button">
                    {r.id}（{r.isoClass}）在室放行 {n}/{r.capacity}
                  </button>
                );
              })}
            </div>
            <div className="stack">
              {liveReleases.map((o) => {
                const room = state.rooms.find((r) => r.id === o.roomId);
                return (
                  <article key={o.id} className={"card-row" + (o.stale ? " stale" : "")}>
                    <div className="row-head">
                      <strong>
                        {o.id} · 批次 {o.batchId}
                      </strong>
                      <span className={`chip ${o.stale || o.closed ? "chip-muted" : CONCLUSION_CLS[o.conclusion]}`}>
                        {o.stale ? "已失效" : o.closed ? "已结案" : CONCLUSION_TEXT[o.conclusion]}
                      </span>
                    </div>
                    <p className="hint">
                      房间 {o.roomId}（{room?.isoClass}，上限 {room ? ISO_LIMITS[room.isoClass] : "-"}
                      /m³）· 快照 v{o.snapshotVersion} · 系数 {o.correction} · 修正粒子 {o.adjustedParticle}/m³ ·{" "}
                      {fmtDT(o.computedAt)} · {o.trigger}
                    </p>
                    {o.reasons.length > 0 && <p className="reasons">{o.reasons.join("；")}</p>}
                    <Blockers items={o.blockers} />
                    {o.supersededBy && <p className="hint">已被 {o.supersededBy} 取代</p>}
                    {!o.stale && !o.closed && (
                      <div className="form-row">
                        {o.conclusion !== "pass" && (
                          <button
                            className="btn-small"
                            onClick={() => act((st) => recomputeRelease(st, o.id, "班组长", "手动重新评估"))}
                          >
                            重新评估
                          </button>
                        )}
                        {o.conclusion === "pass" && (
                          <button className="btn-small" onClick={() => act((st) => closeRelease(st, o.id))}>
                            结案释放容量
                          </button>
                        )}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          </section>

          <section className="panel">
            <div className="section-heading">
              <div>
                <p>字段冲突</p>
                <h2>两边同改保留两版 · 待下一班确认</h2>
              </div>
            </div>
            {pendingConflicts.length === 0 && <p className="hint">暂无待确认冲突。</p>}
            <div className="stack">
              {pendingConflicts.map((c) => {
                const sameShift = state.shift === c.createdShift;
                return (
                  <article key={c.id} className="card-row">
                    <div className="row-head">
                      <strong>
                        批次 {c.batchId} · {c.fieldLabel}
                      </strong>
                      <span className="chip chip-blocked">待下一班确认</span>
                    </div>
                    <div className="compare">
                      <div>
                        <p className="hint">离线值 · {fmtDT(c.offlineUpdatedAt)}</p>
                        <strong>{String(c.offlineValue)}</strong>
                      </div>
                      <div>
                        <p className="hint">线上值 · {fmtDT(c.serverUpdatedAt)}</p>
                        <strong>{String(c.serverValue)}</strong>
                      </div>
                    </div>
                    <div className="form-row">
                      <button
                        className="btn-small"
                        disabled={sameShift}
                        onClick={() => act((st) => resolveConflict(st, c.id, "offline"))}
                      >
                        采用离线值
                      </button>
                      <button
                        className="btn-small"
                        disabled={sameShift}
                        onClick={() => act((st) => resolveConflict(st, c.id, "server"))}
                      >
                        采用线上值
                      </button>
                      {sameShift && <span className="hint">冲突产生于{c.createdShift}，需切换下一班后确认</span>}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>

          <section className="panel">
            <div className="section-heading">
              <div>
                <p>房间异常</p>
                <h2>未结异常阻断放行</h2>
              </div>
            </div>
            <div className="stack">
              {state.anomalies.map((a) => (
                <div className="card-row" key={a.id}>
                  <div className="row-head">
                    <strong>
                      {a.id} · {a.roomId}
                    </strong>
                    <span className={`chip ${a.resolved ? "chip-muted" : "chip-fail"}`}>
                      {a.resolved ? "已结案" : "未结"}
                    </span>
                  </div>
                  <p className="hint">{a.title}</p>
                  {!a.resolved && (
                    <div className="form-row">
                      <button className="btn-small" onClick={() => act((st) => resolveAnomaly(st, a.id))}>
                        标记已结并重估
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>

      <section className="panel records">
        <div className="section-heading">
          <div>
            <p>原始采样记录</p>
            <h2>设备事件不影响原始值，永久保留</h2>
          </div>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>批次</th>
                <th>房间</th>
                <th>层流台</th>
                <th>采集时点</th>
                <th>0.5µm粒子(原始)</th>
                <th>温度</th>
                <th>湿度</th>
                <th>压差</th>
                <th>快照</th>
                <th>备注</th>
              </tr>
            </thead>
            <tbody>
              {batches.map((b) => (
                <tr key={b.id}>
                  <td>{b.id}</td>
                  <td>{b.roomId}</td>
                  <td>{b.hoodId}</td>
                  <td>{fmtDT(b.collectedAt)}</td>
                  <td>{b.fields.particle05}</td>
                  <td>{b.fields.temperature}℃</td>
                  <td>{b.fields.humidity}%</td>
                  <td>{b.fields.pressureDiff}Pa</td>
                  <td>v{b.snapshot.version}</td>
                  <td>{b.fields.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p>审计日志</p>
            <h2>合并、冲突、失效重算与阻断对象全留痕</h2>
          </div>
        </div>
        <div className="stack">
          {state.audit.map((e) => (
            <div className="audit-item" key={e.id}>
              <div className="audit-meta">
                <span>{fmtDT(e.at)}</span>
                <span>{e.actor}</span>
                <strong>{e.action}</strong>
              </div>
              <p className="hint">{e.detail}</p>
              <Blockers items={e.blockers} />
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

export default App;
