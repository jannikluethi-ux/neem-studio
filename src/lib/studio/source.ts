import { ALPINE_KEY, PRIMARY_WORLD_KEY } from "./brain.ts";
import { allocId, canonicalOf, latestSnapshot } from "./engine.ts";
import type {
  Actor,
  AnalyticsPatternRecord,
  ArtifactPin,
  AssetBody,
  HumanApprovalRecord,
  LocationProposal,
  LocationStrategy,
  Op,
  PerformanceRecord,
  ProvenanceRecord,
  PublicationRecord,
  QARun,
  RightsRecord,
  RightsStanding,
  SourceAudit,
  SourceSnapshot,
  StudioDb,
  VersionedEntity,
  VersionLink,
} from "./types.ts";

function fail<T>(db: StudioDb, code: string, error: string): Op<T> {
  return { ok: false, db, code, error };
}

function stamp(now?: string): string {
  return now ?? new Date().toISOString();
}

function isThunder(db: StudioDb, episodeId: string): boolean {
  const episode = db.episodes.find((item) => item.id === episodeId);
  if (!episode) return false;
  return latestSnapshot(episode).snapshot.title === "Count the Thunder";
}

function auditSource(
  db: StudioDb,
  at: string,
  actor: Actor,
  eventType: string,
  entityType: string,
  entityId: string,
  previousState: string,
  newState: string,
  reason: string,
  related: string[] = [],
): StudioDb {
  const ided = allocId(db, "srcaud");
  const row: SourceAudit = {
    id: ided.id,
    at,
    eventType,
    entityType,
    entityId,
    actorType: actor.type,
    actorId: actor.id,
    previousState,
    newState,
    reason,
    relatedEntityIds: related,
  };
  const logged = allocId(ided.db, "aud");
  return {
    ...logged.db,
    sourceAudits: [...(logged.db.sourceAudits ?? []), row],
    audit: [
      ...logged.db.audit,
      {
        id: logged.id,
        at,
        actorType: actor.type,
        actorId: actor.id,
        action: eventType,
        entityType,
        entityId,
        detail: `${previousState} → ${newState}. ${reason}`,
      },
    ],
  };
}

function snapshotRow(db: StudioDb, at: string, kind: SourceSnapshot["kind"], episodeId: string | null, storyId: string | null, pins: ArtifactPin[], note: string): StudioDb {
  const ided = allocId(db, "srcsnap");
  const row: SourceSnapshot = { id: ided.id, at, kind, episodeId, storyId, pins, note };
  return { ...ided.db, sourceSnapshots: [...(ided.db.sourceSnapshots ?? []), row] };
}

export function rightsAreCleared(status: RightsStanding | string | null | undefined): boolean {
  return status === "CLEARED";
}

export interface IdentityRow {
  entityType: string;
  id: string;
  label: string;
  status: string;
  version: number | null;
}

export interface SourceCatalog {
  studio: IdentityRow | null;
  brand: IdentityRow | null;
  universe: IdentityRow | null;
  world: IdentityRow | null;
  characters: IdentityRow[];
  locations: IdentityRow[];
  proposals: IdentityRow[];
  markets: string[];
  languages: string[];
  note: string;
}

function rowOf(entityType: string, id: string, label: string, status: string, version: number | null): IdentityRow {
  return { entityType, id, label, status, version };
}

