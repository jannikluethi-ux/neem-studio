import { Link, useRouterState } from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { reviewer, useStudio } from "@/lib/studio/store";
import { Button } from "./bits";

const LINKS = [
  { to: "/", label: "Studio" },
  { to: "/ip", label: "Canon" },
  { to: "/characters", label: "Characters" },
  { to: "/stories", label: "Stories" },
  { to: "/episodes", label: "Episodes" },
  { to: "/queue", label: "Queue" },
  { to: "/brain", label: "Brain" },
  { to: "/analytics", label: "Analytics" },
  { to: "/source", label: "Source" },
  { to: "/architecture", label: "Architecture" },
  { to: "/plan", label: "Plan" },
  { to: "/agents", label: "Agents" },
  { to: "/review", label: "Review" },
  { to: "/settings", label: "Settings" },
] as const;

export function StudioShell({ children }: { children: ReactNode }) {
  const flash = useStudio((s) => s.flash);
  const clearFlash = useStudio((s) => s.clearFlash);
  const db = useStudio((s) => s.db);
  const path = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    void useStudio.persist.rehydrate();
  }, []);

  const age = db.studio?.ageBand ?? "age not set";

  return (
    <div className="min-h-screen bg-paper text-ink">
      <header className="border-b border-line bg-card">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-baseline justify-between gap-3">
            <Link to="/" className="font-serif text-xl text-ink">
              Neem Studio
            </Link>
            <p className="text-xs text-muted">
              India · Hindi · {age}
              {db.studio ? ` · ${reviewer(db).name}` : ""}
            </p>
          </div>
          <nav className="flex gap-1 overflow-x-auto pb-1">
            {LINKS.map((link) => {
              const active = link.to === "/" ? path === "/" : path === link.to || path.startsWith(`${link.to}/`);
              return (
                <Link
                  key={link.to}
                  to={link.to}
                  className={`inline-flex min-h-11 shrink-0 items-center rounded-sm px-3 text-sm font-semibold ${active ? "bg-neem text-neem-ink" : "text-ink"}`}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>
      {flash ? (
        <div className="border-b border-line bg-marigold text-marigold-ink">
          <div className="mx-auto flex max-w-6xl items-start justify-between gap-3 px-4 py-2 sm:px-6">
            <p className="text-sm">{flash}</p>
            <Button variant="quiet" onClick={clearFlash} className="bg-card">
              Dismiss
            </Button>
          </div>
        </div>
      ) : null}
      <main>{children}</main>
    </div>
  );
}
