import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { Button, Card, Field, inputClass, Page, Pill, statusTone } from "@/components/studio/bits";
import { createCharacter, latestSnapshot } from "@/lib/studio/engine";
import { reviewer, useStudio } from "@/lib/studio/store";
import type { CharacterBody } from "@/lib/studio/types";

export const Route = createFileRoute("/characters/")({ component: CharactersPage });

function CharactersPage() {
  const db = useStudio((s) => s.db);
  const apply = useStudio((s) => s.apply);
  const [open, setOpen] = useState(false);

  return (
    <Page kicker="Characters" title="Who is allowed in the stories" lede="A character is not canon until you approve a version. Agents cannot edit or approve one.">
      <div className="flex justify-end">
        <Button type="button" onClick={() => setOpen((v) => !v)}>{open ? "Close" : "New character"}</Button>
      </div>
      {open ? <NewCharacter onCreate={(body) => { const result = createCharacter(db, body, reviewer(db)); apply(result); if (result.ok) setOpen(false); }} /> : null}
      <ul className="grid gap-3">
        {db.characters.map((character) => {
          const version = latestSnapshot(character);
          const canon = character.canonicalVersion;
          return (
            <li key={character.id}>
              <Link to="/characters/$characterId" params={{ characterId: character.id }} className="block rounded-md border border-line bg-card p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-xl">{version.snapshot.nameHi} · {version.snapshot.name}</h2>
                  <Pill tone={statusTone(version.status)}>{version.status.replaceAll("_", " ")}</Pill>
                </div>
                <p className="mt-1 text-sm text-muted">{version.snapshot.species} · {version.snapshot.age} · {version.snapshot.storyFunction}</p>
                <p className="mt-2 text-sm">{version.snapshot.personality}</p>
                <p className="mt-2 text-xs text-muted">Canon version {canon ?? "none"} · latest v{character.currentVersion} · “{version.snapshot.catchphrases[0]}”</p>
              </Link>
            </li>
          );
        })}
      </ul>
    </Page>
  );
}

function NewCharacter({ onCreate }: { onCreate: (body: CharacterBody) => void }) {
  const [name, setName] = useState("");
  const [nameHi, setNameHi] = useState("");
  const [clothing, setClothing] = useState("");
  const [phrase, setPhrase] = useState("");
  const [weakness, setWeakness] = useState("impatience");

  function submit(event: FormEvent) {
    event.preventDefault();
    onCreate({
      name,
      nameHi,
      age: "5",
      species: "human",
      personality: "To be sharpened in review.",
      strengths: ["attention"],
      weaknesses: [weakness],
      likes: [],
      dislikes: [],
      fears: [],
      relationshipNotes: [],
      appearance: "Original design. Describe and lock before production.",
      clothing,
      colorPalette: ["#1F6B4A"],
      voiceProfile: {
        ageImpression: "child",
        pitch: "medium",
        tempo: "natural",
        energy: "warm",
        accent: "everyday Hindi",
        pronunciation: "Pending voice director.",
        emotionalRange: "narrow until reviewed",
        provider: "unassigned",
        commercialRights: "not-cleared",
        voiceId: "unassigned",
      },
      speechStyle: "Short lines.",
      catchphrases: [phrase],
      characterArc: "Not yet defined.",
      storyFunction: "friend",
      visualRules: ["Do not change clothing inside an episode."],
      forbiddenVariations: ["cape"],
      developmentTokens: [weakness, "honesty", "sharing", "curiosity"],
    });
  }

  return (
    <Card>
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        <Field label="Name"><input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} required /></Field>
        <Field label="Hindi name"><input className={inputClass} value={nameHi} onChange={(e) => setNameHi(e.target.value)} required /></Field>
        <Field label="Clothing"><input className={inputClass} value={clothing} onChange={(e) => setClothing(e.target.value)} required /></Field>
        <Field label="Catchphrase"><input className={inputClass} value={phrase} onChange={(e) => setPhrase(e.target.value)} required /></Field>
        <Field label="Weakness"><input className={inputClass} value={weakness} onChange={(e) => setWeakness(e.target.value)} required /></Field>
        <div className="flex items-end"><Button type="submit">Propose character</Button></div>
      </form>
      <p className="mt-2 text-xs text-muted">This saves a proposal. It does not enter the canon until you approve it.</p>
    </Card>
  );
}