export function sourceCatalog(db: StudioDb): SourceCatalog {
  const brand = db.brand ? canonicalOf(db.brand) ?? latestSnapshot(db.brand) : null;
  const universe = db.universe ? canonicalOf(db.universe) ?? latestSnapshot(db.universe) : null;
  const world = db.world ? canonicalOf(db.world) ?? latestSnapshot(db.world) : null;
  const primary = (db.locationLibrary ?? []).find((item) => item.key === PRIMARY_WORLD_KEY);
  return {
    studio: db.studio ? rowOf("studio", db.studio.id, db.studio.name, "ACTIVE", null) : null,
    brand: db.brand && brand ? rowOf("brand", db.brand.id, brand.snapshot.name, brand.status, brand.version) : null,
    universe: db.universe && universe ? rowOf("universe", db.universe.id, universe.snapshot.name, universe.status, universe.version) : null,
    world: db.world && world ? rowOf("world", db.world.id, world.snapshot.name, primary?.status ?? "LOCKED", world.version) : null,
    characters: db.characters.map((character) => {
      const version = canonicalOf(character) ?? latestSnapshot(character);
      return rowOf("character", character.id, version.snapshot.name, version.status, version.version);
    }),
    locations: db.locations.map((location) => {
      const version = canonicalOf(location) ?? latestSnapshot(location);
      return rowOf("location", location.id, version.snapshot.name, version.status, version.version);
    }),
    proposals: (db.locationLibrary ?? [])
      .filter((item) => item.status === "PROPOSED")
      .map((item) => rowOf("location-proposal", item.id, item.name, item.status, null)),
    markets: db.sourceMarkets?.length ? db.sourceMarkets : ["IN"],
    languages: db.sourceLanguages?.length ? db.sourceLanguages : ["hi"],
    note: "Names are labels. The id is the identity. India and Hindi are the current market and language, not a permanent limit.",
  };
}

export function addMarket(db: StudioDb, code: string, actor: Actor, now?: string): Op<{ markets: string[] }> {
  const at = stamp(now);
  if (actor.type !== "human") return fail(db, "human-required", "Only a human can add a market.");
  const nextCode = code.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(nextCode)) return fail(db, "market", "Use a two-letter market code.");
  const markets = db.sourceMarkets?.length ? db.sourceMarkets : ["IN"];
  if (markets.includes(nextCode)) return { ok: true, db, data: { markets } };
  const next = auditSource({ ...db, sourceMarkets: [...markets, nextCode] }, at, actor, "MARKET_ADDED", "studio", db.studio?.id ?? "studio", markets.join(","), [...markets, nextCode].join(","), `${nextCode} is an additional market. India stays.`);
  return { ok: true, db: next, data: { markets: next.sourceMarkets } };
}

export function branchStoryVersion(
  db: StudioDb,
  storyId: string,
  fromVersion: number,
  logline: string,
  actor: Actor,
  reason: string,
  now?: string,
): Op<{ version: number; supersedesVersion: number }> {
  const at = stamp(now);
  if (actor.type === "system") return fail(db, "permission", "A system process cannot open a story version.");
  if (reason.trim().length < 8) return fail(db, "note", "Write why this version exists.");
  if (logline.trim().length < 8) return fail(db, "note", "Write the new logline. The previous version is not edited in place.");
  const story = db.stories.find((item) => item.id === storyId);
  if (!story) return fail(db, "missing", "Story not found.");
  const from = story.versions.find((item) => item.version === fromVersion);
  if (!from) return fail(db, "missing", "That story version is not on record.");
  const before = JSON.stringify(from.snapshot);
  const snapshot = structuredClone(from.snapshot);
  snapshot.logline = logline.trim();
  const version = story.currentVersion + 1;
  const entity = {
    ...story,
    currentVersion: version,
    canonicalVersion: story.canonicalVersion,
    updatedAt: at,
    versions: [
      ...story.versions,
      { version, status: "draft" as const, snapshot, createdAt: at, createdBy: actor.id, note: reason.trim(), immutable: true },
    ],
  };
  const kept = entity.versions.find((item) => item.version === fromVersion);
  if (!kept || JSON.stringify(kept.snapshot) !== before) return fail(db, "history", "The previous story version would have been rewritten. Stopped.");
  const ided = allocId(db, "vlink");
  const link: VersionLink = {
    id: ided.id,
    at,
    entityType: "story",
    entityId: storyId,
    version,
    supersedesVersion: fromVersion,
    status: "DRAFT",
    createdBy: actor.id,
    reason: reason.trim(),
  };
  let next: StudioDb = {
    ...ided.db,
    stories: ided.db.stories.map((item) => (item.id === storyId ? entity : item)),
    versionLinks: [...(ided.db.versionLinks ?? []), link],
    qaRuns: (ided.db.qaRuns ?? []).map((run) =>
      run.storyId === storyId && run.storyVersion !== version && run.overallStatus !== "OUTDATED" ? { ...run, overallStatus: "OUTDATED" as const } : run,
    ),
  };
  next = auditSource(next, at, actor, "STORY_VERSION_CREATED", "story", storyId, `v${fromVersion}`, `v${version}`, reason.trim(), [link.id]);
  return { ok: true, db: next, data: { version, supersedesVersion: fromVersion } };
}

