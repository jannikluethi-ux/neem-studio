import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Button, Card, Field, inputClass, Page, Pill } from "@/components/studio/bits";
import { AGENTS } from "@/lib/studio/agents";
import { createEmptyDb, setAgeBand, setCreativeThresholds, setReviewerName, updatePlatformRules } from "@/lib/studio/engine";
import { buildSeedDb } from "@/lib/studio/seed";
import { reviewer, useStudio } from "@/lib/studio/store";
import { AGE_BANDS, LANGUAGE_SLOTS, type AgeBand } from "@/lib/studio/types";

export const Route = createFileRoute("/settings")({ component: SettingsPage });

function SettingsPage() {
  const db = useStudio((s) => s.db);
  const apply = useStudio((s) => s.apply);
  const replace = useStudio((s) => s.replace);
  const actor = reviewer(db);
  const [name, setName] = useState(db.studio?.reviewerName ?? "");
  const [originality, setOriginality] = useState(db.settings.originalityThreshold);
  const [similarity, setSimilarity] = useState(db.settings.similarityBlock);
  const rules = db.studio?.platformRules;

  return (
    <Page kicker="Settings" title="Rules you can change" lede="Age can move later without a new database. Platform numbers are configuration. They are not a promise, and this build still cannot publish.">
      <Card>
        <h2 className="text-xl">Target age</h2>
        <p className="mt-1 text-sm text-muted">Episode production is blocked until one band is active.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {AGE_BANDS.map((band) => (
            <Button key={band} type="button" variant={db.studio?.ageBand === band ? "primary" : "quiet"} onClick={() => apply(setAgeBand(db, band as AgeBand, actor))}>
              {band}
            </Button>
          ))}
        </div>
      </Card>
      <Card>
        <Field label="Reviewer name on approvals">
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Button className="mt-3" type="button" onClick={() => apply(setReviewerName(db, name, actor))}>Save name</Button>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label="Internal originality bar">
            <input className={inputClass} type="number" min={1} max={100} value={originality} onChange={(e) => setOriginality(Number(e.target.value) || 75)} />
          </Field>
          <Field label="Similarity block">
            <input className={inputClass} type="number" min={1} max={100} value={similarity} onChange={(e) => setSimilarity(Number(e.target.value) || 55)} />
          </Field>
        </div>
        <p className="mt-2 text-xs text-muted">75 is Neem’s internal creative bar, not a YouTube rule. Only a human can change it. Agents cannot lower it or turn similarity off.</p>
        <Button className="mt-3" type="button" variant="quiet" onClick={() => apply(setCreativeThresholds(db, { originalityThreshold: originality, similarityBlock: similarity }, actor))}>
          Save creative gates
        </Button>
      </Card>
      {rules ? (
        <Card>
          <h2 className="text-xl">Platform rules</h2>
          <p className="mt-1 text-sm text-muted">{rules.note}</p>
          <p className="mt-1 text-xs text-muted">{rules.source}. Last reviewed {rules.lastReviewed}.</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <Field label="Subscribers">
              <input className={inputClass} type="number" value={rules.yppSubscribers} onChange={(e) => apply(updatePlatformRules(db, { yppSubscribers: Number(e.target.value) }, actor))} />
            </Field>
            <Field label="Watch hours">
              <input className={inputClass} type="number" value={rules.yppWatchHours} onChange={(e) => apply(updatePlatformRules(db, { yppWatchHours: Number(e.target.value) }, actor))} />
            </Field>
            <Field label="Shorts views / 90d">
              <input className={inputClass} type="number" value={rules.yppShortsViews90d} onChange={(e) => apply(updatePlatformRules(db, { yppShortsViews90d: Number(e.target.value) }, actor))} />
            </Field>
          </div>
        </Card>
      ) : null}
      <Card>
        <h2 className="text-xl">Auditor brief</h2>
        <p className="mt-1 text-sm text-muted">Nine pages. 16 October 2026. Not a legal opinion. Publishing stays off.</p>
        <a className="mt-3 inline-flex min-h-11 items-center font-semibold text-neem" href="/Neem-Studio-Auditor-Brief.pdf" download="Neem-Studio-Auditor-Brief.pdf">
          Download the PDF
        </a>
      </Card>
      <Card>
        <h2 className="text-xl">Text provider</h2>
        <p className="mt-2 text-sm">Development provider · dev-template-v1</p>
        <p className="mt-1 text-sm text-muted">Templated proposals from canon. Not a live model. Swap the adapter on Architecture without moving the IP record. Image, video, voice, and music adapters are not connected. This build does not pretend they rendered anything.</p>
        <Link to="/architecture" className="mt-3 inline-flex font-semibold text-neem">Open architecture</Link>
      </Card>
      <Card>
        <h2 className="text-xl">Languages</h2>
        <p className="mt-1 text-sm text-muted">One IP. Localizations hang off it. Hindi is the only script language in this build.</p>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {LANGUAGE_SLOTS.map((lang) => (
            <li key={lang.code} className="rounded-sm border border-line px-3 py-2 text-sm">
              <span className="font-semibold">{lang.label}</span>
              <span className="text-muted"> · {lang.role}</span>
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <h2 className="text-xl">Agents</h2>
        <ul className="mt-3 flex flex-col gap-2">
          {AGENTS.map((agent) => (
            <li key={agent.id} className="border-t border-line py-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{agent.name}</span>
                <Pill tone={agent.status === "IMPLEMENTED" ? "neem" : agent.status === "INACTIVE" ? "marigold" : "quiet"}>{agent.status.replaceAll("_", " ")}</Pill>
                <Pill tone="quiet">v{agent.version}</Pill>
              </div>
              <p className="text-muted">{agent.role}. {agent.description}</p>
              <p className="text-xs text-muted">{agent.modelConfig.provider} · {agent.modelConfig.model}</p>
              <p className="text-xs text-muted">{agent.grants.join(" · ")}</p>
              <p className="text-xs text-muted">Cannot approve canon, stories, scripts, storyboards, or episodes. Cannot publish.</p>
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <h2 className="text-xl">This device</h2>
        <p className="mt-1 text-sm text-muted">The canon lives in this browser. Reset does not publish, delete a remote account, or touch a child.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="button" variant="quiet" onClick={() => replace(buildSeedDb())}>Reload Gulmohar Gali</Button>
          <Button type="button" variant="danger" onClick={() => replace(createEmptyDb())}>Start blank</Button>
        </div>
      </Card>
    </Page>
  );
}
