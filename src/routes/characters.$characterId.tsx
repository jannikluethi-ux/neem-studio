import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Button, Card, Field, inputClass, Page, Pill, statusTone } from "@/components/studio/bits";
import { ImagePanel } from "@/components/studio/image-panel";
import { characterCanonProfile } from "@/lib/studio/canon";
import { approveCharacter, decideCharacter, latestSnapshot, proposeCanonChange } from "@/lib/studio/engine";
import { reviewer, useStudio } from "@/lib/studio/store";

export const Route = createFileRoute("/characters/$characterId")({ component: CharacterPage });

function CharacterPage() {
  const { characterId } = Route.useParams();
  const db = useStudio((s) => s.db);
  const apply = useStudio((s) => s.apply);
  const character = db.characters.find((c) => c.id === characterId);
  const [note, setNote] = useState("Locked. Clothing, eyes, and catchphrase stay.");
  const [reason, setReason] = useState("");
  const [proposed, setProposed] = useState("");
  const [field, setField] = useState("age");
  if (!character) {
    return <Page title="Missing character"><Link to="/characters">Back</Link></Page>;
  }
  const latest = latestSnapshot(character);
  const body = latest.snapshot;
  const locked = character.versions.find((version) => version.version === character.canonicalVersion);
  const profile = characterCanonProfile(locked?.snapshot ?? body);
  const actor = reviewer(db);
  const fields = [...profile.hard, ...profile.soft];
  const approvals = db.approvals.filter((item) => item.entityId === character.id || db.canonChanges.some((change) => change.id === item.entityId && change.entityId === character.id));

  return (
    <Page kicker={body.species} title={`${body.nameHi} · ${body.name}`} lede={body.personality}>
      <div className="flex flex-wrap gap-2">
        <Pill tone={locked ? "neem" : statusTone(latest.status)}>{locked ? "Locked canon" : latest.status.replaceAll("_", " ")}</Pill>
        <Pill tone="quiet">v{character.canonicalVersion ?? "—"}</Pill>
        <Pill tone="quiet">{body.storyFunction}</Pill>
        <Pill tone="quiet">{character.id}</Pill>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="text-xl">Hard canon</h2>
          <p className="mt-1 text-sm text-muted">Cannot change without a proposed change, an impact note, and your approval.</p>
          <dl className="mt-3 grid gap-2 text-sm">
            {profile.hard.map((item) => (
              <div key={item.field}>
                <dt className="text-xs text-muted">{item.label} · {item.rule}</dt>
                <dd>{item.value}</dd>
              </div>
            ))}
          </dl>
        </Card>
        <Card>
          <h2 className="text-xl">Soft canon</h2>
          <p className="mt-1 text-sm text-muted">May vary inside an episode. The locked default is still the record. Forbidden items do not become soft.</p>
          <dl className="mt-3 grid gap-2 text-sm">
            {profile.soft.map((item) => (
              <div key={item.field}>
                <dt className="text-xs text-muted">{item.label} · allowed variation</dt>
                <dd>{item.value}</dd>
              </div>
            ))}
          </dl>
        </Card>
        <Card>
          <h2 className="text-xl">Voice, not cleared</h2>
          <p className="mt-2 text-sm">{body.voiceProfile.pitch} · {body.voiceProfile.tempo} · {body.voiceProfile.accent}</p>
          <p className="mt-1 text-sm text-muted">{body.speechStyle}</p>
          <p className="mt-1 text-sm">{body.catchphrases[0]}</p>
          <p className="mt-2 text-xs text-clay">Commercial rights: {body.voiceProfile.commercialRights}. Pitch is hard voice canon.</p>
        </Card>
        <Card>
          <h2 className="text-xl">Forbidden variations</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {profile.forbidden.map((rule) => <Pill key={rule} tone="clay">{rule}</Pill>)}
          </div>
          <ul className="mt-3 list-disc pl-5 text-sm text-muted">
            {body.visualRules.map((rule) => <li key={rule}>{rule}</li>)}
          </ul>
          {body.relationshipNotes.length ? <p className="mt-3 text-sm">{body.relationshipNotes.join(" ")}</p> : null}
        </Card>
      </div>
      <ImagePanel characterId={character.id} />
      {locked ? (
        <Card>
          <h2 className="text-xl">Propose a change</h2>
          <p className="mt-1 text-sm text-muted">This does not edit {body.name}. It opens a proposal on the Canon page. You still have to approve it.</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label="Field">
              <select className={inputClass} value={field} onChange={(event) => setField(event.target.value)}>
                {fields.map((item) => (
                  <option key={item.field} value={item.field}>{item.label} · {item.strength}</option>
                ))}
              </select>
            </Field>
            <Field label="Proposed value">
              <input className={inputClass} value={proposed} onChange={(event) => setProposed(event.target.value)} />
            </Field>
          </div>
          <div className="mt-3">
            <Field label="Reason">
              <textarea className={inputClass} rows={3} value={reason} onChange={(event) => setReason(event.target.value)} />
            </Field>
          </div>
          <div className="mt-3">
            <Button type="button" onClick={() => apply(proposeCanonChange(db, { entityId: character.id, field, proposedValue: proposed, reason }, actor))}>
              Propose canon change
            </Button>
          </div>
        </Card>
      ) : null}
      <Card>
        <h2 className="text-xl">Version history</h2>
        <ul className="mt-3 flex flex-col gap-2 text-sm">
          {character.versions.map((version) => (
            <li key={version.version} className="flex flex-wrap items-center justify-between gap-2 border-t border-line py-2">
              <span>v{version.version} · {version.note}</span>
              <Pill tone={version.canonState === "LOCKED" ? "neem" : version.canonState === "SUPERSEDED" ? "quiet" : statusTone(version.status)}>
                {version.canonState ?? version.status}
              </Pill>
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <h2 className="text-xl">Approval history</h2>
        {approvals.length === 0 ? <p className="mt-2 text-sm text-muted">No human decision yet.</p> : null}
        <ul className="mt-2 text-sm">
          {approvals.map((item) => (
            <li key={item.id} className="border-t border-line py-2">
              <span className="font-semibold">{item.decision}</span> · {item.actorName} · v{item.version}
              <p className="text-muted">{item.note}</p>
            </li>
          ))}
        </ul>
      </Card>
      {latest.status === "in_review" && !locked ? (
        <Card>
          <Field label="Approval note">
            <textarea className={inputClass} rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" onClick={() => apply(approveCharacter(db, character.id, actor, note))}>Approve canon</Button>
            <Button type="button" variant="quiet" onClick={() => apply(decideCharacter(db, character.id, "revision_requested", actor, note))}>Request revision</Button>
            <Button type="button" variant="danger" onClick={() => apply(decideCharacter(db, character.id, "rejected", actor, note))}>Reject</Button>
          </div>
        </Card>
      ) : null}
    </Page>
  );
}