export function pinQaRun(db: StudioDb, storyId: string, storyVersion: number, actor: Actor, now?: string): Op<{ id: string; status: QARun["overallStatus"] }> {
  const at = stamp(now);
  if (actor.type === "agent" && actor.id === "agent_rights") return fail(db, "permission", "Rights review cannot stand in for a QA run.");
  const story = db.stories.find((item) => item.id === storyId);
  const version = story?.versions.find((item) => item.version === storyVersion);
  if (!story || !version) return fail(db, "missing", "QA needs an existing story version.");
  const ided = allocId(db, "qa");
  const run: QARun = {
    id: ided.id,
    at,
    episodeId: null,
    storyId,
    canonVersionId: version.snapshot.canonSnapshotHash ?? version.snapshot.canonVersionUsed ?? null,
    storyVersion,
    scriptId: null,
    scriptVersion: null,
    storyboardId: null,
    storyboardVersion: null,
    planId: null,
    planVersion: null,
    assetVersions: [],
    checkResults: [`Evaluated story ${storyId} version ${storyVersion}. A pass here would still not be human approval.`],
    evaluatedStatus: "HUMAN_REVIEW_REQUIRED",
    overallStatus: "HUMAN_REVIEW_REQUIRED",
    createdBy: actor.id,
  };
  let next = snapshotRow(
    { ...ided.db, qaRuns: [...(ided.db.qaRuns ?? []), run] },
    at,
    "QA",
    null,
    storyId,
    [{ type: "story", id: storyId, version: storyVersion }],
    "QA snapshot. Reuse only while this story version is current.",
  );
  next = auditSource(next, at, actor, "QA_PINNED", "qa_run", run.id, "none", run.overallStatus, `Pinned to story v${storyVersion}.`, [storyId]);
  return { ok: true, db: next, data: { id: run.id, status: run.overallStatus } };
}

export function reuseQa(db: StudioDb, qaRunId: string, storyVersion: number): { ok: boolean; reason: string; run: QARun | null } {
  const run = (db.qaRuns ?? []).find((item) => item.id === qaRunId) ?? null;
  if (!run) return { ok: false, reason: "No QA run.", run: null };
  if (run.overallStatus === "OUTDATED") return { ok: false, reason: "This QA run is outdated and cannot be reused.", run };
  if (run.storyVersion !== storyVersion) return { ok: false, reason: "This QA run evaluated a different story version.", run };
  return { ok: true, reason: "The pin matches this version. A human still has to approve. QA is not approval.", run };
}

