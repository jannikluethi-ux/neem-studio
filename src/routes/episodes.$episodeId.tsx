import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Button, Card, Field, inputClass, Page, Pill, statusTone } from "@/components/studio/bits";
import { EditorialPanel } from "@/components/studio/editorial-panel";
import { realDrafts } from "@/lib/studio/editorial";
import { audienceFor } from "@/lib/studio/analytics";
import { approveEpisodeDraft, approveScript, approveStoryboard, assembleDraftEpisode, chainForEpisode, decideLocationProposal, decideProductionRevision, explainCanon, generateScript, generateStoryboard, latestSnapshot, proposeNewLocation, publishEpisode, reportProductionProblem, reviewHindi, runQa } from "@/lib/studio/engine";
import { nextOrchestratedStep } from "@/lib/studio/orchestration";
import { episodeBlocker, productionPipeline, sceneBreakdown, validateBoardConsistency, validateStoryConsistency } from "@/lib/studio/production";
import { advanceToHumanApproval, previewRelease, readRelease, resultLabel, runReleaseGate, statusLabel } from "@/lib/studio/release";
import { traceEpisode } from "@/lib/studio/source";
import { EPISODE_STAGES } from "@/lib/studio/types";
import { MVP_STAGES } from "@/lib/studio/machine";
import { reviewer, useStudio } from "@/lib/studio/store";

export const Route = createFileRoute("/episodes/$episodeId")({ component: EpisodePage });

