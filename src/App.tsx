import { useMemo, useState } from "react";
import { useStore } from "./store";
import { fmt } from "./domain";
import { BatchesPanel } from "./components/BatchesPanel";
import { OccupancyPanel } from "./components/OccupancyPanel";
import { ConflictsPanel } from "./components/ConflictsPanel";
import { AuditPanel } from "./components/AuditPanel";
import { Badge } from "./components/ui";

type Tab = "batches" | "occupancy" | "conflicts" | "audit";

const TABS: { id: Tab; label: string }[] = [
  { id: "batches", label: "批次放行" },
  { id: "occupancy", label: "层流台占用" },
  { id: "conflicts", label: "冲突与维护" },
  { id: "audit", label: "阻断与审计" },
];

const RULES = [
  "同一层流台同一时段只能归一个房间",
  "离线批次带采集时点与设备快照",
  "同字段两边改过 → 两版并存待下一班确认",
  "校准/滤芯登记 → 引用旧快照结论立即失效重算，原始采样保留",
  "失败批次单独重试；已接收批次幂等不重复",
  "房间有未结异常或容量不足不能放行，页面与审计列出阻断对象",
];

function App() {
  const store = useStore();
  const { state, dispatch } = store;
  const [tab, setTab] = useState<Tab>("batches");

  const metrics = useMemo(() => {
    const pending = state.batches.filter((b) => b.syncState !== "RECEIVED").length;
    const failed = state.batches.filter((b) => b.syncState === "FAILED").length;
    const conflicts = state.conflicts.filter((c) => c.status === "PENDING").length;
    const blockTargets = new Set(
      state.batches
        .filter((b) => b.conclusion.kind === "BLOCKED")
        .flatMap((b) => b.conclusion.reasons.flatMap((r) => r.targets)),
    ).size;
    return { pending, failed, conflicts, blockTargets };
  }, [state]);

  const metricCards = [
    { label: "待合并批次", value: metrics.pending, tone: "amber" as const },
    { label: "同步失败（可单批重试）", value: metrics.failed, tone: "red" as const },
    { label: "字段冲突待下一班确认", value: metrics.conflicts, tone: "violet" as const },
    { label: "当前阻断对象", value: metrics.blockTargets, tone: "blue" as const },
  ];

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">hxwl-09 · 巡检员离线采样 · 回网合并沙盘</p>
          <h1>洁净室离线采样合并</h1>
          <p className="subtitle">
            合并房间采样、层流台占用与批次放行单：占用互斥、字段两版并存、维护即时失效重算、失败单独重试、阻断对象全程留痕。
          </p>
          <div className="status-bar">
            <button className={state.online ? "link-on" : "link-off"} onClick={() => dispatch({ type: "TOGGLE_ONLINE" })}>
              {state.online ? "● 已回网" : "○ 离线模式"}
            </button>
            <span className="clock">沙盘时钟 {fmt(state.clock)}</span>
            <button onClick={() => dispatch({ type: "TICK" })}>+1 分钟</button>
            <button onClick={() => dispatch({ type: "RESET" })}>重置演练数据</button>
          </div>
        </div>
        <div className="stack-card">
          <span>建议演练路径</span>
          <strong>① 回网 → 合并全部（B-2401 首传失败）→ ② 单独重试 B-2401 → ③ 处理备注两版 → ④ 登记 LF-03 滤芯维护观察失效重算</strong>
          <div className="chips tight">
            {state.online ? <Badge tone="teal">在线</Badge> : <Badge tone="amber">离线</Badge>}
            <Badge tone="gray">localStorage 持久化</Badge>
          </div>
        </div>
      </section>

      <section className="metrics-grid">
        {metricCards.map((m) => (
          <article className="metric-card" key={m.label}>
            <span>{m.label}</span>
            <strong>{m.value}</strong>
            <i className={`tone-bar ${m.tone}`} />
          </article>
        ))}
      </section>

      <section className="rules-strip panel">
        <p className="eyebrow">业务规则</p>
        <ul>
          {RULES.map((r, i) => (
            <li key={r}>
              <em>{String(i + 1).padStart(2, "0")}</em>
              {r}
            </li>
          ))}
        </ul>
      </section>

      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? "tab active" : "tab"} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>

      {tab === "batches" && <BatchesPanel store={store} />}
      {tab === "occupancy" && <OccupancyPanel store={store} />}
      {tab === "conflicts" && <ConflictsPanel store={store} />}
      {tab === "audit" && <AuditPanel store={store} />}
    </main>
  );
}

export default App;
