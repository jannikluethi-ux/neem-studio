import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Button, Card, Field, inputClass, Page, Pill } from "@/components/studio/bits";
import { activeCanonVersion, characterCanonProfile, compileCanonRules, isOpenChange } from "@/lib/studio/canon";
import { approveCanonChange, canonicalOf, latestSnapshot, rejectCanonChange, snapshotOf } from "@/lib/studio/engine";
import { reviewer, useStudio } from "@/lib/studio/store";

export const Route = createFileRoute("/ip")({ component: IpPage });

function IpPage() {
  const db = useStudio((s) => s.db);
  const apply = useStudio((s) => s.apply);
  const actor = reviewer(db);
  const [note, setNote] = useState("Approved after reading the impact. Existing episodes stay as written.");
  const brand = canonicalOf(db.brand);
  const universe = canonicalOf(db.universe);
  const world = canonicalOf(db.world);
  const rules = canonicalOf(db.storyRules);
  const active = activeCanonVersion(db);
  const canonRules = compileCanonRules(db);
  const pending = db.canonChanges.filter(isOpenChange);
  const hard = canonRules.filter((rule) => rule.strength === "HARD").length;
  const soft = canonRules.filter((rule) => rule.strength === "SOFT").length;

  return (
    <Page
      kicker="Canon"
      title={brand?.snapshot.name ?? "Canon"}
      lede="What is locked stays locked. Agents may propose a change. Only you can approve one. Nothing here publishes."
    >
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone="neem">Locked</Pill>
          <Pill tone="quiet">{hard} hard rules</Pill>
          <Pill tone="marigold">{soft} soft rules</Pill>
          <Pill tone={pending.length ? "clay" : "quiet"}>{pending.length} proposed</Pill>
        </div>
        <h2 className="mt-3 text-xl">{active.label}</h2>
        <p className="mt-2 text-sm text-muted">Active canon version</p>
        <p className="mt-1 break-all font-mono text-xs text-ink">{active.version}</p>
        <p className="mt-2 text-xs text-muted">Snapshot hash {active.hash}. Generation uses this slice, not the whole studio database.</p>
      </Card>

      <Card>
        <h2 className="text-xl">Pending changes</h2>
        <p className="mt-1 text-sm text-muted">A proposal does not edit the locked version. Approval writes a new version and leaves old episodes alone.</p>
        {pending.length === 0 ? <p className="mt-3 text-sm text-muted">No proposed canon changes.</p> : null}
        <ul className="mt-3 flex flex-col gap-4">
          {pending.map((change) => (
            <li key={change.id} className="border-t border-line pt-3">
              <p className="font-semibold">{change.entityName} · {change.field}</p>
              <p className="mt-1 text-sm">Locked “{change.currentValue}” → proposed “{change.proposedValue}”</p>
              <p className="mt-1 text-sm text-muted">{change.reason}</p>
              <p className="mt-1 text-xs text-muted">Proposed by {change.proposedByName} ({change.proposedByType}). {change.strength} canon.</p>
              <p className="mt-2 text-sm">{change.impact.summary}</p>
              <ul className="mt-2 text-sm">
                {change.impact.episodes.map((episode) => (
                  <li key={episode.id}>
                    <Link className="font-semibold text-neem" to="/episodes/$episodeId" params={{ episodeId: episode.id }}>{episode.title}</Link>
                    <span className="text-muted"> stays as written.</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
        {pending.length > 0 ? (
          <div className="mt-4 flex flex-col gap-3">
            <Field label="Decision note">
              <textarea className={inputClass} rows={3} value={note} onChange={(event) => setNote(event.target.value)} />
            </Field>
            <div className="flex flex-wrap gap-2">
              {pending.map((change) => (
                <Button key={change.id} type="button" onClick={() => apply(approveCanonChange(db, change.id, actor, note))}>
                  Approve {change.entityName} {change.field}
                </Button>
              ))}
              {pending.map((change) => (
                <Button key={`no-${change.id}`} type="button" variant="danger" onClick={() => apply(rejectCanonChange(db, change.id, actor, note))}>
                  Reject {change.field}
                </Button>
              ))}
            </div>
          </div>
        ) : null}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="text-xl">Characters</h2>
          <ul className="mt-3 flex flex-col">
            {db.characters.map((character) => {
              const locked = canonicalOf(character);
              const body = locked?.snapshot ?? latestSnapshot(character).snapshot;
              const profile = characterCanonProfile(body);
              return (
                <li key={character.id} className="border-t border-line py-3">
                  <Link to="/characters/$characterId" params={{ characterId: character.id }} className="font-semibold text-neem">
                    {body.nameHi} · {body.name}
                  </Link>
                  <p className="mt-1 text-sm text-muted">
                    {locked ? `Locked v${locked.version}` : "Not locked"} · {profile.hard.length} hard · {profile.soft.length} soft · {profile.forbidden.length} forbidden
                  </p>
                </li>
              );
            })}
          </ul>
        </Card>
        <Card>
          <h2 className="text-xl">World</h2>
          <p className="mt-2 text-sm">{world?.snapshot.name}</p>
          <p className="mt-1 text-sm text-muted">{world?.snapshot.geography}</p>
          <p className="mt-3 text-xs font-semibold text-neem">World rules · hard</p>
          <ul className="mt-2 list-disc pl-5 text-sm">
            {world?.snapshot.rules.map((rule) => <li key={rule}>{rule}</li>)}
          </ul>
          <p className="mt-3 text-sm text-muted">{universe?.snapshot.premise}</p>
        </Card>
      </div>

      <Card>
        <h2 className="text-xl">Locations</h2>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {db.locations.map((loc) => {
            const snap = snapshotOf(loc);
            if (!snap) return null;
            return (
              <li key={loc.id} className="rounded-sm border border-line px-3 py-3">
                <p className="font-semibold">{snap.name} · {snap.nameHi}</p>
                <p className="text-xs text-muted">{loc.id} · v{loc.canonicalVersion ?? loc.currentVersion}</p>
                <p className="mt-1 text-sm text-muted">{snap.description}</p>
              </li>
            );
          })}
        </ul>
      </Card>

      <Card>
        <h2 className="text-xl">Relationships</h2>
        {db.relationships.length === 0 ? <p className="mt-2 text-sm text-muted">None recorded.</p> : null}
        <ul className="mt-2 text-sm">
          {db.relationships.map((rel) => (
            <li key={rel.id} className="border-t border-line py-2">
              <span className="font-semibold">{nameOf(db, rel.fromId)}</span>
              <span> · {rel.kind} · </span>
              <span className="font-semibold">{nameOf(db, rel.toId)}</span>
              <p className="text-muted">{rel.note}</p>
              <p className="text-xs text-muted">{rel.id} · hard relationship</p>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <h2 className="text-xl">Story rules</h2>
        <p className="mt-2 text-sm">{rules?.snapshot.tone}</p>
        <p className="mt-2 text-sm text-muted">{rules?.snapshot.hindiRegister}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {rules?.snapshot.never.map((rule) => <Pill key={rule} tone="clay">{rule}</Pill>)}
        </div>
      </Card>

      <Card>
        <h2 className="text-xl">Rules</h2>
        <p className="mt-1 text-sm text-muted">Executable checks. Prose on the character page is not the rule.</p>
        <ul className="mt-3 max-h-80 overflow-auto text-sm">
          {canonRules.map((rule) => (
            <li key={rule.id} className="border-t border-line py-2">
              <span className="font-semibold">{rule.kind}</span>
              <span className="text-muted"> · {rule.strength} · {rule.field}</span>
              <p>{rule.description}</p>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <h2 className="text-xl">Version history</h2>
        <ul className="mt-3 flex flex-col gap-3 text-sm">
          {db.characters.map((character) => (
            <li key={character.id}>
              <p className="font-semibold">{character.name}</p>
              <ul>
                {character.versions.map((version) => (
                  <li key={version.version} className="border-t border-line py-1 text-muted">
                    v{version.version} · {version.canonState ?? version.status} · {version.note}
                  </li>
                ))}
              </ul>
            </li>
          ))}
          {db.canonChanges.length === 0 ? null : <li className="font-semibold">Decisions</li>}
          {db.canonChanges.map((change) => (
            <li key={change.id} className="border-t border-line py-2">
              {change.status} · {change.entityName}.{change.field} · {change.proposedByName}
              {change.decidedByName ? ` · decided by ${change.decidedByName}` : ""}
              {change.decisionNote ? <p className="text-muted">{change.decisionNote}</p> : null}
            </li>
          ))}
        </ul>
      </Card>
    </Page>
  );
}

function nameOf(db: ReturnType<typeof useStudio.getState>["db"], id: string) {
  return db.characters.find((c) => c.id === id)?.name ?? id;
}
