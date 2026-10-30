import { createFileRoute, Link } from "@tanstack/react-router";
import { Card, Page, Pill } from "@/components/studio/bits";
import { latestSnapshot } from "@/lib/studio/engine";
import { episodeBlocker } from "@/lib/studio/production";
import { useStudio } from "@/lib/studio/store";

export const Route = createFileRoute("/episodes/")({ component: EpisodesPage });

function EpisodesPage() {
  const db = useStudio((s) => s.db);
  return (
    <Page kicker="Episodes" title="One episode at a time" lede="An episode opens only from an approved story. Generated work stays a proposal until you accept it. Publish is off.">
      {db.episodes.length === 0 ? <Card><p className="text-sm">No episodes. Approve a story first.</p></Card> : null}
      <ul className="grid gap-3">
        {db.episodes.map((episode) => {
          const snap = latestSnapshot(episode).snapshot;
          const blocker = episodeBlocker(db, episode.id);
          const number = snap.episodeNumber ? `Episode ${String(snap.episodeNumber).padStart(3, "0")}` : "Episode";
          return (
            <li key={episode.id}>
              <Link to="/episodes/$episodeId" params={{ episodeId: episode.id }} className="block rounded-md border border-line bg-card p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-xl">{snap.title}</h2>
                  <Pill tone={blocker ? "clay" : "neem"}>{snap.stage.replaceAll("_", " ")}</Pill>
                </div>
                <p className="mt-2 text-sm text-muted">{number} · age {snap.targetAge} · story v{snap.storyVersion} · canon {snap.canonVersionUsed ?? "linked"}</p>
                {blocker ? <p className="mt-2 text-sm text-clay">{blocker}</p> : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </Page>
  );
}