export function registerAssetWithUnknownRights(db: StudioDb, name: string, actor: Actor, now?: string): Op<{ assetId: string; rightsId: string; status: RightsStanding }> {
  const at = stamp(now);
  if (actor.type === "agent") return fail(db, "permission", "An agent cannot file a rights record or clear one.");
  if (name.trim().length < 3) return fail(db, "note", "Name the asset.");
  const ided = allocId(db, "asset");
  const body: AssetBody = {
    assetType: "other",
    source: "manual record",
    creator: actor.id,
    model: "none",
    provider: "manual",
    prompt: "No prompt. This is a rights fixture, not a render.",
    referenceAssets: [],
    licenseStatus: "unknown",
    commercialUseStatus: "not-cleared",
    rightsNotes: "Rights standing is UNKNOWN. Unknown is not cleared.",
    modificationHistory: [],
    linkedEntityType: "asset",
    linkedEntityId: ided.id,
    episodeId: null,
    createdAt: at,
  };
  const asset: VersionedEntity<AssetBody> = {
    id: ided.id,
    type: "asset",
    name: name.trim(),
    currentVersion: 1,
    canonicalVersion: null,
    createdAt: at,
    updatedAt: at,
    versions: [{ version: 1, status: "draft", snapshot: body, createdAt: at, createdBy: actor.id, note: "Version 1. Rights unknown.", immutable: true }],
  };
  const rightsId = allocId({ ...ided.db, assets: [...ided.db.assets, asset] }, "rights");
  const rights: RightsRecord = {
    id: rightsId.id,
    at,
    subjectType: "asset",
    subjectId: asset.id,
    assetId: asset.id,
    assetVersion: 1,
    licenseType: "unset",
    commercialUse: "UNKNOWN",
    territory: "unset",
    restrictions: "Not reviewed.",
    evidenceReference: "",
    status: "UNKNOWN",
    reviewedBy: null,
    reviewedAt: null,
    notes: "UNKNOWN is not CLEARED.",
  };
  const provId = allocId(rightsId.db, "prov");
  const provenance: ProvenanceRecord = {
    id: provId.id,
    at,
    assetId: asset.id,
    assetVersion: 1,
    source: body.source,
    creator: body.creator,
    tool: body.provider,
    model: body.model,
    promptReference: body.prompt,
    sourceLicense: "unknown",
    modificationHistory: [],
    notes: "Provenance recorded. Rights remain UNKNOWN.",
  };
  let next: StudioDb = {
    ...provId.db,
    rightsRecords: [...(provId.db.rightsRecords ?? []), rights],
    provenanceRecords: [...(provId.db.provenanceRecords ?? []), provenance],
  };
  next = auditSource(next, at, actor, "RIGHTS_RECORDED", "asset", asset.id, "none", "UNKNOWN", "A new asset version was filed with unknown rights. It was not cleared.", [rights.id]);
  return { ok: true, db: next, data: { assetId: asset.id, rightsId: rights.id, status: "UNKNOWN" } };
}

export function sourceClearRights(db: StudioDb, rightsId: string, actor: Actor, now?: string): Op<never> {
  const at = stamp(now);
  const next = auditSource(db, at, actor, "RIGHTS_CLEAR_DENIED", "rights", rightsId, "UNKNOWN", "UNKNOWN", "Nothing cleared this rights record. UNKNOWN stays UNKNOWN.");
  return fail(next, "rights", "UNKNOWN is not CLEARED. This layer cannot clear a rights flag.");
}

export function recordHumanApproval(
  db: StudioDb,
  input: { episodeId: string | null; subjectType: string; subjectId: string; pins: ArtifactPin[]; decision: HumanApprovalRecord["decision"]; notes: string; qaRunId?: string | null },
  actor: Actor,
  now?: string,
): Op<{ id: string }> {
  const at = stamp(now);
  if (actor.type !== "human") return fail(db, "human-required", "Only a human approval record can approve. An agent review cannot.");
  if (input.notes.trim().length < 8) return fail(db, "note", "Write the approval note.");
  if (!input.pins.length || input.pins.some((pin) => !pin.id || pin.version == null)) return fail(db, "version", "Name each artifact id and version. Approval is not a blank yes.");
  const ided = allocId(db, "hapr");
  const row: HumanApprovalRecord = {
    id: ided.id,
    at,
    episodeId: input.episodeId,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    approvedArtifactVersions: input.pins,
    decision: input.decision,
    reviewerId: actor.id,
    reviewerName: actor.name,
    notes: input.notes.trim(),
    qaRunId: input.qaRunId ?? null,
  };
  let next = snapshotRow(
    { ...ided.db, humanApprovals: [...(ided.db.humanApprovals ?? []), row] },
    at,
    "HUMAN_APPROVAL",
    input.episodeId,
    input.subjectType === "story" ? input.subjectId : null,
    input.pins,
    "Human approval snapshot. QA was not treated as this decision.",
  );
  next = auditSource(next, at, actor, "HUMAN_APPROVAL_RECORDED", input.subjectType, input.subjectId, "pending", input.decision, input.notes.trim(), input.pins.map((pin) => `${pin.type}:${pin.id}@${pin.version}`));
  return { ok: true, db: next, data: { id: row.id } };
}

