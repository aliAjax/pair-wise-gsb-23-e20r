import type { AuditType } from "../types";
import { fmt } from "../domain";
import type { Store } from "../store";
import { Badge, TargetList } from "./ui";

const TYPE_LABEL: Record<AuditType, string> = {
  SYNC: "合并接收",
  BLOCK: "放行阻断",
  CONFLICT: "版本冲突",
  MAINT: "维护登记",
  INVALIDATE: "结论失效",
  DUPLICATE: "重复忽略",
  RESOLVE: "下一班确认",
};

const TYPE_TONE: Record<AuditType, "blue" | "red" | "amber" | "violet" | "teal" | "gray"> = {
  SYNC: "blue",
  BLOCK: "red",
  CONFLICT: "amber",
  MAINT: "violet",
  INVALIDATE: "violet",
  DUPLICATE: "gray",
  RESOLVE: "teal",
};

export function AuditPanel({ store }: { store: Store }) {
  const blocks = store.state.audit.filter((a) => a.type === "BLOCK");
  const blockTargets = new Set(blocks.flatMap((a) => a.targets));

  return (
    <div className="stack">
      <section className="panel">
        <div className="section-heading">
          <div>
            <p>阻断对象汇总</p>
            <h2>当前阻断清单</h2>
          </div>
          <Badge tone={blockTargets.size ? "red" : "teal"}>{blockTargets.size} 项</Badge>
        </div>
        {blockTargets.size === 0 ? (
          <p className="hint">尚无阻断对象（离线批次的预检阻断不计入，回网接收后列入）。</p>
        ) : (
          <TargetList targets={[...blockTargets]} />
        )}
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p>全程留痕</p>
            <h2>合并与放行审计</h2>
          </div>
        </div>
        <ol className="audit-list">
          {store.state.audit.map((a) => (
            <li key={a.id} className="audit-row">
              <time>{fmt(a.at)}</time>
              <Badge tone={TYPE_TONE[a.type]}>{TYPE_LABEL[a.type]}</Badge>
              <div className="audit-body">
                <p>{a.message}</p>
                <TargetList targets={a.targets} />
              </div>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
