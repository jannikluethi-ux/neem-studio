import { createFileRoute, Link } from "@tanstack/react-router";
import { Button, Card, Page, Pill } from "@/components/studio/bits";
import { publishEpisode } from "@/lib/studio/engine";
import { MVP_NON_GOALS, MVP_PHASES, runVerticalSlice, sliceOnRecord } from "@/lib/studio/mvp";
import { reviewer, useStudio } from "@/lib/studio/store";

export const Route = createFileRoute("/plan")({ component: PlanPage });

function tone(status: string): "neem" | "marigold" | "clay" | "quiet" {
  if (status === "IMPLEMENTED") return "neem";
  if (status === "PARTIALLY IMPLEMENTED") return "marigold";
  if (status === "NOT IMPLEMENTED") return "clay";
  return "quiet";
}

function PlanPage() {
  const db = useStudio((s) => s.db);
  const apply = useStudio((s) => s.apply);
  const actor = reviewer(db);
  const slice = sliceOnRecord(db);

  return (
    <Page
      kicker="Build plan"
      title="One story, the whole control plane"
      lede="The MVP proves a new Gulmohar Gali story can move through canon, script, storyboard, rights, QA, and human approval. Publishing stays off."
    >
      <Card>
        <h2 className="text-xl">What is in this build</h2>
        <ul className="mt-3 flex flex-col gap-3 text-sm">
          {MVP_PHASES.map((phase) => (
            <li key={phase.id} className="border-t border-line pt-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{phase.name}</span>
                <Pill tone={tone(phase.status)}>{phase.status.replaceAll("_", " ")}</Pill>
              </div>
              <p className="mt-1 text-muted">{phase.note}</p>
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <h2 className="text-xl">Vertical slice</h2>
        <p className="mt-1 text-sm text-muted">This drafts one unused story shape, runs the gates, and stops at ready to publish. Count the Thunder is not rewritten. The Alpine range is not approved.</p>
        {slice ? (
          <div className="mt-3 flex flex-col gap-1 text-sm">
            <p className="font-semibold">{slice.title}</p>
            <p>Story {slice.storyId} v{slice.storyVersion}</p>
            <p>Canon {slice.canonHash.slice(0, 12)}</p>
            <p>Script {slice.scriptId} v{slice.scriptVersion}</p>
            <p>Storyboard {slice.storyboardId} · {slice.sceneCount} scenes · {slice.shotCount} shots</p>
            <p>Plan {slice.planId} v{slice.planVersion}</p>
            <p>Assets {slice.assetIds.length}. Human approval {slice.approvalId}.</p>
            <p><Pill tone="marigold">{slice.stage.replaceAll("_", " ")}</Pill> <span className="text-muted">Not published.</span></p>
            <Link to="/episodes/$episodeId" params={{ episodeId: slice.episodeId }} className="mt-2 font-semibold text-neem">Open the episode</Link>
            <Button className="mt-3" type="button" variant="quiet" onClick={() => apply(publishEpisode(db, slice.episodeId, actor))}>
              Try to publish
            </Button>
          </div>
        ) : (
          <p className="mt-2 text-sm">No episode has reached ready to publish.</p>
        )}
        <Button className="mt-4" type="button" onClick={() => apply(runVerticalSlice(db, actor))}>
          Run one story through the slice
        </Button>
      </Card>
      <Card>
        <h2 className="text-xl">Not in this MVP</h2>
        <ul className="mt-3 flex flex-col gap-1 text-sm">
          {MVP_NON_GOALS.map((item) => (
            <li key={item} className="border-t border-line pt-2">{item}</li>
          ))}
        </ul>
      </Card>
    </Page>
  );
}