function EpisodePage() {
  const { episodeId } = Route.useParams();
  const db = useStudio((s) => s.db);
  const apply = useStudio((s) => s.apply);
  const episode = db.episodes.find((e) => e.id === episodeId);
  const [note, setNote] = useState("Approved as an internal draft. Not for upload.");
  const [problem, setProblem] = useState("This beat cannot be staged without changing the approved story.");
  const [placeName, setPlaceName] = useState("");
  if (!episode) return <Page title="Missing episode"><Link to="/episodes">Back</Link></Page>;
  const snap = latestSnapshot(episode).snapshot;
  const script = snap.scriptId ? db.scripts.find((s) => s.id === snap.scriptId) : undefined;
  const scriptSnap = script ? latestSnapshot(script).snapshot : null;
  const board = snap.storyboardId ? db.storyboards.find((s) => s.id === snap.storyboardId) : undefined;
  const boardSnap = board ? latestSnapshot(board).snapshot : null;
  const plan = snap.planId ? db.plans.find((p) => p.id === snap.planId) : undefined;
  const planSnap = plan ? latestSnapshot(plan).snapshot : null;
  const reviews = db.qualityReviews.filter((r) => r.entityId === episode.id);
  const chain = chainForEpisode(db, episode.id);
  const actor = reviewer(db);
  const liveDraft = script ? realDrafts(db).some((item) => item.scriptId === script.id) : false;
  const story = db.stories.find((s) => s.id === snap.storyId);
  const canonTrace = explainCanon(db, "episode", episode.id);
  const scriptTrace = script ? explainCanon(db, "script", script.id) : null;
  const boardTrace = board ? explainCanon(db, "storyboard", board.id) : null;
  const canonVersion = snap.canonVersionUsed ?? canonTrace.run?.canonVersion ?? "not stamped";
  const canonHash = snap.canonSnapshotHash ?? canonTrace.run?.snapshotHash ?? "";
  const canonFail = [scriptTrace?.validation, boardTrace?.validation, canonTrace.validation].find((item) => item && (item.validation.result === "FAIL" || item.validation.result === "BLOCKED"));
  const pipeline = productionPipeline(db, episode.id);
  const blocker = episodeBlocker(db, episode.id);
  const storySnap = story ? (story.versions.find((item) => item.version === snap.storyVersion)?.snapshot ?? null) : null;
  const consistency = scriptSnap && storySnap ? validateStoryConsistency(storySnap, scriptSnap) : null;
  const boardConsistency = scriptSnap && boardSnap ? validateBoardConsistency(scriptSnap, boardSnap) : null;
  const scenes = scriptSnap ? sceneBreakdown(scriptSnap, snap.canonVersionUsed ?? scriptSnap.canonVersionUsed ?? "") : [];
  const revisions = (db.productionRevisions ?? []).filter((item) => item.episodeId === episode.id);
  const proposals = (db.locationProposals ?? []).filter((item) => item.episodeId === episode.id);
  const assets = db.assets.filter((asset) => {
    const body = latestSnapshot(asset).snapshot;
    return body.episodeId === episode.id || body.linkedEntityId === snap.scriptId || body.linkedEntityId === snap.storyboardId || body.linkedEntityId === snap.planId;
  });
  const number = snap.episodeNumber ? String(snap.episodeNumber).padStart(3, "0") : "—";
  const release = previewRelease(db, episode.id);
  const recorded = readRelease(db, episode.id);
  const trace = traceEpisode(db, episode.id);
  const audience = audienceFor(db, episode.id);

  return (
    <Page kicker={`Episode ${number}`} title={snap.title} lede={`Age ${snap.targetAge} · ${snap.audience} · story v${snap.storyVersion} · canon ${canonVersion}`}>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {EPISODE_STAGES.map((stage) => {
          const on = stage === snap.stage;
          const inSlice = MVP_STAGES.includes(stage);
          return (
            <span key={stage} className={`shrink-0 rounded-sm px-2 py-2 text-xs font-semibold ${on ? "bg-neem text-neem-ink" : inSlice ? "border border-line bg-card text-ink" : "text-muted"}`}>
              {stage.replaceAll("_", " ")}
            </span>
          );
        })}
      </div>
      {blocker ? <Card><p className="text-sm text-clay">Blocked: {blocker}</p></Card> : null}
      {snap.holdReason ? <Card><p className="text-sm text-clay">{snap.holdReason}</p></Card> : null}
      {trace ? (
        <Card>
          <h2 className="text-xl">Source of truth</h2>
          <p className="mt-1 text-sm text-muted">This episode points at exact versions. Older versions stay readable. Audience performance is not invented.</p>
          <ul className="mt-3 flex flex-col gap-1 text-sm">
            <li>Story {trace.story ? `${trace.story.id} · v${trace.story.version}` : "missing"}</li>
            <li>Canon {trace.canon ? trace.canon.version : "not stamped"}</li>
            <li>Script {trace.script ? `${trace.script.id} · v${trace.script.version}` : "none"} · {trace.scenes.length} scenes</li>
            <li>Storyboard {trace.storyboard ? `${trace.storyboard.id} · v${trace.storyboard.version}` : "none"} · {trace.shots.length} shots</li>
            <li>Plan {trace.plan ? `${trace.plan.id} · v${trace.plan.version}` : "none"}</li>
            <li>Publications {trace.publications.length}. Performance {trace.performance.length}.</li>
          </ul>
          <Link to="/source" className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-neem">Open the full trace</Link>
        </Card>
      ) : null}
      <Card>
        <h2 className="text-xl">Audience performance</h2>
        <p className="mt-2 text-sm">{audience.reason}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Pill tone={audience.dataState === "NOT_AVAILABLE" ? "clay" : "quiet"}>{audience.dataState.replaceAll("_", " ")}</Pill>
          <Pill tone="quiet">{audience.views == null ? "Views unknown" : `Views ${audience.views}`}</Pill>
          <Pill tone="quiet">{audience.retention == null ? "Retention unknown" : `Retention ${audience.retention}`}</Pill>
          <Pill tone="quiet">{audience.ctr == null ? "CTR unknown" : `CTR ${audience.ctr}`}</Pill>
        </div>
      </Card>
      {snap.lastError ? <Card><p className="text-sm text-clay">{snap.lastError}</p></Card> : null}
      <Card>
        <h2 className="text-xl">Pipeline</h2>
        <p className="mt-1 text-sm text-muted">Story → script → scenes → storyboard → plan → assets → draft → review. A later stage cannot approve itself.</p>
        <ol className="mt-3 flex flex-col gap-3">
          {pipeline.map((row) => (
            <li key={row.name} className="border-t border-line pt-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{row.name}</span>
                <Pill tone="quiet">{row.version}</Pill>
                <Pill tone={statusTone(row.validation)}>{row.validation}</Pill>
                <Pill tone={row.blocking ? "clay" : "quiet"}>{row.approval}</Pill>
              </div>
              <p className="mt-1 text-sm">{row.status}</p>
              {row.blocking ? <p className="mt-1 text-sm text-clay">{row.blocking}</p> : null}
            </li>
          ))}
        </ol>
      </Card>
      <Card>
        <h2 className="text-xl">Canon used</h2>
        <p className="mt-2 text-sm">Version {canonVersion}</p>
        {canonHash ? <p className="mt-1 break-all font-mono text-xs text-muted">Snapshot {canonHash}</p> : null}
        <p className="mt-2 text-sm text-muted">
          {canonTrace.run?.purpose === "migration"
            ? "Linked to the approved canon already in this studio. The episode text was not rewritten."
            : "This episode was produced against that snapshot. A later canon change does not silently edit it."}
        </p>
        {canonFail ? (
          <div className="mt-3">
            <Pill tone="clay">{canonFail.validation.result}</Pill>
            <ul className="mt-2 text-sm">
              {canonFail.validation.violations.map((violation, index) => (
                <li key={`${violation.field}-${index}`}>
                  {violation.entityName} · {violation.field}: proposed {violation.proposed}, canon {violation.canonical}. {violation.rule}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="mt-3 text-sm">No stored canon failure on this episode.</p>
        )}
      </Card>
      <Card>
        <h2 className="text-xl">Next human step</h2>
        <div className="mt-3 flex flex-col gap-3">
          <Button type="button" onClick={() => apply(nextOrchestratedStep(db, episode.id, actor))}>Run the next agent step</Button>
          {snap.stage === "STORY_APPROVED" ? (
            <Button type="button" onClick={() => apply(generateScript(db, snap.storyId, "agent_scriptwriter"))}>Generate Hindi script</Button>
          ) : null}
          {script && !liveDraft && scriptSnap?.languageReview === "pending" ? (
            <Button type="button" onClick={() => apply(reviewHindi(db, script.id, "agent_hindi_editor"))}>Run Hindi review</Button>
          ) : null}
          {script && !liveDraft && scriptSnap && scriptSnap.languageReview !== "pending" && scriptSnap.languageReview !== "fail" && script.canonicalVersion == null ? (
            <>
              <Field label="Script note"><textarea className={inputClass} rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
              <Button type="button" onClick={() => apply(approveScript(db, script.id, actor, note))}>Approve script</Button>
            </>
          ) : null}
          {snap.stage === "SCRIPT_APPROVED" && script ? (
            <Button type="button" onClick={() => apply(generateStoryboard(db, script.id, "agent_storyboard_director"))}>Storyboard and production plan</Button>
          ) : null}
          {snap.stage === "STORYBOARD" ? (
            <Button type="button" onClick={() => apply(runQa(db, episode.id, "agent_qa"))}>Run quality, rights, and policy gates</Button>
          ) : null}
          {board && script?.canonicalVersion && board.canonicalVersion == null ? (
            <Button type="button" onClick={() => apply(approveStoryboard(db, board.id, actor, note))}>Approve storyboard</Button>
          ) : null}
          {script?.canonicalVersion && snap.storyboardId && snap.planId && !snap.draftAssembled ? (
            <Button type="button" onClick={() => apply(assembleDraftEpisode(db, episode.id, actor))}>Assemble draft reference</Button>
          ) : null}
          {snap.draftAssembled ? <p className="text-sm">Draft episode is a PRODUCTION MOCK. No picture, voice, or music was rendered.</p> : null}
          {snap.stage === "HUMAN_APPROVAL" && !snap.draftApproved ? (
            <>
              <Field label="Draft approval note"><textarea className={inputClass} rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
              <Button type="button" onClick={() => apply(approveEpisodeDraft(db, episode.id, actor, note))}>Approve draft</Button>
            </>
          ) : null}
          <Button type="button" variant="quiet" onClick={() => apply(publishEpisode(db, episode.id, actor))}>Publish — disabled</Button>
          <Button type="button" variant="quiet" onClick={() => apply(runReleaseGate(db, episode.id, actor))}>Record release check</Button>
          {recorded && !recorded.stale && recorded.report.status === "RELEASE_READY" && snap.stage !== "HUMAN_APPROVAL" && snap.stage !== "PUBLISHED" ? (
            <Button type="button" onClick={() => apply(advanceToHumanApproval(db, episode.id, actor))}>Move to human approval</Button>
          ) : null}
        </div>
        {story ? <p className="mt-3 text-xs text-muted">From <Link className="font-semibold text-neem" to="/stories/$storyId" params={{ storyId: story.id }}>{story.name}</Link></p> : null}
      </Card>
      {scriptSnap ? (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-xl">{scriptSnap.titleHi}</h2>
            <Pill tone={statusTone(scriptSnap.languageReview)}>{scriptSnap.draftLabel ?? "Script"} · {scriptSnap.languageReview}</Pill>
          </div>
          <p className="mt-1 text-xs text-muted">{scriptSnap.providerDisclosure} Story v{scriptSnap.storyVersion}. Canon {scriptSnap.canonVersionUsed ?? "unstamped"}.</p>
          {script && script.canonicalVersion && script.currentVersion !== script.canonicalVersion ? (
            <p className="mt-2 text-sm text-marigold-ink">Showing the latest proposal. Approved script v{script.canonicalVersion} is unchanged.</p>
          ) : null}
          {consistency ? (
            <p className={`mt-2 text-sm ${consistency.result === "FAIL" ? "text-clay" : ""}`}>
              Story consistency {consistency.result}. {consistency.failures[0]?.detail ?? "The script still matches the approved story."}
            </p>
          ) : null}
          <ul className="mt-3 flex flex-wrap gap-2">
            {scriptSnap.vocabulary.map((word) => (
              <li key={word.word}><Pill tone="quiet">{word.word} · {word.meaning}</Pill></li>
            ))}
          </ul>
          <div className="mt-4 flex flex-col gap-4">
            {scriptSnap.scenes.map((scene) => (
              <div key={scene.sceneNo}>
                <p className="text-xs font-semibold text-neem">Scene {scene.sceneNo} · {scene.locationKey}</p>
                <p className="mt-1 text-sm">{scene.purpose ?? scene.action}</p>
                <p className="mt-1 text-sm">{scene.action}</p>
                {scene.emotionalBeat ? <p className="text-xs text-muted">{scene.emotionalBeat}</p> : null}
                {scene.visualDirection ? <p className="text-xs text-muted">{scene.visualDirection}</p> : null}
                {scene.soundDirection ? <p className="text-xs text-muted">{scene.soundDirection} · {scene.estimatedDuration ?? ""} · {scene.transition ?? ""}</p> : null}
                <ul className="mt-2 flex flex-col gap-1">
                  {scene.lines.map((line, index) => (
                    <li key={index} className="text-sm">
                      <span className="font-semibold">{line.speaker}. </span>
                      <span className="font-serif text-base">{line.hi}</span>
                      <span className="text-muted"> — {line.en}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <ul className="mt-3 text-xs text-muted">
            {scriptSnap.canonRefs.map((ref) => <li key={ref}>{ref}</li>)}
          </ul>
        </Card>
      ) : null}
      {script ? <EditorialPanel scriptId={script.id} /> : null}
      {scenes.length > 0 ? (
        <Card>
          <h2 className="text-xl">Scene breakdown</h2>
          <p className="mt-1 text-sm text-muted">Derived from the script. Not a second story.</p>
          <ol className="mt-3 flex flex-col gap-3">
            {scenes.map((scene) => (
              <li key={scene.sceneId} className="border-t border-line pt-2 text-sm">
                <p className="font-semibold">Scene {scene.sceneNumber}. {scene.purpose}</p>
                <p className="text-muted">{scene.locationKey} · {scene.estimatedDuration} · canon {scene.canonVersion || "—"}</p>
                <p className="mt-1">{scene.dialogueReference}</p>
                <p className="text-xs text-muted">{scene.visualRequirements}</p>
                <p className="text-xs text-muted">{scene.audioRequirements}</p>
              </li>
            ))}
          </ol>
        </Card>
      ) : null}
      {boardSnap ? (
        <Card>
          <h2 className="text-xl">Storyboard</h2>
          <p className="mt-1 text-xs text-muted">{boardSnap.providerDisclosure} Script v{boardSnap.scriptVersion}. Canon {boardSnap.canonVersionUsed ?? "unstamped"}.</p>
          {board && board.canonicalVersion ? <p className="mt-2 text-sm">Approved storyboard v{board.canonicalVersion}.</p> : <p className="mt-2 text-sm text-muted">Proposal. Not human-approved.</p>}
          {board && board.canonicalVersion && board.currentVersion !== board.canonicalVersion ? (
            <p className="mt-1 text-sm text-marigold-ink">Latest proposal differs. The approved board stays readable.</p>
          ) : null}
          {boardConsistency ? (
            <p className={`mt-2 text-sm ${boardConsistency.result === "FAIL" ? "text-clay" : ""}`}>
              Story consistency {boardConsistency.result}. {boardConsistency.failures[0]?.detail ?? "Shots follow the approved script."}
            </p>
          ) : null}
          <ol className="mt-3 flex flex-col gap-3">
            {boardSnap.scenes.flatMap((scene) => scene.shots).map((shot) => (
              <li key={shot.id} className="border-t border-line pt-2 text-sm">
                <span className="font-semibold">Shot {shot.shotNo}. </span>
                {shot.description}
                <p className="text-xs text-muted">{shot.framing ? `${shot.framing} · ` : ""}{shot.camera} · {shot.locationKey}</p>
                {shot.dialogueReference ? <p className="font-serif">{shot.dialogueReference}</p> : null}
                {shot.continuityNotes ? <p className="text-xs text-muted">{shot.continuityNotes}</p> : null}
                {shot.contradictsScript ? <p className="text-xs text-clay">This shot contradicts the approved script.</p> : null}
              </li>
            ))}
          </ol>
        </Card>
      ) : null}
      {planSnap ? (
        <Card>
          <h2 className="text-xl">Production plan</h2>
          <p className="mt-2 text-sm">{planSnap.disclosure}</p>
          <p className="mt-2 text-sm font-semibold">{planSnap.providerStatus ?? "NOT CONNECTED"}</p>
          <p className="mt-2 text-sm">{planSnap.runtimeMinutes} minutes · {planSnap.shots} shots</p>
          <p className="mt-2 text-sm text-marigold-ink">{planSnap.musicStatus}</p>
          <ul className="mt-2 list-disc pl-5 text-sm">{planSnap.voicePlan.map((line) => <li key={line}>{line}</li>)}</ul>
          {(planSnap.assetRequests ?? []).length > 0 ? (
            <div className="mt-3">
              <h3 className="text-sm font-semibold">Asset requests</h3>
              <p className="text-xs text-muted">Requests only. Nothing has been rendered.</p>
              <ul className="mt-2 flex flex-col gap-2 text-sm">
                {planSnap.assetRequests?.map((request) => (
                  <li key={request.id} className="border-t border-line pt-2">
                    {request.assetType} · {request.status} · scene {request.sceneNo}
                    <span className="block text-xs text-muted">Canon {request.canonVersion}. {request.requiredAttributes.join(", ")}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {(planSnap.musicCues ?? []).map((cue) => (
            <p key={cue.id} className="mt-2 text-sm">Music {cue.type}: {cue.purpose} · {cue.source} · rights {cue.rightsStatus}</p>
          ))}
          {(planSnap.soundCues ?? []).length > 0 ? <p className="mt-1 text-xs text-muted">{planSnap.soundCues?.length} sound requests. Source not connected. Rights not cleared.</p> : null}
        </Card>
      ) : null}
      <Card>
        <h2 className="text-xl">Assets</h2>
        {assets.length === 0 ? <p className="mt-2 text-sm text-muted">No provenance records.</p> : null}
        <ul className="mt-3 flex flex-col gap-3">
          {assets.map((asset) => {
            const body = latestSnapshot(asset).snapshot;
            return (
              <li key={asset.id} className="border-t border-line pt-2 text-sm">
                <div className="flex flex-wrap gap-2">
                  <span className="font-semibold">{body.assetType}</span>
                  <Pill tone={body.commercialUseStatus === "cleared" ? "neem" : "clay"}>{body.commercialUseStatus}</Pill>
                  <Pill tone="quiet">{body.assetStatus ?? latestSnapshot(asset).status}</Pill>
                </div>
                <p className="mt-1 text-xs text-muted">{body.provider} · {body.model} · {body.source} · {body.creator}</p>
                <p className="text-xs text-muted">Canon {body.canonVersionUsed ?? body.canonVersion ?? "—"}{body.characterId ? ` · character ${body.characterId}` : ""}{body.characterVersion ? ` v${body.characterVersion}` : ""}</p>
                <p className="text-xs text-muted">{body.rightsNotes}</p>
              </li>
            );
          })}
        </ul>
      </Card>
      <Card>
        <h2 className="text-xl">Production revision</h2>
        <p className="mt-1 text-sm text-muted">A problem does not rewrite the approved story.</p>
        <Field label="Problem">
          <textarea className={inputClass} rows={2} value={problem} onChange={(e) => setProblem(e.target.value)} />
        </Field>
        <div className="mt-3">
          <Button type="button" variant="quiet" onClick={() => apply(reportProductionProblem(db, { episodeId: episode.id, problem, reason: problem, recommendedChange: "Change the shot, not the story.", impact: "Production only." }, actor))}>Request revision</Button>
        </div>
        <ul className="mt-3 flex flex-col gap-2 text-sm">
          {revisions.map((item) => (
            <li key={item.id} className="border-t border-line pt-2">
              <span className="font-semibold">{item.status}. </span>{item.problem}
              {item.sceneNo ? <span className="text-muted"> · scene {item.sceneNo}</span> : null}
              {item.status === "OPEN" ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button type="button" onClick={() => apply(decideProductionRevision(db, item.id, "ACCEPTED", actor, note))}>Accept</Button>
                  <Button type="button" variant="quiet" onClick={() => apply(decideProductionRevision(db, item.id, "REJECTED", actor, note))}>Reject</Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <h2 className="text-xl">New location</h2>
        <p className="mt-1 text-sm text-muted">A proposal is not canon until you approve it.</p>
        <Field label="Location name">
          <input className={inputClass} value={placeName} onChange={(e) => setPlaceName(e.target.value)} />
        </Field>
        <div className="mt-3">
          <Button
            type="button"
            variant="quiet"
            onClick={() => apply(proposeNewLocation(db, { episodeId: episode.id, key: placeName.trim().toLowerCase().replace(/\s+/g, "-") || "unnamed", name: placeName || "Unnamed", nameHi: placeName || "स्थान", description: placeName || "Proposed place.", reason: "Needed for this episode. Not in canon yet." }, actor))}
          >
            Propose location
          </Button>
        </div>
        <ul className="mt-3 flex flex-col gap-2 text-sm">
          {proposals.map((item) => (
            <li key={item.id} className="border-t border-line pt-2">
              {item.name} · {item.nameHi} · {item.status}
              {item.status === "PROPOSED" ? (
                <div className="mt-2">
                  <Button type="button" onClick={() => apply(decideLocationProposal(db, item.id, "APPROVED", actor, note))}>Approve into canon</Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <h2 className="text-xl">Agent work</h2>
        {(db.agentTasks ?? []).filter((task) => task.episodeId === episode.id).length === 0 ? <p className="mt-2 text-sm text-muted">No orchestrated task on this episode yet.</p> : null}
        <ul className="mt-3 flex flex-col gap-3">
          {(db.agentTasks ?? []).filter((task) => task.episodeId === episode.id).map((task) => (
            <li key={task.id} className="border-t border-line pt-2 text-sm">
              <div className="flex flex-wrap gap-2">
                <span className="font-semibold">{task.taskType}</span>
                <Pill tone={task.status === "BLOCKED" || task.status === "FAILED" ? "clay" : task.status === "REQUIRES_HUMAN_REVIEW" ? "marigold" : "quiet"}>{task.status.replaceAll("_", " ")}</Pill>
                <Pill tone="quiet">{task.priority}</Pill>
              </div>
              <p className="mt-1 text-xs text-muted">{task.agentId} · canon {task.canonVersion || "—"}</p>
              <p>{task.outputArtifacts.map((item) => item.label).join(", ") || task.instructions}</p>
              <p className="text-muted">{task.validationResults.map((item) => `${item.name} ${item.result}`).join(" · ")}</p>
              {task.blockedReason ? <p className="text-clay">{task.blockedReason}</p> : null}
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <h2 className="text-xl">Quality and release</h2>
        <p className="mt-1 text-sm text-muted">Independent checks. A pass in one does not cancel a fail in another. Nothing here publishes.</p>
        {recorded?.stale ? <p className="mt-3 text-sm font-semibold text-clay">{recorded.staleReason}. This episode cannot move on the old check.</p> : null}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Pill tone={release.status === "RELEASE_READY" ? "neem" : release.status === "HUMAN_REVIEW_REQUIRED" ? "marigold" : "clay"}>{statusLabel(release.status)}</Pill>
          <span className="text-xs text-muted">{release.versionsLabel}</span>
        </div>
        <ul className="mt-3 flex flex-col gap-3">
          {release.checks.map((item) => (
            <li key={item.checkId} className="border-t border-line pt-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{item.label}</span>
                <Pill tone={item.severity === "GREEN" ? "neem" : item.severity === "YELLOW" || item.severity === "HUMAN_REVIEW" ? "marigold" : "clay"}>{resultLabel(item.result)}</Pill>
                <span className="text-xs text-muted">{item.reviewerName}</span>
              </div>
              {item.findings.length === 0 ? <p className="mt-1 text-sm text-muted">{item.evidence[0] ?? "No blocking issue."}</p> : null}
              <ul className="mt-1 text-sm">
                {item.findings.map((found) => (
                  <li key={`${found.code}-${found.artifactId}-${found.what}`} className={found.code.endsWith("WARN") ? "text-muted" : "text-clay"}>
                    {found.what} {found.why}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
        {release.blocking[0] ? (
          <div className="mt-3">
            <p className="text-sm font-semibold">Blocking issue</p>
            <p className="text-sm text-clay">{release.blocking[0].what}</p>
            <p className="mt-1 text-sm">{release.nextAction}</p>
          </div>
        ) : (
          <p className="mt-3 text-sm">{release.nextAction}</p>
        )}
        {(recorded?.repairs.length ?? 0) > 0 ? (
          <div className="mt-3">
            <p className="text-sm font-semibold">Repair recommendations</p>
            <ul className="mt-1 text-sm text-muted">
              {recorded?.repairs.slice(0, 6).map((item) => (
                <li key={item.id}>{item.responsibleRole}: {item.requiredChange}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </Card>
      <Card>
        <h2 className="text-xl">Gates</h2>
        {reviews.length === 0 ? <p className="mt-2 text-sm text-muted">Not run yet.</p> : null}
        <ul className="mt-3 flex flex-col gap-3">
          {reviews.map((review) => (
            <li key={review.id}>
              <div className="flex flex-wrap items-center gap-2">
                <Pill tone={statusTone(review.result)}>{review.gate} {review.result}</Pill>
                {review.redFlag ? <Pill tone="clay">Red flag</Pill> : null}
              </div>
              <ul className="mt-1 text-sm text-muted">
                {review.checks.map((check) => <li key={check.name}>{check.name}: {check.detail}</li>)}
              </ul>
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <h2 className="text-xl">Audit chain</h2>
        <ol className="mt-3 flex flex-col gap-2 text-sm">
          {chain.map((event) => (
            <li key={event.id} className="border-t border-line pt-2">
              <span className="font-semibold">{event.action}</span>
              <span className="text-muted"> · {event.actorType} {event.actorId}</span>
              <p className="text-muted">{event.detail}</p>
            </li>
          ))}
        </ol>
      </Card>
      <Card>
        <h2 className="text-xl">Episode versions</h2>
        <ul className="mt-2 text-sm">
          {episode.versions.map((version) => (
            <li key={version.version} className="border-t border-line py-2">v{version.version} · {version.snapshot.stage} · {version.note}</li>
          ))}
        </ul>
      </Card>
    </Page>
  );
}
