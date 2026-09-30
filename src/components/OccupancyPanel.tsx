import { HOODS, occupancyView, SLOTS } from "../domain";
import type { ClaimVM } from "../domain";
import type { Store } from "../store";
import { Badge } from "./ui";

const SOURCE_LABEL: Record<ClaimVM["source"], string> = {
  SERVER: "当班占用",
  RECEIVED: "合并后占用",
  BLOCKED: "已接收未放行",
  PENDING: "待合并预占",
};

const SOURCE_TONE: Record<ClaimVM["source"], "blue" | "teal" | "red" | "amber"> = {
  SERVER: "blue",
  RECEIVED: "teal",
  BLOCKED: "red",
  PENDING: "amber",
};

export function OccupancyPanel({ store }: { store: Store }) {
  const { state } = store;
  const claims = occupancyView(state);

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p>互斥规则</p>
          <h2>层流台 × 时段占用矩阵</h2>
        </div>
        <div className="legend">
          <Badge tone="blue">当班占用</Badge>
          <Badge tone="teal">合并后占用</Badge>
          <Badge tone="amber">待合并预占</Badge>
          <Badge tone="red">冲突/阻断</Badge>
        </div>
      </div>
      <p className="hint">同一层流台同一时段只能归一个房间；同格出现两个房间即为阻断冲突，页面与审计同步列出。</p>

      <div className="matrix">
        <div className="matrix-corner">层流台 ＼ 时段</div>
        {SLOTS.map((s) => (
          <div className="matrix-slot" key={s.id}>
            <strong>{s.label}</strong>
            <span>{s.span}</span>
          </div>
        ))}

        {HOODS.map((h) => (
          <div className="matrix-row" key={h.id}>
            <div className="matrix-hood">
              <strong>{h.label}</strong>
            </div>
            {SLOTS.map((slot) => {
              const cell = claims.filter((c) => c.hoodId === h.id && c.slotId === slot.id);
              return (
                <div className={`matrix-cell ${cell.some((c) => c.conflict) ? "cell-conflict" : ""}`} key={slot.id}>
                  {cell.length === 0 && <span className="cell-empty">空闲</span>}
                  {cell.map((c) => {
                    const room = state.rooms.find((r) => r.id === c.roomId);
                    return (
                      <div className={`claim ${c.conflict ? "claim-conflict" : ""}`} key={c.key}>
                        <div className="claim-line">
                          <strong>{c.roomId}</strong>
                          <span>{room?.name}</span>
                        </div>
                        <div className="claim-line sub">
                          <span>{c.batchId}</span>
                          <Badge tone={c.conflict ? "red" : SOURCE_TONE[c.source]}>
                            {c.conflict ? "占用冲突" : SOURCE_LABEL[c.source]}
                          </Badge>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </section>
  );
}
