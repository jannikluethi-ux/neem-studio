import { createFileRoute } from "@tanstack/react-router";
import { Button, Card, Page, Pill } from "@/components/studio/bits";
import { architectureView, publishBlockers, requestGeneration, sessionObjectStore, switchTextAdapter } from "@/lib/studio/architecture";
import { latestSnapshot } from "@/lib/studio/engine";
import { reviewer, useStudio } from "@/lib/studio/store";

export const Route = createFileRoute("/architecture")({ component: ArchitecturePage });

function ArchitecturePage() {
  const db = useStudio((s) => s.db);
  const apply = useStudio((s) => s.apply);
  const view = architectureView(db);
  const actor = reviewer(db);
  const episode = db.episodes[0];
  const snap = episode ? latestSnapshot(episode).snapshot : null;
  const blockers = episode ? publishBlockers(db, episode.id) : [];
  const text = view.providers.find((item) => item.capability === "LLM" && item.selected);

  return (
    <Page
      kicker="Architecture"
      title="The studio is not the model"
      lede="Neem owns the IP, the workflow, the provenance, and the record. Models and hosting are replaceable services. Nothing on this page publishes."
    >
      <Card>
        <h2 className="text-xl">Control plane</h2>
        <ol className="mt-3 flex flex-col gap-1 text-sm">
          {view.plane.map((step, index) => (
            <li key={step} className="border-t border-line pt-2">
              <span className="text-muted">{index + 1}. </span>
              {step}
            </li>
          ))}
        </ol>
        <p className="mt-3 text-sm text-muted">Workflow, rights, approval, and publishing are enforced in the studio record. Hiding a button is not the control.</p>
      </Card>
      <Card>
        <h2 className="text-xl">What is portable, what is managed</h2>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div>
            <h3 className="text-sm font-semibold">Portable</h3>
            <p className="mt-1 text-sm text-muted">Canon, stories, episodes, approvals, rights, QA, agent permissions, audit, and the studio document. A new model does not rewrite them.</p>
          </div>
          <div>
            <h3 className="text-sm font-semibold">Managed</h3>
            <p className="mt-1 text-sm text-muted">Postgres holds that document when the studio is hosted. Image, video, and audio bytes go to S3-compatible storage, which is not connected. Long jobs are queued. Sign-in, when the studio is shared, is a managed account service. This device keeps the named reviewer and does not store passwords.</p>
          </div>
        </div>
        <p className="mt-3 text-sm">One region. No cluster. Publishing {view.flags.publishing ? "on" : "off"}. YouTube {view.flags.youtube ? "on" : "off"}. Autonomous execution {view.flags.autonomousExecution ? "on" : "off"}.</p>
      </Card>
      <Card>
        <h2 className="text-xl">Adapters</h2>
        <p className="mt-1 text-sm text-muted">The studio calls a capability. It does not call a vendor. The current text adapter is {text ? text.label : "unassigned"}. The live text model is listed here, but this page does not call it. A Hindi draft is requested from Agents, and the credential stays on the server.</p>
        <ul className="mt-3 flex flex-col gap-2 text-sm">
          {view.providers.map((provider) => (
            <li key={provider.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2">
              <span>{provider.label}</span>
              <span className="text-muted">
                {provider.capability} · {provider.model} {provider.modelVersion}
                {provider.selected ? " · selected" : ""}
              </span>
              <Pill tone={provider.availability === "AVAILABLE" ? "neem" : provider.availability === "UNAVAILABLE" ? "clay" : "quiet"}>{provider.availability.replaceAll("_", " ")}</Pill>
            </li>
          ))}
        </ul>
        <Button className="mt-4" type="button" variant="quiet" onClick={() => apply(switchTextAdapter(db, actor))}>
          Use the other text adapter
        </Button>
      </Card>
      <Card>
        <h2 className="text-xl">Templates</h2>
        <ul className="mt-3 flex flex-col gap-2 text-sm">
          {view.prompts.map((prompt) => (
            <li key={prompt.key} className="border-t border-line pt-2">
              <span className="font-semibold">{prompt.key}</span>
              <span className="text-muted"> · v{prompt.version}</span>
              <p className="text-muted">{prompt.purpose}</p>
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <h2 className="text-xl">Jobs</h2>
        <p className="mt-1 text-sm text-muted">Long work is queued, then stepped. It is not held open on a page request. A timeout can be retried. A creative failure cannot.</p>
        {view.jobs.length === 0 ? <p className="mt-2 text-sm">No jobs yet.</p> : null}
        <ul className="mt-3 flex flex-col gap-2 text-sm">
          {view.jobs.map((job) => (
            <li key={job.id} className="border-t border-line pt-2">
              <Pill tone={job.state === "completed" ? "neem" : job.state === "failed" ? "clay" : "quiet"}>{job.state}</Pill>
              <span className="ml-2">{job.kind}</span>
              <span className="text-muted"> · {job.providerId} · {job.model} {job.modelVersion} · attempts {job.attempts}</span>
              {job.failureClass ? <span className="text-muted"> · {job.failureClass}</span> : null}
            </li>
          ))}
        </ul>
        <Button
          className="mt-4"
          type="button"
          onClick={() => {
            const story = db.stories[0];
            if (!story) return;
            apply(requestGeneration(db, sessionObjectStore(), {
              capability: "LLM",
              promptKey: "SCRIPTWRITER_CHILDREN",
              inputArtifactIds: [story.id],
              idempotencyKey: `draft:${story.id}:${db.jobs.length}`,
            }, actor));
          }}
        >
          Queue a development draft
        </Button>
        <p className="mt-2 text-sm text-muted">The draft is not an approval. Its rights stay unknown. The story version does not change.</p>
      </Card>
      {snap && episode ? (
        <Card>
          <h2 className="text-xl">{snap.title}</h2>
          <p className="mt-2 text-sm">{blockers.join(" ")}</p>
          <p className="mt-2 text-sm text-muted">Stage {snap.stage.replaceAll("_", " ")}. An admin role does not override this.</p>
        </Card>
      ) : null}
    </Page>
  );
}
