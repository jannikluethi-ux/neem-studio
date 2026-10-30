import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Button, Card, Field, inputClass, Meter, Page, Pill, statusTone } from "@/components/studio/bits";
import { canonResultFor } from "@/lib/studio/intelligence";
import { approveStory, latestSnapshot, openEpisode, proposeLookalike, proposeSimilarVariant, variationFor } from "@/lib/studio/engine";
import { reviewer, useStudio } from "@/lib/studio/store";
import type { StoryDecision } from "@/lib/studio/types";

export const Route = createFileRoute("/stories/$storyId")({ component: StoryPage });

function decisionLabel(decision: StoryDecision | undefined): string {
  if (decision === "HUMAN_REVIEW") return "Human review";
  if (decision === "REQUIRES_REVISION") return "Requires revision";
  if (decision === "BLOCKED") return "Blocked";
  return "Not evaluated";
}

function StoryPage() {
  const { storyId } = Route.useParams();
  const db = useStudio((s) => s.db);
  const apply = useStudio((s) => s.apply);
  const story = db.stories.find((s) => s.id === storyId);
  const [note, setNote] = useState("Editorial: keep this specific to the lane. Do not add a villain.");
  if (!story) return <Page title="Missing story"><Link to="/stories">Back</Link></Page>;
  const version = latestSnapshot(story);
  const snap = version.snapshot;
  const canon = story.versions.find((v) => v.version === story.canonicalVersion);
  const actor = reviewer(db);
  const names = snap.characterIds.map((id) => db.characters.find((c) => c.id === id)?.name ?? id).join(", ");
  const canonResult = canonResultFor(db, "story", story.id, version.version);
  const storedCanon = snap.recommendation?.canonResult;
  const canonLabel = storedCanon && storedCanon !== "NOT_EVALUATED" ? storedCanon : canonResult;
  const variation = variationFor(db);
  const dimensions = snap.originality.dimensions ?? [];
  const similarityDimensions = snap.similarity.dimensions ?? [];

  return (
    <Page kicker={snap.targetAge} title={snap.title} lede={snap.logline}>
      <div className="flex flex-wrap gap-2">
        <Pill tone={statusTone(version.status)}>{version.status.replaceAll("_", " ")}</Pill>
        <Pill tone={snap.originality.meetsThreshold ? "neem" : "clay"}>Originality {snap.originality.total}/100</Pill>
        <Pill tone={snap.similarity.tooSimilar ? "clay" : "quiet"}>Similarity {snap.similarity.score}/100</Pill>
        <Pill tone={canonLabel === "PASS" ? "neem" : canonLabel === "NOT_EVALUATED" ? "quiet" : "clay"}>Canon {canonLabel}</Pill>
        <Pill tone={snap.recommendation?.decision === "HUMAN_REVIEW" ? "marigold" : snap.recommendation?.decision === "NOT_EVALUATED" ? "quiet" : "clay"}>
          {decisionLabel(snap.recommendation?.decision)}
        </Pill>
        <Pill tone="quiet">v{version.version}</Pill>
        {snap.canonVersionUsed ? <Pill tone="quiet">Canon snapshot {snap.canonSnapshotHash}</Pill> : null}
      </div>
      <p className="text-xs text-muted">
        {snap.titleHi} · Internal originality bar {snap.originality.threshold}. Not a YouTube rule. The decision is a recommendation. It is not approval.
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="text-xl">Brief</h2>
          <p className="mt-2 text-sm"><span className="text-muted">Cast. </span>{names || "—"}</p>
          <p className="mt-1 text-sm"><span className="text-muted">Place. </span>{snap.settingLabel}</p>
          <p className="mt-3 text-sm">{snap.beginning}</p>
          <p className="mt-2 text-sm">{snap.middle || "No middle. This cannot be approved."}</p>
          <p className="mt-2 text-sm">{snap.resolution}</p>
          <p className="mt-3 text-sm text-muted">{snap.emotionalObjective}</p>
          <p className="mt-1 text-sm text-muted">{snap.learningObjective}</p>
        </Card>
        <Card>
          <h2 className="text-xl">Story DNA</h2>
          <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
            {Object.entries(snap.dna).map(([key, value]) => (
              <div key={key}>
                <dt className="text-xs text-muted">{key}</dt>
                <dd className="break-words">{Array.isArray(value) ? value.join(", ") : value || "—"}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-xs text-muted">Fingerprint {snap.fingerprint?.hash ?? "NOT EVALUATED"}</p>
        </Card>
        <Card>
          <h2 className="text-xl">Originality</h2>
          <p className="mt-1 text-sm">{snap.originality.total}/100 · {snap.originality.meetsThreshold ? "clears the internal bar" : "below the internal bar"}</p>
          {dimensions.length === 0 ? <p className="mt-3 text-sm text-muted">NOT EVALUATED</p> : (
            <div className="mt-3 flex flex-col gap-3 text-sm">
              {dimensions.map((item) => (
                <div key={item.key}>
                  <div className="mb-1 flex justify-between gap-3"><span>{item.label}</span><span className="tabular-nums">{item.score}/{item.max}</span></div>
                  <Meter value={item.score} max={item.max} />
                  <p className="mt-1 text-xs text-muted">{item.reason}</p>
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card>
          <h2 className="text-xl">Similarity</h2>
          <p className="mt-1 text-sm">{snap.similarity.score}/100 · {snap.similarity.status ?? (snap.similarity.tooSimilar ? "LOOKALIKE" : "CLEAR")}</p>
          {snap.similarity.explanation ? (
            <pre className="mt-3 whitespace-pre-wrap font-sans text-sm">{snap.similarity.explanation}</pre>
          ) : <p className="mt-3 text-sm text-muted">NOT EVALUATED</p>}
          {similarityDimensions.length > 0 ? (
            <ul className="mt-3 text-sm">
              {similarityDimensions.filter((item) => item.matched).map((item) => (
                <li key={item.key} className="border-t border-line py-1">{item.label}: {item.score}/{item.max}</li>
              ))}
            </ul>
          ) : null}
          {snap.similarity.closestMatches?.length ? (
            <ul className="mt-3 text-sm">
              {snap.similarity.closestMatches.map((hit) => (
                <li key={hit.storyId}>
                  <Link to="/stories/$storyId" params={{ storyId: hit.storyId }} className="font-semibold text-neem">{hit.title}</Link>
                  <span className="text-muted"> · {hit.score}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </Card>
        <Card>
          <h2 className="text-xl">Variation</h2>
          <p className="mt-1 text-sm text-muted">Measured on the library, not on this title alone.</p>
          <ul className="mt-3 flex flex-col gap-2 text-sm">
            {variation.recommendations.map((line) => <li key={line}>{line}</li>)}
          </ul>
        </Card>
        <Card>
          <h2 className="text-xl">Canon and decision</h2>
          <p className="mt-2 text-sm">Canon Engine: {canonLabel}. Version {snap.canonVersionUsed ?? "not stamped"}.</p>
          {snap.canonSnapshotHash ? <p className="mt-1 break-all font-mono text-xs text-muted">{snap.canonSnapshotHash}</p> : null}
          <p className="mt-3 text-sm font-semibold">{decisionLabel(snap.recommendation?.decision)}</p>
          <ul className="mt-2 flex flex-col gap-2 text-sm">
            {(snap.recommendation?.reasons ?? ["NOT EVALUATED"]).map((reason) => <li key={reason}>{reason}</li>)}
          </ul>
          <p className="mt-3 text-xs text-muted">This recommendation is not human approval. An agent cannot approve it.</p>
        </Card>
      </div>
      <Card>
        <h2 className="text-xl">Versions</h2>
        <ul className="mt-2 text-sm">
          {story.versions.map((item) => (
            <li key={item.version} className="flex flex-wrap justify-between gap-2 border-t border-line py-2">
              <span>
                v{item.version} · originality {item.snapshot.originality?.total ?? "—"} · similarity {item.snapshot.similarity?.score ?? "—"} · {item.note}
              </span>
              <Pill tone={statusTone(item.status)}>{item.status}{item.immutable ? " · sealed" : ""}</Pill>
            </li>
          ))}
        </ul>
        {canon ? <p className="mt-2 text-xs text-muted">Approved logline stays: {canon.snapshot.logline}</p> : null}
      </Card>
      {story.canonicalVersion == null ? (
        <Card>
          <Field label="Editorial note (required, human)">
            <textarea className={inputClass} rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" onClick={() => apply(approveStory(db, story.id, actor, note))}>Approve this version</Button>
            <Button type="button" variant="quiet" onClick={() => apply(proposeSimilarVariant(db, story.id, "agent_story_architect"))}>
              Copy the same DNA
            </Button>
            <Button type="button" variant="quiet" onClick={() => apply(proposeLookalike(db, story.id, "polished", "agent_story_architect"))}>
              Swap the nouns
            </Button>
          </div>
        </Card>
      ) : (
        <Card>
          <p className="text-sm">This story has an immutable approved version. A later draft does not replace it. Open production from the approved version only.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" onClick={() => apply(openEpisode(db, story.id, actor))}>Open episode</Button>
            <Button type="button" variant="quiet" onClick={() => apply(proposeLookalike(db, story.id, "polished", "agent_story_architect"))}>
              Swap the nouns
            </Button>
          </div>
        </Card>
      )}
    </Page>
  );
}
