import { analyzeVariation } from "./intelligence.ts";
import { allocId, canonicalOf, createLocation, latestSnapshot, publishEpisode } from "./engine.ts";
import { releaseDesk } from "./release.ts";
import type {
  Actor,
  BrainAutonomy,
  BrainCall,
  BrainCategory,
  BrainConfidence,
  BrainDecisionLog,
  BrainOpportunity,
  BrainRecommendation,
  LocationStrategy,
  Op,
  PerformanceSignal,
  PlaceLayer,
  StudioDb,
} from "./types.ts";

export const PRIMARY_WORLD_KEY = "gulmohar-gali";
export const ALPINE_KEY = "alpine-inspired";
export const AUTONOMY_CAP: BrainAutonomy = 3;

export const ECONOMICS_INPUTS = [
  { key: "production_cost", label: "Production cost", available: false },
  { key: "production_time", label: "Estimated production time", available: false },
  { key: "asset_reuse", label: "Asset reuse", available: false },
  { key: "voice_cost", label: "Voice cost", available: false },
  { key: "music_cost", label: "Music cost", available: false },
  { key: "localization_cost", label: "Localization cost", available: false },
  { key: "audience_value", label: "Expected audience value", available: false },
  { key: "ip_value", label: "Expected IP value", available: false },
] as const;

const EMPTY_MEMORY = { rejected: [] as string[], accepted: [] as string[], outcomes: [] as Array<{ fingerprint: string; at: string; outcome: string }> };

function fail<T>(db: StudioDb, code: string, error: string): Op<T> {
  return { ok: false, db, code, error };
}

function stamp(now?: string): string {
  return now ?? new Date().toISOString();
}

function memoryOf(db: StudioDb) {
  return db.brainMemory ?? EMPTY_MEMORY;
}

function audit(db: StudioDb, at: string, actor: Actor, action: string, entityId: string, detail: string): StudioDb {
  const ided = allocId(db, "aud");
  return {
    ...ided.db,
    audit: [
      ...ided.db.audit,
      {
        id: ided.id,
        at,
        actorType: actor.type,
        actorId: actor.id,
        action,
        entityType: "studio_brain",
        entityId,
        detail,
      },
    ],
  };
}

function logLine(
  db: StudioDb,
  at: string,
  rec: Pick<BrainRecommendation, "id" | "title" | "evidence" | "rationale" | "confidence" | "recommendedAction">,
  humanDecision: string | null,
  outcome: string | null,
): StudioDb {
  const ided = allocId(db, "blog");
  const row: BrainDecisionLog = {
    id: ided.id,
    at,
    recommendationId: rec.id,
    recommendation: rec.title,
    evidence: rec.evidence,
    reasoning: rec.rationale,
    confidence: rec.confidence,
    humanDecision,
    resultingAction: rec.recommendedAction,
    outcome,
  };
  return { ...ided.db, brainDecisions: [...(ided.db.brainDecisions ?? []), row] };
}

export function economicsReadiness() {
  return {
    optimized: false,
    note: "These inputs are reserved. The brain does not rank work by money or views yet.",
    inputs: ECONOMICS_INPUTS,
  };
}

function primaryEntry(db: StudioDb, at: string): LocationStrategy {
  return {
    id: "loclib_gulmohar",
    key: PRIMARY_WORLD_KEY,
    name: db.world?.name || "Gulmohar Gali",
    nameHi: "गुलमोहर गली",
    role: "PRIMARY_WORLD",
    status: "LOCKED",
    layer: "canon",
    canonLocationId: null,
    worldId: db.world?.id ?? null,
    rationale: "Home of the IP. Indian identity, recurring relationships, and visual recognition stay here.",
    ageSuitability: db.studio?.ageBand ?? "3-5",
    storyOpportunities: "Everyday lane stories with Meethi, Golu, and Dadi Kamla.",
    culturalNotes: "The lane is the canon home. Expansion places do not replace it.",
    visualIdentity: "Courtyard gulmohar, veranda, familiar clothes and faces.",
    productionNotes: "Reuse locked character and location canon. No new world.",
    recurrence: "recurring",
    realWorld: "fictional",
    createdAt: at,
    updatedAt: at,
  };
}