export function approveBecauseQaPassed(db: StudioDb, qaRunId: string, actor: Actor, now?: string): Op<never> {
  const at = stamp(now);
  const next = auditSource(db, at, actor, "APPROVAL_INFERENCE_DENIED", "qa_run", qaRunId, "QA", "not approved", "A QA result was not turned into human approval.");
  return fail(next, "human-required", "A QA pass means eligible for a human. It is not approval.");
}

export function registerPublication(
  db: StudioDb,
  input: { episodeId: string; title: string; contentVersionReference: string; platform?: string },
  actor: Actor,
  now?: string,
): Op<{ id: string; status: PublicationRecord["status"] }> {
  const at = stamp(now);
  if (actor.type !== "human") return fail(db, "human-required", "Only a human can file a publication record, and publishing stays off for studio episodes.");
  if (isThunder(db, input.episodeId) || input.title.trim().toLowerCase() === "count the thunder") {
    return fail(db, "unpublished", "Count the Thunder has no publication. None is created.");
  }
  if (db.episodes.some((item) => item.id === input.episodeId)) {
    return fail(db, "publish-disabled", "Publishing is disabled. A studio episode does not receive a publication record.");
  }
  if (input.contentVersionReference.trim().length < 3) return fail(db, "version", "Name the content version this publication would refer to.");
  const stages = db.episodes.map((item) => latestSnapshot(item).snapshot.stage);
  const ided = allocId(db, "pub");
  const row: PublicationRecord = {
    id: ided.id,
    at,
    episodeId: input.episodeId,
    platform: input.platform ?? "youtube",
    channel: "not-connected",
    language: "hi",
    title: input.title.trim(),
    description: "Model record only. Nothing was uploaded.",
    thumbnailAssetVersionId: null,
    publishedAt: null,
    externalReference: null,
    status: "PUBLISHED",
    contentVersionReference: input.contentVersionReference.trim(),
  };
  let next = snapshotRow(
    { ...ided.db, publications: [...(ided.db.publications ?? []), row] },
    at,
    "PUBLICATION",
    null,
    null,
    [{ type: "content", id: input.episodeId, version: null }],
    row.contentVersionReference,
  );
  next = auditSource(next, at, actor, "PUBLICATION_RECORDED", "publication", row.id, "NOT_PUBLISHED", "PUBLISHED", "Recorded for a non-studio fixture. No episode stage changed and nothing was uploaded.");
  const after = next.episodes.map((item) => latestSnapshot(item).snapshot.stage);
  if (after.join() !== stages.join()) return fail(db, "publish-disabled", "Publication tried to move an episode. Rolled back.");
  return { ok: true, db: next, data: { id: row.id, status: row.status } };
}

export function importPerformance(
  db: StudioDb,
  input: { publicationId: string; episodeId: string; metric: string; value: number | null; contentVersionReference: string; period?: string },
  actor: Actor,
  now?: string,
): Op<{ id: string; value: number | null }> {
  const at = stamp(now);
  if (actor.type === "agent") return fail(db, "permission", "An agent cannot invent a performance record.");
  if (isThunder(db, input.episodeId)) return fail(db, "not-available", "Count the Thunder is unpublished. No performance record is stored.");
  const publication = (db.publications ?? []).find((item) => item.id === input.publicationId);
  if (!publication) return fail(db, "missing", "Performance needs a publication. Missing data is not stored as zero.");
  if (publication.episodeId !== input.episodeId) return fail(db, "mismatch", "The publication belongs to a different episode.");
  if (publication.status !== "PUBLISHED") return fail(db, "unpublished", "Only a published record can carry performance. This one is not published.");
  if (input.contentVersionReference.trim() !== publication.contentVersionReference) {
    return fail(db, "version", "Performance must name the same content version as the publication.");
  }
  const value = typeof input.value === "number" && Number.isFinite(input.value) ? input.value : null;
  const ided = allocId(db, "perfrec");
  const row: PerformanceRecord = {
    id: ided.id,
    at,
    publicationId: publication.id,
    episodeId: input.episodeId,
    contentVersionReference: publication.contentVersionReference,
    metric: input.metric.trim() || "retention",
    value,
    measurementPeriod: input.period ?? "unspecified",
    source: "manual record",
    dataQualityStatus: value == null ? "UNKNOWN" : "OBSERVED",
  };
  const next = auditSource(
    { ...ided.db, performanceRecords: [...(ided.db.performanceRecords ?? []), row] },
    at,
    actor,
    "PERFORMANCE_RECORDED",
    "performance",
    row.id,
    "none",
    value == null ? "UNKNOWN" : String(value),
    `Tied to publication ${publication.id} and ${publication.contentVersionReference}.`,
    [publication.id],
  );
  return { ok: true, db: next, data: { id: row.id, value: row.value } };
}

