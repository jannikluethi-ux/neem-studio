import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Button, Card, Field, inputClass, Page, Pill } from "@/components/studio/bits";
import { brainAdvance, brainBrief, decideBrain, economicsReadiness, portfolio, recordBrain, setAutonomy } from "@/lib/studio/brain";
import { reviewer, useStudio } from "@/lib/studio/store";

export const Route = createFileRoute("/brain")({ component: BrainPage });

function BrainPage() {
  const db = useStudio((s) => s.db);
  const apply = useStudio((s) => s.apply);
  const actor = reviewer(db);
  const brief = brainBrief(db);
  const economics = economicsReadiness();
  const lanes = portfolio(db);
  const [note, setNote] = useState("Accepted as a plan. Not an approval to publish.");
  const [modified, setModified] = useState("");
  const open = (db.brainRecommendations ?? []).filter((item) => item.status === "OPEN");

  return (
    <Page kicker="Studio brain" title="What should the studio do next?" lede="Advice and plans only. The brain cannot change canon, clear rights, pass QA, or publish.">
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone="quiet">Autonomy {brief.autonomy}</Pill>
          <Pill tone="clay">Publishing off</Pill>
        </div>
        <p className="mt-2 text-sm text-muted">Level 0 observes. Levels 1 and 2 recommend and plan. Level 3 still cannot approve or publish. Levels 4 and 5 stay off.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="button" onClick={() => apply(recordBrain(db, actor))}>Record recommendations</Button>
          {[0, 1, 2, 3].map((level) => (
            <Button key={level} type="button" variant="quiet" onClick={() => apply(setAutonomy(db, level, actor))}>Level {level}</Button>
          ))}
        </div>
      </Card>
      <Card>
        <h2 className="text-xl">What needs attention</h2>
        <ul className="mt-3 flex flex-col gap-2 text-sm">
          {brief.queue.map((item) => (
            <li key={`${item.gate}-${item.title}`} className="border-t border-line pt-2">
              <Pill tone={item.gate === "RECOMMENDED" ? "quiet" : "clay"}>{item.gate}</Pill>
              <p className="mt-1 font-semibold">{item.title}</p>
              <p className="text-muted">{item.detail}</p>
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <h2 className="text-xl">What should we make next?</h2>
        {open.length === 0 ? <p className="mt-2 text-sm text-muted">Record a plan to keep these recommendations. Nothing is approved by recording them.</p> : null}
        <ul className="mt-3 flex flex-col gap-4">
          {(open.length ? open : brief.next).map((item) => {
            const stored = "id" in item ? item : null;
            return (
              <li key={stored?.id ?? item.title} className="border-t border-line pt-3">
                <div className="flex flex-wrap gap-2">
                  <Pill tone="quiet">{item.category.replaceAll("_", " ")}</Pill>
                  <Pill tone={item.confidence === "LOW" ? "marigold" : item.confidence === "HIGH" ? "neem" : "quiet"}>{item.confidence}{item.hypothesis || item.confidence === "LOW" ? " · hypothesis" : ""}</Pill>
                </div>
                <p className="mt-2 font-semibold">{item.title}</p>
                {"rationale" in item ? <p className="mt-1 text-sm">{item.rationale}</p> : null}
                <p className="mt-1 text-sm text-muted">{"recommendedAction" in item ? item.recommendedAction : item.action}</p>
                {"evidence" in item ? <p className="mt-1 text-xs text-muted">{item.evidence.join(" ")}</p> : null}
                {stored ? (
                  <div className="mt-3 flex flex-col gap-2">
                    <Field label="Decision note"><textarea className={inputClass} rows={2} value={note} onChange={(event) => setNote(event.target.value)} /></Field>
                    <Field label="Modified wording, only if you change it"><textarea className={inputClass} rows={2} value={modified} onChange={(event) => setModified(event.target.value)} /></Field>
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" onClick={() => apply(decideBrain(db, stored.id, "ACCEPT", actor, note))}>Accept</Button>
                      <Button type="button" variant="quiet" onClick={() => apply(decideBrain(db, stored.id, "REJECT", actor, note))}>Reject</Button>
                      <Button type="button" variant="quiet" onClick={() => apply(decideBrain(db, stored.id, "MODIFY", actor, note, modified))}>Modify</Button>
                      <Button type="button" variant="quiet" onClick={() => apply(decideBrain(db, stored.id, "DEFER", actor, note))}>Defer</Button>
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="text-xl">Opportunities</h2>
          <ul className="mt-3 flex flex-col gap-3 text-sm">
            {brief.opportunities.map((item) => (
              <li key={item.title} className="border-t border-line pt-2">
                <p className="font-semibold">{item.title}</p>
                <p className="text-muted">{item.category} · {item.status} · {item.confidence} · {item.expectedValue}</p>
                <p className="mt-1">{item.rationale}</p>
                <p className="text-clay">{item.risks[0]}</p>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <h2 className="text-xl">World expansion</h2>
          <ul className="mt-3 flex flex-col gap-3 text-sm">
            {brief.world.map((place) => (
              <li key={place.name}>
                <p className="font-semibold">{place.name} · {place.nameHi}</p>
                <p><Pill tone={place.status === "PROPOSED" ? "marigold" : "neem"}>{place.role} · {place.status}</Pill></p>
                <p className="mt-1 text-muted">{place.note}</p>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted">A proposed place is not canon, not a story setting, and not a production asset.</p>
        </Card>
      </div>
      <Card>
        <h2 className="text-xl">Portfolio</h2>
        <ul className="mt-3 flex flex-col gap-2 text-sm">
          {lanes.map((lane) => (
            <li key={lane.name} className="flex flex-wrap items-baseline justify-between gap-2 border-t border-line pt-2">
              <span>{lane.name}</span>
              <span className="text-muted">{lane.status} · {lane.reason}</span>
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <h2 className="text-xl">What we are learning</h2>
        <ul className="mt-3 text-sm text-muted">
          {brief.learning.map((line) => <li key={line} className="border-t border-line py-2">{line}</li>)}
        </ul>
        <p className="mt-2 text-xs text-muted">Character use: {brief.characters}. The brain cannot edit character canon.</p>
        <p className="mt-3 text-sm">{economics.note}</p>
      </Card>
      <Card>
        <h2 className="text-xl">Decision log</h2>
        {(db.brainDecisions ?? []).length === 0 ? <p className="mt-2 text-sm text-muted">No decisions recorded yet.</p> : null}
        <ul className="mt-3 flex flex-col gap-2 text-sm">
          {(db.brainDecisions ?? []).slice(-8).map((item) => (
            <li key={item.id} className="border-t border-line pt-2">
              <p className="font-semibold">{item.recommendation}</p>
              <p className="text-muted">{item.humanDecision ?? "Recorded. Waiting for a human."} {item.outcome ? `Outcome: ${item.outcome}` : ""}</p>
            </li>
          ))}
        </ul>
        {db.episodes[0] ? (
          <div className="mt-4">
            <Button type="button" variant="quiet" onClick={() => apply(brainAdvance(db, db.episodes[0].id, actor))}>Let the brain publish — blocked</Button>
          </div>
        ) : null}
        <p className="mt-3 text-xs text-muted"><Link to="/" className="font-semibold text-neem">Back to the studio</Link></p>
      </Card>
    </Page>
  );
}
