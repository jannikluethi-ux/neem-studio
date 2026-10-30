import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { EntityStatus, GateResult } from "@/lib/studio/types";

export function Page({ title, kicker, lede, children }: { title: string; kicker?: string; lede?: string; children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <header className="mb-6 max-w-3xl">
        {kicker ? <p className="text-xs font-semibold tracking-widest text-neem uppercase">{kicker}</p> : null}
        <h1 className="mt-1 text-3xl text-ink sm:text-4xl">{title}</h1>
        {lede ? <p className="mt-2 text-base leading-relaxed text-muted">{lede}</p> : null}
      </header>
      <div className="flex flex-col gap-4">{children}</div>
    </div>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-md border border-line bg-card p-4 ${className}`}>{children}</section>;
}

export function Pill({ tone, children }: { tone: "neem" | "marigold" | "clay" | "quiet"; children: ReactNode }) {
  const cls =
    tone === "neem"
      ? "bg-neem text-neem-ink"
      : tone === "marigold"
        ? "bg-marigold text-marigold-ink"
        : tone === "clay"
          ? "bg-clay text-clay-ink"
          : "border border-line bg-paper text-ink";
  return <span className={`inline-flex items-center rounded-sm px-2 py-0.5 text-xs font-semibold ${cls}`}>{children}</span>;
}

export function statusTone(status: EntityStatus | GateResult | string): "neem" | "marigold" | "clay" | "quiet" {
  if (status === "approved" || status === "PASS" || status === "pass") return "neem";
  if (status === "blocked" || status === "FAIL" || status === "fail" || status === "rejected") return "clay";
  if (status === "WARN" || status === "warn" || status === "in_review" || status === "revision_requested") return "marigold";
  return "quiet";
}

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "quiet" | "danger" }) {
  const cls =
    variant === "primary"
      ? "bg-neem text-neem-ink"
      : variant === "danger"
        ? "bg-clay text-clay-ink"
        : "border border-line bg-card text-ink";
  return (
    <button
      {...props}
      className={`inline-flex min-h-11 items-center justify-center rounded-sm px-3 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-40 ${cls} ${className}`}
    />
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium text-ink">{label}</span>
      {children}
    </label>
  );
}

export const inputClass =
  "min-h-11 rounded-sm border border-line bg-paper px-3 text-sm text-ink outline-none focus:border-neem";

export function Meter({ value, max = 100 }: { value: number; max?: number }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-sm bg-line" aria-hidden="true">
      <div className="h-full bg-neem" style={{ width: `${pct}%` }} />
    </div>
  );
}
