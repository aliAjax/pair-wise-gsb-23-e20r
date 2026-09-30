import { fmt } from "../domain";
import type { Store } from "../store";
import { Badge } from "./ui";

function ConflictCard({ store, conflictId }: { store: Store; conflictId: string }) {
  const { state, dispatch } = store;
  const c = state.conflicts.find((x) => x.id === conflictId)!;
  const batch = state.batches.find((b) => b.id === c.batchId);

  return (
    <article className="conflict-card">
      <header>
        <div>
          <h3>{c.batchId} · {c.field}</h3>
          <p>同一字段离线端与当班端都改过，两版都保留，待下一班确认。</p>
        </div>
        {c.status === "PENDING" ? (
          <Badge tone="amber">待下一班确认</Badge>
        ) : c.status === "KEPT_OFFLINE" ? (
          <Badge tone="teal">已保留离线版</Badge>
        ) : (
          <Badge tone="blue">已保留当班版</Badge>
        )}
      </header>
      <div className="version-grid">
        <div className={`version ${c.status === "KEPT_OFFLINE" ? "version-picked" : ""}`}>
          <p className="version-tag"><Badge tone="teal">离线版</Badge> 采集时点 {batch ? fmt(batch.samples[0].collectedAt) : "-"}</p>
          <p>{c.offlineValue}</p>
        </div>
        <div className={`version ${c.status === "KEPT_SERVER" ? "version-picked" : ""}`}>
          <p className="version-tag"><Badge tone="blue">当班版（服务器）</Badge></p>
          <p>{c.serverValue}</p>
        </div>
      </div>
      {c.status === "PENDING" ? (
        <footer className="conflict-actions">
          <button className="primary-action" onClick={() => dispatch({ type: "RESOLVE", conflictId: c.id, choice: "offline" })}>
            下一班确认：采用离线版
          </button>
          <button onClick={() => dispatch({ type: "RESOLVE", conflictId: c.id, choice: "server" })}>
            下一班确认：采用当班版
          </button>
        </footer>
      ) : (
        <p className="hint">已于 {fmt(c.resolvedAt!)} 确认并入审计。</p>
      )}
    </article>
  );
}

export function ConflictsPanel({ store }: { store: Store }) {
  const { state, dispatch } = store;
  const pendingConflicts = state.conflicts.filter((c) => c.status === "PENDING");

  return (
    <div className="stack">
      <section className="panel">
        <div className="section-heading">
          <div>
            <p>同字段两边改过</p>
            <h2>字段版本冲突</h2>
          </div>
          <Badge tone={pendingConflicts.length ? "amber" : "teal"}>
            {pendingConflicts.length ? `${pendingConflicts.length} 项待确认` : "无待确认"}
          </Badge>
        </div>
        {state.conflicts.length === 0 ? (
          <p className="hint">回网合并后，若同一字段两边都改过，这里会并排保留两版。</p>
        ) : (
          <div className="conflict-list">
            {state.conflicts.map((c) => (
              <ConflictCard key={c.id} store={store} conflictId={c.id} />
            ))}
          </div>
        )}
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p>维护登记（即时失效）</p>
            <h2>设备校准 / 滤芯维护</h2>
          </div>
        </div>
        <p className="hint">
          登记后，引用登记前旧快照的放行结论立即失效并重算为「需重采重算」；原始采样与采集时点全部保留，仅打旧快照标记。
        </p>
        <div className="maint-list">
          {state.maintenance.map((m) => (
            <div className="maint-row" key={m.id}>
              <div>
                <strong>{m.label}</strong>
                <p>{m.type === "CALIBRATION" ? "校准登记影响 LF-01 引用方" : "滤芯更换影响 LF-03 引用方"}</p>
              </div>
              {m.registered ? (
                <Badge tone="violet">已于 {fmt(m.at!)} 登记 · 结论已失效重算</Badge>
              ) : (
                <button className="primary-action" onClick={() => dispatch({ type: "MAINT", id: m.id })}>
                  登记{m.type === "CALIBRATION" ? "校准" : "滤芯维护"}
                </button>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
