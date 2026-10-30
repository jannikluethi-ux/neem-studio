import { createFileRoute, Link } from "@tanstack/react-router";
import { Card, Page, Pill } from "@/components/studio/bits";
import { sourceCatalog, traceEpisode } from "@/lib/studio/source";
import { latestSnapshot } from "@/lib/studio/engine";
import { useStudio } from "@/lib/studio/store";

export const Route = createFileRoute("/source")({ component: SourcePage });

function SourcePage() {
  const db = useStudio((s) => s.db);
  const catalog = sourceCatalog(db);
  const alpine = (db.locationLibrary ?? []).find((item) => item.key === "alpine-inspired");
  const episode = db.episodes[0];
  const trace = episode ? traceEpisode(db, episode.id) : null;
  const snap = episode ? latestSnapshot(episode).snapshot : null;

  return (
    <Page
      kicker="Source"
      title="What produced this episode?"
      lede="Stable ids and versions. A name can change. The id does not. Nothing on this page publishes or clears a rights flag."
    >
      <Card>
        <h2 className="text-xl">Identities</h2>
        <p className="mt-1 text-sm text-muted">{catalog.note}</p>
        <ul className="mt-3 flex flex-col gap-2 text-sm">
          {[catalog.studio, catalog.brand, catalog.universe, catalog.world].filter((item) => item != null).map((item) => (
            <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2">
              <span>{item.label}</span>
              <span className="text-muted">{item.entityType} · {item.id} · {item.status}{item.version != null ? ` · v${item.version}` : ""}</span>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex flex-wrap gap-2">
          {catalog.characters.map((item) => (
            <Pill key={item.id} tone="quiet">{item.label} · {item.id}</Pill>
          ))}
        </div>
        <p className="mt-3 text-sm text-muted">Markets on record: {catalog.markets.join(", ")}. Languages: {catalog.languages.join(", ")}.</p>
      </Card>
      <Card>
        <h2 className="text-xl">Proposed places</h2>
        <p className="mt-2 text-sm">Fictional Alpine range — {alpine?.status ?? "PROPOSED"}. Not canon, not a story setting, and not a production asset until a human approves it.</p>
        {catalog.proposals.length === 0 ? <p className="mt-2 text-sm text-muted">It is not on the location library until the studio records it. This page does not approve it.</p> : null}
        <ul className="mt-3 flex flex-col gap-2 text-sm">
          {catalog.proposals.map((item) => (
            <li key={item.id} className="border-t border-line pt-2">
              <span className="font-semibold">{item.label}</span>
              <span className="text-muted"> · {item.status} · {item.id}. Not usable as production canon.</span>
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <h2 className="text-xl">{trace ? trace.title : "No episode"}</h2>
        {trace && snap ? (
          <div className="mt-3 flex flex-col gap-2 text-sm">
            <p><Pill tone="clay">{trace.stage.replaceAll("_", " ")}</Pill> <span className="text-muted">Unpublished episodes do not get a performance record.</span></p>
            <p>Story {trace.story ? `${trace.story.id} v${trace.story.version}` : "missing"}{trace.story?.readable ? " · version still readable" : ""}</p>
            <p>Canon {trace.canon ? `${trace.canon.version} · ${trace.canon.hash.slice(0, 12)}` : "not stamped"}</p>
            <p>Script {trace.script ? `${trace.script.id} v${trace.script.version} · ${trace.script.sceneCount} scenes` : "none"}</p>
            <p>Storyboard {trace.storyboard ? `${trace.storyboard.id} v${trace.storyboard.version} · script v${trace.storyboard.scriptVersion}` : "none"}</p>
            <p>Plan {trace.plan ? `${trace.plan.id} v${trace.plan.version}` : "none"}</p>
            <p>Shots {trace.shots.length}. Assets {trace.assets.length}. Rights red flags {trace.reviews.filter((item) => item.redFlag).length}.</p>
            <p>Publications {trace.publications.length}. Performance records {trace.performance.length}.</p>
            <p className="text-muted">Human approvals stored on this trail: {trace.approvals.length}. A QA pass is not one of them.</p>
            <Link to="/episodes/$episodeId" params={{ episodeId: trace.episodeId }} className="font-semibold text-neem">Open the episode</Link>
          </div>
        ) : (
          <p className="mt-2 text-sm text-muted">No episode to trace.</p>
        )}
      </Card>
    </Page>
  );
}