function alpineEntry(db: StudioDb, at: string, id: string): LocationStrategy {
  return {
    id,
    key: ALPINE_KEY,
    name: "Fictional Alpine range",
    nameHi: "काल्पनिक पहाड़",
    role: "EXPANSION",
    status: "PROPOSED",
    layer: "proposal",
    canonLocationId: null,
    worldId: null,
    rationale: "An Alpine adventure could add visual variety and a travel story without leaving the characters behind.",
    ageSuitability: db.studio?.ageBand ?? "3-5",
    storyOpportunities: "One journey story. Meethi and Golu notice a new landscape and come home.",
    culturalNotes: "Prefer a fictional Alpine-inspired place. Do not turn Gulmohar Gali into a tourism showcase, and do not make Switzerland canon by default.",
    visualIdentity: "High meadows, cold light, a simple path. No flags, no souvenir shop, no real-world branding.",
    productionNotes: "New location art. Higher complexity than the lane. One-off until a human says otherwise.",
    recurrence: "one-off",
    realWorld: "fictional",
    createdAt: at,
    updatedAt: at,
  };
}

function withLibrary(db: StudioDb, at: string): { db: StudioDb; alpine: LocationStrategy } {
  const library = [...(db.locationLibrary ?? [])];
  if (!library.some((item) => item.key === PRIMARY_WORLD_KEY)) library.unshift(primaryEntry(db, at));
  let alpine = library.find((item) => item.key === ALPINE_KEY);
  if (!alpine) {
    const ided = allocId({ ...db, locationLibrary: library }, "loclib");
    alpine = alpineEntry(ided.db, at, ided.id);
    return { db: { ...ided.db, locationLibrary: [...library, alpine] }, alpine };
  }
  return { db: { ...db, locationLibrary: library }, alpine };
}

export interface PlaceReading {
  key: string;
  name: string;
  layer: PlaceLayer;
  status: string;
  usableInProduction: boolean;
  canonLocationId: string | null;
  note: string;
}

/** Canon, story setting, and production asset stay separate. */
export function readPlace(db: StudioDb, key: string): PlaceReading {
  const strategy = (db.locationLibrary ?? []).find((item) => item.key === key);
  const canon = db.locations.find((item) => canonicalOf(item)?.snapshot.key === key || latestSnapshot(item).snapshot.key === key);
  const canonId = canon?.id ?? null;
  const assetCount = db.assets.filter((asset) => latestSnapshot(asset).snapshot.locationId === canonId && canonId).length;
  if (strategy?.role === "PRIMARY_WORLD") {
    return {
      key,
      name: strategy.name,
      layer: "canon",
      status: strategy.status,
      usableInProduction: true,
      canonLocationId: null,
      note: "Primary world. Stories happen inside it. That does not create a new location asset.",
    };
  }
  if (strategy && (strategy.status === "PROPOSED" || strategy.status === "RETIRED")) {
    return {
      key,
      name: strategy.name,
      layer: "proposal",
      status: strategy.status,
      usableInProduction: false,
      canonLocationId: strategy.canonLocationId,
      note: strategy.status === "PROPOSED" ? "Proposed only. Not canon. A story setting and a production asset are not created by this proposal." : "Retired. Not available for new stories.",
    };
  }
  if (strategy && (strategy.status === "APPROVED" || strategy.status === "LOCKED") && canon) {
    return {
      key,
      name: strategy.name,
      layer: assetCount > 0 ? "production-asset" : "canon",
      status: strategy.status,
      usableInProduction: true,
      canonLocationId: canon.id,
      note: assetCount > 0 ? `${assetCount} production asset${assetCount === 1 ? "" : "s"} cite this location. The asset is not the canon place.` : "Approved canon location. No production asset has been made for it yet.",
    };
  }
  if (canon) {
    return {
      key,
      name: latestSnapshot(canon).snapshot.name,
      layer: assetCount > 0 ? "production-asset" : "canon",
      status: "APPROVED",
      usableInProduction: true,
      canonLocationId: canon.id,
      note: "Existing canon location. Usable as a story setting. An asset, if any, is separate.",
    };
  }
  return {
    key,
    name: key,
    layer: "proposal",
    status: "UNKNOWN",
    usableInProduction: false,
    canonLocationId: null,
    note: "Unknown place. The brain will not invent canon for it.",
  };
}

export function locationGate(db: StudioDb, key: string): { usable: boolean; status: string; layer: PlaceLayer; locationId: string | null } {
  const place = readPlace(db, key);
  return { usable: place.usableInProduction, status: place.status, layer: place.layer, locationId: place.canonLocationId };
}

interface DraftRec {
  category: BrainCategory;
  title: string;
  rationale: string;
  evidence: string[];
  confidence: BrainConfidence;
  targetAge: string;
  characterIds: string[];
  locationKey: string | null;
  risks: string[];
  recommendedAction: string;
  fingerprint: string;
  opportunity?: Omit<BrainOpportunity, "id" | "at" | "recommendationId" | "status">;
}

