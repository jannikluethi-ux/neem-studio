import { createFileRoute, Link } from "@tanstack/react-router";
import { Page, Pill } from "@/components/studio/bits";
import { getAgent } from "@/lib/studio/agents";
import { latestSnapshot } from "@/lib/studio/engine";
import { episodeBlocker, pipelineOwner } from "@/lib/studio/production";
import { previewRelease } from "@/lib/studio/release";
import { useStudio } from "@/lib/studio/store";

export const Route = createFileRoute("/queue")({ component: QueuePage });

function rank(priority: string): number {
  if (priority === "BLOCKING") return 0;
  if (priority === "HIGH" || priority === "High") return 1;
  if (priority === "NORMAL" || priority === "Normal") return 2;
  return 3;
}

function QueuePage() {
  const db = useStudio((s) => s.db);
  const rows = [
    ...(db.agentTasks ?? []).map((task) => {
      const episode = task.episodeId ? db.episodes.find((item) => item.id === task.episodeId) : undefined;
      const title = episode ? latestSnapshot(episode).snapshot.title : task.taskType;
      return {
        id: task.id,
        episodeId: task.episodeId,
        kind: task.episodeId && episode?.versions.at(-1)?.snapshot.episodeNumber ? `Episode ${String(latestSnapshot(episode).snapshot.episodeNumber).padStart(3, "0")}` : "Task",
        title,
        stage: task.status.replaceAll("_", " "),
        owner: getAgent(task.agentId)?.name ?? task.agentId,
        status: task.status,
        blocker: task.blockedReason || task.error,
        priority: task.priority,
        created: task.createdAt,
        updated: task.updatedAt,
        href: task.episodeId ? ("episode" as const) : ("agents" as const),
      };
    }),
    ...db.episodes.map((episode) => {
      const snap = latestSnapshot(episode).snapshot;
      const rights = db.qualityReviews.some((review) => review.entityId === episode.id && review.redFlag);
      const release = previewRelease(db, episode.id);
      const releaseBlock = release.status === "RELEASE_BLOCKED" ? release.blocking[0]?.what ?? "Release blocked." : release.status === "HUMAN_REVIEW_REQUIRED" ? release.humanQuestions[0] ?? "Human review required." : null;
      const blocker = [episodeBlocker(db, episode.id), releaseBlock].filter(Boolean).join(" ");
      const priority = release.status === "RELEASE_BLOCKED" ? "BLOCKING" : rights || snap.lastError ? "HIGH" : snap.stage === "HUMAN_APPROVAL" ? "NORMAL" : "LOW";
      return {
        id: episode.id,
        episodeId: episode.id,
        kind: snap.episodeNumber ? `Episode ${String(snap.episodeNumber).padStart(3, "0")}` : "Episode",
        title: snap.title,
        stage: snap.stage.replaceAll("_", " "),
        owner: pipelineOwner(snap.stage, rights),
        status: blocker ? "BLOCKED" : snap.draftApproved ? "Draft accepted" : "Open",
        blocker,
        priority,
        created: episode.createdAt,
        updated: episode.updatedAt,
        href: "episode" as const,
      };
    }),
    ...db.stories.filter((story) => {
      const status = latestSnapshot(story).status;
      return status === "in_review" || status === "blocked" || status === "revision_requested";
    }).map((story) => {
      const snap = latestSnapshot(story).snapshot;
      const status = latestSnapshot(story).status;
      const blocker = snap.similarity.tooSimilar
        ? `Too similar to ${snap.similarity.againstTitle}`
        : !snap.originality.meetsThreshold
          ? `Originality ${snap.originality.total}`
          : status === "revision_requested"
            ? "Revision requested"
            : null;
      return {
        id: story.id,
        episodeId: null as string | null,
        kind: status,
        title: snap.title,
        stage: "Story",
        owner: "You",
        status: blocker ? "BLOCKED" : "Waiting",
        blocker,
        priority: "NORMAL",
        created: story.createdAt,
        updated: story.updatedAt,
        href: "story" as const,
      };
    }),
  ].sort((a, b) => rank(a.priority) - rank(b.priority) || b.updated.localeCompare(a.updated));

  return (
    <Page kicker="Production queue" title="What is stuck, and who owns it" lede="Blocking work stays at the top. Agents cannot approve it, and nothing here can publish.">
      <ul className="flex flex-col gap-2">
        {rows.map((row) => (
          <li key={`${row.href}-${row.id}`} className="rounded-md border border-line bg-card px-3 py-3">
            {row.href === "episode" ? (
              <Link to="/episodes/$episodeId" params={{ episodeId: row.episodeId ?? row.id }} className="flex min-h-11 flex-col gap-1">
                <RowBody row={row} />
              </Link>
            ) : row.href === "story" ? (
              <Link to="/stories/$storyId" params={{ storyId: row.id }} className="flex min-h-11 flex-col gap-1">
                <RowBody row={row} />
              </Link>
            ) : (
              <Link to="/agents" className="flex min-h-11 flex-col gap-1">
                <RowBody row={row} />
              </Link>
            )}
          </li>
        ))}
      </ul>
    </Page>
  );
}

function RowBody({ row }: { row: { title: string; kind: string; stage: string; owner: string; status: string; blocker: string | null; priority: string; created: string; updated: string } }) {
  return (
    <>
      <span className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-semibold">{row.title}</span>
        <span className="text-xs text-muted">{row.updated.slice(0, 16).replace("T", " ")}</span>
      </span>
      <span className="flex flex-wrap gap-2">
        <Pill tone="quiet">{row.kind}</Pill>
        <Pill tone="quiet">{row.stage}</Pill>
        <Pill tone={row.blocker || row.status === "BLOCKED" || row.status === "FAILED" ? "clay" : row.status === "REQUIRES_HUMAN_REVIEW" ? "marigold" : "neem"}>{row.status}</Pill>
        <Pill tone={row.priority === "BLOCKING" || row.priority === "HIGH" ? "clay" : "quiet"}>{row.priority}</Pill>
      </span>
      <span className="text-xs text-muted">{row.owner} · created {row.created.slice(0, 16).replace("T", " ")}</span>
      {row.blocker ? <span className="text-sm text-clay">{row.blocker}</span> : null}
    </>
  );
}