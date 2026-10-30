import { createFileRoute, Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Card, Page, Pill, statusTone } from "@/components/studio/bits";
import { isOpenChange } from "@/lib/studio/canon";
import { latestSnapshot } from "@/lib/studio/engine";
import { useStudio } from "@/lib/studio/store";

export const Route = createFileRoute("/review")({ component: ReviewPage });

function ReviewPage() {
  const db = useStudio((s) => s.db);
  const characters = db.characters.filter((c) => latestSnapshot(c).status === "in_review" || latestSnapshot(c).status === "revision_requested");
  const stories = db.stories.filter((s) => ["in_review", "blocked", "revision_requested"].includes(latestSnapshot(s).status));
  const scripts = db.scripts.filter((s) => s.canonicalVersion == null);
  const episodes = db.episodes.filter((e) => latestSnapshot(e).snapshot.stage === "HUMAN_APPROVAL");
  const canonChanges = db.canonChanges.filter(isOpenChange);

  return (
    <Page kicker="Review" title="Generation, then a different person" lede="No agent can approve its own work. Reject, revise, or approve here. Approval writes your name into the audit.">
      <Section title="Canon changes" empty={canonChanges.length === 0}>
        {canonChanges.map((change) => (
          <Link key={change.id} to="/ip" className="flex min-h-11 items-center justify-between gap-2 border-t border-line py-2">
            <span>{change.entityName} · {change.field} → {change.proposedValue}</span>
            <Pill tone="marigold">Proposed</Pill>
          </Link>
        ))}
      </Section>
      <Section title="Characters" empty={characters.length === 0}>
        {characters.map((item) => (
          <Link key={item.id} to="/characters/$characterId" params={{ characterId: item.id }} className="flex min-h-11 items-center justify-between gap-2 border-t border-line py-2">
            <span>{item.name}</span>
            <Pill tone={statusTone(latestSnapshot(item).status)}>{latestSnapshot(item).status.replaceAll("_", " ")}</Pill>
          </Link>
        ))}
      </Section>
      <Section title="Stories" empty={stories.length === 0}>
        {stories.map((item) => {
          const snap = latestSnapshot(item).snapshot;
          return (
            <Link key={item.id} to="/stories/$storyId" params={{ storyId: item.id }} className="flex min-h-11 items-center justify-between gap-2 border-t border-line py-2">
              <span>{snap.title} · {snap.originality.total}</span>
              <Pill tone={snap.similarity.tooSimilar || !snap.originality.meetsThreshold ? "clay" : "marigold"}>{latestSnapshot(item).status.replaceAll("_", " ")}</Pill>
            </Link>
          );
        })}
      </Section>
      <Section title="Scripts" empty={scripts.length === 0}>
        {scripts.map((item) => {
          const snap = latestSnapshot(item).snapshot;
          const episode = db.episodes.find((e) => latestSnapshot(e).snapshot.scriptId === item.id);
          const to = episode ? (
            <Link to="/episodes/$episodeId" params={{ episodeId: episode.id }} className="flex min-h-11 items-center justify-between gap-2 border-t border-line py-2">
              <span>{snap.titleHi}</span>
              <Pill tone={statusTone(snap.languageReview)}>{snap.languageReview}</Pill>
            </Link>
          ) : <p key={item.id} className="border-t border-line py-2 text-sm">{snap.titleEn}</p>;
          return <div key={item.id}>{to}</div>;
        })}
      </Section>
      <Section title="Episode drafts" empty={episodes.length === 0}>
        {episodes.map((item) => {
          const snap = latestSnapshot(item).snapshot;
          return (
            <Link key={item.id} to="/episodes/$episodeId" params={{ episodeId: item.id }} className="flex min-h-11 items-center justify-between gap-2 border-t border-line py-2">
              <span>{snap.title}</span>
              <Pill tone={snap.draftApproved ? "neem" : "marigold"}>{snap.draftApproved ? "Draft held" : "Needs you"}</Pill>
            </Link>
          );
        })}
      </Section>
    </Page>
  );
}

function Section({ title, empty, children }: { title: string; empty: boolean; children: ReactNode }) {
  return (
    <Card>
      <h2 className="text-xl">{title}</h2>
      {empty ? <p className="mt-2 text-sm text-muted">Clear.</p> : <div className="mt-2">{children}</div>}
    </Card>
  );
}