function storyRows(db: StudioDb) {
  return db.stories.map((story) => {
    const version = story.versions.find((item) => item.version === story.canonicalVersion) ?? story.versions[story.versions.length - 1];
    const snap = version?.snapshot;
    return {
      id: story.id,
      title: snap?.title ?? story.name,
      dna: snap?.dna,
      settingLabel: snap?.settingLabel ?? "",
      castLabel: (snap?.characterIds ?? []).join("+"),
      characterIds: snap?.characterIds ?? [],
      approved: story.canonicalVersion != null,
      originality: snap?.originality.total ?? 0,
      meets: Boolean(snap?.originality.meetsThreshold),
      tooSimilar: Boolean(snap?.similarity.tooSimilar),
    };
  });
}

function draftsFor(db: StudioDb): DraftRec[] {
  const age = db.studio?.ageBand ?? "3-5";
  const drafts: DraftRec[] = [];
  const desk = releaseDesk(db);
  for (const row of desk.rows) {
    if (!row.rights && row.status !== "RELEASE_BLOCKED") continue;
    if (!row.rights && !row.blocker) continue;
    drafts.push({
      category: "REPAIR",
      title: `Resolve the rights blocker on ${row.title}`,
      rationale: "The episode is blocked by rights or release checks. The brain can point at the block. It cannot clear it.",
      evidence: [row.blocker ?? "Release blocked.", row.rights ? "Rights QA is red. Unknown commercial rights stay uncleared." : "Release is blocked."],
      confidence: "HIGH",
      targetAge: age,
      characterIds: [],
      locationKey: null,
      risks: ["Clearing rights without evidence would be a false clearance."],
      recommendedAction: "A human resolves the rights evidence, then the release check is run again. Do not advance the episode.",
      fingerprint: `repair:rights:${row.episodeId}`,
    });
  }
  const variation = analyzeVariation(
    storyRows(db)
      .filter((row) => row.dna)
      .map((row) => ({ title: row.title, dna: row.dna!, settingLabel: row.settingLabel, castLabel: row.castLabel })),
  );
  for (const item of variation.overused.filter((row) => row.dimension === "story structure" || row.dimension === "premise" || row.dimension === "conflict" || row.dimension === "resolution").slice(0, 3)) {
    const percent = Math.round(item.share * 100);
    drafts.push({
      category: item.dimension === "story structure" ? "PAUSE" : "DO_NOT_PRODUCE",
      title: `Do not add another “${item.value}” ${item.dimension}`,
      rationale: `${item.dimension} “${item.value}” is ${percent}% of the library (${item.count} of ${variation.librarySize}). High performance would not erase this repetition.`,
      evidence: [`${item.count} of ${variation.librarySize} stories share this ${item.dimension}.`, "Story Intelligence measured the pattern. No story text was changed."],
      confidence: item.share >= 0.4 ? "HIGH" : "MEDIUM",
      targetAge: age,
      characterIds: [],
      locationKey: null,
      risks: ["Forcing a different story by rewriting approved work would break canon and approvals."],
      recommendedAction: "Explore a different narrative structure for the next new story. Do not rewrite stories already in the library.",
      fingerprint: `pause:${item.dimension}:${item.value}`,
    });
  }
  const unused = variation.gaps[0];
  if (unused) {
    drafts.push({
      category: "PRODUCE",
      title: `Consider a story shaped like ${unused.value}`,
      rationale: "This structure is in the development catalog and not in the library. It is a suggestion, not a quota.",
      evidence: [unused.note],
      confidence: "LOW",
      targetAge: age,
      characterIds: [],
      locationKey: PRIMARY_WORLD_KEY,
      risks: ["A new structure still has to pass Story Intelligence and a human."],
      recommendedAction: "A human can ask for one new story in Gulmohar Gali. The brain will not write or approve it.",
      fingerprint: `produce:gap:${unused.value}`,
    });
  }
  const alpineKnown = (db.locationLibrary ?? []).find((item) => item.key === ALPINE_KEY);
  if (!alpineKnown || alpineKnown.status === "PROPOSED") {
    drafts.push({
      category: "DEVELOP",
      title: "Alpine adventure",
      rationale: "A fictional Alpine-inspired place could add visual variety and one travel story. Switzerland is not part of Gulmohar Gali canon.",
      evidence: ["No approved Alpine location is in canon.", "The primary world remains Gulmohar Gali."],
      confidence: "LOW",
      targetAge: age,
      characterIds: [],
      locationKey: ALPINE_KEY,
      risks: ["The episode could feel disconnected from Indian identity if the trip has no story reason."],
      recommendedAction: "Develop one fictional Alpine-inspired location and one story concept. Leave the location PROPOSED until a human approves it.",
      fingerprint: "develop:alpine-inspired",
      opportunity: {
        title: "Alpine adventure",
        category: "World expansion",
        rationale: "Could provide visual variety and a distinctive travel story.",
        evidence: ["Hypothesis only. No audience proof is stored.", "Fictional setting preferred over a real Swiss showcase."],
        targetAge: age,
        characterNames: ["Meethi", "Golu"],
        locationKey: ALPINE_KEY,
        expectedValue: "Medium / High",
        risks: ["Could feel disconnected from Indian identity if used without a narrative reason."],
        recommendedAction: "Develop a fictional Alpine-inspired location and test one story concept.",
        confidence: "LOW",
      },
    });
    drafts.push({
      category: "EXPERIMENT",
      title: "Test one Alpine story against home stories",
      rationale: "Hypothesis: a travel episode may hold attention without weakening the lane. This is a test design, not a result.",
      evidence: ["No performance comparison exists yet.", "Same target age, approved characters, and a human-approved setting would be required."],
      confidence: "LOW",
      targetAge: age,
      characterIds: [],
      locationKey: ALPINE_KEY,
      risks: ["Publishing the test automatically would skip human approval."],
      recommendedAction: "If a human approves the place, make one episode and compare retention with home-setting episodes. Do not publish it from the brain.",
      fingerprint: "experiment:alpine-retention",
    });
  }
  for (const signal of db.performanceSignals ?? []) {
    const viewsOnly = signal.metric === "views";
    drafts.push({
      category: "INVESTIGATE",
      title: `Investigate ${signal.label}`,
      rationale: viewsOnly
        ? "A high view count is not a reason to copy the story. Ask why it happened, then recommend. Do not reproduce the pattern on views alone."
        : "A performance signal is evidence, not an order to make more of the same.",
      evidence: [
        `${signal.metric} ${signal.value} across ${signal.sampleSize} observations. ${signal.hypothetical ? "Hypothetical data." : "Reported data."}`,
        signal.note || "No extra note.",
        signal.storyStructure ? `Structure: ${signal.storyStructure}.` : "No structure was named.",
      ],
      confidence: signal.sampleSize >= 8 && !signal.hypothetical ? "MEDIUM" : "LOW",
      targetAge: age,
      characterIds: [],
      locationKey: null,
      risks: ["Copying a winner would collapse originality and can repeat a blocked structure."],
      recommendedAction: "Study the pattern. Do not automatically create copies.",
      fingerprint: `investigate:${signal.metric}:${signal.storyStructure ?? signal.label}`,
    });
  }
  const waiting = storyRows(db).filter((row) => row.approved && !row.tooSimilar && row.meets && !db.episodes.some((episode) => latestSnapshot(episode).snapshot.storyId === row.id));
  const nextStory = [...waiting].sort((a, b) => b.originality - a.originality)[0];
  if (nextStory) {
    drafts.push({
      category: "PRODUCE",
      title: `Produce “${nextStory.title}” when a human opens it`,
      rationale: "An approved story is waiting and no episode is open. The brain can put it on the plan. It cannot approve production or publish.",
      evidence: [`Originality ${nextStory.originality}. Similarity is not a lookalike. A human already approved the story.`],
      confidence: "MEDIUM",
      targetAge: age,
      characterIds: nextStory.characterIds,
      locationKey: PRIMARY_WORLD_KEY,
      risks: ["Opening an episode is still a human production choice."],
      recommendedAction: "A human opens the episode. Agents draft only after that. Nothing publishes.",
      fingerprint: `produce:story:${nextStory.id}`,
    });
  }
  return drafts;
}

