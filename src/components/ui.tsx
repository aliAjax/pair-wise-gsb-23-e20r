import type { ReactNode } from "react";

type Tone = "teal" | "blue" | "red" | "amber" | "gray" | "violet";

const TONE_CLASS: Record<Tone, string> = {
  teal: "tone-teal",
  blue: "tone-blue",
  red: "tone-red",
  amber: "tone-amber",
  gray: "tone-gray",
  violet: "tone-violet",
};

export function Badge({ tone = "gray", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`badge ${TONE_CLASS[tone]}`}>{children}</span>;
}

export function TargetList({ targets }: { targets: string[] }) {
  if (!targets.length) return null;
  return (
    <ul className="target-list">
      {targets.map((t, i) => (
        <li key={`${t}-${i}`}>{t}</li>
      ))}
    </ul>
  );
}
