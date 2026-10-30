import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Button, Card, Page, Pill } from "@/components/studio/bits";
import { EditorialPanel } from "@/components/studio/editorial-panel";
import { AGENTS, getAgent } from "@/lib/studio/agents";
import { latestSnapshot } from "@/lib/studio/engine";
import { reviewer, useStudio } from "@/lib/studio/store";
import { acceptNormalizedDraft, assembleScriptContext, promptByVersion, SCRIPT_TEMPLATE_KEY } from "@/lib/studio/text";
import { realDrafts } from "@/lib/studio/editorial";
import { generateTextDraft, readTextAdapterStatus } from "@/lib/studio/text-call";

export const Route = createFileRoute("/agents")({ component: AgentsPage });

function AgentsPage() {
  const db = useStudio((s) => s.db);
  const apply = useStudio((s) => s.apply);
  const actor = reviewer(db);
  const tasks = [...(db.agentTasks ?? [])].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const runs = db.orchestrationRuns ?? [];
  const legacy = [...db.agentRuns].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 12);
  const template = promptByVersion(db, SCRIPT_TEMPLATE_KEY, 1) ?? promptByVersion(db, SCRIPT_TEMPLATE_KEY, (db.promptVersions ?? []).filter((item) => item.key === SCRIPT_TEMPLATE_KEY).at(-1)?.version ?? 1);
  const currentTemplate = [...(db.promptVersions ?? []), template].filter((item) => item && item.key === SCRIPT_TEMPLATE_KEY).sort((a, b) => (a?.version ?? 0) - (b?.version ?? 0)).at(-1) ?? template;
  const approved = db.stories.filter((story) => story.canonicalVersion != null && latestSnapshot(story).snapshot.title !== "Count the Thunder");
  const [storyId, setStoryId] = useState(approved[0]?.id ?? "");
  const [status, setStatus] = useState<{ configured: boolean; provider: string; model: string; modelVersion: string; cost: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const drafts = (db.aiExecutions ?? []).filter((item) => item.promptKey === SCRIPT_TEMPLATE_KEY).slice(-6).reverse();
  const eligible = realDrafts(db);
  const [editorialId, setEditorialId] = useState(eligible[0]?.scriptId ?? "");

  return (
    <Page kicker="Agents" title="Who did the work" lede="Agents propose and review. The orchestrator stops at human gates. Approval and publishing are not agent permissions.">
      <Card>
        <h2 className="text-xl">Registry</h2>
        <ul className="mt-3 flex flex-col gap-3">
          {AGENTS.map((agent) => (
            <li key={agent.id} className="border-t border-line pt-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{agent.name}</span>
                <Pill tone={agent.status === "IMPLEMENTED" ? "neem" : agent.status === "INACTIVE" ? "marigold" : "quiet"}>{agent.status.replaceAll("_", " ")}</Pill>
              </div>
              <p className="mt-1 text-muted">{agent.description}</p>
              <p className="text-xs text-muted">In: {agent.inputSchema.join(", ") || "none"}. Out: {agent.outputSchema.join(", ") || "none"}.</p>
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <h2 className="text-xl">Scriptwriter</h2>
        <p className="mt-1 text-sm">Status: implemented. Capability: real text generation. The model writes a development draft. It cannot approve the script, change canon, clear rights, pass QA, or publish.</p>
        <p className="mt-2 text-sm text-muted">Provider {status?.provider ?? "xAI"} · model {status?.model ?? "grok-4.5"} · model version {status?.modelVersion ?? "UNKNOWN"} · template {SCRIPT_TEMPLATE_KEY} v{currentTemplate?.version ?? 1}. Cost {status?.cost ?? "UNKNOWN"}.</p>
        <p className="mt-1 text-sm text-muted">{status ? (status.configured ? "The server credential is configured. It is not shown here." : "The server has no text credential. No draft will be invented.") : "The credential stays on the server. Check it before you draft. This page does not call the model by itself."}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className="text-sm" htmlFor="draft-story">Approved story</label>
          <select id="draft-story" className="border border-line bg-paper px-2 py-1 text-sm" value={storyId} onChange={(event) => setStoryId(event.target.value)}>
            {approved.length === 0 ? <option value="">None yet</option> : null}
            {approved.map((story) => (
              <option key={story.id} value={story.id}>{latestSnapshot(story).snapshot.title}</option>
            ))}
          </select>
          <Button
            type="button"
            disabled={busy || !storyId}
            onClick={() => {
              const context = assembleScriptContext(db, storyId);
              if (typeof context === "string" || !currentTemplate) {
                apply({ ok: false, db, code: "story", error: typeof context === "string" ? context : "The Hindi template is missing." });
                return;
              }
              setBusy(true);
              void generateTextDraft({ data: { templateKey: currentTemplate.key, templateVersion: currentTemplate.version, templateBody: currentTemplate.body, context } })
                .then((result) => apply(acceptNormalizedDraft(db, storyId, result, actor)))
                .catch(() => apply({ ok: false, db, code: "text", error: "The text call did not finish. No script was invented." }))
                .finally(() => setBusy(false));
            }}
          >
            {busy ? "Drafting" : "Draft a Hindi script"}
          </Button>
          <Button type="button" variant="quiet" onClick={() => void readTextAdapterStatus().then(setStatus)}>
            Check the text model
          </Button>
        </div>
        {approved.length === 0 ? <p className="mt-2 text-sm text-muted">Approve a story other than Count the Thunder. That episode stays untouched.</p> : null}
        <ul className="mt-3 flex flex-col gap-2 text-sm">
          {drafts.map((item) => (
            <li key={item.id} className="border-t border-line pt-2">
              <span className="font-semibold">{item.status}</span>
              <span className="text-muted"> · {item.providerId} · {item.model} · template v{item.promptVersion} · {item.durationMs ?? "unknown"} ms</span>
              <p className="text-muted">Tokens in {item.inputUnits ?? "unknown"}, out {item.outputUnits ?? "unknown"}. Cost {item.estimatedCost ?? "unknown"}. Validation {String(item.parameters.validation ?? "not run")}.</p>
              {item.error ? <p>{item.error}</p> : null}
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <h2 className="text-xl">Select a real draft</h2>
        <p className="mt-1 text-sm text-muted">Only a Hindi development draft filed from the live text provider can enter editorial review. Count the Thunder is excluded.</p>
        {eligible.length === 0 ? <p className="mt-2 text-sm">No eligible real draft yet. Draft one above. A fabricated script will not be labeled as real.</p> : (
          <label className="mt-3 flex flex-col gap-1 text-sm">
            Real draft
            <select className="border border-line bg-paper px-2 py-1" value={editorialId} onChange={(event) => setEditorialId(event.target.value)}>
              {eligible.map((item) => <option key={item.scriptId} value={item.scriptId}>{item.storyTitle} · {item.title}</option>)}
            </select>
          </label>
        )}
      </Card>
      <EditorialPanel scriptId={eligible.some((item) => item.scriptId === editorialId) ? editorialId : null} />
      <Card>
        <h2 className="text-xl">Activity</h2>
        {tasks.length === 0 ? <p className="mt-2 text-sm text-muted">No orchestrated tasks yet. Open an episode and run the next agent step. Count the Thunder’s earlier production runs stay in the log below.</p> : null}
        <ul className="mt-3 flex flex-col gap-4">
          {tasks.map((task) => {
            const episode = task.episodeId ? db.episodes.find((item) => item.id === task.episodeId) : undefined;
            const run = [...runs].reverse().find((item) => item.taskId === task.id);
            const agent = getAgent(task.agentId);
            return (
              <li key={task.id} className="border-t border-line pt-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{agent?.name ?? task.agentId}</span>
                  <Pill tone="quiet">{task.taskType}</Pill>
                  <Pill tone={task.status === "BLOCKED" || task.status === "FAILED" ? "clay" : task.status === "REQUIRES_HUMAN_REVIEW" ? "marigold" : "neem"}>{task.status.replaceAll("_", " ")}</Pill>
                </div>
                <p className="mt-1 text-xs text-muted">{task.updatedAt.slice(0, 16).replace("T", " ")} · {task.context.canonVersion || "no canon"} · {run ? `${run.modelProvider} / ${run.model}` : "no model run"}</p>
                {episode ? (
                  <p className="mt-1">
                    <Link className="font-semibold text-neem" to="/episodes/$episodeId" params={{ episodeId: episode.id }}>{latestSnapshot(episode).snapshot.title}</Link>
                  </p>
                ) : null}
                <p className="mt-1">In: {task.inputArtifacts.map((item) => `${item.type} ${item.id}`).join(", ") || task.instructions}</p>
                <p>Out: {task.outputArtifacts.map((item) => `${item.label} ${item.type}`).join(", ") || "none"}</p>
                <p className="text-muted">Validation: {task.validationResults.map((item) => `${item.name} ${item.result}`).join(" · ") || "not run"}</p>
                {task.blockedReason ? <p className="text-clay">{task.blockedReason}</p> : null}
              </li>
            );
          })}
        </ul>
      </Card>
      <Card>
        <h2 className="text-xl">Earlier production runs</h2>
        <p className="mt-1 text-sm text-muted">These are the development-provider runs already stored with the episode. They are not a new generation.</p>
        <ul className="mt-3 flex flex-col gap-2 text-sm">
          {legacy.map((run) => (
            <li key={run.id} className="border-t border-line pt-2">
              <span className="font-semibold">{getAgent(run.agentId)?.name ?? run.agentId}</span>
              <span className="text-muted"> · {run.action} · {run.status}</span>
              <p className="text-xs text-muted">{run.at.slice(0, 16).replace("T", " ")} · {run.providerId} / {run.model}</p>
            </li>
          ))}
        </ul>
      </Card>
    </Page>
  );
}