function suppressed(db: StudioDb, fingerprintKey: string): boolean {
  const memory = memoryOf(db);
  if (memory.rejected.includes(fingerprintKey)) return true;
  return (db.brainRecommendations ?? []).some((item) => item.fingerprint === fingerprintKey && item.status !== "OPEN");
}

export interface BrainQueueItem {
  order: number;
  title: string;
  gate: "DO NOT ADVANCE" | "DO NOT START PRODUCTION" | "WAIT FOR HUMAN" | "RECOMMENDED";
  detail: string;
}

export function brainQueue(db: StudioDb): BrainQueueItem[] {
  const items: BrainQueueItem[] = [];
  for (const row of releaseDesk(db).rows) {
    if (row.status === "RELEASE_BLOCKED" || row.rights) {
      items.push({ order: 0, title: row.title, gate: "DO NOT ADVANCE", detail: row.blocker ?? "Release blocked." });
    } else if (row.human) {
      items.push({ order: 2, title: row.title, gate: "WAIT FOR HUMAN", detail: "Policy or culture needs a person. The brain does not override QA." });
    }
  }
  for (const episode of db.episodes) {
    const snap = latestSnapshot(episode).snapshot;
    if (snap.stage === "HUMAN_APPROVAL") {
      items.push({ order: 2, title: snap.title, gate: "WAIT FOR HUMAN", detail: "Final approval is human. The brain cannot publish." });
    }
  }
  for (const row of storyRows(db)) {
    if (!row.approved || row.tooSimilar || !row.meets) {
      items.push({
        order: 3,
        title: row.title,
        gate: "DO NOT START PRODUCTION",
        detail: !row.approved ? "Story Intelligence has not been accepted by a human." : row.tooSimilar ? "Too similar to an existing story." : "Under the originality bar.",
      });
    }
  }
  const alpine = (db.locationLibrary ?? []).find((item) => item.key === ALPINE_KEY);
  if (!alpine || alpine.status === "PROPOSED") {
    items.push({ order: 4, title: "Alpine adventure", gate: "RECOMMENDED", detail: "Location stays PROPOSED until a human approves it into canon." });
  }
  return items.sort((a, b) => a.order - b.order).slice(0, 8);
}