export function fileAlpineProposal(db: StudioDb, actor: Actor, now?: string): Op<{ proposalId: string; status: "PROPOSED" }> {
  const at = stamp(now);
  if (actor.type === "agent") return fail(db, "permission", "An agent cannot file a location into the source of truth.");
  if ((db.locations ?? []).some((item) => latestSnapshot(item).snapshot.key === ALPINE_KEY)) {
    return fail(db, "canon", "Alpine is already a canon location. This path does not approve one.");
  }
  let next = db;
  let libraryId = (next.locationLibrary ?? []).find((item) => item.key === ALPINE_KEY)?.id ?? null;
  if (!libraryId) {
    const ided = allocId(next, "loclib");
    const entry: LocationStrategy = {
      id: ided.id,
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
    next = { ...ided.db, locationLibrary: [...(ided.db.locationLibrary ?? []), entry] };
    libraryId = entry.id;
  }
  const existing = (next.locationProposals ?? []).find((item) => item.key === ALPINE_KEY && item.status === "PROPOSED");
  if (existing) {
    return { ok: true, db: next, data: { proposalId: existing.id, status: "PROPOSED" } };
  }
  const ided = allocId(next, "locprop");
  const proposal: LocationProposal = {
    id: ided.id,
    at,
    episodeId: null,
    key: ALPINE_KEY,
    name: "Fictional Alpine range",
    nameHi: "काल्पनिक पहाड़",
    description: "Fictional Alpine-inspired place. Not canon.",
    reason: "Proposal only. The brain cannot turn this into a production location.",
    status: "PROPOSED",
  };
  next = auditSource(
    { ...ided.db, locationProposals: [...(ided.db.locationProposals ?? []), proposal] },
    at,
    actor,
    "LOCATION_PROPOSED",
    "location_proposal",
    proposal.id,
    "none",
    "PROPOSED",
    "The Alpine range is a proposal. It is not a canon location, a story setting, or a production asset.",
    [libraryId],
  );
  return { ok: true, db: next, data: { proposalId: proposal.id, status: "PROPOSED" } };
}

export function locationUsableForProduction(db: StudioDb, key: string): { usable: boolean; status: string; reason: string } {
  if (key === ALPINE_KEY) {
    const entry = (db.locationLibrary ?? []).find((item) => item.key === key);
    const canon = db.locations.some((item) => latestSnapshot(item).snapshot.key === key);
    if (!entry || entry.status === "PROPOSED" || !canon) {
      return { usable: false, status: entry?.status ?? "PROPOSED", reason: "A proposed place is not usable as production canon." };
    }
  }
  const entry = (db.locationLibrary ?? []).find((item) => item.key === key);
  if (entry?.status === "PROPOSED" || entry?.status === "RETIRED") {
    return { usable: false, status: entry.status, reason: "This place is not approved for production." };
  }
  return { usable: true, status: entry?.status ?? "CANON", reason: "Usable only if it is already canon. A proposal is not." };
}

export function sourceApproveLocation(db: StudioDb, proposalId: string, actor: Actor, now?: string): Op<never> {
  const at = stamp(now);
  const next = auditSource(db, at, actor, "LOCATION_APPROVAL_DENIED", "location_proposal", proposalId, "PROPOSED", "PROPOSED", "The source layer does not approve a proposal into canon.");
  return fail(next, "human-required", "A proposal stays a proposal here. Canon approval is a separate human step.");
}

export function recordPattern(
  db: StudioDb,
  input: Omit<AnalyticsPatternRecord, "id" | "at" | "updatedAt">,
  actor: Actor,
  now?: string,
): Op<{ id: string }> {
  const at = stamp(now);
  if (actor.type === "agent") return fail(db, "permission", "An agent cannot confirm a pattern.");
  const ided = allocId(db, "pat");
  const row: AnalyticsPatternRecord = { ...input, id: ided.id, at, updatedAt: at };
  const next = { ...ided.db, analyticsPatterns: [...(ided.db.analyticsPatterns ?? []), row] };
  return { ok: true, db: next, data: { id: row.id } };
}

export interface EpisodeTrace {
  episodeId: string;
  title: string;
  stage: string;
  story: { id: string; version: number; title: string; readable: boolean; supersededBy: number | null } | null;
  canon: { id: string; version: string; hash: string } | null;
  script: { id: string; version: number; sceneCount: number } | null;
  storyboard: { id: string; version: number; scriptId: string; scriptVersion: number } | null;
  plan: { id: string; version: number } | null;
  scenes: Array<{ id: string; sceneNo: number; locationKey: string; characterIds: string[] }>;
  shots: Array<{ id: string; sceneNo: number; shotNo: number }>;
  assets: Array<{ id: string; version: number; rights: RightsStanding; provenanceId: string | null }>;
  reviews: Array<{ id: string; type: string; result: string; version: number; redFlag: boolean }>;
  qa: Array<{ id: string; status: string; evaluatedStatus: string; storyVersion: number | null }>;
  approvals: Array<{ id: string; decision: string; versions: string[] }>;
  publications: Array<{ id: string; status: string; contentVersionReference: string }>;
  performance: Array<{ id: string; metric: string; value: number | null; publicationId: string; contentVersionReference: string }>;
  brain: Array<{ id: string; title: string; recommendation: string; decision: string | null }>;
}

function standingForAsset(db: StudioDb, assetId: string, version: number, commercial: string): RightsStanding {
  const record = (db.rightsRecords ?? []).find((item) => item.assetId === assetId && item.assetVersion === version);
  if (record) return record.status;
  if (commercial === "cleared") return "CLEARED";
  return "UNKNOWN";
}

export function traceEpisode(db: StudioDb, episodeId: string): EpisodeTrace | null {
  const episode = db.episodes.find((item) => item.id === episodeId);
  if (!episode) return null;
  const snap = latestSnapshot(episode).snapshot;
  const story = db.stories.find((item) => item.id === snap.storyId);
  const storyVersion = story?.versions.find((item) => item.version === snap.storyVersion) ?? null;
  const later = (db.versionLinks ?? []).find((item) => item.entityType === "story" && item.entityId === snap.storyId && item.supersedesVersion === snap.storyVersion);
  const canon = db.canonSnapshots.find((item) => item.hash === snap.canonSnapshotHash) ?? null;
  const script = snap.scriptId ? db.scripts.find((item) => item.id === snap.scriptId) : undefined;
  const scriptVersion = script?.versions.find((item) => item.version === (snap.scriptVersion ?? script.currentVersion)) ?? (script ? latestSnapshot(script) : null);
  const board = snap.storyboardId ? db.storyboards.find((item) => item.id === snap.storyboardId) : undefined;
  const boardVersion = board ? latestSnapshot(board) : null;
  const plan = snap.planId ? db.plans.find((item) => item.id === snap.planId) : undefined;
  const planVersion = plan ? latestSnapshot(plan) : null;
  const scenes = (scriptVersion?.snapshot.scenes ?? []).map((scene) => ({
    id: scene.sceneId ?? `${script?.id ?? "script"}:scene:${scene.sceneNo}`,
    sceneNo: scene.sceneNo,
    locationKey: scene.locationKey,
    characterIds: scene.characterIds,
  }));
  const shots = (boardVersion?.snapshot.scenes ?? []).flatMap((scene) =>
    scene.shots.map((shot) => ({ id: shot.id, sceneNo: scene.sceneNo, shotNo: shot.shotNo })),
  );
  const assets = db.assets
    .filter((asset) => {
      const body = latestSnapshot(asset).snapshot;
      return body.episodeId === episode.id || body.linkedEntityId === snap.scriptId || body.linkedEntityId === snap.storyboardId || body.linkedEntityId === snap.planId;
    })
    .map((asset) => {
      const version = latestSnapshot(asset);
      const provenance = (db.provenanceRecords ?? []).find((item) => item.assetId === asset.id && item.assetVersion === version.version);
      return {
        id: asset.id,
        version: version.version,
        rights: standingForAsset(db, asset.id, version.version, version.snapshot.commercialUseStatus),
        provenanceId: provenance?.id ?? null,
      };
    });
  return {
    episodeId: episode.id,
    title: snap.title,
    stage: snap.stage,
    story: story && storyVersion ? { id: story.id, version: storyVersion.version, title: storyVersion.snapshot.title, readable: true, supersededBy: later?.version ?? null } : null,
    canon: canon ? { id: canon.id, version: canon.canonVersion, hash: canon.hash } : snap.canonVersionUsed ? { id: snap.canonSnapshotHash ?? "unstamped", version: snap.canonVersionUsed, hash: snap.canonSnapshotHash ?? "" } : null,
    script: script && scriptVersion ? { id: script.id, version: scriptVersion.version, sceneCount: scriptVersion.snapshot.scenes.length } : null,
    storyboard: board && boardVersion ? { id: board.id, version: boardVersion.version, scriptId: boardVersion.snapshot.scriptId, scriptVersion: boardVersion.snapshot.scriptVersion } : null,
    plan: plan && planVersion ? { id: plan.id, version: planVersion.version } : null,
    scenes,
    shots,
    assets,
    reviews: db.qualityReviews
      .filter((review) => review.entityId === episode.id || review.entityId === snap.scriptId || review.entityId === snap.storyboardId)
      .map((review) => ({ id: review.id, type: review.gate, result: review.result, version: review.version, redFlag: review.redFlag })),
    qa: (db.qaRuns ?? []).filter((run) => run.episodeId === episode.id || run.storyId === snap.storyId).map((run) => ({ id: run.id, status: run.overallStatus, evaluatedStatus: run.evaluatedStatus, storyVersion: run.storyVersion })),
    approvals: (db.humanApprovals ?? [])
      .filter((item) => item.episodeId === episode.id || item.subjectId === snap.storyId)
      .map((item) => ({ id: item.id, decision: item.decision, versions: item.approvedArtifactVersions.map((pin) => `${pin.type}:${pin.id}@${pin.version}`) })),
    publications: (db.publications ?? []).filter((item) => item.episodeId === episode.id).map((item) => ({ id: item.id, status: item.status, contentVersionReference: item.contentVersionReference })),
    performance: (db.performanceRecords ?? [])
      .filter((item) => item.episodeId === episode.id)
      .map((item) => ({ id: item.id, metric: item.metric, value: item.value, publicationId: item.publicationId, contentVersionReference: item.contentVersionReference })),
    brain: (db.brainRecommendations ?? [])
      .filter((item) => item.fingerprint.includes(episode.id) || item.evidence.some((line) => line.includes(episode.id) || line.includes(snap.title)))
      .map((item) => ({
        id: item.id,
        title: item.title,
        recommendation: item.rationale,
        decision: item.humanDecision ? `${item.humanDecision.decision}: ${item.humanDecision.note}` : null,
      })),
  };
}

export function sourcePublish(db: StudioDb, episodeId: string, actor: Actor, now?: string): Op<never> {
  const at = stamp(now);
  const next = auditSource(db, at, actor, "PUBLISH_DENIED", "episode", episodeId, "unpublished", "unpublished", "The source of truth does not publish.");
  return fail(next, "publish-disabled", "Publishing is disabled.");
}
