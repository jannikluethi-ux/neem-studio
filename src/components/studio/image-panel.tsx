import { useEffect, useState } from "react";
import { Button, Card, Field, inputClass, Pill } from "@/components/studio/bits";
import { activePrompt } from "@/lib/studio/architecture";
import { latestSnapshot } from "@/lib/studio/engine";
import { acceptImageGeneration, approvedCharacterReference, automatedConsistency, decideCharacterImage, imageCovers, prepareCharacterImage } from "@/lib/studio/image";
import { generateCharacterImage, readImageAdapterStatus, readRecordedCharacterImage, readStoredImage } from "@/lib/studio/image-call";
import { reviewer, useStudio } from "@/lib/studio/store";

export function ImagePanel({ characterId }: { characterId: string }) {
  const db = useStudio((s) => s.db);
  const apply = useStudio((s) => s.apply);
  const actor = reviewer(db);
  const prepared = prepareCharacterImage(db, characterId, null);
  const reference = approvedCharacterReference(db, characterId);
  const images = db.assets.filter((asset) => asset.versions.some((version) => version.snapshot.characterId === characterId && version.snapshot.assetType === "character-image"));
  const [status, setStatus] = useState<string>("");
  const [note, setNote] = useState("");
  const [preview, setPreview] = useState<Record<string, string>>({});
  const [recordedNote, setRecordedNote] = useState("");
  const [busy, setBusy] = useState(false);
  const blocked = typeof prepared === "string";
  const storageKey = images.map((asset) => asset.versions.map((version) => `${version.snapshot.generationRunId ?? ""}:${(db.objectRecords ?? []).find((item) => item.provenanceExecutionId === version.snapshot.generationRunId)?.storageRef ?? ""}`).join(",")).join("|");

  useEffect(() => {
    let stop = false;
    void readRecordedCharacterImage({ data: { characterId } }).then((item) => {
      if (stop || !item) return;
      if (item.dataUrl && item.storageRef) setPreview((current) => (current[item.storageRef] ? current : { ...current, [item.storageRef]: item.dataUrl as string }));
      setRecordedNote(item.retrieval === "VERIFIED" ? `Studio file ${item.assetId} v${item.assetVersion}. Execution ${item.executionId}. Request ${item.externalReference || "none"}. Retrieval verified in this server process. Storage BLOCKED. Not approved.` : "The recorded file could not be read back. It is not shown as stored.");
    });
    for (const ref of storageKey.split(/[|,]/).map((item) => item.split(":").at(-1) ?? "").filter(Boolean)) {
      void readStoredImage({ data: { storageRef: ref } }).then((item) => {
        if (stop || !item.found) return;
        setPreview((current) => (current[ref] ? current : { ...current, [ref]: item.dataUrl }));
      });
    }
    return () => {
      stop = true;
    };
  }, [characterId, storageKey]);

  return (
    <Card>
      <h2 className="text-xl">Character image</h2>
      <p className="mt-1 text-sm text-muted">One still image. It does not change canon, clear rights, or publish. Durable storage is not configured.</p>
      {blocked ? <p className="mt-2 text-sm">{prepared}</p> : (
        <>
          <div className="mt-3 flex flex-wrap gap-2">
            <Pill tone="quiet">{prepared.role === "INITIAL_DESIGN" ? "Initial design" : "Follow-up"}</Pill>
            <Pill tone={reference ? "marigold" : "clay"}>{reference ? `Reference ${reference.assetId} v${reference.version}` : "No approved reference"}</Pill>
            <Pill tone="clay">Rights UNKNOWN</Pill>
            <Pill tone="clay">Storage BLOCKED</Pill>
          </div>
          <p className="mt-2 text-sm">Canon {prepared.canonVersion || "unstamped"}. Character v{prepared.characterVersion}. Template {prepared.templateKey} v{prepared.templateVersion}.</p>
          {prepared.unknown.length ? <p className="mt-1 text-sm">Not invented: {prepared.unknown.join(", ")}.</p> : null}
          <p className="mt-1 text-sm text-muted">{reference ? "The provider is not sent the reference file. A person compares the pictures." : "There is no approved picture of this character. A generated image is only an initial design until a person approves that exact version."}</p>
          <p className="mt-1 text-sm">An automated pass is not a person's approval, and it does not prove the picture matches.</p>
          <ul className="mt-2 text-sm">
            {automatedConsistency(prepared).map((item) => <li key={item.name}>{item.owner === "human" ? "Person" : "Check"} · {item.name} · {item.result}. {item.detail}</li>)}
          </ul>
          <details className="mt-2">
            <summary className="cursor-pointer text-sm">Exact prompt</summary>
            <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap text-xs text-muted">{prepared.prompt}</pre>
          </details>
        </>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" variant="quiet" onClick={() => void readImageAdapterStatus().then((item) => setStatus(item.configured ? `${item.provider} · ${item.model} · storage ${item.storage}` : "The image model is not configured on the server."))}>Check the image model</Button>
        <Button
          type="button"
          disabled={busy || blocked}
          onClick={() => {
            if (typeof prepared === "string") return;
            const template = activePrompt(db, prepared.templateKey);
            if (!template) {
              setStatus("The character image template is not on record. The model was not called.");
              return;
            }
            setBusy(true);
            void generateCharacterImage({ data: { templateKey: prepared.templateKey, templateVersion: prepared.templateVersion, templateBody: template.body, prompt: prepared.prompt, characterId } })
              .then((result) => {
                const { dataUrl, ...filed } = result;
                if (dataUrl && filed.storageRef) setPreview((current) => ({ ...current, [filed.storageRef as string]: dataUrl }));
                apply(acceptImageGeneration(db, prepared, filed, actor, null, null));
                setStatus(result.status === "SUCCESS" ? "Filed as an unapproved image. Rights stay unknown." : result.error ?? result.status);
              })
              .catch(() => setStatus("The image call did not finish. No picture was invented."))
              .finally(() => setBusy(false));
          }}
        >
          {busy ? "Generating" : typeof prepared !== "string" && prepared.role === "FOLLOW_UP" ? "Generate another version" : "Generate initial design"}
        </Button>
      </div>
      {status ? <p className="mt-2 text-sm">{status}</p> : null}
      {recordedNote ? <p className="mt-2 text-sm">{recordedNote}</p> : null}
      <ul className="mt-4 flex flex-col gap-4">
        {images.map((asset) => {
          const current = latestSnapshot(asset);
          const ref = current.snapshot.referenceAssetId;
          return (
            <li key={asset.id} className="border-t border-line pt-3 text-sm">
              <div className="flex flex-wrap gap-2">
                <Pill tone="quiet">AI generated</Pill>
                {current.snapshot.lineage === "HUMAN_APPROVED" ? <Pill tone="neem">Human approved</Pill> : <Pill tone="quiet">Not human approved</Pill>}
                <Pill tone="clay">Rights UNKNOWN</Pill>
                <Pill tone="clay">Storage {current.snapshot.storageDurability ?? "BLOCKED"}</Pill>
              </div>
              <p className="mt-1">{asset.name} · v{asset.currentVersion} · {current.snapshot.provider} · {current.snapshot.model}</p>
              <p className="text-muted">Template {current.snapshot.promptKey} v{current.snapshot.promptVersion}. Canon {current.snapshot.canonSnapshotHash || "unstamped"}. Character v{current.snapshot.characterVersion ?? "—"}.</p>
              <p className="text-muted">Reference {ref ? `${ref} v${current.snapshot.referenceAssetVersion}` : "none"}. Request {current.snapshot.externalReference || "none"}. Run {current.snapshot.generationRunId || "none"}.</p>
              <p className="text-muted">{current.snapshot.storageNote}</p>
              <p className="text-muted">{current.snapshot.rightsNotes}</p>
              {asset.versions.map((version) => {
                const storageRef = (db.objectRecords ?? []).find((item) => item.provenanceExecutionId === version.snapshot.generationRunId)?.storageRef ?? "";
                return (
                  <div key={version.version} className="mt-3 border-t border-line pt-3">
                    <p>{asset.id} · version {version.version} · {version.status.replaceAll("_", " ")} · {imageCovers(db, asset.id, version.version) ? "approved version" : "not approved"}</p>
                    <p className="text-muted">Run {version.snapshot.generationRunId || "none"} · {version.snapshot.provider} · {version.snapshot.model} · template {version.snapshot.promptKey} v{version.snapshot.promptVersion}</p>
                    <ImagePreview storageRef={storageRef} preview={preview} onLoad={(refKey, url) => setPreview((currentPreview) => ({ ...currentPreview, [refKey]: url }))} />
                    <a className="mt-2 inline-flex min-h-11 items-center font-semibold underline" href={`/studio-image/${version.version}`} target="_blank" rel="noreferrer">View image</a>
                  </div>
                );
              })}
              <ul className="mt-2">
                {asset.versions.map((version) => <li key={version.version}>v{version.version} · {version.status} · {imageCovers(db, asset.id, version.version) ? "covers this version" : "not the approved version"}</li>)}
              </ul>
              {asset.canonicalVersion === asset.currentVersion ? <p className="mt-2">Approved v{asset.canonicalVersion} only. A new file needs its own approval.</p> : current.status === "rejected" ? <p className="mt-2">This version was rejected. It cannot be approved. A new picture is a new version, and it is not requested automatically.</p> : (
                <>
                  <Field label="Decision note"><textarea className={inputClass} rows={2} value={note} onChange={(event) => setNote(event.target.value)} /></Field>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button type="button" onClick={() => apply(decideCharacterImage(db, asset.id, asset.currentVersion, "APPROVED", actor, note))}>Approve this version</Button>
                    <Button type="button" variant="quiet" onClick={() => apply(decideCharacterImage(db, asset.id, asset.currentVersion, "CHANGES_REQUESTED", actor, note))}>Ask for another version</Button>
                    <Button type="button" variant="danger" onClick={() => apply(decideCharacterImage(db, asset.id, asset.currentVersion, "REJECTED", actor, note))}>Reject this version</Button>
                  </div>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function ImagePreview({ storageRef, preview, onLoad }: { storageRef: string; preview: Record<string, string>; onLoad: (ref: string, url: string) => void }) {
  const url = storageRef ? preview[storageRef] : "";
  if (!storageRef) return <p className="mt-2 text-muted">No stored file reference.</p>;
  return (
    <div className="mt-2">
      {url ? <img src={url} alt="Generated character design, not yet a canon reference unless this version is approved." className="max-w-xs border border-line" /> : <p className="text-muted">The file is not in the browser. Durable storage is blocked.</p>}
      {!url ? <Button type="button" variant="quiet" onClick={() => void readStoredImage({ data: { storageRef } }).then((item) => { if (item.found) onLoad(storageRef, item.dataUrl); })}>Load from this server process</Button> : null}
    </div>
  );
}