export interface ContentLane {
  name: string;
  status: "ACTIVE" | "PLANNED" | "PROPOSED" | "PAUSE";
  reason: string;
}

export function portfolio(db: StudioDb): ContentLane[] {
  const alpine = (db.locationLibrary ?? []).find((item) => item.key === ALPINE_KEY);
  const variation = analyzeVariation(
    storyRows(db)
      .filter((row) => row.dna)
      .map((row) => ({ title: row.title, dna: row.dna!, settingLabel: row.settingLabel, castLabel: row.castLabel })),
  );
  const repeated = variation.overused.find((item) => item.dimension === "story structure");
  const lanes: ContentLane[] = [
    { name: "Gulmohar Gali home stories", status: "ACTIVE", reason: "Core IP" },
    { name: "Comedy", status: "ACTIVE", reason: "Strong character fit" },
    { name: "Learning", status: "ACTIVE", reason: "Age-band appropriate" },
    { name: "Festival stories", status: "PLANNED", reason: "Seasonal opportunity" },
    {
      name: "Alpine adventure",
      status: alpine?.status === "APPROVED" || alpine?.status === "LOCKED" ? "PLANNED" : "PROPOSED",
      reason: alpine?.status === "APPROVED" ? "Location approved. Not a tourism canon, and not auto-produced." : "World expansion. Not canon yet.",
    },
  ];
  if (repeated) {
    lanes.push({ name: `Repeated ${repeated.value} stories`, status: "PAUSE", reason: `${Math.round(repeated.share * 100)}% of the library. Do not keep copying it.` });
  }
  return lanes;
}

export interface BrainBrief {
  autonomy: BrainAutonomy;
  attention: ReturnType<typeof releaseDesk>;
  next: Array<{ title: string; category: BrainCategory; confidence: BrainConfidence; action: string; hypothesis: boolean }>;
  opportunities: Array<{ title: string; category: string; rationale: string; risks: string[]; confidence: BrainConfidence; status: string; expectedValue: string }>;
  learning: string[];
  world: Array<{ name: string; nameHi: string; status: string; role: string; note: string }>;
  portfolio: ContentLane[];
  queue: BrainQueueItem[];
  characters: string;
}

