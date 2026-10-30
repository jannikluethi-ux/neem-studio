import { useEffect, useState } from "react";
import { Button, Card, Field, inputClass, Pill } from "@/components/studio/bits";
import {
  approveEditorialScript,
  currentReviews,
  editorialView,
  realDrafts,
  reviewCultureEditorial,
  reviewHindiEditorial,
  reviseScript,
  rightsStanding,
  runEditorialQa,
  type LineEdit,
} from "@/lib/studio/editorial";
import { reviewer, useStudio } from "@/lib/studio/store";
import type { StudioDb } from "@/lib/studio/types";

export function EditorialPanel({ scriptId }: { scriptId: string | null }) {
  const db = useStudio((s) => s.db);
  const apply = useStudio((s) => s.apply);
  const actor = reviewer(db);
  const drafts = realDrafts(db);
  const view = scriptId ? editorialView(db, scriptId) : null;
  const [reason, setReason] = useState("Human revision. Suggestions were not applied automatically.");
  const [note, setNote] = useState("");
  const [accepted, setAccepted] = useState<string[]>([]);
  const [lines, setLines] = useState<LineEdit[]>([]);

  const version = view?.script?.currentVersion ?? 0;

  useEffect(() => {
    const script = db.scripts.find((item) => item.id === scriptId);
    const body = script?.versions.find((item) => item.version === script.currentVersion)?.snapshot;
    if (!body) return;
    setLines(body.scenes.flatMap((scene) => scene.lines.map((line, lineIndex) => ({ sceneNo: scene.sceneNo, lineIndex, hi: line.hi, en: line.en }))));
    setAccepted([]);
  }, [db, scriptId, version]);

  if (scriptId && !view?.draft) {
    return (
      <Card>
        <h2 className="text-xl">Hindi editorial review</h2>
        <p className="mt-2 text-sm">This script is not an eligible real Hindi draft from the text gateway. It is not treated as one. Count the Thunder stays out of this review.</p>
      </Card>
    );
  }

  if (!scriptId || !view?.draft) {
    return (
      <Card>
        <h2 className="text-xl">Hindi editorial review</h2>
        <p className="mt-2 text-sm">No eligible real Hindi development draft is on record. A development-provider script is not a substitute, and Count the Thunder cannot enter this review.</p>
        {drafts.length > 0 ? <p className="mt-2 text-sm text-muted">{drafts.length} real draft{drafts.length === 1 ? "" : "s"} exist. Select one above.</p> : null}
      </Card>
    );
  }

  const pair = currentReviews(db, scriptId);
  const standing = rightsStanding(db, scriptId);
  const original = view.original?.snapshot;

  return (
    <Card>
      <h2 className="text-xl">Hindi editorial review</h2>
      <p className="mt-1 text-sm text-muted">Advisory only. A passing review is not approval, and approval is not a rights clearance. The original model draft is kept.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {view.labels.aiGenerated ? <Pill tone="quiet">AI generated</Pill> : null}
        {view.labels.aiReviewed ? <Pill tone="marigold">AI reviewed</Pill> : null}
        {view.labels.humanRevised ? <Pill tone="marigold">Human revised</Pill> : null}
        {view.labels.humanApproved ? <Pill tone="neem">Human approved</Pill> : <Pill tone="quiet">Not human approved</Pill>}
        <Pill tone={standing === "UNKNOWN" ? "clay" : "quiet"}>Rights {standing}</Pill>
      </div>
      <p className="mt-3 text-sm">Current script v{view.script?.currentVersion}. Story v{view.draft.storyVersion}. Canon {view.draft.canonVersion}. Prompt {view.draft.promptKey} v{view.draft.promptVersion}. Execution {view.draft.executionId}.</p>
      {pair.disagreement ? <p className="mt-2 text-sm text-clay">The Hindi editor and the cultural reviewer disagree. Both records stay. A person has to resolve them. Neither can approve.</p> : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" onClick={() => apply(reviewHindiEditorial(db, scriptId, "agent_hindi_editor"))}>Run Hindi review</Button>
        <Button type="button" variant="quiet" onClick={() => apply(reviewCultureEditorial(db, scriptId, "agent_cultural_reviewer"))}>Run cultural review</Button>
        <Button type="button" variant="quiet" onClick={() => apply(runEditorialQa(db, scriptId, "agent_qa"))}>Run version QA</Button>
      </div>
      <ReviewList title="Hindi review" review={pair.hindi} stale={reviewsStale(db, scriptId, "hindi")} />
      <ReviewList title="Cultural review" review={pair.culture} stale={reviewsStale(db, scriptId, "culture")} />
      {view.qa ? <p className="mt-3 text-sm">QA {view.qa.overallStatus}. Pinned to script v{view.qa.scriptVersion}. {view.qa.checkResults.join(" ")}</p> : <p className="mt-3 text-sm text-muted">No current QA run for this version.</p>}
      {view.outdated.length > 0 ? <p className="mt-1 text-sm text-marigold-ink">{view.outdated.length} earlier QA run{view.outdated.length === 1 ? "" : "s"} marked outdated. They are not reviews of this version.</p> : null}
      <div className="mt-4 border-t border-line pt-3">
        <h3 className="text-lg">Original model draft</h3>
        <p className="mt-1 text-xs text-muted">Version 1. Not overwritten.</p>
        {original ? <ScriptLines snap={original} /> : null}
      </div>
      <div className="mt-4 border-t border-line pt-3">
        <h3 className="text-lg">Human revision</h3>
        <p className="mt-1 text-sm text-muted">Edits make a new version. Unchecked suggestions are not applied.</p>
        <ul className="mt-2 flex flex-col gap-2">
          {(pair.hindi?.findings ?? []).concat(pair.culture?.findings ?? []).filter((item) => item.severity !== "info").map((item) => (
            <li key={item.id} className="text-sm">
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={accepted.includes(item.id)}
                  onChange={(event) => setAccepted((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))}
                />
                <span><span className="font-semibold">{item.severity}.</span> {item.explanation} Suggestion: {item.suggestion}</span>
              </label>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex flex-col gap-2">
          {lines.map((line, index) => (
            <Field key={`${line.sceneNo}-${line.lineIndex}`} label={`Scene ${line.sceneNo}, line ${line.lineIndex + 1}`}>
              <input className={inputClass} value={line.hi} onChange={(event) => setLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, hi: event.target.value } : item))} />
            </Field>
          ))}
        </div>
        <Field label="Revision reason">
          <textarea className={inputClass} rows={2} value={reason} onChange={(event) => setReason(event.target.value)} />
        </Field>
        <Button className="mt-2" type="button" onClick={() => apply(reviseScript(db, scriptId, { reason, lines, acceptedFindingIds: accepted }, actor))}>Save human revision</Button>
      </div>
      <div className="mt-4 border-t border-line pt-3">
        <h3 className="text-lg">Version history</h3>
        <ul className="mt-2 text-sm">
          {view.script?.versions.map((item) => (
            <li key={item.version} className="border-t border-line py-1">v{item.version} · {item.snapshot.lineage ?? "AI generated"} · {item.createdBy} · {item.note}</li>
          ))}
        </ul>
      </div>
      <div className="mt-4 border-t border-line pt-3">
        <h3 className="text-lg">Human script approval</h3>
        <p className="mt-1 text-sm text-muted">This approves the current version only. It does not start a storyboard and it does not clear rights.</p>
        <Field label="Approval note">
          <textarea className={inputClass} rows={2} value={note} onChange={(event) => setNote(event.target.value)} />
        </Field>
        <Button className="mt-2" type="button" disabled={view.labels.humanApproved} onClick={() => apply(approveEditorialScript(db, scriptId, actor, note))}>Approve this script version</Button>
        {view.approval ? <p className="mt-2 text-sm">{view.approvalCoversCurrent ? `Human approved v${view.script?.currentVersion}.` : `An earlier approval does not cover v${view.script?.currentVersion}.`}</p> : null}
      </div>
      <div className="mt-4 border-t border-line pt-3">
        <h3 className="text-lg">Blocking reasons</h3>
        <ul className="mt-2 text-sm">
          {view.blockers.map((item) => <li key={item}>{item}</li>)}
        </ul>
      </div>
    </Card>
  );
}

function reviewsStale(db: StudioDb, scriptId: string, kind: "hindi" | "culture") {
  const script = db.scripts.find((item) => item.id === scriptId);
  if (!script) return [];
  return (db.editorialReviews ?? []).filter((item) => item.scriptId === scriptId && item.kind === kind && item.scriptVersion !== script.currentVersion);
}

function ReviewList({ title, review, stale }: { title: string; review: ReturnType<typeof currentReviews>["hindi"]; stale: { id: string; scriptVersion: number; outcome: string }[] }) {
  return (
    <div className="mt-3">
      <h3 className="text-lg">{title}</h3>
      {review ? (
        <div className="mt-1 text-sm">
          <p>{review.outcome} · {review.agentId} · template {review.templateKey} v{review.templateVersion} · script v{review.scriptVersion}</p>
          <p className="text-muted">{review.disclaimer}</p>
          <ul className="mt-1">
            {review.findings.map((item) => (
              <li key={item.id}>{item.severity}: {item.explanation} {item.passage ? `(${item.passage})` : ""}</li>
            ))}
          </ul>
        </div>
      ) : <p className="mt-1 text-sm text-muted">No review of the current version.</p>}
      {stale.length > 0 ? <p className="mt-1 text-xs text-muted">{stale.length} older {title.toLowerCase()} record{stale.length === 1 ? "" : "s"} remain in history and do not count as current.</p> : null}
    </div>
  );
}

function ScriptLines({ snap }: { snap: { scenes: { sceneNo: number; lines: { speaker: string; hi: string }[] }[] } }) {
  return (
    <ul className="mt-2 text-sm">
      {snap.scenes.flatMap((scene) => scene.lines.map((line, index) => (
        <li key={`${scene.sceneNo}-${index}`}><span className="font-semibold">{line.speaker}. </span><span className="font-serif">{line.hi}</span></li>
      )))}
    </ul>
  );
}
