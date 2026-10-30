import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { Button, Card, Field, inputClass, Page, Pill } from "@/components/studio/bits";
import { activeCanonVersion, isOpenChange } from "@/lib/studio/canon";
import {
  approveBrand,
  approveCharacter,
  approveUniverse,
  approveWorld,
  canonicalOf,
  counts,
  createCharacter,
  createEmptyDb,
  createLocation,
  createStudio,
  latestSnapshot,
  saveBrand,
  saveUniverse,
  saveWorld,
  setAgeBand,
} from "@/lib/studio/engine";
import { buildSeedDb } from "@/lib/studio/seed";
import { brainBrief } from "@/lib/studio/brain";
import { analyticsBrief } from "@/lib/studio/analytics";
import { releaseDesk, statusLabel } from "@/lib/studio/release";
import { useStudio } from "@/lib/studio/store";
import { AGE_BANDS, type AgeBand, type CharacterBody } from "@/lib/studio/types";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const db = useStudio((s) => s.db);
  if (!db.studio) return <Setup />;
  const tally = counts(db);
  const brand = canonicalOf(db.brand)?.snapshot;
  const episode = db.episodes[0];
  const snap = episode ? latestSnapshot(episode).snapshot : null;
  const waitingStories = db.stories.filter((s) => {
    const status = latestSnapshot(s).status;
    return status === "in_review" || status === "revision_requested";
  });
  const waitingCharacters = db.characters.filter((c) => latestSnapshot(c).status === "in_review");
  const waitingEpisodes = db.episodes.filter(
    (e) => latestSnapshot(e).snapshot.stage === "HUMAN_APPROVAL" && !latestSnapshot(e).snapshot.draftApproved,
  );
  const flags = db.qualityReviews.filter((r) => r.redFlag);
  const canon = activeCanonVersion(db);
  const pendingCanon = db.canonChanges.filter(isOpenChange);
  const desk = releaseDesk(db);
  const brief = brainBrief(db);
  const learning = analyticsBrief(db);

  return (
    <Page
      kicker="Studio"
      title={brand ? brand.name : db.studio.name}
      lede="The canon is the source of truth. Agents propose from it. You approve. Nothing in this build can publish."
    >
      <Card>
        <p className="text-sm text-muted">{brand?.parentPositioning}</p>
        <p className="mt-2 font-serif text-lg text-ink">{brand?.taglineHi}</p>
        <p className="mt-3 text-sm">
          Locked canon: {canon.label}.{" "}
          <Link to="/ip" className="font-semibold text-neem">
            {pendingCanon.length ? `${pendingCanon.length} proposed change${pendingCanon.length === 1 ? "" : "s"}` : "Open canon"}
          </Link>
        </p>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Canonical characters" value={tally.characters} />
          <Stat label="Stories" value={tally.stories} />
          <Stat label="Awaiting you" value={tally.awaiting} />
          <Stat label="Rights red flags" value={tally.redFlags} />
        </div>
      </Card>
      <Card>
        <h2 className="text-xl">Quality and release</h2>
        <p className="mt-1 text-sm text-muted">Informational. This does not approve an episode and it cannot publish.</p>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Ready for a human" value={desk.ready} />
          <Stat label="Release blocked" value={desk.blocked} />
          <Stat label="Human review" value={desk.human} />
          <Stat label="Rights issues" value={desk.rights} />
          <Stat label="Policy issues" value={desk.policy} />
          <Stat label="Canon blocks" value={desk.canon} />
          <Stat label="Stale checks" value={desk.stale} />
          <Stat label="Missing provenance" value={desk.provenance} />
        </div>
        <ul className="mt-3 flex flex-col gap-2">
          {desk.rows.map((row) => (
            <li key={row.episodeId}>
              <Link to="/episodes/$episodeId" params={{ episodeId: row.episodeId }} className="flex min-h-11 flex-col justify-center gap-1 rounded-sm border border-line px-3 py-2">
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <span>{row.title}</span>
                  <Pill tone={row.status === "RELEASE_READY" ? "neem" : row.status === "HUMAN_REVIEW_REQUIRED" ? "marigold" : "clay"}>{statusLabel(row.status)}</Pill>
                </span>
                {row.staleReason ? <span className="text-sm text-clay">{row.staleReason}</span> : null}
                {row.blocker ? <span className="text-sm text-muted">{row.blocker}</span> : null}
              </Link>
            </li>
          ))}
        </ul>
        {desk.productionFailures > 0 ? <p className="mt-3 text-sm text-muted">{desk.productionFailures} episode{desk.productionFailures === 1 ? "" : "s"} with a production failure.</p> : null}
      </Card>
      <Card>
        <h2 className="text-xl">What should we make next?</h2>
        <p className="mt-1 text-sm text-muted">Studio brain recommendations. They are not approvals, and nothing here can publish.</p>
        <ul className="mt-3 flex flex-col gap-2 text-sm">
          {brief.next.slice(0, 3).map((item) => (
            <li key={item.title} className="border-t border-line pt-2">
              <span className="font-semibold">{item.title}</span>
              <span className="text-muted"> · {item.category.replaceAll("_", " ")} · {item.confidence}{item.hypothesis ? " hypothesis" : ""}</span>
              <p className="text-muted">{item.action}</p>
            </li>
          ))}
        </ul>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <h3 className="font-semibold">Opportunities</h3>
            {brief.opportunities.slice(0, 2).map((item) => (
              <p key={item.title} className="mt-1 text-sm">{item.title} · {item.status}. {item.risks[0]}</p>
            ))}
          </div>
          <div>
            <h3 className="font-semibold">World expansion</h3>
            {brief.world.map((place) => (
              <p key={place.name} className="mt-1 text-sm">{place.name} — {place.role} · {place.status}</p>
            ))}
          </div>
        </div>
        <p className="mt-3 text-sm text-muted">{brief.learning[0]}</p>
        <Link to="/brain" className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-neem">Open the studio brain</Link>
      </Card>
      <Card>
        <h2 className="text-xl">What happened?</h2>
        <p className="mt-1 text-sm text-muted">Analytics explains the past. It does not approve, publish, or order more episodes.</p>
        <p className="mt-3 text-sm">{learning.happened}</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <h3 className="font-semibold">What are we learning?</h3>
            <p className="mt-1 text-sm text-muted">{learning.learning[0]}</p>
          </div>
          <div>
            <h3 className="font-semibold">What is uncertain?</h3>
            <p className="mt-1 text-sm text-muted">{learning.uncertain[0]}</p>
          </div>
        </div>
        <h3 className="mt-4 font-semibold">What should we investigate?</h3>
        <p className="mt-1 text-sm text-muted">{learning.investigate[0] ?? "Nothing in the audience record needs a production decision."}</p>
        <p className="mt-3 text-sm">Experiments on record: {learning.experiments.length}. No live audience connection is turned on.</p>
        <Link to="/analytics" className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-neem">Open analytics</Link>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="text-xl">Waiting for a human</h2>
          {waitingCharacters.length + waitingStories.length + waitingEpisodes.length === 0 ? (
            <p className="mt-2 text-sm text-muted">Nothing is waiting.</p>
          ) : null}
          <ul className="mt-3 flex flex-col gap-2">
            {waitingCharacters.map((item) => (
              <li key={item.id}>
                <Link to="/characters/$characterId" params={{ characterId: item.id }} className="flex min-h-11 items-center justify-between gap-3 rounded-sm border border-line px-3">
                  <span>{item.name}</span>
                  <Pill tone="marigold">Character</Pill>
                </Link>
              </li>
            ))}
            {waitingStories.map((item) => (
              <li key={item.id}>
                <Link to="/stories/$storyId" params={{ storyId: item.id }} className="flex min-h-11 items-center justify-between gap-3 rounded-sm border border-line px-3">
                  <span>{latestSnapshot(item).snapshot.title}</span>
                  <Pill tone={latestSnapshot(item).status === "revision_requested" ? "clay" : "marigold"}>
                    {latestSnapshot(item).status === "revision_requested" ? "Revise" : "Story"}
                  </Pill>
                </Link>
              </li>
            ))}
            {waitingEpisodes.map((item) => (
              <li key={item.id}>
                <Link to="/episodes/$episodeId" params={{ episodeId: item.id }} className="flex min-h-11 items-center justify-between gap-3 rounded-sm border border-line px-3">
                  <span>{latestSnapshot(item).snapshot.title}</span>
                  <Pill tone="marigold">Episode draft</Pill>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <h2 className="text-xl">Active episode</h2>
          {snap && episode ? (
            <div className="mt-3 flex flex-col gap-2">
              <p className="font-serif text-lg">{snap.title}</p>
              <div className="flex flex-wrap gap-2">
                <Pill tone="quiet">{snap.stage.replaceAll("_", " ")}</Pill>
                <Pill tone={snap.holdReason ? "clay" : "neem"}>{snap.holdReason ? "Held" : "Clear"}</Pill>
              </div>
              {snap.holdReason ? <p className="text-sm text-muted">{snap.holdReason}</p> : null}
              {snap.lastError ? <p className="text-sm text-clay">{snap.lastError}</p> : null}
              <Link to="/episodes/$episodeId" params={{ episodeId: episode.id }} className="text-sm font-semibold text-neem">
                Open the episode
              </Link>
            </div>
          ) : (
            <p className="mt-2 text-sm text-muted">No episode yet. Approve a story, then open production.</p>
          )}
          {flags.length > 0 ? (
            <p className="mt-4 text-sm text-clay">{flags.length} rights red flag{flags.length === 1 ? "" : "s"}. Drafts can be accepted. Publish cannot.</p>
          ) : null}
        </Card>
      </div>
      <Card>
        <h2 className="text-xl">How a story moves</h2>
        <ol className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
          {["Brand and canon", "Story, scored for sameness", "Hindi script", "Storyboard and plan", "Gates", "Your approval"].map((step, i) => (
            <li key={step} className="rounded-sm border border-line bg-paper px-3 py-3">
              <span className="text-xs font-semibold text-neem">0{i + 1}</span>
              <p className="mt-1">{step}</p>
            </li>
          ))}
        </ol>
        <p className="mt-3 text-xs text-muted">
          Text comes from the development provider: templated from canon, not a live model. Commercial rights stay uncleared until you say otherwise.
        </p>
      </Card>
    </Page>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-sm bg-paper px-3 py-3">
      <p className="font-serif text-2xl tabular-nums">{value}</p>
      <p className="text-xs text-muted">{label}</p>
    </div>
  );
}

function Setup() {
  const replace = useStudio((s) => s.replace);
  const [age, setAge] = useState<AgeBand | "">("");
  const [studioName, setStudio] = useState("Neem Studio");
  const [reviewerName, setReviewer] = useState("Studio lead");
  const [brand, setBrand] = useState("Gulmohar Gali");
  const [brandHi, setBrandHi] = useState("गुलमोहर गली");
  const [character, setCharacter] = useState("Meethi");
  const [characterHi, setCharacterHi] = useState("मीठी");
  const [clothing, setClothing] = useState("mustard kurta");
  const [phrase, setPhrase] = useState("देखो ना!");
  const [weakness, setWeakness] = useState("impatience");

  function create(event: FormEvent) {
    event.preventDefault();
    if (!age) {
      useStudio.setState({ flash: "Pick a target age. Production stays locked until you do." });
      return;
    }
    const actor = { type: "human" as const, id: "human_reviewer", name: reviewerName };
    let cursor = createEmptyDb();
    const studio = createStudio(cursor, { name: studioName, reviewerName }, actor);
    if (!studio.ok) {
      useStudio.setState({ db: studio.db, flash: studio.error });
      return;
    }
    cursor = studio.db;
    const aged = setAgeBand(cursor, age, actor);
    if (!aged.ok) {
      useStudio.setState({ db: aged.db, flash: aged.error });
      return;
    }
    cursor = aged.db;
    const savedBrand = saveBrand(
      cursor,
      {
        name: brand,
        nameHi: brandHi,
        tagline: "A small lane. A new story. No copies.",
        taglineHi: "जहाँ हर दिन एक छोटी कहानी खिलती है",
        colors: ["#1F6B4A", "#E08A2C", "#1C1915", "#F4EFE6"],
        voice: "Warm, specific, never shouty.",
        parentPositioning: "Original Hindi stories for young children.",
        notPositioning: "Not an AI cartoon generator.",
      },
      actor,
    );
    if (!savedBrand.ok) {
      useStudio.setState({ db: savedBrand.db, flash: savedBrand.error });
      return;
    }
    cursor = approveBrand(savedBrand.db, actor).db;
    const universe = saveUniverse(cursor, { name: brand, premise: "Stories stay at child scale.", rules: ["No magic powers."] }, actor);
    if (!universe.ok) {
      useStudio.setState({ db: universe.db, flash: universe.error });
      return;
    }
    cursor = approveUniverse(universe.db, actor).db;
    const world = saveWorld(cursor, { name: brand, geography: "One lane.", timeFeel: "The present.", rules: ["The tree does not talk."] }, actor);
    if (!world.ok) {
      useStudio.setState({ db: world.db, flash: world.error });
      return;
    }
    cursor = approveWorld(world.db, actor).db;
    const place = createLocation(cursor, { key: "courtyard", name: "Courtyard", nameHi: "आँगन", description: "One tree.", kind: "world" }, actor);
    if (!place.ok) {
      useStudio.setState({ db: place.db, flash: place.error });
      return;
    }
    cursor = place.db;
    const body: CharacterBody = {
      name: character,
      nameHi: characterHi,
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
      storyFunction: "lead",
      visualRules: ["Do not change clothing inside an episode."],
      forbiddenVariations: ["cape"],
      developmentTokens: [weakness, "honesty", "sharing", "curiosity"],
    };
    const made = createCharacter(cursor, body, actor);
    if (!made.ok) {
      useStudio.setState({ db: made.db, flash: made.error });
      return;
    }
    const locked = approveCharacter(made.db, made.data.id, actor, "First canonical character, locked by the studio lead.");
    useStudio.setState({ db: locked.db, flash: locked.ok ? null : locked.error });
  }

  return (
    <Page kicker="Studio" title="Start from canon" lede="Pick an age, name the lane, and lock one character. Or load the Gulmohar Gali demo. Nothing publishes.">
      <form onSubmit={create} className="flex flex-col gap-4">
        <Card>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Studio"><input className={inputClass} value={studioName} onChange={(e) => setStudio(e.target.value)} required /></Field>
            <Field label="Your name"><input className={inputClass} value={reviewerName} onChange={(e) => setReviewer(e.target.value)} required /></Field>
            <Field label="Brand"><input className={inputClass} value={brand} onChange={(e) => setBrand(e.target.value)} required /></Field>
            <Field label="Brand in Hindi"><input className={inputClass} value={brandHi} onChange={(e) => setBrandHi(e.target.value)} required /></Field>
            <Field label="Age band">
              <select className={inputClass} value={age} onChange={(e) => setAge(e.target.value as AgeBand | "")} required>
                <option value="">Choose</option>
                {AGE_BANDS.map((band) => <option key={band} value={band}>{band}</option>)}
              </select>
            </Field>
            <Field label="Character"><input className={inputClass} value={character} onChange={(e) => setCharacter(e.target.value)} required /></Field>
            <Field label="Hindi name"><input className={inputClass} value={characterHi} onChange={(e) => setCharacterHi(e.target.value)} required /></Field>
            <Field label="Clothing"><input className={inputClass} value={clothing} onChange={(e) => setClothing(e.target.value)} required /></Field>
            <Field label="Catchphrase"><input className={inputClass} value={phrase} onChange={(e) => setPhrase(e.target.value)} required /></Field>
            <Field label="Weakness"><input className={inputClass} value={weakness} onChange={(e) => setWeakness(e.target.value)} required /></Field>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button type="submit">Lock the first character</Button>
            <Button type="button" variant="quiet" onClick={() => replace(buildSeedDb())}>Load the Gulmohar Gali demo</Button>
          </div>
        </Card>
      </form>
    </Page>
  );
}