export function brainBrief(db: StudioDb): BrainBrief {
  const stored = db.brainRecommendations ?? [];
  const open = stored.filter((item) => item.status === "OPEN");
  const drafts = draftsFor(db).filter((draft) => !suppressed(db, draft.fingerprint) && !stored.some((item) => item.fingerprint === draft.fingerprint));
  const source = [...open, ...drafts];
  const alpine = (db.locationLibrary ?? []).find((item) => item.key === ALPINE_KEY);
  const opportunities = (db.brainOpportunities ?? []).filter((item) => item.status === "PROPOSED");
  const shownOpps = opportunities.length
    ? opportunities.map((item) => ({
        title: item.title,
        category: item.category,
        rationale: item.rationale,
        risks: item.risks,
        confidence: item.confidence,
        status: item.status,
        expectedValue: item.expectedValue,
      }))
    : source
        .filter((item) => item.category === "DEVELOP" || item.category === "EXPERIMENT")
        .slice(0, 3)
        .map((item) => ({
          title: item.title,
          category: item.category === "EXPERIMENT" ? "Experiment" : "World expansion",
          rationale: item.rationale,
          risks: item.risks,
          confidence: item.confidence,
          status: "PROPOSED",
          expectedValue: "Medium / High",
        }));
  const learning = [
    ...((db.performanceSignals ?? []).slice(-3).map((signal) => `${signal.label}: ${signal.metric} ${signal.value}. ${signal.hypothetical ? "Hypothetical." : "Reported."} Not an order to copy.`)),
    ...memoryOf(db).outcomes.slice(-3).map((item) => `Outcome kept: ${item.outcome}`),
  ];
  if (!learning.length) learning.push("No performance has been published from this studio. Nothing here is a view-chasing rule.");
  for (const lesson of (db.analyticsLessons ?? []).filter((item) => item.status !== "RETIRED").slice(-2)) {
    learning.push(`${lesson.observation} Confidence ${lesson.confidence}. Not an order to copy.`);
  }
  const world = [
    { name: db.world?.name || "Gulmohar Gali", nameHi: "गुलमोहर गली", status: "LOCKED", role: "PRIMARY", note: "Home world. Not replaced by an expansion." },
    alpine
      ? { name: alpine.name, nameHi: alpine.nameHi, status: alpine.status, role: "EXPANSION", note: alpine.culturalNotes }
      : { name: "Fictional Alpine range", nameHi: "काल्पनिक पहाड़", status: "PROPOSED", role: "EXPANSION", note: "Not canon. Switzerland is not part of Gulmohar Gali." },
  ];
  const counts = new Map<string, number>();
  for (const row of storyRows(db)) {
    for (const id of row.characterIds) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const names = [...counts.entries()]
    .map(([id, count]) => `${db.characters.find((item) => item.id === id)?.name ?? id} ${count}`)
    .join(", ");
  return {
    autonomy: db.brainAutonomy ?? 2,
    attention: releaseDesk(db),
    next: source.slice(0, 5).map((item) => ({
      title: item.title,
      category: item.category,
      confidence: item.confidence,
      action: item.recommendedAction,
      hypothesis: item.confidence === "LOW",
    })),
    opportunities: shownOpps,
    learning,
    world,
    portfolio: portfolio(db),
    queue: brainQueue(db).slice(0, 5),
    characters: names || "No character usage yet.",
  };
}

export function recordBrain(db: StudioDb, actor: Actor, now?: string): Op<{ ids: string[] }> {
  const at = stamp(now);
  if (actor.type === "agent") return fail(db, "permission", "An agent cannot file studio strategy. A human records the brain's plan.");
  if ((db.brainAutonomy ?? 2) < 1) return fail(db, "autonomy", "Autonomy is observe-only. Raise it to recommend.");
  const library = withLibrary(db, at);
  let next = library.db;
  const ids: string[] = [];
  for (const draft of draftsFor(next)) {
    if (suppressed(next, draft.fingerprint)) continue;
    if ((next.brainRecommendations ?? []).some((item) => item.fingerprint === draft.fingerprint)) continue;
    const ided = allocId(next, "brain");
    const rec: BrainRecommendation = {
      id: ided.id,
      at,
      category: draft.category,
      title: draft.title,
      rationale: draft.rationale,
      evidence: draft.evidence,
      confidence: draft.confidence,
      hypothesis: draft.confidence === "LOW",
      targetAge: draft.targetAge,
      characterIds: draft.characterIds,
      locationKey: draft.locationKey,
      risks: draft.risks,
      recommendedAction: draft.recommendedAction,
      fingerprint: draft.fingerprint,
      status: "OPEN",
      humanDecision: null,
      outcomes: [],
    };
    next = { ...ided.db, brainRecommendations: [...(ided.db.brainRecommendations ?? []), rec] };
    next = logLine(next, at, rec, null, null);
    ids.push(rec.id);
    if (draft.opportunity && !(next.brainOpportunities ?? []).some((item) => item.locationKey === draft.locationKey && item.title === draft.opportunity?.title)) {
      const oppId = allocId(next, "opp");
      const opportunity: BrainOpportunity = { ...draft.opportunity, id: oppId.id, at, status: "PROPOSED", recommendationId: rec.id };
      next = { ...oppId.db, brainOpportunities: [...(oppId.db.brainOpportunities ?? []), opportunity] };
    }
  }
  next = audit(next, at, actor, "brain.recorded", ids[0] ?? "brain", `${ids.length} recommendations. No canon, rights, or publish action was taken.`);
  return { ok: true, db: next, data: { ids } };
}

export function decideBrain(
  db: StudioDb,
  recommendationId: string,
  decision: BrainCall,
  actor: Actor,
  note: string,
  modifiedText?: string,
  now?: string,
): Op<{ status: BrainRecommendation["status"] }> {
  const at = stamp(now);
  if (actor.type !== "human") {
    return fail(audit(db, at, actor, "brain.decision_denied", recommendationId, "An agent tried to accept, reject, or modify strategy."), "human-required", "Only a human can accept, reject, modify, or defer a recommendation.");
  }
  if (note.trim().length < 8) return fail(db, "note", "Write the decision.");
  const current = (db.brainRecommendations ?? []).find((item) => item.id === recommendationId);
  if (!current || current.status !== "OPEN") return fail(db, "missing", "No open recommendation.");
  if (decision === "MODIFY" && (modifiedText ?? "").trim().length < 8) return fail(db, "note", "Write the modified recommendation separately from the original.");
  const status = decision === "ACCEPT" ? "ACCEPTED" : decision === "REJECT" ? "REJECTED" : decision === "MODIFY" ? "MODIFIED" : "DEFERRED";
  const human = {
    decision,
    at,
    actorId: actor.id,
    actorName: actor.name,
    note: note.trim(),
    modifiedText: decision === "MODIFY" ? (modifiedText ?? "").trim() : null,
  };
  const updated: BrainRecommendation = { ...current, status, humanDecision: human };
  let next: StudioDb = {
    ...db,
    brainRecommendations: (db.brainRecommendations ?? []).map((item) => (item.id === current.id ? updated : item)),
    brainMemory: {
      rejected: memoryOf(db).rejected,
      accepted: memoryOf(db).accepted,
      outcomes: memoryOf(db).outcomes,
    },
  };
  if (decision === "REJECT" && !next.brainMemory.rejected.includes(current.fingerprint)) {
    next = { ...next, brainMemory: { ...next.brainMemory, rejected: [...next.brainMemory.rejected, current.fingerprint] } };
  }
  if ((decision === "ACCEPT" || decision === "MODIFY") && !next.brainMemory.accepted.includes(current.fingerprint)) {
    next = { ...next, brainMemory: { ...next.brainMemory, accepted: [...next.brainMemory.accepted, current.fingerprint] } };
  }
  if (current.locationKey === ALPINE_KEY) {
    const oppStatus = decision === "REJECT" ? "REJECTED" : decision === "DEFER" ? "DEFERRED" : "ACCEPTED";
    next = {
      ...next,
      brainOpportunities: (next.brainOpportunities ?? []).map((item) => (item.recommendationId === current.id ? { ...item, status: oppStatus } : item)),
    };
  }
  next = logLine(next, at, current, `${decision}. ${note.trim()}${human.modifiedText ? ` Modified: ${human.modifiedText}` : ""}`, null);
  next = audit(next, at, actor, "brain.decided", current.id, `${decision}. The original rationale was kept.`);
  return { ok: true, db: next, data: { status } };
}

export function recordBrainOutcome(db: StudioDb, recommendationId: string, outcome: string, actor: Actor, now?: string): Op<{ id: string }> {
  const at = stamp(now);
  if (actor.type !== "human") return fail(db, "human-required", "Only a human records what happened after a decision.");
  if (outcome.trim().length < 8) return fail(db, "note", "Write the outcome.");
  const current = (db.brainRecommendations ?? []).find((item) => item.id === recommendationId);
  if (!current) return fail(db, "missing", "Recommendation not found.");
  const text = outcome.trim();
  const updated: BrainRecommendation = { ...current, outcomes: [...current.outcomes, text] };
  let next: StudioDb = {
    ...db,
    brainRecommendations: (db.brainRecommendations ?? []).map((item) => (item.id === current.id ? updated : item)),
    brainMemory: {
      ...memoryOf(db),
      outcomes: [...memoryOf(db).outcomes, { fingerprint: current.fingerprint, at, outcome: text }],
    },
  };
  next = logLine(next, at, current, current.humanDecision ? `${current.humanDecision.decision}. ${current.humanDecision.note}` : null, text);
  return { ok: true, db: next, data: { id: current.id } };
}

export function recordPerformance(
  db: StudioDb,
  input: Omit<PerformanceSignal, "id" | "at">,
  actor: Actor,
  now?: string,
): Op<{ id: string }> {
  const at = stamp(now);
  if (actor.type === "agent") return fail(db, "permission", "An agent cannot invent performance and turn it into a production order.");
  const ided = allocId(db, "perf");
  const signal: PerformanceSignal = { ...input, id: ided.id, at, hypothetical: input.hypothetical };
  const next = audit(
    { ...ided.db, performanceSignals: [...(ided.db.performanceSignals ?? []), signal] },
    at,
    actor,
    "brain.performance_noted",
    ided.id,
    "Stored as evidence. No copies were made.",
  );
  return { ok: true, db: next, data: { id: ided.id } };
}

export function setAutonomy(db: StudioDb, level: number, actor: Actor, now?: string): Op<{ level: BrainAutonomy }> {
  const at = stamp(now);
  if (actor.type !== "human") return fail(db, "human-required", "Only a human sets autonomy.");
  if (level >= 5) return fail(audit(db, at, actor, "brain.autonomy_denied", "autonomy", "Level 5 publishing autonomy was refused."), "autonomy", "Autonomous publishing is never enabled.");
  if (level === 4) return fail(audit(db, at, actor, "brain.autonomy_denied", "autonomy", "Level 4 production autonomy is not enabled."), "autonomy", "Autonomous production is not enabled.");
  if (level !== 0 && level !== 1 && level !== 2 && level !== 3) return fail(db, "autonomy", "Autonomy must be 0, 1, 2, or 3.");
  const next = audit({ ...db, brainAutonomy: level }, at, actor, "brain.autonomy_set", "autonomy", `Level ${level}. Publishing stays off.`);
  return { ok: true, db: next, data: { level } };
}

/** Human canon step. The brain cannot call this for itself. */
export function approveProposedLocation(db: StudioDb, libraryId: string, actor: Actor, note: string, now?: string): Op<{ locationId: string; status: "APPROVED" }> {
  const at = stamp(now);
  if (actor.type !== "human") {
    return fail(audit(db, at, actor, "brain.location_denied", libraryId, "The brain or an agent tried to approve a location into canon."), "human-required", "Only a human can approve a location into canon.");
  }
  if (note.trim().length < 8) return fail(db, "note", "Write why this place can enter canon.");
  const entry = (db.locationLibrary ?? []).find((item) => item.id === libraryId);
  if (!entry || entry.status !== "PROPOSED") return fail(db, "missing", "No proposed expansion to approve.");
  if (entry.role === "PRIMARY_WORLD") return fail(db, "canon", "The primary world is already canon. It is not re-approved from a proposal.");
  const created = createLocation(db, { key: entry.key, name: entry.name, nameHi: entry.nameHi, description: entry.rationale, kind: "expansion" }, actor, at);
  if (!created.ok) return created;
  let next: StudioDb = {
    ...created.db,
    locationLibrary: (created.db.locationLibrary ?? []).map((item) =>
      item.id === entry.id ? { ...item, status: "APPROVED", layer: "canon", canonLocationId: created.data.id, updatedAt: at } : item,
    ),
  };
  next = audit(next, at, actor, "brain.location_approved", created.data.id, `${entry.name} is now an approved canon location. Gulmohar Gali stays the primary world. ${note.trim()}`);
  return { ok: true, db: next, data: { locationId: created.data.id, status: "APPROVED" } };
}

export function brainApproveLocation(db: StudioDb, libraryId: string, actor: Actor, now?: string): Op<never> {
  const at = stamp(now);
  return fail(audit(db, at, actor, "brain.location_denied", libraryId, "Studio Brain cannot approve a location."), "human-required", "The studio brain cannot approve a world or location.");
}

export function brainClearRights(db: StudioDb, episodeId: string, actor: Actor, now?: string): Op<never> {
  const at = stamp(now);
  return fail(audit(db, at, actor, "brain.rights_denied", episodeId, "Studio Brain cannot clear a rights red flag."), "rights", "The studio brain cannot clear rights or remove a red flag.");
}

export function brainChangeCanon(db: StudioDb, actor: Actor, now?: string): Op<never> {
  const at = stamp(now);
  return fail(audit(db, at, actor, "brain.canon_denied", "canon", "Studio Brain cannot change canon or lower a threshold."), "canon", "The studio brain cannot change canon, approve a character, or lower the originality bar.");
}

export function brainAdvance(db: StudioDb, episodeId: string, actor: Actor, now?: string): Op<never> {
  const at = stamp(now);
  const logged = audit(db, at, actor, "brain.advance_blocked", episodeId, "BLOCKED. The studio brain cannot move an episode past human approval.");
  const published = publishEpisode(logged, episodeId, actor, at);
  return fail(published.db, "blocked", "BLOCKED. The studio brain cannot approve an episode or publish.");
}

export function executeAcceptedPlan(db: StudioDb, recommendationId: string, actor: Actor, now?: string): Op<never> {
  const at = stamp(now);
  const level = db.brainAutonomy ?? 2;
  if (level < 3) return fail(db, "autonomy", "This autonomy level only recommends and plans. It does not start work, and it never publishes.");
  const rec = (db.brainRecommendations ?? []).find((item) => item.id === recommendationId);
  if (!rec || (rec.status !== "ACCEPTED" && rec.status !== "MODIFIED")) return fail(db, "human-required", "Nothing starts until a human has accepted the plan.");
  if (rec.category === "REPAIR" || rec.fingerprint.startsWith("repair:rights")) {
    return fail(audit(db, at, actor, "brain.execute_denied", rec.id, "A rights repair cannot be executed by the brain."), "rights", "The studio brain cannot clear the rights blocker.");
  }
  return fail(audit(db, at, actor, "brain.execute_denied", rec.id, "No pre-approved agent task is allowed to publish or approve."), "blocked", "Level 3 does not auto-write, auto-approve, or publish this plan.");
}
