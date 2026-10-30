import { createFileRoute, Link } from "@tanstack/react-router";
import { Button, Card, Meter, Page, Pill, statusTone } from "@/components/studio/bits";
import { canonResultFor } from "@/lib/studio/intelligence";
import {
  generateStoryCandidates,
  latestSnapshot,
  proposeCanonBreach,
  proposeLookalike,
  proposeUnderOriginalityBar,
  variationFor,
} from "@/lib/studio/engine";
import { useStudio } from "@/lib/studio/store";
import type { StoryDecision } from "@/lib/studio/types";

export const Route = createFileRoute("/stories/")({ component: StoriesPage });

function decisionLabel(decision: StoryDecision | undefined): string {
  if (decision === "HUMAN_REVIEW") return "Human review";
  if (decision === "REQUIRES_REVISION") return "Requires revision";
  if (decision === "BLOCKED") return "Blocked";
  return "Not evaluated";
}

function StoriesPage() {
  const db = useStudio((s) => s.db);
  const apply = useStudio((s) => s.apply);
  const ageMissing = !db.studio?.ageBand;
  const variation = variationFor(db);
  const approved = db.stories.find((story) => story.canonicalVersion != null);

  return (
    <Page
      kicker="Story intelligence"
      title="Candidates, not a prompt box"
      lede="Concepts load the locked canon, then Story Intelligence scores structure. Originality and similarity stay separate. 75 is an internal Neem bar, not a YouTube rule. Nothing here can publish."
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          Internal originality bar {db.settings.originalityThreshold}. Similarity block {db.settings.similarityBlock}.
        </p>
        <Button type="button" disabled={ageMissing} onClick={() => apply(generateStoryCandidates(db, 4, "agent_story_architect"))}>
          Generate from unused shapes
        </Button>
      </div>
      {ageMissing ? <Card><p className="text-sm text-clay">Pick a target age in Settings before generating.</p></Card> : null}
      <Card>
        <h2 className="text-xl">Variation across the library</h2>
        <p className="mt-1 text-sm text-muted">{variation.librarySize} stories. Recommendations are for a human. The engine does not force a different plot.</p>
        <ul className="mt-3 flex flex-col gap-2 text-sm">
          {variation.recommendations.map((line) => <li key={line}>{line}</li>)}
        </ul>
        {variation.overused.length ? (
          <p className="mt-3 text-xs text-muted">
            Often: {variation.overused.slice(0, 3).map((item) => `${item.value} (${item.count})`).join(" · ")}
          </p>
        ) : null}
      </Card>
      <Card>
        <h2 className="text-xl">Development probes</h2>
        <p className="mt-1 text-sm text-muted">The Story Architect proposes. These are not approvals, and they are not a live model.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            type="button"
            variant="quiet"
            disabled={!approved}
            onClick={() => approved && apply(proposeLookalike(db, approved.id, "polished", "agent_story_architect"))}
          >
            Noun-swapped lookalike
          </Button>
          <Button type="button" variant="quiet" disabled={ageMissing} onClick={() => apply(proposeUnderOriginalityBar(db, "agent_story_architect"))}>
            Story under the bar
          </Button>
          <Button type="button" variant="quiet" disabled={ageMissing} onClick={() => apply(proposeCanonBreach(db, "agent_story_architect"))}>
            Canon breach
          </Button>
        </div>
      </Card>
      <ul className="grid gap-3">
        {db.stories.map((story) => {
          const version = latestSnapshot(story);
          const snap = version.snapshot;
          const canon = canonResultFor(db, "story", story.id, version.version);
          const decision = snap.recommendation?.decision;
          const tone = decision === "BLOCKED" || decision === "REQUIRES_REVISION" ? "clay" : statusTone(version.status);
          return (
            <li key={story.id}>
              <Link to="/stories/$storyId" params={{ storyId: story.id }} className="block rounded-md border border-line bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h2 className="text-xl">{snap.title}</h2>
                    <p className="text-sm text-muted">{snap.titleHi}</p>
                  </div>
                  <Pill tone={tone}>{version.status.replaceAll("_", " ")}</Pill>
                </div>
                <p className="mt-2 text-sm">{snap.logline}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Pill tone="quiet">Age {snap.targetAge}</Pill>
                  <Pill tone={canon === "PASS" ? "neem" : canon === "NOT_EVALUATED" ? "quiet" : "clay"}>Canon {canon}</Pill>
                  <Pill tone="quiet">v{version.version}{story.canonicalVersion ? ` · approved v${story.canonicalVersion}` : ""}</Pill>
                  <Pill tone={decision === "HUMAN_REVIEW" ? "marigold" : decision === "NOT_EVALUATED" ? "quiet" : "clay"}>{decisionLabel(decision)}</Pill>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div>
                    <p className="mb-1 text-xs text-muted">Originality {snap.originality.total}/100 · internal bar {snap.originality.threshold}</p>
                    <Meter value={snap.originality.total} />
                  </div>
                  <div>
                    <p className="mb-1 text-xs text-muted">
                      Similarity {snap.similarity.score}/100
                      {snap.similarity.againstTitle ? ` · ${snap.similarity.againstTitle}` : ""}
                    </p>
                    <Meter value={snap.similarity.score} />
                  </div>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </Page>
  );
}
