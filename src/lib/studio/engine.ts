import { agentCan, getAgent } from "./agents.ts";
import { BLUEPRINTS, THIN_BLUEPRINT, blueprintByKey, type StoryBlueprint } from "./blueprints.ts";
import {
  changedCanonFields,
  draftCanonSnapshot,
  impactOfCharacter,
  patchCharacterField,
  validateSubject,
  HARD_FIELDS,
  type CanonSubject,
} from "./canon.ts";
import { canTransition } from "./machine.ts";
import {
  anchorsFromStory,
  productionRequests,
  sceneBreakdown,
  validateAgeSuitability,
  validateBoardConsistency,
  validateStoryConsistency,
} from "./production.ts";
import {
  analyzeVariation,
  backfillStoryBody,
  bestSimilarity,
  canonResultFor,
  disguiseDna,
  foldedArcUsed,
  foldedMotifUsed,
  loadStoryGenerationContext,
  makeFingerprint,
  recommendationFor,
  scoreOriginality,
  type CorpusEntry,
  type VariationReport,
} from "./intelligence.ts";
import type {
  Actor,
  AgeBand,
  AnalyticsConfig,
  ApprovalRecord,
  AssetBody,
  AuditEvent,
  BrandBody,
  CharacterBody,
  EpisodeBody,
  EpisodeStage,
  GateCheck,
  LocationBody,
  Op,
  OpErr,
  PlatformRules,
  ProductionPlanBody,
  QualityReview,
  ScriptBody,
  ScriptScene,
  StoryBody,
  StoryDna,
  StoryRulesBody,
  StoryboardBody,
  Studio,
  StudioDb,
  StudioSettings,
  UniverseBody,
  VersionedEntity,
  VisualClaims,
  WorldBody,
  CanonSnapshot,
  AiExecution,
  DomainEvent,
  FeatureFlags,
  IdempotencyRecord,
  ObjectRecord,
  OpsLog,
  PromptVersion,
  ProviderBindings,
  ProviderHold,
  RoleBinding,
  StudioJob,
} from "./types.ts";

export const DEV_PROVIDER_ID = "development";
export const DEV_MODEL = "dev-template-v1";
export const DEV_DISCLOSURE =
  "Development draft. Templated from canon by the development provider. Not a live model. Not cleared for commercial use.";

const DEFAULT_PLATFORM: PlatformRules = {
  source: "YouTube Help — configurable, not a permanent rule",
  lastReviewed: "2026-10-01",
  note: "Thresholds change. This build does not publish and does not treat these numbers as a guarantee of monetization.",
  yppSubscribers: 1000,
  yppWatchHours: 4000,
  yppShortsViews90d: 10_000_000,
  madeForKids: true,
};

export function freshAnalyticsConfig(): AnalyticsConfig {
  return {
    baselineDefinitionVersion: 1,
    baselineMethod: "median",
    privacy: "aggregated-platform-only",
    liveYouTube: false,
    lengthBuckets: [
      { key: "under-2", label: "Under 2 minutes", minSeconds: 0, maxSeconds: 120 },
      { key: "2-5", label: "2–5 minutes", minSeconds: 120, maxSeconds: 300 },
      { key: "5-10", label: "5–10 minutes", minSeconds: 300, maxSeconds: 600 },
      { key: "10-plus", label: "10+ minutes", minSeconds: 600, maxSeconds: null },
    ],
  };
}

export function architectureDefaults(): {
  providerBindings: ProviderBindings;
  providerHolds: ProviderHold[];
  aiExecutions: AiExecution[];
  jobs: StudioJob[];
  idempotencyKeys: IdempotencyRecord[];
  objectRecords: ObjectRecord[];
  promptVersions: PromptVersion[];
  roleBindings: RoleBinding[];
  featureFlags: FeatureFlags;
  domainEvents: DomainEvent[];
  opsLogs: OpsLog[];
} {
  return {
    providerBindings: {
      LLM: DEV_PROVIDER_ID,
      IMAGE: "",
      VIDEO: "",
      VOICE: "",
      MUSIC: "",
      EMBEDDING: "",
      MODERATION: "",
    },
    providerHolds: [],
    aiExecutions: [],
    jobs: [],
    idempotencyKeys: [],
    objectRecords: [],
    promptVersions: [],
    roleBindings: [],
    featureFlags: {
      publishing: false,
      youtube: false,
      autonomousExecution: false,
      experimentalWorkflow: false,
    },
    domainEvents: [],
    opsLogs: [],
  };
}

export function createEmptyDb(): StudioDb {
  return {
    schemaVersion: 10,
    seq: 0,
    studio: null,
    brand: null,
    universe: null,
    world: null,
    locations: [],
    characters: [],
    relationships: [],
    storyRules: null,
    stories: [],
    episodes: [],
    scripts: [],
    storyboards: [],
    plans: [],
    assets: [],
    agentRuns: [],
    approvals: [],
    qualityReviews: [],
    audit: [],
    settings: { originalityThreshold: 75, similarityBlock: 55, textProviderId: DEV_PROVIDER_ID },
    canonSnapshots: [],
    canonValidations: [],
    canonChanges: [],
    generationRuns: [],
    productionRevisions: [],
    locationProposals: [],
    agentTasks: [],
    orchestrationRuns: [],
    agentRevisions: [],
    storyRevisionRequests: [],
    releaseChecks: [],
    releaseReports: [],
    releaseRepairs: [],
    brainAutonomy: 2,
    locationLibrary: [],
    brainRecommendations: [],
    brainOpportunities: [],
    brainDecisions: [],
    brainMemory: { rejected: [], accepted: [], outcomes: [] },
    performanceSignals: [],
    analyticsConfig: freshAnalyticsConfig(),
    analyticsObservations: [],
    analyticsBaselines: [],
    analyticsComparisons: [],
    analyticsInterpretations: [],
    analyticsCorrections: [],
    analyticsExperiments: [],
    analyticsAnomalies: [],
    analyticsLessons: [],
    analyticsQuality: [],
    analyticsPackets: [],
    sourceMarkets: ["IN"],
    sourceLanguages: ["hi"],
    versionLinks: [],
    rightsRecords: [],
    provenanceRecords: [],
    qaRuns: [],
    humanApprovals: [],
    publications: [],
    performanceRecords: [],
    analyticsPatterns: [],
    sourceSnapshots: [],
    sourceAudits: [],
    ...architectureDefaults(),
    editorialReviews: [],
  };
}

function withId(db: StudioDb, prefix: string): { db: StudioDb; id: string } {
  const seq = db.seq + 1;
  return { db: { ...db, seq }, id: `${prefix}_${seq.toString(36)}` };
}

export function allocId(db: StudioDb, prefix: string): { db: StudioDb; id: string } {
  return withId(db, prefix);
}

export function fingerprint(value: unknown): string {
  const s = JSON.stringify(value);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = Math.imul(h, 33) ^ s.charCodeAt(i);
  return (h >>> 0).toString(16);
}

function stamp(now?: string): string {
  return now ?? new Date().toISOString();
}

function ensureSnapshot(db: StudioDb, at: string, purpose: string): { db: StudioDb; snapshot: CanonSnapshot } {
  const draft = draftCanonSnapshot(db, purpose);
  const existing = db.canonSnapshots.find((item) => item.hash === draft.hash);
  if (existing) return { db, snapshot: existing };
  const ided = withId(db, "snap");
  const snapshot: CanonSnapshot = { ...draft, id: ided.id, createdAt: at };
  return { db: { ...ided.db, canonSnapshots: [...ided.db.canonSnapshots, snapshot] }, snapshot };
}

function bindCanon<T extends { canonVersionUsed?: string; canonSnapshotHash?: string; generationRunId?: string }>(
  db: StudioDb,
  body: T,
  purpose: string,
  at: string,
): { db: StudioDb; body: T; snapshot: CanonSnapshot; runId: string } {
  const ensured = ensureSnapshot(db, at, purpose);
  const run = withId(ensured.db, "gen");
  return {
    db: run.db,
    snapshot: ensured.snapshot,
    runId: run.id,
    body: {
      ...body,
      canonVersionUsed: ensured.snapshot.canonVersion,
      canonSnapshotHash: ensured.snapshot.hash,
      generationRunId: run.id,
    },
  };
}

function commitRun(
  db: StudioDb,
  runId: string,
  at: string,
  purpose: string,
  entityType: string,
  entityId: string,
  snapshot: CanonSnapshot,
  validationId?: string,
): StudioDb {
  return {
    ...db,
    generationRuns: [
      ...db.generationRuns,
      {
        id: runId,
        at,
        purpose,
        entityType,
        entityId,
        snapshotId: snapshot.id,
        canonVersion: snapshot.canonVersion,
        snapshotHash: snapshot.hash,
        providerId: DEV_PROVIDER_ID,
        ...(validationId ? { validationId } : {}),
      },
    ],
  };
}

function commitValidation(
  db: StudioDb,
  at: string,
  entityType: string,
  entityId: string,
  version: number,
  subject: CanonSubject,
  snapshot: CanonSnapshot,
): { db: StudioDb; id: string; validation: ReturnType<typeof validateSubject> } {
  const validation = validateSubject(db, subject, snapshot);
  const ided = withId(db, "cv");
  return {
    db: {
      ...ided.db,
      canonValidations: [
        ...ided.db.canonValidations,
        { id: ided.id, at, entityType, entityId, version, validation: { ...validation, snapshotId: snapshot.id } },
      ],
    },
    id: ided.id,
    validation,
  };
}

export function migrateStudioDb(input: Partial<StudioDb> | null | undefined): StudioDb {
  const empty = createEmptyDb();
  if (!input || typeof input !== "object") return empty;
  let db: StudioDb = {
    ...empty,
    ...input,
    schemaVersion: 10,
    settings: { ...empty.settings, ...(input.settings ?? {}) },
    locations: input.locations ?? [],
    characters: input.characters ?? [],
    relationships: input.relationships ?? [],
    stories: input.stories ?? [],
    episodes: input.episodes ?? [],
    scripts: input.scripts ?? [],
    storyboards: input.storyboards ?? [],
    plans: input.plans ?? [],
    assets: input.assets ?? [],
    agentRuns: input.agentRuns ?? [],
    approvals: input.approvals ?? [],
    qualityReviews: input.qualityReviews ?? [],
    audit: input.audit ?? [],
    canonSnapshots: input.canonSnapshots ?? [],
    canonValidations: input.canonValidations ?? [],
    canonChanges: input.canonChanges ?? [],
    generationRuns: [...(input.generationRuns ?? [])],
    productionRevisions: input.productionRevisions ?? [],
    locationProposals: input.locationProposals ?? [],
    agentTasks: input.agentTasks ?? [],
    orchestrationRuns: input.orchestrationRuns ?? [],
    agentRevisions: input.agentRevisions ?? [],
    storyRevisionRequests: input.storyRevisionRequests ?? [],
    releaseChecks: input.releaseChecks ?? [],
    releaseReports: input.releaseReports ?? [],
    releaseRepairs: input.releaseRepairs ?? [],
    brainAutonomy: input.brainAutonomy === 0 || input.brainAutonomy === 1 || input.brainAutonomy === 2 || input.brainAutonomy === 3 ? input.brainAutonomy : 2,
    locationLibrary: input.locationLibrary ?? [],
    brainRecommendations: input.brainRecommendations ?? [],
    brainOpportunities: input.brainOpportunities ?? [],
    brainDecisions: input.brainDecisions ?? [],
    brainMemory: {
      rejected: input.brainMemory?.rejected ?? [],
      accepted: input.brainMemory?.accepted ?? [],
      outcomes: input.brainMemory?.outcomes ?? [],
    },
    performanceSignals: input.performanceSignals ?? [],
    analyticsConfig: {
      ...freshAnalyticsConfig(),
      ...(input.analyticsConfig ?? {}),
      lengthBuckets: input.analyticsConfig?.lengthBuckets?.length ? input.analyticsConfig.lengthBuckets : freshAnalyticsConfig().lengthBuckets,
      privacy: "aggregated-platform-only",
      liveYouTube: false,
    },
    analyticsObservations: input.analyticsObservations ?? [],
    analyticsBaselines: input.analyticsBaselines ?? [],
    analyticsComparisons: input.analyticsComparisons ?? [],
    analyticsInterpretations: input.analyticsInterpretations ?? [],
    analyticsCorrections: input.analyticsCorrections ?? [],
    analyticsExperiments: input.analyticsExperiments ?? [],
    analyticsAnomalies: input.analyticsAnomalies ?? [],
    analyticsLessons: input.analyticsLessons ?? [],
    analyticsQuality: input.analyticsQuality ?? [],
    analyticsPackets: input.analyticsPackets ?? [],
    sourceMarkets: input.sourceMarkets?.length ? input.sourceMarkets : ["IN"],
    sourceLanguages: input.sourceLanguages?.length ? input.sourceLanguages : ["hi"],
    versionLinks: input.versionLinks ?? [],
    rightsRecords: input.rightsRecords ?? [],
    provenanceRecords: input.provenanceRecords ?? [],
    qaRuns: input.qaRuns ?? [],
    humanApprovals: input.humanApprovals ?? [],
    publications: input.publications ?? [],
    performanceRecords: input.performanceRecords ?? [],
    analyticsPatterns: input.analyticsPatterns ?? [],
    sourceSnapshots: input.sourceSnapshots ?? [],
    sourceAudits: input.sourceAudits ?? [],
    providerBindings: {
      ...architectureDefaults().providerBindings,
      ...(input.providerBindings ?? {}),
      LLM: input.providerBindings?.LLM || input.settings?.textProviderId || DEV_PROVIDER_ID,
    },
    providerHolds: (input.providerHolds ?? []).filter((hold) => hold.availability === "UNAVAILABLE"),
    aiExecutions: input.aiExecutions ?? [],
    jobs: input.jobs ?? [],
    idempotencyKeys: input.idempotencyKeys ?? [],
    objectRecords: (input.objectRecords ?? []).map((row) => {
      const clean = { ...row } as ObjectRecord & { bytes?: unknown };
      delete clean.bytes;
      return clean;
    }),
    promptVersions: input.promptVersions ?? [],
    roleBindings: input.roleBindings ?? [],
    featureFlags: {
      ...architectureDefaults().featureFlags,
      ...(input.featureFlags ?? {}),
      publishing: false,
      youtube: false,
      autonomousExecution: false,
    },
    domainEvents: input.domainEvents ?? [],
    opsLogs: input.opsLogs ?? [],
    editorialReviews: input.editorialReviews ?? [],
  };
  if (!db.studio) return db;
  const at = db.studio.updatedAt || db.studio.createdAt;
  const ensured = ensureSnapshot(db, at, db.canonSnapshots.length ? "active" : "migration");
  db = ensured.db;
  const link = (entityType: string, entityId: string) => {
    if (db.generationRuns.some((run) => run.entityType === entityType && run.entityId === entityId)) return;
    const ided = withId(db, "gen");
    db = {
      ...ided.db,
      generationRuns: [
        ...ided.db.generationRuns,
        {
          id: ided.id,
          at,
          purpose: "migration",
          entityType,
          entityId,
          snapshotId: ensured.snapshot.id,
          canonVersion: ensured.snapshot.canonVersion,
          snapshotHash: ensured.snapshot.hash,
          providerId: DEV_PROVIDER_ID,
        },
      ],
    };
  };
  for (const episode of db.episodes) {
    const snap = episode.versions[episode.versions.length - 1]?.snapshot;
    if (snap && !snap.canonVersionUsed) link("episode", episode.id);
  }
  for (const story of db.stories) {
    const snap = story.versions[story.versions.length - 1]?.snapshot;
    if (snap && !snap.canonVersionUsed) link("story", story.id);
  }
  for (const script of db.scripts) {
    const snap = script.versions[script.versions.length - 1]?.snapshot;
    if (snap && !snap.canonVersionUsed) link("script", script.id);
  }
  for (const board of db.storyboards) {
    const snap = board.versions[board.versions.length - 1]?.snapshot;
    if (snap && !snap.canonVersionUsed) link("storyboard", board.id);
  }
  for (const plan of db.plans) {
    const snap = plan.versions[plan.versions.length - 1]?.snapshot;
    if (snap && !snap.canonVersionUsed) link("production_plan", plan.id);
  }
  db = {
    ...db,
    stories: db.stories.map((story) => ({
      ...story,
      versions: story.versions.map((version) => ({
        ...version,
        snapshot: backfillStoryBody(version.snapshot, canonResultFor(db, "story", story.id, version.version)),
      })),
    })),
  };
  return db;
}

function audit(
  db: StudioDb,
  at: string,
  actor: Actor,
  action: string,
  entityType: string,
  entityId: string,
  detail: string,
  version?: number,
): StudioDb {
  const next = withId(db, "aud");
  const event: AuditEvent = {
    id: next.id,
    at,
    actorType: actor.type,
    actorId: actor.id,
    action,
    entityType,
    entityId,
    detail,
    ...(version === undefined ? {} : { version }),
  };
  return { ...next.db, audit: [...next.db.audit, event] };
}

function fail<T>(db: StudioDb, code: string, error: string): Op<T> {
  return { ok: false, db, code, error };
}

function latest<T>(entity: VersionedEntity<T>) {
  return entity.versions[entity.versions.length - 1];
}

export function canonicalOf<T>(entity: VersionedEntity<T> | null | undefined) {
  if (!entity || entity.canonicalVersion == null) return null;
  return entity.versions.find((v) => v.version === entity.canonicalVersion) ?? null;
}

export function snapshotOf<T>(entity: VersionedEntity<T> | null | undefined): T | null {
  const v = canonicalOf(entity);
  return v ? v.snapshot : null;
}

function pushVersion<T>(
  db: StudioDb,
  entity: VersionedEntity<T>,
  snapshot: T,
  status: VersionedEntity<T>["versions"][number]["status"],
  actor: Actor,
  note: string,
  at: string,
): { db: StudioDb; entity: VersionedEntity<T> } {
  const version = entity.currentVersion + 1;
  const next: VersionedEntity<T> = {
    ...entity,
    name: nameOf(snapshot, entity.name),
    currentVersion: version,
    updatedAt: at,
    versions: [
      ...entity.versions,
      { version, status, snapshot, createdAt: at, createdBy: actor.id, note, immutable: true },
    ],
  };
  return { db, entity: next };
}

function nameOf(snapshot: unknown, fallback: string): string {
  if (snapshot && typeof snapshot === "object" && "name" in snapshot) {
    const n = (snapshot as { name?: unknown }).name;
    if (typeof n === "string" && n) return n;
  }
  if (snapshot && typeof snapshot === "object" && "title" in snapshot) {
    const n = (snapshot as { title?: unknown }).title;
    if (typeof n === "string" && n) return n;
  }
  return fallback;
}

function createEntity<T>(
  db: StudioDb,
  prefix: string,
  type: string,
  snapshot: T,
  actor: Actor,
  note: string,
  at: string,
  status: VersionedEntity<T>["versions"][number]["status"],
): { db: StudioDb; entity: VersionedEntity<T> } {
  const ided = withId(db, prefix);
  const entity: VersionedEntity<T> = {
    id: ided.id,
    type,
    name: nameOf(snapshot, type),
    currentVersion: 1,
    canonicalVersion: null,
    createdAt: at,
    updatedAt: at,
    versions: [
      { version: 1, status, snapshot, createdAt: at, createdBy: actor.id, note, immutable: true },
    ],
  };
  return { db: ided.db, entity };
}

function replaceEntity<T>(list: VersionedEntity<T>[], entity: VersionedEntity<T>): VersionedEntity<T>[] {
  return list.map((item) => (item.id === entity.id ? entity : item));
}

function requireHuman(db: StudioDb, actor: Actor): OpErr | null {
  if (actor.type !== "human") {
    return {
      ok: false,
      db,
      code: "human-required",
      error: "Only a human can approve, reject, or change canon. Agents do not approve their own work.",
    };
  }
  return null;
}

function requireAgent(db: StudioDb, agentId: string, action: Parameters<typeof agentCan>[1], at: string):
  | { ok: true; db: StudioDb; agentName: string }
  | { ok: false; db: StudioDb; error: string; code: string } {
  const agent = getAgent(agentId);
  const actor: Actor = { type: "agent", id: agentId, name: agent?.name ?? agentId };
  if (!agent || !agentCan(agent, action)) {
    const next = audit(db, at, actor, "permission.denied", "agent", agentId, `Denied ${action}.`, undefined);
    return { ok: false, db: next, code: "permission", error: `${actor.name} cannot ${action}.` };
  }
  return { ok: true, db, agentName: agent.name };
}

function recordRun(
  db: StudioDb,
  at: string,
  agentId: string,
  action: string,
  status: "completed" | "denied" | "error",
  entityType: string,
  entityId: string,
  note: string,
  fp: string,
): StudioDb {
  const ided = withId(db, "run");
  return {
    ...ided.db,
    agentRuns: [
      ...ided.db.agentRuns,
      {
        id: ided.id,
        at,
        agentId,
        action,
        status,
        entityType,
        entityId,
        fingerprint: fp,
        providerId: DEV_PROVIDER_ID,
        model: DEV_MODEL,
        note,
      },
    ],
  };
}

export function ageBandOrBlock(db: StudioDb): string | null {
  if (!db.studio) return "Create a studio first.";
  if (!db.studio.ageBand) return "Select a target age before any episode production.";
  return null;
}

export function createStudio(
  db: StudioDb,
  input: { name: string; reviewerName: string; positioning?: string },
  actor: Actor,
  now?: string,
): Op<{ studioId: string }> {
  const denied = requireHuman(db, actor);
  if (denied) return denied;
  const at = stamp(now);
  const ided = withId(db, "stu");
  const studio: Studio = {
    id: ided.id,
    name: input.name.trim(),
    market: "IN",
    primaryLanguage: "hi",
    ageBand: null,
    reviewerName: input.reviewerName.trim() || "Studio lead",
    positioning:
      input.positioning?.trim() ||
      "Original Hindi children's stories made with modern production tools. Not an AI cartoon channel.",
    platformRules: DEFAULT_PLATFORM,
    createdAt: at,
    updatedAt: at,
  };
  let next = audit({ ...ided.db, studio }, at, actor, "studio.created", "studio", studio.id, studio.name);
  return { ok: true, db: next, data: { studioId: studio.id } };
}

export function setAgeBand(db: StudioDb, ageBand: AgeBand, actor: Actor, now?: string): Op<{ ageBand: AgeBand }> {
  const denied = requireHuman(db, actor);
  if (denied) return denied;
  if (!db.studio) return fail(db, "no-studio", "Create a studio first.");
  const at = stamp(now);
  const studio = { ...db.studio, ageBand, updatedAt: at };
  const next = audit({ ...db, studio }, at, actor, "studio.age", "studio", studio.id, `Age band set to ${ageBand}.`);
  return { ok: true, db: next, data: { ageBand } };
}

export function updatePlatformRules(
  db: StudioDb,
  patch: Partial<PlatformRules>,
  actor: Actor,
  now?: string,
): Op<PlatformRules> {
  const denied = requireHuman(db, actor);
  if (denied) return denied;
  if (!db.studio) return fail(db, "no-studio", "Create a studio first.");
  const at = stamp(now);
  const platformRules = { ...db.studio.platformRules, ...patch };
  const studio = { ...db.studio, platformRules, updatedAt: at };
  const next = audit({ ...db, studio }, at, actor, "platform.updated", "studio", studio.id, "Platform rules edited. They are configuration, not a publisher.");
  return { ok: true, db: next, data: platformRules };
}

export function setReviewerName(db: StudioDb, reviewerName: string, actor: Actor, now?: string): Op<string> {
  const denied = requireHuman(db, actor);
  if (denied) return denied;
  if (!db.studio) return fail(db, "no-studio", "Create a studio first.");
  const at = stamp(now);
  const studio = { ...db.studio, reviewerName: reviewerName.trim() || db.studio.reviewerName, updatedAt: at };
  return { ok: true, db: audit({ ...db, studio }, at, actor, "studio.reviewer", "studio", studio.id, studio.reviewerName), data: studio.reviewerName };
}

function approveSimple<T>(
  entity: VersionedEntity<T> | null,
  label: string,
): { entity: VersionedEntity<T> } | { error: string } {
  if (!entity) return { error: `Create ${label} first.` };
  const cur = latest(entity);
  if (cur.status === "approved" && entity.canonicalVersion === cur.version) return { entity };
  const versions = entity.versions.map((v) =>
    v.version === cur.version ? { ...v, status: "approved" as const } : v.status === "approved" ? { ...v, status: "superseded" as const } : v,
  );
  return { entity: { ...entity, versions, canonicalVersion: cur.version, updatedAt: cur.createdAt } };
}

export function saveBrand(db: StudioDb, body: BrandBody, actor: Actor, now?: string): Op<{ id: string }> {
  const denied = requireHuman(db, actor);
  if (denied) return denied;
  const at = stamp(now);
  if (!db.brand) {
    const made = createEntity(db, "brd", "brand", body, actor, "Brand proposal", at, "in_review");
    const next = audit(made.db, at, actor, "brand.proposed", "brand", made.entity.id, body.name);
    return { ok: true, db: { ...next, brand: made.entity }, data: { id: made.entity.id } };
  }
  const bumped = pushVersion(db, db.brand, body, "in_review", actor, "Brand revision. Previous version kept.", at);
  const next = audit(bumped.db, at, actor, "brand.revised", "brand", bumped.entity.id, `Version ${bumped.entity.currentVersion}`, bumped.entity.currentVersion);
  return { ok: true, db: { ...next, brand: bumped.entity }, data: { id: bumped.entity.id } };
}

export function approveBrand(db: StudioDb, actor: Actor, now?: string): Op<{ version: number }> {
  const denied = requireHuman(db, actor);
  if (denied) return denied;
  const result = approveSimple(db.brand, "a brand");
  if ("error" in result) return fail(db, "missing", result.error);
  const at = stamp(now);
  const entity = { ...result.entity, updatedAt: at };
  const version = entity.canonicalVersion ?? 1;
  let next = audit({ ...db, brand: entity }, at, actor, "brand.approved", "brand", entity.id, "Human approved brand.", version);
  next = pushApproval(next, at, actor, "brand", entity.id, version, "approved", "Brand approved.");
  return { ok: true, db: next, data: { version } };
}

export function saveUniverse(db: StudioDb, body: UniverseBody, actor: Actor, now?: string): Op<{ id: string }> {
  const denied = requireHuman(db, actor);
  if (denied) return denied;
  const at = stamp(now);
  if (!db.universe) {
    const made = createEntity(db, "uni", "universe", body, actor, "Universe proposal", at, "in_review");
    return { ok: true, db: { ...audit(made.db, at, actor, "universe.proposed", "universe", made.entity.id, body.name), universe: made.entity }, data: { id: made.entity.id } };
  }
  const bumped = pushVersion(db, db.universe, body, "in_review", actor, "Universe revision.", at);
  return { ok: true, db: { ...audit(bumped.db, at, actor, "universe.revised", "universe", bumped.entity.id, "Revision", bumped.entity.currentVersion), universe: bumped.entity }, data: { id: bumped.entity.id } };
}

export function approveUniverse(db: StudioDb, actor: Actor, now?: string): Op<{ version: number }> {
  const denied = requireHuman(db, actor);
  if (denied) return denied;
  const result = approveSimple(db.universe, "a universe");
  if ("error" in result) return fail(db, "missing", result.error);
  const at = stamp(now);
  const entity = { ...result.entity, updatedAt: at };
  const version = entity.canonicalVersion ?? 1;
  let next: StudioDb = { ...db, universe: entity };
  next = audit(next, at, actor, "universe.approved", "universe", entity.id, "Human approved universe.", version);
  next = pushApproval(next, at, actor, "universe", entity.id, version, "approved", "Universe approved.");
  return { ok: true, db: next, data: { version } };
}

export function saveWorld(db: StudioDb, body: WorldBody, actor: Actor, now?: string): Op<{ id: string }> {
  const denied = requireHuman(db, actor);
  if (denied) return denied;
  const at = stamp(now);
  if (!db.world) {
    const made = createEntity(db, "wld", "world", body, actor, "World proposal", at, "in_review");
    return { ok: true, db: { ...audit(made.db, at, actor, "world.proposed", "world", made.entity.id, body.name), world: made.entity }, data: { id: made.entity.id } };
  }
  const bumped = pushVersion(db, db.world, body, "in_review", actor, "World revision.", at);
  return { ok: true, db: { ...audit(bumped.db, at, actor, "world.revised", "world", bumped.entity.id, "Revision", bumped.entity.currentVersion), world: bumped.entity }, data: { id: bumped.entity.id } };
}

export function approveWorld(db: StudioDb, actor: Actor, now?: string): Op<{ version: number }> {
  const denied = requireHuman(db, actor);
  if (denied) return denied;
  const result = approveSimple(db.world, "a world");
  if ("error" in result) return fail(db, "missing", result.error);
  const at = stamp(now);
  const entity = { ...result.entity, updatedAt: at };
  const version = entity.canonicalVersion ?? 1;
  let next: StudioDb = { ...db, world: entity };
  next = audit(next, at, actor, "world.approved", "world", entity.id, "Human approved world.", version);
  next = pushApproval(next, at, actor, "world", entity.id, version, "approved", "World approved.");
  return { ok: true, db: next, data: { version } };
}

export function saveStoryRules(db: StudioDb, body: StoryRulesBody, actor: Actor, now?: string): Op<{ id: string }> {
  const denied = requireHuman(db, actor);
  if (denied) return denied;
  const at = stamp(now);
  if (!db.storyRules) {
    const made = createEntity(db, "rul", "story_rules", body, actor, "Story rules", at, "in_review");
    return { ok: true, db: { ...audit(made.db, at, actor, "rules.proposed", "story_rules", made.entity.id, body.tone), storyRules: made.entity }, data: { id: made.entity.id } };
  }
  const bumped = pushVersion(db, db.storyRules, body, "in_review", actor, "Rules revision.", at);
  return { ok: true, db: { ...audit(bumped.db, at, actor, "rules.revised", "story_rules", bumped.entity.id, "Revision", bumped.entity.currentVersion), storyRules: bumped.entity }, data: { id: bumped.entity.id } };
}

export function approveStoryRules(db: StudioDb, actor: Actor, now?: string): Op<{ version: number }> {
  const denied = requireHuman(db, actor);
  if (denied) return denied;
  const result = approveSimple(db.storyRules, "story rules");
  if ("error" in result) return fail(db, "missing", result.error);
  const at = stamp(now);
  const entity = { ...result.entity, updatedAt: at };
  const version = entity.canonicalVersion ?? 1;
  let next: StudioDb = { ...db, storyRules: entity };
  next = audit(next, at, actor, "rules.approved", "story_rules", entity.id, "Human approved story rules.", version);
  return { ok: true, db: next, data: { version } };
}

export function createLocation(db: StudioDb, body: LocationBody, actor: Actor, now?: string): Op<{ id: string }> {
  const denied = requireHuman(db, actor);
  if (denied) return denied;
  const at = stamp(now);
  const made = createEntity(db, "loc", "location", body, actor, "Location", at, "approved");
  const entity = { ...made.entity, canonicalVersion: 1 };
  const next = audit(made.db, at, actor, "location.created", "location", entity.id, body.name);
  return { ok: true, db: { ...next, locations: [...next.locations, entity] }, data: { id: entity.id } };
}

export function canonicalCharacters(db: StudioDb) {
  return db.characters
    .map((entity) => ({ entity, version: canonicalOf(entity) }))
    .filter((row): row is { entity: VersionedEntity<CharacterBody>; version: NonNullable<ReturnType<typeof canonicalOf<CharacterBody>>> } =>
      Boolean(row.version && row.version.status === "approved"),
    );
}

export function createCharacter(db: StudioDb, body: CharacterBody, actor: Actor, now?: string): Op<{ id: string; version: number }> {
  const denied = requireHuman(db, actor);
  if (denied) return denied;
  if (!body.name.trim() || !body.clothing.trim() || body.catchphrases.length === 0) {
    return fail(db, "invalid", "A character needs a name, clothing, and at least one catchphrase.");
  }
  const at = stamp(now);
  const made = createEntity(db, "chr", "character", body, actor, "Character proposal. Not canon until a human approves.", at, "in_review");
  const entity = {
    ...made.entity,
    versions: made.entity.versions.map((version) => ({ ...version, canonState: "PROPOSED" as const })),
  };
  const next = audit(made.db, at, actor, "character.proposed", "character", entity.id, body.name);
  return { ok: true, db: { ...next, characters: [...next.characters, entity] }, data: { id: entity.id, version: 1 } };
}

export function reviseCharacter(
  db: StudioDb,
  id: string,
  body: CharacterBody,
  actor: Actor,
  now?: string,
): Op<{ version: number }> {
  const denied = requireHuman(db, actor);
  if (denied) {
    const at = stamp(now);
    const agent = getAgent(actor.id);
    const next = audit(db, at, actor, "permission.denied", "character", id, "Agent attempted to modify canonical character.");
    return fail(recordRun(next, at, actor.id, "canon.write", "denied", "character", id, agent?.name ?? actor.name, fingerprint(body)), "permission", "Agents cannot modify canonical characters.");
  }
  const current = db.characters.find((c) => c.id === id);
  if (!current) return fail(db, "missing", "Character not found.");
  const at = stamp(now);
  const locked = canonicalOf(current);
  if (locked) {
    const changed = changedCanonFields(locked.snapshot, body);
    if (changed.length) {
      return fail(
        db,
        "canon-change-required",
        `Locked canon cannot be edited in place (${changed.join(", ")}). Propose a canon change. Impact is reviewed before a human approves a new version.`,
      );
    }
  }
  const bumped = pushVersion(db, current, body, "in_review", actor, "Human revision. Approved version, if any, stays.", at);
  const next = audit(bumped.db, at, actor, "character.revised", "character", id, `Version ${bumped.entity.currentVersion}. Canon pointer unchanged until approval.`, bumped.entity.currentVersion);
  return { ok: true, db: { ...next, characters: replaceEntity(next.characters, bumped.entity) }, data: { version: bumped.entity.currentVersion } };
}

export function approveCharacter(db: StudioDb, id: string, actor: Actor, note: string, now?: string): Op<{ version: number }> {
  const denied = requireHuman(db, actor);
  if (denied) {
    const at = stamp(now);
    return fail(audit(db, at, actor, "permission.denied", "character", id, "Agent tried to approve a character."), "human-required", denied.error);
  }
  const current = db.characters.find((c) => c.id === id);
  if (!current) return fail(db, "missing", "Character not found.");
  const cur = latest(current);
  const locked = canonicalOf(current);
  if (locked && JSON.stringify(locked.snapshot) !== JSON.stringify(cur.snapshot)) {
    return fail(db, "canon-change-required", "Locked canon is not overwritten from a draft. Propose a canon change. A human approves it after impact analysis.");
  }
  const at = stamp(now);
  const versions = current.versions.map((v) => {
    if (v.version === cur.version) return { ...v, status: "approved" as const, canonState: "LOCKED" as const };
    if (v.status === "approved" || v.canonState === "LOCKED" || v.canonState === "APPROVED") {
      return { ...v, status: "superseded" as const, canonState: "SUPERSEDED" as const };
    }
    return v;
  });
  const entity: VersionedEntity<CharacterBody> = { ...current, versions, canonicalVersion: cur.version, updatedAt: at };
  let next: StudioDb = { ...db, characters: replaceEntity(db.characters, entity) };
  next = audit(next, at, actor, "character.approved", "character", id, note || "Human approved character canon.", cur.version);
  next = pushApproval(next, at, actor, "character", id, cur.version, "approved", note || "Character canon approved.");
  return { ok: true, db: next, data: { version: cur.version } };
}

export function decideCharacter(
  db: StudioDb,
  id: string,
  decision: "rejected" | "revision_requested",
  actor: Actor,
  note: string,
  now?: string,
): Op<{ version: number }> {
  const denied = requireHuman(db, actor);
  if (denied) return denied;
  const current = db.characters.find((c) => c.id === id);
  if (!current) return fail(db, "missing", "Character not found.");
  const cur = latest(current);
  const at = stamp(now);
  const versions = current.versions.map((v) => (v.version === cur.version ? { ...v, status: decision } : v));
  const entity = { ...current, versions, updatedAt: at };
  let next: StudioDb = { ...db, characters: replaceEntity(db.characters, entity) };
  next = audit(next, at, actor, `character.${decision}`, "character", id, note, cur.version);
  next = pushApproval(next, at, actor, "character", id, cur.version, decision, note);
  return { ok: true, db: next, data: { version: cur.version } };
}

function fill(template: string, ctx: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => ctx[key] ?? "");
}

function locationByKey(db: StudioDb, key: string) {
  return db.locations.find((loc) => snapshotOf(loc)?.key === key);
}

interface LeadCtx {
  id: string;
  name: string;
  nameHi: string;
  clothing: string;
  catchphrase: string;
  weakness: string;
  fear: string;
  tokens: string[];
  forbidden: string[];
}

function leadFrom(db: StudioDb): LeadCtx | null {
  const rows = canonicalCharacters(db);
  const row = rows.find((r) => r.version.snapshot.storyFunction === "lead") ?? rows[0];
  if (!row) return null;
  const s = row.version.snapshot;
  return {
    id: row.entity.id,
    name: s.name,
    nameHi: s.nameHi || s.name,
    clothing: s.clothing,
    catchphrase: s.catchphrases[0] ?? "",
    weakness: s.weaknesses[0] ?? "",
    fear: s.fears[0] ?? "",
    tokens: s.developmentTokens,
    forbidden: s.forbiddenVariations,
  };
}

function supportFrom(db: StudioDb, leadId: string) {
  const rows = canonicalCharacters(db).filter((r) => r.entity.id !== leadId);
  const row = rows[0];
  if (!row) return null;
  const s = row.version.snapshot;
  return { id: row.entity.id, name: s.name, nameHi: s.nameHi || s.name, catchphrase: s.catchphrases[0] ?? "", forbidden: s.forbiddenVariations };
}

function ctxMap(lead: LeadCtx): Record<string, string> {
  return {
    name: lead.name,
    nameHi: lead.nameHi,
    clothing: lead.clothing,
    catchphrase: lead.catchphrase,
    weakness: lead.weakness,
    fear: lead.fear,
  };
}

function corpusOf(db: StudioDb, excludeId?: string): CorpusEntry[] {
  const out: CorpusEntry[] = [];
  for (const story of db.stories) {
    if (story.id === excludeId) continue;
    const snap = latest(story).snapshot;
    out.push({ id: story.id, title: snap.title, dna: snap.dna });
  }
  return out;
}

function motifUsed(db: StudioDb, motif: string, excludeId?: string): boolean {
  return foldedMotifUsed(
    db.stories.map((story) => ({ id: story.id, motif: latest(story).snapshot.dna.visualMotif })),
    motif,
    excludeId,
  );
}

function arcUsed(db: StudioDb, arc: string, excludeId?: string): boolean {
  return foldedArcUsed(
    db.stories.map((story) => ({ id: story.id, arc: latest(story).snapshot.dna.emotionalArc })),
    arc,
    excludeId,
  );
}

function scoreStory(
  db: StudioDb,
  input: {
    dna: StoryDna;
    developmentHit: boolean;
    characterPresent: boolean;
    thin: boolean;
    hasBeginning: boolean;
    hasMiddle: boolean;
    hasResolution: boolean;
    hasConflict: boolean;
    hasPlayEngine: boolean;
    culturalSpecificity: StoryBody["culturalSpecificity"];
    editorialNote: string;
    theme: string;
    excludeId?: string;
  },
) {
  return scoreOriginality({
    premise: input.dna.premise,
    storyStructure: input.dna.storyStructure,
    theme: input.theme,
    developmentHit: input.developmentHit,
    characterPresent: input.characterPresent,
    thin: input.thin,
    hasBeginning: input.hasBeginning,
    hasMiddle: input.hasMiddle,
    hasResolution: input.hasResolution,
    hasConflict: input.hasConflict,
    hasPlayEngine: input.hasPlayEngine,
    visualMotif: input.dna.visualMotif,
    visualMotifUsed: motifUsed(db, input.dna.visualMotif, input.excludeId),
    emotionalArc: input.dna.emotionalArc,
    emotionalArcUsed: arcUsed(db, input.dna.emotionalArc, input.excludeId),
    culturalSpecificity: input.culturalSpecificity,
    editorialNote: input.editorialNote,
    threshold: db.settings.originalityThreshold,
  });
}

function buildStory(
  db: StudioDb,
  blueprint: StoryBlueprint,
  lead: LeadCtx,
  support: ReturnType<typeof supportFrom>,
  editorialNote: string,
): StoryBody {
  const map = ctxMap(lead);
  const loc = locationByKey(db, blueprint.settingKey);
  const locSnap = loc ? snapshotOf(loc) : null;
  const ids = [lead.id];
  if (blueprint.wantsSupport && support) ids.push(support.id);
  const setting = loc ? loc.id : blueprint.settingKey;
  const dna: StoryDna = {
    premise: blueprint.key,
    theme: blueprint.theme,
    conflict: blueprint.conflict,
    characterCombination: [...ids].sort(),
    setting,
    emotionalArc: blueprint.emotionalArc,
    learningObjective: blueprint.learningKey,
    resolutionType: blueprint.resolutionType,
    humorMechanism: blueprint.humor,
    adventureMechanism: blueprint.adventure,
    mysteryMechanism: blueprint.mystery,
    culturalElement: blueprint.culturalElement,
    songUsage: blueprint.songUsage,
    visualMotif: blueprint.visualMotif,
    storyStructure: blueprint.storyStructure,
  };
  const similarity = bestSimilarity(dna, corpusOf(db), undefined, db.settings.similarityBlock);
  const developmentHit = Boolean(blueprint.developmentHook && lead.tokens.includes(blueprint.developmentHook));
  const originality = scoreStory(db, {
    dna,
    developmentHit,
    characterPresent: true,
    thin: blueprint.thin,
    hasBeginning: Boolean(blueprint.beginning.trim()),
    hasMiddle: Boolean(blueprint.middle.trim()),
    hasResolution: Boolean(blueprint.resolution.trim()),
    hasConflict: Boolean(blueprint.conflict.trim()),
    hasPlayEngine: blueprint.humor !== "none" || blueprint.adventure !== "none" || blueprint.mystery !== "none",
    culturalSpecificity: blueprint.culturalSpecificity,
    editorialNote,
    theme: blueprint.theme,
  });
  const age = db.studio?.ageBand ?? "3-5";
  return {
    title: blueprint.title.replace("Meethi", lead.name),
    titleHi: blueprint.titleHi,
    logline: fill(blueprint.logline.replace("Meethi", lead.name), map),
    targetAge: age,
    characterIds: ids,
    settingId: loc?.id ?? null,
    settingLabel: locSnap ? `${locSnap.name} / ${locSnap.nameHi}` : blueprint.settingKey,
    theme: blueprint.theme,
    mainConflict: blueprint.conflict,
    emotionalObjective: blueprint.emotionalObjective,
    learningObjective: blueprint.learningObjective,
    value: blueprint.value,
    beginning: fill(blueprint.beginning, map),
    middle: fill(blueprint.middle, map),
    resolution: fill(blueprint.resolution, map),
    culturalElements: blueprint.culturalElement ? [blueprint.culturalElement] : [],
    culturalSpecificity: blueprint.culturalSpecificity,
    dna,
    fingerprint: makeFingerprint(dna),
    originality,
    similarity,
    recommendation: {
      decision: "NOT_EVALUATED",
      canonResult: "NOT_EVALUATED",
      reasons: ["Canon validation has not been attached yet."],
    },
    developmentHook: blueprint.developmentHook,
    thin: blueprint.thin,
    blueprintKey: blueprint.key,
    editorialNote,
    providerId: DEV_PROVIDER_ID,
    providerDisclosure: DEV_DISCLOSURE,
  };
}

function storyStatus(body: StoryBody): "in_review" | "blocked" | "revision_requested" {
  if (body.recommendation.decision === "BLOCKED" || body.similarity.tooSimilar) return "blocked";
  if (
    body.recommendation.decision === "REQUIRES_REVISION" ||
    !body.originality.meetsThreshold ||
    body.thin ||
    !body.middle.trim()
  ) {
    return "revision_requested";
  }
  return "in_review";
}

function finishStory(
  body: StoryBody,
  canonResult: StoryBody["recommendation"]["canonResult"],
  similarityBlock = 55,
): StoryBody {
  const fingerprint = makeFingerprint(body.dna);
  const next = { ...body, fingerprint };
  return { ...next, recommendation: recommendationFor(next, canonResult, similarityBlock) };
}

function proposeOne(db: StudioDb, blueprint: StoryBlueprint, actor: Actor, at: string): Op<{ id: string; story: StoryBody }> {
  const gate = requireAgent(db, actor.id, "stories.create", at);
  if (!gate.ok) return fail(gate.db, gate.code, gate.error);
  const ageError = ageBandOrBlock(db);
  if (ageError) return fail(db, "age", ageError);
  const context = loadStoryGenerationContext(db);
  if (context.characterCount === 0) {
    return fail(db, "no-character", "Story generation loads the Canon snapshot first. No locked character is in it.");
  }
  const lead = leadFrom(db);
  if (!lead) return fail(db, "no-character", "Approve at least one character. Stories cannot be generated from a blank prompt.");
  const support = supportFrom(db, lead.id);
  const built = buildStory(db, blueprint, lead, support, "");
  const bound = bindCanon(db, built, "story", at);
  const precheck = validateSubject(bound.db, { kind: "story", id: "pending", version: 1, body: bound.body }, bound.snapshot);
  const body = finishStory(bound.body, precheck.result, db.settings.similarityBlock);
  const status = storyStatus(body);
  const made = createEntity(bound.db, "sty", "story", body, actor, `Proposal from ${DEV_PROVIDER_ID}. Not approved.`, at, status);
  let next = made.db;
  next = { ...next, stories: [...next.stories, made.entity] };
  const recorded = commitValidation(next, at, "story", made.entity.id, 1, { kind: "story", id: made.entity.id, version: 1, body }, bound.snapshot);
  next = commitRun(recorded.db, bound.runId, at, "story", "story", made.entity.id, bound.snapshot, recorded.id);
  const gap = context.gaps[0] ? ` Gap: ${context.gaps[0]}.` : "";
  next = recordRun(next, at, actor.id, "stories.create", "completed", "story", made.entity.id, blueprint.key, fingerprint({ blueprint: blueprint.key, canon: context.canonVersion, score: body.originality.total, similarity: body.similarity.score }));
  next = audit(
    next,
    at,
    actor,
    "story.proposed",
    "story",
    made.entity.id,
    `${body.title}. Originality ${body.originality.total}. Similarity ${body.similarity.score}. Canon ${body.recommendation.canonResult}. Recommendation ${body.recommendation.decision}. Context ${context.canonVersion}.${gap} ${status}.`,
    1,
  );
  return { ok: true, db: next, data: { id: made.entity.id, story: body } };
}

export function generateStoryCandidates(
  db: StudioDb,
  count: number,
  agentId: string,
  now?: string,
): Op<{ ids: string[] }> {
  const at = stamp(now);
  const actor: Actor = { type: "agent", id: agentId, name: getAgent(agentId)?.name ?? agentId };
  const used = new Set(db.stories.map((s) => latest(s).snapshot.blueprintKey));
  const pool = [...BLUEPRINTS.filter((b) => !used.has(b.key))];
  const ids: string[] = [];
  let cursor = db;
  const target = Math.max(0, count);
  const includeThin = target >= 10 && !used.has(THIN_BLUEPRINT.key);
  const strongTarget = includeThin ? target - 1 : target;
  for (const blueprint of pool.slice(0, strongTarget)) {
    const result = proposeOne(cursor, blueprint, actor, at);
    cursor = result.db;
    if (!result.ok) return fail(cursor, result.code, result.error);
    ids.push(result.data.id);
  }
  if (includeThin) {
    const result = proposeOne(cursor, THIN_BLUEPRINT, actor, at);
    cursor = result.db;
    if (!result.ok) return fail(cursor, result.code, result.error);
    ids.push(result.data.id);
  }
  if (ids.length === 0) return fail(cursor, "empty", "No unused story shapes left in the development provider.");
  return { ok: true, db: cursor, data: { ids } };
}

export function proposeSimilarVariant(db: StudioDb, storyId: string, agentId: string, now?: string): Op<{ id: string; story: StoryBody }> {
  const at = stamp(now);
  const gate = requireAgent(db, agentId, "stories.create", at);
  if (!gate.ok) return fail(gate.db, gate.code, gate.error);
  const ageError = ageBandOrBlock(db);
  if (ageError) return fail(db, "age", ageError);
  const source = db.stories.find((s) => s.id === storyId);
  if (!source) return fail(db, "missing", "Story not found.");
  const snap = latest(source).snapshot;
  const actor: Actor = { type: "agent", id: agentId, name: gate.agentName };
  const lead = leadFrom(db);
  if (!lead) return fail(db, "no-character", "No canonical character.");
  const cloned = blueprintByKey(snap.blueprintKey);
  if (!cloned) return fail(db, "missing", "Blueprint missing.");
  const body = buildStory(db, cloned, lead, supportFrom(db, lead.id), "");
  body.title = `${snap.title} — same shape`;
  body.logline = snap.logline;
  body.dna = { ...snap.dna };
  body.fingerprint = makeFingerprint(body.dna);
  body.similarity = bestSimilarity(body.dna, corpusOf(db), undefined, db.settings.similarityBlock);
  body.originality = scoreStory(db, {
    dna: body.dna,
    developmentHit: Boolean(cloned.developmentHook && lead.tokens.includes(cloned.developmentHook)),
    characterPresent: true,
    thin: false,
    hasBeginning: true,
    hasMiddle: true,
    hasResolution: true,
    hasConflict: Boolean(body.mainConflict.trim()),
    hasPlayEngine: body.dna.humorMechanism !== "none" || body.dna.adventureMechanism !== "none" || body.dna.mysteryMechanism !== "none",
    culturalSpecificity: snap.culturalSpecificity,
    editorialNote: "",
    theme: snap.theme,
  });
  const bound = bindCanon(db, body, "story", at);
  const precheck = validateSubject(bound.db, { kind: "story", id: "pending", version: 1, body: bound.body }, bound.snapshot);
  const stamped = finishStory(bound.body, precheck.result, db.settings.similarityBlock);
  const status = storyStatus(stamped);
  const made = createEntity(bound.db, "sty", "story", stamped, actor, "Near-duplicate proposal. Should not pass similarity.", at, status);
  let next: StudioDb = { ...made.db, stories: [...made.db.stories, made.entity] };
  const recorded = commitValidation(next, at, "story", made.entity.id, 1, { kind: "story", id: made.entity.id, version: 1, body: stamped }, bound.snapshot);
  next = commitRun(recorded.db, bound.runId, at, "story", "story", made.entity.id, bound.snapshot, recorded.id);
  next = recordRun(next, at, agentId, "stories.create", "completed", "story", made.entity.id, "similar-variant", fingerprint(stamped.dna));
  next = audit(next, at, actor, "story.proposed", "story", made.entity.id, `Same DNA as ${snap.title}. Similarity ${stamped.similarity.score}. ${stamped.similarity.explanation.split("\n")[0]}.`, 1);
  return { ok: true, db: next, data: { id: made.entity.id, story: stamped } };
}

export function approveStory(db: StudioDb, id: string, actor: Actor, editorialNote: string, now?: string): Op<{ version: number }> {
  const at = stamp(now);
  if (actor.type !== "human") {
    return fail(audit(db, at, actor, "permission.denied", "story", id, "Agent tried to approve its own story."), "human-required", "The Story Architect cannot approve a story.");
  }
  const story = db.stories.find((s) => s.id === id);
  if (!story) return fail(db, "missing", "Story not found.");
  if (story.canonicalVersion != null) return fail(db, "sealed", "This story already has an approved version. Revise into a new version instead of overwriting.");
  const proposal = latest(story).snapshot;
  const lead = leadFrom(db);
  if (!lead) return fail(db, "no-character", "Canonical character missing.");
  const note = editorialNote.trim();
  if (note.length < 12) return fail(db, "note", "Write an editorial note. Approval without a human trace is not allowed.");
  const canonCheck = validateSubject(db, { kind: "story", id, version: story.currentVersion, body: proposal });
  if (canonCheck.result === "FAIL" || canonCheck.result === "BLOCKED") {
    const first = canonCheck.violations[0];
    const why = first ? `${first.entityName} ${first.field}: proposed ${first.proposed}, canon ${first.canonical} (${first.rule}).` : "Canon failed.";
    return fail(db, "canon", `Canon failed. ${why} Approval is blocked.`);
  }
  const similarity = bestSimilarity(proposal.dna, corpusOf(db, id), id, db.settings.similarityBlock);
  const originality = scoreStory(db, {
    dna: proposal.dna,
    developmentHit: Boolean(proposal.developmentHook && lead.tokens.includes(proposal.developmentHook)),
    characterPresent: proposal.characterIds.length > 0,
    thin: proposal.thin,
    hasBeginning: Boolean(proposal.beginning.trim()),
    hasMiddle: Boolean(proposal.middle.trim()),
    hasResolution: Boolean(proposal.resolution.trim()),
    hasConflict: Boolean(proposal.mainConflict.trim()),
    hasPlayEngine: proposal.dna.humorMechanism !== "none" || proposal.dna.adventureMechanism !== "none" || proposal.dna.mysteryMechanism !== "none",
    culturalSpecificity: proposal.culturalSpecificity,
    editorialNote: note,
    theme: proposal.theme,
    excludeId: id,
  });
  if (similarity.tooSimilar) {
    return fail(db, "similar", `Too similar to “${similarity.againstTitle}” (${similarity.score}). A good story can still be rejected for sameness. ${similarity.explanation.split("\n").slice(0, 2).join(" ")}`);
  }
  if (!originality.meetsThreshold || proposal.thin) {
    return fail(db, "originality", `Originality ${originality.total} is under the internal threshold ${originality.threshold}. This is not a YouTube score.`);
  }
  const approvedBody = finishStory({ ...proposal, similarity, originality, editorialNote: note }, canonCheck.result, db.settings.similarityBlock);
  const bumped = pushVersion(db, story, approvedBody, "approved", actor, "Human approved this version. It is now immutable.", at);
  const entity: VersionedEntity<StoryBody> = {
    ...bumped.entity,
    canonicalVersion: bumped.entity.currentVersion,
    versions: bumped.entity.versions.map((v) => (v.version === proposalVersion(story) ? { ...v, status: "superseded" as const } : v)),
  };
  let next: StudioDb = { ...bumped.db, stories: replaceEntity(bumped.db.stories, entity) };
  const ensured = ensureSnapshot(next, at, "story-approval");
  const recorded = commitValidation(
    ensured.db,
    at,
    "story",
    id,
    entity.canonicalVersion ?? 1,
    { kind: "story", id, version: entity.canonicalVersion ?? 1, body: approvedBody },
    ensured.snapshot,
  );
  next = recorded.db;
  next = audit(next, at, actor, "story.approved", "story", id, note, entity.canonicalVersion ?? undefined);
  next = pushApproval(next, at, actor, "story", id, entity.canonicalVersion ?? 1, "approved", note);
  return { ok: true, db: next, data: { version: entity.canonicalVersion ?? 1 } };
}

function proposalVersion(story: VersionedEntity<StoryBody>): number {
  return story.currentVersion;
}

export function reviseStoryNote(
  db: StudioDb,
  id: string,
  logline: string,
  actor: Actor,
  now?: string,
): Op<{ version: number; canonicalUnchanged: boolean }> {
  const story = db.stories.find((s) => s.id === id);
  if (!story) return fail(db, "missing", "Story not found.");
  const at = stamp(now);
  if (actor.type === "agent") {
    const gate = requireAgent(db, actor.id, "stories.revise", at);
    if (!gate.ok) return fail(gate.db, gate.code, gate.error);
  } else if (actor.type !== "human") {
    return fail(db, "human-required", "Not allowed.");
  }
  const base = canonicalOf(story)?.snapshot ?? latest(story).snapshot;
  const lead = leadFrom(db);
  let revised: StoryBody = { ...base, logline, editorialNote: "" };
  revised.similarity = bestSimilarity(revised.dna, corpusOf(db, id), id, db.settings.similarityBlock);
  revised.originality = scoreStory(db, {
    dna: revised.dna,
    developmentHit: Boolean(revised.developmentHook && lead?.tokens.includes(revised.developmentHook)),
    characterPresent: revised.characterIds.length > 0,
    thin: revised.thin,
    hasBeginning: Boolean(revised.beginning.trim()),
    hasMiddle: Boolean(revised.middle.trim()),
    hasResolution: Boolean(revised.resolution.trim()),
    hasConflict: Boolean(revised.mainConflict.trim()),
    hasPlayEngine: revised.dna.humorMechanism !== "none" || revised.dna.adventureMechanism !== "none" || revised.dna.mysteryMechanism !== "none",
    culturalSpecificity: revised.culturalSpecificity,
    editorialNote: "",
    theme: revised.theme,
    excludeId: id,
  });
  const bound = bindCanon(db, revised, "story-revision", at);
  const precheck = validateSubject(bound.db, { kind: "story", id, version: story.currentVersion + 1, body: bound.body }, bound.snapshot);
  const finished = finishStory(bound.body, precheck.result, db.settings.similarityBlock);
  const status = storyStatus(finished);
  const bumped = pushVersion(bound.db, story, finished, status, actor, "New version. Canon, originality, and similarity were run again. The approved snapshot was not overwritten.", at);
  let next: StudioDb = { ...bumped.db, stories: replaceEntity(bumped.db.stories, bumped.entity) };
  const recorded = commitValidation(next, at, "story", id, bumped.entity.currentVersion, { kind: "story", id, version: bumped.entity.currentVersion, body: finished }, bound.snapshot);
  next = commitRun(recorded.db, bound.runId, at, "story-revision", "story", id, bound.snapshot, recorded.id);
  next = audit(next, at, actor, "story.revised", "story", id, `Re-evaluated. Originality ${finished.originality.total}. Similarity ${finished.similarity.score}. Canon ${finished.recommendation.canonResult}.`, bumped.entity.currentVersion);
  return {
    ok: true,
    db: next,
    data: { version: bumped.entity.currentVersion, canonicalUnchanged: true },
  };
}

function castTokens(db: StudioDb, ids: string[]): string[] {
  const tokens: string[] = [];
  for (const id of ids) {
    const snap = snapshotOf(db.characters.find((character) => character.id === id));
    if (snap) tokens.push(...snap.developmentTokens);
  }
  return tokens;
}

function commitProposal(
  db: StudioDb,
  body: StoryBody,
  actor: Actor,
  at: string,
  note: string,
  runKey: string,
): Op<{ id: string; story: StoryBody }> {
  const bound = bindCanon(db, body, "story", at);
  const precheck = validateSubject(bound.db, { kind: "story", id: "pending", version: 1, body: bound.body }, bound.snapshot);
  const finished = finishStory(bound.body, precheck.result, db.settings.similarityBlock);
  const status = storyStatus(finished);
  const made = createEntity(bound.db, "sty", "story", finished, actor, note, at, status);
  let next: StudioDb = { ...made.db, stories: [...made.db.stories, made.entity] };
  const recorded = commitValidation(next, at, "story", made.entity.id, 1, { kind: "story", id: made.entity.id, version: 1, body: finished }, bound.snapshot);
  next = commitRun(recorded.db, bound.runId, at, "story", "story", made.entity.id, bound.snapshot, recorded.id);
  next = recordRun(next, at, actor.id, "stories.create", "completed", "story", made.entity.id, runKey, fingerprint(finished.fingerprint));
  next = audit(
    next,
    at,
    actor,
    "story.proposed",
    "story",
    made.entity.id,
    `${finished.title}. Originality ${finished.originality.total}. Similarity ${finished.similarity.score}. Canon ${finished.recommendation.canonResult}. Recommendation ${finished.recommendation.decision}.`,
    1,
  );
  return { ok: true, db: next, data: { id: made.entity.id, story: finished } };
}

export function proposeLookalike(
  db: StudioDb,
  storyId: string,
  mode: "surface" | "polished",
  agentId: string,
  now?: string,
): Op<{ id: string; story: StoryBody }> {
  const at = stamp(now);
  const gate = requireAgent(db, agentId, "stories.create", at);
  if (!gate.ok) return fail(gate.db, gate.code, gate.error);
  const ageError = ageBandOrBlock(db);
  if (ageError) return fail(db, "age", ageError);
  const context = loadStoryGenerationContext(db);
  if (context.characterCount === 0) return fail(db, "no-character", "No locked canon to propose against.");
  const source = db.stories.find((story) => story.id === storyId);
  if (!source) return fail(db, "missing", "Story not found.");
  const snap = canonicalOf(source)?.snapshot ?? latest(source).snapshot;
  const actor: Actor = { type: "agent", id: agentId, name: gate.agentName };
  const others = canonicalCharacters(db)
    .map((row) => row.entity.id)
    .filter((id) => !snap.characterIds.includes(id));
  const characterIds = others.length ? [others[0]!, ...snap.characterIds.slice(1)].filter((id, index, list) => list.indexOf(id) === index) : [...snap.characterIds];
  const place = db.locations.find((location) => location.id !== snap.settingId);
  const placeSnap = place ? snapshotOf(place) : null;
  const dna = disguiseDna({ ...snap.dna, characterCombination: [...characterIds].sort(), setting: place?.id ?? snap.dna.setting });
  const tokens = castTokens(db, characterIds);
  const hook = mode === "polished" ? (tokens.find((token) => token) ?? snap.developmentHook) : null;
  const leadName = db.characters.find((character) => character.id === characterIds[0])?.name ?? "The child";
  const title = disguiseTokenTitle(snap.title);
  const beginning =
    mode === "polished"
      ? `${leadName} starts somewhere else in the lane. The trouble is still ${dna.conflict.replaceAll("-", " ")}. The nouns changed. The story did not.`
      : `${leadName} meets the same trouble: ${dna.conflict.replaceAll("-", " ")}.`;
  const middle =
    mode === "polished"
      ? `Company shows up in the same structural turn. There is no new kind of problem, only a different object and a different door.`
      : `Friends help in the same shape as “${snap.title}”.`;
  const resolution = `${dna.resolutionType.replaceAll("-", " ")}. The lesson is still ${dna.learningObjective.replaceAll("-", " ")}.`;
  let draft: StoryBody = {
    ...snap,
    title,
    titleHi: mode === "polished" ? "वही ढाँचा, दूसरे नाम" : "दूसरा नाम",
    logline: `${leadName} faces ${dna.conflict.replaceAll("-", " ")} and resolves it the way “${snap.title}” already does.`,
    characterIds,
    settingId: place?.id ?? snap.settingId,
    settingLabel: placeSnap ? `${placeSnap.name} / ${placeSnap.nameHi}` : snap.settingLabel,
    theme: dna.theme,
    mainConflict: dna.conflict,
    beginning,
    middle,
    resolution,
    culturalElements: mode === "polished" ? ["A steel tumbler on a different threshold of the same lane. The plot is not new."] : snap.culturalElements.map((item) => item),
    culturalSpecificity: mode === "polished" ? "specific" : snap.culturalSpecificity,
    dna,
    developmentHook: hook,
    thin: false,
    editorialNote: "",
    blueprintKey: `${snap.blueprintKey}-noun-swap`,
    providerId: DEV_PROVIDER_ID,
    providerDisclosure: DEV_DISCLOSURE,
  };
  draft.similarity = bestSimilarity(dna, corpusOf(db), undefined, db.settings.similarityBlock);
  draft.originality = scoreStory(db, {
    dna,
    developmentHit: Boolean(hook && tokens.includes(hook)),
    characterPresent: characterIds.length > 0,
    thin: false,
    hasBeginning: true,
    hasMiddle: true,
    hasResolution: true,
    hasConflict: Boolean(dna.conflict.trim()),
    hasPlayEngine: dna.humorMechanism !== "none" || dna.adventureMechanism !== "none" || dna.mysteryMechanism !== "none",
    culturalSpecificity: draft.culturalSpecificity,
    editorialNote: "",
    theme: mode === "polished" ? snap.theme : "generic",
  });
  if (mode === "surface") {
    draft = { ...draft, theme: "generic" };
    draft.originality = scoreStory(db, {
      dna,
      developmentHit: false,
      characterPresent: true,
      thin: false,
      hasBeginning: true,
      hasMiddle: true,
      hasResolution: true,
      hasConflict: Boolean(dna.conflict.trim()),
      hasPlayEngine: false,
      culturalSpecificity: "generic",
      editorialNote: "",
      theme: "generic",
    });
    draft.culturalSpecificity = "generic";
  }
  return commitProposal(gate.db, draft, actor, at, "Noun-swapped proposal. Structure copied. Not an approval.", `lookalike-${mode}`);
}

function disguiseTokenTitle(title: string): string {
  return title
    .replace(/Thunder/g, "Barking")
    .replace(/thunder/g, "barking")
    .replace(/Gulmohar/g, "Blossom")
    .replace(/Flower/g, "Blossom")
    .replace(/Scarf/g, "Cloth")
    .replace(/Bangle/g, "Marble")
    .replace(/Balloon/g, "Kite");
}

export function proposeUnderOriginalityBar(db: StudioDb, agentId: string, now?: string): Op<{ id: string; story: StoryBody }> {
  const at = stamp(now);
  const gate = requireAgent(db, agentId, "stories.create", at);
  if (!gate.ok) return fail(gate.db, gate.code, gate.error);
  const ageError = ageBandOrBlock(db);
  if (ageError) return fail(db, "age", ageError);
  const lead = leadFrom(db);
  if (!lead) return fail(db, "no-character", "No canonical character.");
  const actor: Actor = { type: "agent", id: agentId, name: gate.agentName };
  const place = db.locations[0];
  const placeSnap = place ? snapshotOf(place) : null;
  const dna: StoryDna = {
    premise: "generic-snack",
    theme: "generic",
    conflict: "",
    characterCombination: [lead.id],
    setting: place?.id ?? "lane",
    emotionalArc: "none",
    learningObjective: "",
    resolutionType: "",
    humorMechanism: "none",
    adventureMechanism: "none",
    mysteryMechanism: "none",
    culturalElement: "",
    songUsage: "none",
    visualMotif: "",
    storyStructure: "no-structure",
  };
  const draft: StoryBody = {
    title: "A Snack",
    titleHi: "एक नाश्ता",
    logline: `${lead.name} eats a snack and feels fine.`,
    targetAge: db.studio?.ageBand ?? "3-5",
    characterIds: [lead.id],
    settingId: place?.id ?? null,
    settingLabel: placeSnap ? `${placeSnap.name} / ${placeSnap.nameHi}` : "Lane",
    theme: "generic",
    mainConflict: "",
    emotionalObjective: "Nothing particular changes.",
    learningObjective: "",
    value: "",
    beginning: `${lead.name} is in the lane. There is a snack.`,
    middle: `${lead.name} eats it. Nothing is at stake.`,
    resolution: `${lead.name} is done.`,
    culturalElements: [],
    culturalSpecificity: "none",
    dna,
    fingerprint: makeFingerprint(dna),
    originality: scoreStory(db, {
      dna,
      developmentHit: false,
      characterPresent: true,
      thin: false,
      hasBeginning: true,
      hasMiddle: true,
      hasResolution: true,
      hasConflict: false,
      hasPlayEngine: false,
      culturalSpecificity: "none",
      editorialNote: "",
      theme: "generic",
    }),
    similarity: bestSimilarity(dna, corpusOf(db), undefined, db.settings.similarityBlock),
    recommendation: { decision: "NOT_EVALUATED", canonResult: "NOT_EVALUATED", reasons: ["Pending canon."] },
    developmentHook: null,
    thin: false,
    blueprintKey: "generic-snack",
    editorialNote: "",
    providerId: DEV_PROVIDER_ID,
    providerDisclosure: DEV_DISCLOSURE,
  };
  return commitProposal(gate.db, draft, actor, at, "Reasonable but indistinct. Development provider. Not approved.", "under-bar");
}

export function proposeCanonBreach(db: StudioDb, agentId: string, now?: string): Op<{ id: string; story: StoryBody }> {
  const at = stamp(now);
  const gate = requireAgent(db, agentId, "stories.create", at);
  if (!gate.ok) return fail(gate.db, gate.code, gate.error);
  const ageError = ageBandOrBlock(db);
  if (ageError) return fail(db, "age", ageError);
  const lead = leadFrom(db);
  if (!lead) return fail(db, "no-character", "No canonical character.");
  const actor: Actor = { type: "agent", id: agentId, name: gate.agentName };
  const unused = BLUEPRINTS.find((blueprint) => !db.stories.some((story) => latest(story).snapshot.blueprintKey === blueprint.key)) ?? BLUEPRINTS[0];
  if (!unused) return fail(db, "empty", "No blueprint.");
  const built = buildStory(db, unused, lead, supportFrom(db, lead.id), "");
  built.beginning = `${built.beginning} ${lead.name} puts on a cape. The tree says the lane should listen.`;
  built.logline = `${built.logline} She wears a cape and the tree says hello.`;
  built.title = `${built.title} — canon breach`;
  return commitProposal(gate.db, built, actor, at, "Proposal that contradicts locked canon. Not approved.", "canon-breach");
}

export function setCreativeThresholds(
  db: StudioDb,
  input: { originalityThreshold?: number; similarityBlock?: number },
  actor: Actor,
  now?: string,
): Op<StudioSettings> {
  const at = stamp(now);
  if (actor.type !== "human") {
    return fail(
      audit(db, at, actor, "permission.denied", "settings", db.studio?.id ?? "studio", "Agent tried to change the originality bar or the similarity block."),
      "human-required",
      "Agents cannot change the originality bar or bypass similarity detection.",
    );
  }
  const clamp = (value: number, fallback: number) => {
    if (!Number.isFinite(value)) return fallback;
    return Math.max(1, Math.min(100, Math.round(value)));
  };
  const settings: StudioSettings = {
    ...db.settings,
    originalityThreshold: clamp(input.originalityThreshold ?? db.settings.originalityThreshold, db.settings.originalityThreshold),
    similarityBlock: clamp(input.similarityBlock ?? db.settings.similarityBlock, db.settings.similarityBlock),
  };
  const next = audit(
    { ...db, settings },
    at,
    actor,
    "settings.thresholds",
    "studio",
    db.studio?.id ?? "studio",
    `Internal originality bar ${settings.originalityThreshold}. Similarity block ${settings.similarityBlock}. Not a YouTube rule.`,
  );
  return { ok: true, db: next, data: settings };
}

export function variationFor(db: StudioDb): VariationReport {
  return analyzeVariation(
    db.stories.map((story) => {
      const snap = (canonicalOf(story) ?? latest(story)).snapshot;
      const castLabel = snap.characterIds.map((id) => db.characters.find((character) => character.id === id)?.name ?? id).join(", ") || "unset";
      return { title: snap.title, dna: snap.dna, settingLabel: snap.settingLabel || snap.dna.setting, castLabel };
    }),
  );
}

export function attemptOverwriteSnapshot(entityImmutable: boolean): { ok: false; error: string } {
  if (entityImmutable) return { ok: false, error: "Canonical snapshots are immutable. Add a version." };
  return { ok: false, error: "Snapshots are write-once." };
}

function pushApproval(
  db: StudioDb,
  at: string,
  actor: Actor,
  entityType: string,
  entityId: string,
  version: number,
  decision: ApprovalRecord["decision"],
  note: string,
): StudioDb {
  const ided = withId(db, "apr");
  return {
    ...ided.db,
    approvals: [
      ...ided.db.approvals,
      { id: ided.id, at, actorId: actor.id, actorName: actor.name, entityType, entityId, version, decision, note },
    ],
  };
}

export function openEpisode(db: StudioDb, storyId: string, actor: Actor, now?: string): Op<{ id: string }> {
  const denied = requireHuman(db, actor);
  if (denied) return denied;
  const ageError = ageBandOrBlock(db);
  if (ageError) return fail(db, "age", ageError);
  const story = db.stories.find((s) => s.id === storyId);
  const approved = story ? canonicalOf(story) : null;
  if (!story || !approved || approved.status !== "approved") return fail(db, "story", "Open an episode only from an approved story version.");
  const at = stamp(now);
  const body: EpisodeBody = {
    storyId,
    storyVersion: approved.version,
    title: approved.snapshot.title,
    targetAge: approved.snapshot.targetAge,
    stage: "STORY_APPROVED",
    audience: "made-for-kids",
    scriptId: null,
    scriptVersion: null,
    storyboardId: null,
    planId: null,
    draftApproved: false,
    holdReason: null,
    runtimeMinutes: 6,
    lastError: null,
    episodeNumber: db.episodes.length + 1,
  };
  const bound = bindCanon(db, body, "episode", at);
  const made = createEntity(bound.db, "ep", "episode", bound.body, actor, "Episode opened on the approved story. Not published.", at, "approved");
  const entity = { ...made.entity, canonicalVersion: 1 };
  let next: StudioDb = { ...made.db, episodes: [...made.db.episodes, entity] };
  next = commitRun(next, bound.runId, at, "episode", "episode", entity.id, bound.snapshot);
  next = audit(next, at, actor, "episode.opened", "episode", entity.id, `From story v${approved.version}. Canon ${bound.snapshot.canonVersion}.`, 1);
  return { ok: true, db: next, data: { id: entity.id } };
}

function renderScript(db: StudioDb, story: VersionedEntity<StoryBody>, approvedVersion: number): ScriptBody | string {
  const snap = story.versions.find((v) => v.version === approvedVersion)?.snapshot;
  if (!snap) return "Approved story snapshot missing.";
  const blueprint = blueprintByKey(snap.blueprintKey);
  if (!blueprint) return "No blueprint for this story. The development provider will not invent one.";
  const lead = canonicalCharacters(db).find((c) => c.entity.id === snap.characterIds[0]);
  if (!lead) return "Lead character is no longer canonical.";
  const leadSnap = lead.version.snapshot;
  const supportId = snap.characterIds[1];
  const support = supportId ? canonicalCharacters(db).find((c) => c.entity.id === supportId) : undefined;
  const map = ctxMap({
    id: lead.entity.id,
    name: leadSnap.name,
    nameHi: leadSnap.nameHi || leadSnap.name,
    clothing: leadSnap.clothing,
    catchphrase: leadSnap.catchphrases[0] ?? "",
    weakness: leadSnap.weaknesses[0] ?? "",
    fear: leadSnap.fears[0] ?? "",
    tokens: leadSnap.developmentTokens,
    forbidden: leadSnap.forbiddenVariations,
  });
  const scenes: ScriptScene[] = blueprint.scenes.map((scene, index) => {
    const loc = locationByKey(db, scene.settingKey);
    const characterIds = [lead.entity.id];
    const lines = scene.lines.flatMap((line) => {
      if (line.who === "support") {
        if (!support) return [];
        if (!characterIds.includes(support.entity.id)) characterIds.push(support.entity.id);
        return [
          {
            characterId: support.entity.id,
            speaker: support.version.snapshot.nameHi || support.version.snapshot.name,
            hi: fill(line.hi, map),
            en: fill(line.en, map),
          },
        ];
      }
      const hi = line.catchphrase ? leadSnap.catchphrases[0] ?? "" : fill(line.hi, map);
      const en = line.catchphrase ? `Catchphrase from canon: ${leadSnap.catchphrases[0] ?? ""}` : fill(line.en, map);
      return [{ characterId: lead.entity.id, speaker: leadSnap.nameHi || leadSnap.name, hi, en }];
    });
    return {
      sceneNo: index + 1,
      sceneId: `scene_${story.id}_${index + 1}`,
      locationKey: scene.settingKey,
      locationId: loc?.id ?? null,
      characterIds,
      action: fill(scene.action, map),
      purpose: index === 0 ? "Open the approved trouble." : index === blueprint.scenes.length - 1 ? "Land the approved resolution." : "Carry the approved middle.",
      emotionalBeat: snap.emotionalObjective,
      visualDirection: `Keep ${leadSnap.clothing}. No new costume.`,
      soundDirection: scene.settingKey === "veranda" ? "Weather only. No scored song." : "Room tone. No library track.",
      transition: index === blueprint.scenes.length - 1 ? "hold" : "cut",
      estimatedDuration: "20s",
      lines,
    };
  });
  return {
    storyId: story.id,
    storyVersion: approvedVersion,
    language: "hi",
    titleHi: snap.titleHi,
    titleEn: snap.title,
    ageBand: snap.targetAge,
    vocabulary: blueprint.vocabulary,
    pronunciationNotes: [
      leadSnap.voiceProfile.pronunciation,
      `Catchphrase stays exact: ${leadSnap.catchphrases[0] ?? ""}`,
    ],
    scenes,
    languageReview: "pending",
    languageNotes: ["Awaiting Hindi language review. Not approved."],
    canonRefs: [
      `character:${lead.entity.id}`,
      `clothing:${leadSnap.clothing}`,
      `catchphrase:${leadSnap.catchphrases[0] ?? ""}`,
      `weakness:${leadSnap.weaknesses[0] ?? ""}`,
      `storyVersion:${approvedVersion}`,
      `logline:${snap.logline}`,
    ],
    providerId: DEV_PROVIDER_ID,
    providerDisclosure: DEV_DISCLOSURE,
    draftLabel: "DEVELOPMENT DRAFT",
    storyAnchors: anchorsFromStory(snap),
  };
}

function addAsset(
  db: StudioDb,
  body: AssetBody,
  actor: Actor,
  at: string,
): { db: StudioDb; id: string } {
  const made = createEntity(db, "ast", "asset", body, actor, "Provenance record", at, "in_review");
  return { db: { ...made.db, assets: [...made.db.assets, made.entity] }, id: made.entity.id };
}

export function generateScript(db: StudioDb, storyId: string, agentId: string, now?: string): Op<{ scriptId: string; episodeId: string | null }> {
  const at = stamp(now);
  const gate = requireAgent(db, agentId, "script.create", at);
  if (!gate.ok) return fail(gate.db, gate.code, gate.error);
  const story = db.stories.find((s) => s.id === storyId);
  if (!story || story.canonicalVersion == null) return fail(db, "story", "Script only from an approved story version.");
  const rendered = renderScript(db, story, story.canonicalVersion);
  if (typeof rendered === "string") return fail(db, "script", rendered);
  const bound = bindCanon(db, rendered, "script", at);
  const precheck = validateSubject(bound.db, { kind: "script", id: "pending", version: 1, body: bound.body }, bound.snapshot);
  if (precheck.result === "FAIL" || precheck.result === "BLOCKED") {
    const first = precheck.violations[0];
    const why = first ? `${first.entityName} ${first.field}: proposed ${first.proposed}, canon ${first.canonical}.` : "Canon failed.";
    return fail(bound.db, "canon", `Canon failed. ${why} The script was not saved as approved.`);
  }
  const actor: Actor = { type: "agent", id: agentId, name: gate.agentName };
  const made = createEntity(bound.db, "scr", "script", bound.body, actor, "Hindi script proposal. Language review pending.", at, "in_review");
  let next: StudioDb = { ...made.db, scripts: [...made.db.scripts, made.entity] };
  const recorded = commitValidation(next, at, "script", made.entity.id, 1, { kind: "script", id: made.entity.id, version: 1, body: bound.body }, bound.snapshot);
  next = commitRun(recorded.db, bound.runId, at, "script", "script", made.entity.id, bound.snapshot, recorded.id);
  const episode = next.episodes.find((ep) => latest(ep).snapshot.storyId === storyId);
  let episodeId: string | null = null;
  if (episode && canTransition(latest(episode).snapshot.stage, "SCRIPT_DRAFT")) {
    const moved = transitionSnapshot(episode, "SCRIPT_DRAFT", { scriptId: made.entity.id, scriptVersion: 1, lastError: null }, actor, at, "Script drafted.");
    if (!moved.ok) return fail(next, "stage", moved.error);
    next = { ...next, episodes: replaceEntity(next.episodes, moved.entity) };
    episodeId = episode.id;
  } else if (episode && latest(episode).snapshot.stage === "STORY_APPROVED") {
    episodeId = episode.id;
  }
  const leadId = bound.body.scenes[0]?.characterIds[0] ?? null;
  const leadVersion = leadId ? canonicalCharacters(next).find((c) => c.entity.id === leadId)?.version.version ?? null : null;
  const asset = addAsset(next, {
    assetType: "script",
    source: "development-provider",
    creator: agentId,
    model: DEV_MODEL,
    provider: DEV_PROVIDER_ID,
    prompt: `Structured canon brief for story ${storyId} version ${story.canonicalVersion}. No free prompt.`,
    referenceAssets: [`story:${storyId}:v${story.canonicalVersion}`, `canon:${bound.snapshot.canonVersion}`],
    licenseStatus: "development-draft",
    commercialUseStatus: "not-cleared",
    rightsNotes: "Development provider output. Commercial rights are not granted. Red flag until a human clears them.",
    modificationHistory: [],
    linkedEntityType: "script",
    linkedEntityId: made.entity.id,
    characterId: leadId,
    characterVersion: leadVersion,
    worldId: bound.snapshot.worldId,
    locationId: bound.body.scenes[0]?.locationId ?? null,
    canonVersion: bound.snapshot.canonVersion,
    canonVersionUsed: bound.snapshot.canonVersion,
    canonSnapshotHash: bound.snapshot.hash,
    generationRunId: bound.runId,
  }, actor, at);
  next = asset.db;
  next = recordRun(next, at, agentId, "script.create", "completed", "script", made.entity.id, rendered.titleEn, fingerprint(rendered.canonRefs));
  next = audit(next, at, actor, "script.generated", "script", made.entity.id, `From story v${story.canonicalVersion}. ${DEV_DISCLOSURE}`, 1);
  return { ok: true, db: next, data: { scriptId: made.entity.id, episodeId } };
}

export function reviewHindi(db: StudioDb, scriptId: string, agentId: string, now?: string): Op<{ version: number; review: ScriptBody["languageReview"] }> {
  const at = stamp(now);
  const gate = requireAgent(db, agentId, "language.review", at);
  if (!gate.ok) return fail(gate.db, gate.code, gate.error);
  const script = db.scripts.find((s) => s.id === scriptId);
  if (!script) return fail(db, "missing", "Script not found.");
  const snap = latest(script).snapshot;
  const text = snap.scenes.flatMap((s) => s.lines.map((l) => l.hi)).join(" ");
  const devanagari = (text.match(/[\u0900-\u097F]/g) ?? []).length;
  const notes: string[] = [];
  let review: ScriptBody["languageReview"] = "pass";
  if (devanagari < 12) {
    review = "fail";
    notes.push("Not enough Devanagari for a Hindi-first script.");
  }
  if (snap.vocabulary.length === 0) {
    review = review === "fail" ? "fail" : "warn";
    notes.push("No age-specific vocabulary list.");
  }
  if (/guaranteed IQ|scientifically proven/i.test(text)) {
    review = "fail";
    notes.push("Deceptive educational claim.");
  }
  if (review === "pass") notes.push("Register is simple. Native-speaker review is still required before publish. This pass is an internal language gate, not that review.");
  const body: ScriptBody = { ...snap, languageReview: review, languageNotes: notes };
  const actor: Actor = { type: "agent", id: agentId, name: gate.agentName };
  const bumped = pushVersion(db, script, body, "in_review", actor, "Hindi review. Does not approve the script.", at);
  let next: StudioDb = { ...bumped.db, scripts: replaceEntity(bumped.db.scripts, bumped.entity) };
  next = recordRun(next, at, agentId, "language.review", "completed", "script", scriptId, review, fingerprint(notes));
  next = audit(next, at, actor, "script.language_reviewed", "script", scriptId, notes.join(" "), bumped.entity.currentVersion);
  return { ok: true, db: next, data: { version: bumped.entity.currentVersion, review } };
}

export function reviewCulture(
  db: StudioDb,
  scriptId: string,
  agentId: string,
  now?: string,
): Op<{ result: "PASS" | "WARN" | "FAIL"; version: number }> {
  const at = stamp(now);
  const gate = requireAgent(db, agentId, "culture.review", at);
  if (!gate.ok) return fail(gate.db, gate.code, gate.error);
  const script = db.scripts.find((item) => item.id === scriptId);
  if (!script) return fail(db, "missing", "Script not found.");
  const snap = latest(script).snapshot;
  const story = db.stories.find((item) => item.id === snap.storyId);
  const storySnap = story?.versions.find((item) => item.version === snap.storyVersion)?.snapshot ?? null;
  const text = snap.scenes.map((scene) => `${scene.action}\n${scene.lines.map((line) => `${line.hi} ${line.en}`).join("\n")}`).join("\n");
  const checks: GateCheck[] = [];
  if (!storySnap) {
    checks.push({ name: "story", result: "FAIL", detail: "Approved story version is missing." });
  } else if (storySnap.culturalSpecificity === "none" || storySnap.culturalElements.length === 0) {
    checks.push({ name: "cultural-element", result: "FAIL", detail: "The story has no specific cultural element." });
  } else if (storySnap.culturalSpecificity === "generic") {
    checks.push({ name: "cultural-element", result: "WARN", detail: "The cultural detail is generic." });
  } else {
    checks.push({ name: "cultural-element", result: "PASS", detail: storySnap.culturalElements[0] ?? "Specific." });
  }
  if (/generic cartoon india|exotic india|festival lecture|costume india/i.test(text)) {
    checks.push({ name: "careless-shorthand", result: "FAIL", detail: "The script uses a generic or careless stand-in for India." });
  } else {
    checks.push({ name: "careless-shorthand", result: "PASS", detail: "No careless cultural shorthand." });
  }
  const result = checks.some((check) => check.result === "FAIL") ? "FAIL" : checks.some((check) => check.result === "WARN") ? "WARN" : "PASS";
  const actor: Actor = { type: "agent", id: agentId, name: gate.agentName };
  let next = saveReview(db, at, {
    gate: "culture",
    result,
    redFlag: false,
    entityType: "script",
    entityId: scriptId,
    version: script.currentVersion,
    checks,
    agentId,
  });
  next = recordRun(next, at, agentId, "culture.review", "completed", "script", scriptId, result, fingerprint(checks));
  next = audit(next, at, actor, "script.culture_reviewed", "script", scriptId, checks.map((check) => `${check.name}: ${check.detail}`).join(" "), script.currentVersion);
  return { ok: true, db: next, data: { result, version: script.currentVersion } };
}

export function approveScript(db: StudioDb, scriptId: string, actor: Actor, note: string, now?: string): Op<{ version: number }> {
  const at = stamp(now);
  if (actor.type !== "human") {
    return fail(audit(db, at, actor, "permission.denied", "script", scriptId, "Agent tried to approve a script."), "human-required", "The scriptwriter cannot approve the final script.");
  }
  if (note.trim().length < 12) return fail(db, "note", "Write a language or editorial note before approving the script.");
  const script = db.scripts.find((s) => s.id === scriptId);
  if (!script) return fail(db, "missing", "Script not found.");
  const snap = latest(script).snapshot;
  if (snap.languageReview === "pending" || snap.languageReview === "fail") {
    return fail(db, "hindi", "Hindi review must pass or warn before a human approves the script.");
  }
  const canonCheck = validateSubject(db, { kind: "script", id: scriptId, version: script.currentVersion, body: snap });
  if (canonCheck.result === "FAIL" || canonCheck.result === "BLOCKED") {
    const first = canonCheck.violations[0];
    const why = first ? `${first.entityName} ${first.field}: proposed ${first.proposed}, canon ${first.canonical} (${first.rule}).` : "Canon failed.";
    return fail(db, "canon", `Canon failed. ${why} The script stays unapproved.`);
  }
  const story = db.stories.find((item) => item.id === snap.storyId);
  const storySnap = story?.versions.find((item) => item.version === snap.storyVersion)?.snapshot ?? null;
  const consistency = validateStoryConsistency(storySnap, snap);
  if (consistency.result === "FAIL") {
    return fail(db, "story-consistency", `STORY CONSISTENCY FAIL. ${consistency.failures[0]?.detail ?? "The script no longer matches the approved story."} It was not rewritten.`);
  }
  const age = validateAgeSuitability(snap, snap.ageBand);
  if (age.result === "FAIL") return fail(db, "age", age.detail);
  const previous = script.canonicalVersion;
  const versions = script.versions.map((v) => {
    if (v.version === script.currentVersion) return { ...v, status: "approved" as const };
    if (previous != null && v.version === previous) return { ...v, status: "superseded" as const };
    return v;
  });
  const entity = { ...script, versions, canonicalVersion: script.currentVersion, updatedAt: at };
  let next: StudioDb = { ...db, scripts: replaceEntity(db.scripts, entity) };
  const episode = next.episodes.find((ep) => latest(ep).snapshot.scriptId === scriptId);
  if (episode && canTransition(latest(episode).snapshot.stage, "SCRIPT_APPROVED")) {
    const moved = transitionSnapshot(episode, "SCRIPT_APPROVED", { scriptVersion: entity.canonicalVersion, lastError: null }, actor, at, "Script approved.");
    if (!moved.ok) return fail(next, "stage", moved.error);
    next = { ...next, episodes: replaceEntity(next.episodes, moved.entity) };
  }
  next = audit(next, at, actor, "script.approved", "script", scriptId, note, entity.canonicalVersion ?? undefined);
  next = pushApproval(next, at, actor, "script", scriptId, entity.canonicalVersion ?? 1, "approved", note);
  return { ok: true, db: next, data: { version: entity.canonicalVersion ?? 1 } };
}

function transitionSnapshot(
  episode: VersionedEntity<EpisodeBody>,
  to: EpisodeStage,
  patch: Partial<EpisodeBody>,
  actor: Actor,
  at: string,
  note: string,
): { ok: true; entity: VersionedEntity<EpisodeBody> } | { ok: false; error: string } {
  const cur = latest(episode).snapshot;
  if (!canTransition(cur.stage, to)) return { ok: false, error: `Cannot move from ${cur.stage} to ${to}.` };
  const body: EpisodeBody = { ...cur, ...patch, stage: to };
  const version = episode.currentVersion + 1;
  const entity: VersionedEntity<EpisodeBody> = {
    ...episode,
    currentVersion: version,
    updatedAt: at,
    versions: [
      ...episode.versions,
      { version, status: "approved", snapshot: body, createdAt: at, createdBy: actor.id, note, immutable: true },
    ],
  };
  return { ok: true, entity };
}

export function generateStoryboard(db: StudioDb, scriptId: string, agentId: string, now?: string): Op<{ storyboardId: string }> {
  const at = stamp(now);
  const gate = requireAgent(db, agentId, "storyboard.create", at);
  if (!gate.ok) return fail(gate.db, gate.code, gate.error);
  const script = db.scripts.find((s) => s.id === scriptId);
  const approved = script ? canonicalOf(script) : null;
  if (!script || !approved || approved.status !== "approved") return fail(db, "script", "Storyboard only from an approved script.");
  const snap = approved.snapshot;
  const scriptCheck = validateSubject(db, { kind: "script", id: scriptId, version: approved.version, body: snap });
  if (scriptCheck.result === "FAIL" || scriptCheck.result === "BLOCKED") {
    const first = scriptCheck.violations[0];
    const why = first ? `${first.entityName} ${first.field}: proposed ${first.proposed}, canon ${first.canonical}.` : "Canon failed.";
    return fail(db, "canon", `Canon failed. ${why} Storyboard was not created.`);
  }
  const story = db.stories.find((item) => item.id === snap.storyId);
  const storySnap = story?.versions.find((item) => item.version === snap.storyVersion)?.snapshot ?? null;
  const consistency = validateStoryConsistency(storySnap, snap);
  if (consistency.result === "FAIL") {
    return fail(db, "story-consistency", `STORY CONSISTENCY FAIL. ${consistency.failures[0]?.detail ?? "Script drifted."} Storyboard was not created.`);
  }
  const actor: Actor = { type: "agent", id: agentId, name: gate.agentName };
  let shotSerial = 0;
  const scenes = snap.scenes.map((scene) => {
    const shots = [0, 1].map((n) => {
      shotSerial += 1;
      const line = scene.lines[n];
      return {
        id: `shot_${scriptId}_${shotSerial}`,
        shotNo: n + 1,
        description: line
          ? `${scene.action} ${line.speaker}: ${line.en}`
          : scene.action,
        characterIds: [...scene.characterIds],
        locationId: scene.locationId,
        locationKey: scene.locationKey,
        camera: n === 0 ? "wide, eye-level, still" : "closer, still, no whip",
        framing: n === 0 ? "wide" : "medium",
        expression: "as written in the approved line",
        dialogueReference: line?.hi ?? "",
        continuityNotes: "Stays with the approved script. No new story beat.",
        estimatedDuration: "4s",
        contradictsScript: false,
      };
    });
    return {
      sceneNo: scene.sceneNo,
      heading: scene.action.slice(0, 80),
      locationId: scene.locationId,
      locationKey: scene.locationKey,
      shots,
    };
  });
  const body: StoryboardBody = {
    storyId: snap.storyId,
    storyVersion: snap.storyVersion,
    scriptId,
    scriptVersion: approved.version,
    scenes,
    providerId: DEV_PROVIDER_ID,
    providerDisclosure: DEV_DISCLOSURE,
  };
  const bound = bindCanon(db, body, "storyboard", at);
  const boardCheck = validateSubject(bound.db, { kind: "storyboard", id: "pending", version: 1, body: bound.body }, bound.snapshot);
  if (boardCheck.result === "FAIL" || boardCheck.result === "BLOCKED") {
    const first = boardCheck.violations[0];
    const why = first ? `${first.entityName} ${first.field}: proposed ${first.proposed}, canon ${first.canonical}.` : "Canon failed.";
    return fail(bound.db, "canon", `Canon failed. ${why} Storyboard was not created.`);
  }
  const made = createEntity(bound.db, "brd", "storyboard", bound.body, actor, "Storyboard proposal from the approved script.", at, "in_review");
  let next: StudioDb = { ...made.db, storyboards: [...made.db.storyboards, made.entity] };
  const recorded = commitValidation(next, at, "storyboard", made.entity.id, 1, { kind: "storyboard", id: made.entity.id, version: 1, body: bound.body }, bound.snapshot);
  next = commitRun(recorded.db, bound.runId, at, "storyboard", "storyboard", made.entity.id, bound.snapshot, recorded.id);
  const episode = next.episodes.find((ep) => latest(ep).snapshot.scriptId === scriptId);
  if (episode) {
    const moved = transitionSnapshot(episode, "STORYBOARD", { storyboardId: made.entity.id, lastError: null }, actor, at, "Storyboard created.");
    if (!moved.ok) return fail(next, "stage", moved.error);
    next = { ...next, episodes: replaceEntity(next.episodes, moved.entity) };
    const planGate = requireAgent(next, "agent_visual_director", "production_plan.create", at);
    if (planGate.ok) {
      const voices = canonicalCharacters(next)
        .filter((c) => snap.scenes.some((sc) => sc.characterIds.includes(c.entity.id)))
        .map((c) => ({
          characterId: c.entity.id,
          characterName: c.version.snapshot.name,
          voiceId: c.version.snapshot.voiceProfile.voiceId,
          pitch: c.version.snapshot.voiceProfile.pitch,
          tempo: c.version.snapshot.voiceProfile.tempo,
          commercialRights: c.version.snapshot.voiceProfile.commercialRights,
        }));
      const requests = productionRequests({
        episodeId: episode.id,
        canonVersion: bound.snapshot.canonVersion,
        scenes: snap.scenes,
        shots: scenes.flatMap((scene) => scene.shots.map((shot) => ({ id: shot.id, sceneNo: scene.sceneNo, characterIds: shot.characterIds, locationId: shot.locationId }))),
        voices,
      });
      const planBody: ProductionPlanBody = {
        episodeId: episode.id,
        storyId: snap.storyId,
        runtimeMinutes: 6,
        shots: shotSerial,
        voicePlan: voices.map((c) => `${c.characterName}: ${c.pitch}, ${c.tempo}. Rights: ${c.commercialRights}.`),
        musicStatus: "Original motif required. Not composed. No library track attached.",
        visualAssetsNeeded: ["Approved character color callout", "Location frame from canon", "No rendered animation yet"],
        disclosure: "Plan only. The development provider did not render picture, voice, or music.",
        canonVersionUsed: bound.snapshot.canonVersion,
        canonSnapshotHash: bound.snapshot.hash,
        generationRunId: bound.runId,
        providerStatus: "NOT CONNECTED",
        voices,
        ...requests,
      };
      const planActor: Actor = { type: "agent", id: "agent_visual_director", name: "Visual Director" };
      const planCheck = validateSubject(next, { kind: "plan", id: episode.id, version: 1, body: planBody }, bound.snapshot);
      if (planCheck.result === "FAIL" || planCheck.result === "BLOCKED") {
        const currentEpisode = next.episodes.find((ep) => ep.id === episode.id)!;
        const held = pushEpisodePatch(currentEpisode, { lastError: "Production plan failed canon. It was not attached." }, planActor, at, "Canon held the plan.");
        next = { ...next, episodes: replaceEntity(next.episodes, held) };
        next = audit(next, at, planActor, "canon.blocked", "production_plan", episode.id, "Plan contradicted canon and was not attached.");
      } else {
        const plan = createEntity(next, "pln", "production_plan", planBody, planActor, "Plan, not a render.", at, "in_review");
        next = { ...plan.db, plans: [...plan.db.plans, plan.entity] };
        const planRecorded = commitValidation(next, at, "production_plan", plan.entity.id, 1, { kind: "plan", id: plan.entity.id, version: 1, body: planBody }, bound.snapshot);
        next = planRecorded.db;
        const ep2 = next.episodes.find((ep) => ep.id === episode.id)!;
        const patched = pushEpisodePatch(ep2, { planId: plan.entity.id }, planActor, at, "Production plan attached. Stage unchanged.");
        next = { ...next, episodes: replaceEntity(next.episodes, patched) };
        next = recordRun(next, at, "agent_visual_director", "production_plan.create", "completed", "production_plan", plan.entity.id, "plan only", fingerprint(planBody));
      }
    }
  }
  const asset = addAsset(next, {
    assetType: "storyboard",
    source: "development-provider",
    creator: agentId,
    model: DEV_MODEL,
    provider: DEV_PROVIDER_ID,
    prompt: `Shots from approved script ${scriptId} v${approved.version}.`,
    referenceAssets: [`script:${scriptId}:v${approved.version}`, `canon:${bound.snapshot.canonVersion}`],
    licenseStatus: "development-draft",
    commercialUseStatus: "not-cleared",
    rightsNotes: "Storyboard text is a development draft. Not commercially cleared.",
    modificationHistory: [],
    linkedEntityType: "storyboard",
    linkedEntityId: made.entity.id,
    characterId: snap.scenes[0]?.characterIds[0] ?? null,
    characterVersion: canonicalCharacters(next).find((c) => c.entity.id === snap.scenes[0]?.characterIds[0])?.version.version ?? null,
    worldId: bound.snapshot.worldId,
    locationId: snap.scenes[0]?.locationId ?? null,
    canonVersion: bound.snapshot.canonVersion,
    canonVersionUsed: bound.snapshot.canonVersion,
    canonSnapshotHash: bound.snapshot.hash,
    generationRunId: bound.runId,
  }, actor, at);
  next = asset.db;
  next = recordRun(next, at, agentId, "storyboard.create", "completed", "storyboard", made.entity.id, snap.titleEn, fingerprint(body.scenes.map((s) => s.locationKey)));
  next = audit(next, at, actor, "storyboard.generated", "storyboard", made.entity.id, DEV_DISCLOSURE, 1);
  return { ok: true, db: next, data: { storyboardId: made.entity.id } };
}

function pushEpisodePatch(
  episode: VersionedEntity<EpisodeBody>,
  patch: Partial<EpisodeBody>,
  actor: Actor,
  at: string,
  note: string,
): VersionedEntity<EpisodeBody> {
  const body = { ...latest(episode).snapshot, ...patch };
  const version = episode.currentVersion + 1;
  return {
    ...episode,
    currentVersion: version,
    updatedAt: at,
    versions: [
      ...episode.versions,
      { version, status: "approved", snapshot: body, createdAt: at, createdBy: actor.id, note, immutable: true },
    ],
  };
}

export function evaluateStoryGate(db: StudioDb, storyId: string): { result: "PASS" | "WARN" | "FAIL"; checks: GateCheck[]; redFlag: boolean } {
  const story = db.stories.find((s) => s.id === storyId);
  const snap = story ? (canonicalOf(story)?.snapshot ?? latest(story).snapshot) : null;
  const checks: GateCheck[] = [];
  if (!snap || !story) {
    return { result: "FAIL", redFlag: false, checks: [{ name: "exists", result: "FAIL", detail: "Story missing." }] };
  }
  checks.push(textCheck("beginning", snap.beginning));
  checks.push(textCheck("middle", snap.middle));
  checks.push(textCheck("resolution", snap.resolution));
  checks.push(snap.mainConflict ? { name: "conflict", result: "PASS", detail: snap.mainConflict } : { name: "conflict", result: "FAIL", detail: "No conflict." });
  checks.push(
    snap.targetAge === db.studio?.ageBand
      ? { name: "age", result: "PASS", detail: snap.targetAge }
      : { name: "age", result: "FAIL", detail: "Age does not match the studio's active band." },
  );
  checks.push(
    snap.originality.meetsThreshold
      ? { name: "originality", result: "PASS", detail: `${snap.originality.total}/100 internal` }
      : { name: "originality", result: "FAIL", detail: `${snap.originality.total} under ${snap.originality.threshold}` },
  );
  checks.push(
    snap.similarity.tooSimilar
      ? { name: "similarity", result: "FAIL", detail: `${snap.similarity.score} vs ${snap.similarity.againstTitle}` }
      : { name: "similarity", result: "PASS", detail: `Highest similarity ${snap.similarity.score}` },
  );
  const known = new Set(canonicalCharacters(db).map((c) => c.entity.id));
  const unknown = snap.characterIds.filter((id) => !known.has(id));
  checks.push(unknown.length === 0 ? { name: "canon-cast", result: "PASS", detail: "Cast is canonical." } : { name: "canon-cast", result: "FAIL", detail: `Unknown cast: ${unknown.join(",")}` });
  return { result: rollup(checks), checks, redFlag: false };
}

function textCheck(name: string, value: string): GateCheck {
  return value.trim() ? { name, result: "PASS", detail: "Present." } : { name, result: "FAIL", detail: "Missing." };
}

export function evaluateHindiGate(script: ScriptBody | null): { result: "PASS" | "WARN" | "FAIL"; checks: GateCheck[]; redFlag: boolean } {
  const checks: GateCheck[] = [];
  if (!script) return { result: "FAIL", redFlag: false, checks: [{ name: "exists", result: "FAIL", detail: "No script." }] };
  const hi = script.scenes.flatMap((s) => s.lines.map((l) => l.hi)).join(" ");
  checks.push((hi.match(/[\u0900-\u097F]/g) ?? []).length >= 12 ? { name: "devanagari", result: "PASS", detail: "Hindi script present." } : { name: "devanagari", result: "FAIL", detail: "Hindi text missing." });
  checks.push(script.vocabulary.length > 0 ? { name: "vocabulary", result: "PASS", detail: `${script.vocabulary.length} words` } : { name: "vocabulary", result: "WARN", detail: "No vocabulary list." });
  checks.push(script.pronunciationNotes.length > 0 ? { name: "pronunciation", result: "PASS", detail: "Notes present." } : { name: "pronunciation", result: "WARN", detail: "No pronunciation notes." });
  checks.push(
    script.languageReview === "pass"
      ? { name: "language-review", result: "PASS", detail: "Reviewed." }
      : script.languageReview === "warn"
        ? { name: "language-review", result: "WARN", detail: script.languageNotes.join(" ") }
        : { name: "language-review", result: "FAIL", detail: script.languageReview },
  );
  return { result: rollup(checks), checks, redFlag: false };
}

export function evaluateCanonGate(
  db: StudioDb,
  board: StoryboardBody | null,
): { result: "PASS" | "WARN" | "FAIL"; checks: GateCheck[]; redFlag: boolean } {
  const checks: GateCheck[] = [];
  if (!board) return { result: "FAIL", redFlag: false, checks: [{ name: "exists", result: "FAIL", detail: "No storyboard." }] };
  const characters = new Map(canonicalCharacters(db).map((c) => [c.entity.id, c.version.snapshot]));
  const locations = new Set(db.locations.map((l) => l.id));
  let unknownChar = 0;
  let unknownLoc = 0;
  let forbidden = 0;
  for (const scene of board.scenes) {
    if (!scene.locationId || !locations.has(scene.locationId)) unknownLoc += 1;
    for (const shot of scene.shots) {
      for (const id of shot.characterIds) {
        const body = characters.get(id);
        if (!body) unknownChar += 1;
        else if (body.forbiddenVariations.some((rule) => rule && shot.description.toLowerCase().includes(rule.toLowerCase()))) forbidden += 1;
      }
      if (!shot.locationId || !locations.has(shot.locationId)) unknownLoc += 1;
    }
  }
  checks.push(unknownChar === 0 ? { name: "characters", result: "PASS", detail: "Only canonical characters." } : { name: "characters", result: "FAIL", detail: `${unknownChar} shot references outside canon.` });
  checks.push(unknownLoc === 0 ? { name: "locations", result: "PASS", detail: "Locations exist in the world." } : { name: "locations", result: "FAIL", detail: `${unknownLoc} unknown locations.` });
  checks.push(forbidden === 0 ? { name: "forbidden-variations", result: "PASS", detail: "No forbidden visual notes." } : { name: "forbidden-variations", result: "FAIL", detail: `${forbidden} forbidden variations.` });
  const validation = validateSubject(db, { kind: "storyboard", id: "storyboard", version: 1, body: board });
  if (validation.result === "FAIL" || validation.result === "BLOCKED") {
    for (const violation of validation.violations) {
      checks.push({
        name: `canon-${violation.field}`,
        result: "FAIL",
        detail: `${violation.entityName} ${violation.field}: proposed ${violation.proposed}, canon ${violation.canonical}. ${violation.rule}`,
      });
    }
  } else if (validation.result === "WARN") {
    checks.push({ name: "canon-rules", result: "WARN", detail: validation.warnings.map((item) => `${item.entityName} ${item.field}`).join("; ") });
  } else {
    checks.push({ name: "canon-rules", result: "PASS", detail: `Canon ${validation.canonVersion}.` });
  }
  return { result: rollup(checks), checks, redFlag: false };
}

export function evaluateRightsGate(db: StudioDb, episodeId: string): { result: "PASS" | "WARN" | "FAIL"; checks: GateCheck[]; redFlag: boolean } {
  const episode = db.episodes.find((e) => e.id === episodeId);
  const snap = episode ? latest(episode).snapshot : null;
  const checks: GateCheck[] = [];
  const linked = db.assets.filter((asset) => {
    const body = latest(asset).snapshot;
    return body.linkedEntityId === snap?.scriptId || body.linkedEntityId === snap?.storyboardId;
  });
  if (linked.length === 0) checks.push({ name: "provenance", result: "FAIL", detail: "No provenance records." });
  else checks.push({ name: "provenance", result: "PASS", detail: `${linked.length} assets traced.` });
  const uncleared = linked.filter((asset) => latest(asset).snapshot.commercialUseStatus !== "cleared");
  if (uncleared.length > 0) {
    checks.push({
      name: "commercial-rights",
      result: "WARN",
      detail: "Commercial use is not cleared. Red flag until a human clears each asset.",
    });
  } else checks.push({ name: "commercial-rights", result: "PASS", detail: "Asset commercial use cleared." });
  checks.push({
    name: "music",
    result: "WARN",
    detail: "No original music has been composed. Do not attach a library track.",
  });
  return { result: rollup(checks), checks, redFlag: uncleared.length > 0 };
}

export function evaluatePolicyGate(db: StudioDb, episodeId: string): { result: "PASS" | "WARN" | "FAIL"; checks: GateCheck[]; redFlag: boolean } {
  const episode = db.episodes.find((e) => e.id === episodeId);
  const snap = episode ? latest(episode).snapshot : null;
  const checks: GateCheck[] = [];
  if (!snap) return { result: "FAIL", redFlag: false, checks: [{ name: "exists", result: "FAIL", detail: "No episode." }] };
  checks.push(snap.audience === "made-for-kids" ? { name: "made-for-kids", result: "PASS", detail: "Classified made-for-kids." } : { name: "made-for-kids", result: "FAIL", detail: "Audience not set." });
  const script = snap.scriptId ? db.scripts.find((s) => s.id === snap.scriptId) : undefined;
  const text = script ? latest(script).snapshot.scenes.flatMap((s) => [s.action, ...s.lines.map((l) => `${l.hi} ${l.en}`)]).join(" ") : "";
  const danger = /matchstick|knife|chase onto the road|rooftop edge/i.test(text);
  checks.push(danger ? { name: "dangerous-behavior", result: "FAIL", detail: "Dangerous beat." } : { name: "dangerous-behavior", result: "PASS", detail: "No dangerous-behavior phrase." });
  const claim = /scientifically proven|guaranteed to teach/i.test(text);
  checks.push(claim ? { name: "misleading", result: "FAIL", detail: "Deceptive claim." } : { name: "misleading", result: "PASS", detail: "No deceptive educational claim." });
  const ad = /buy now|shop this|use code/i.test(text);
  checks.push(ad ? { name: "commercial-content", result: "FAIL", detail: "Sales beat." } : { name: "commercial-content", result: "PASS", detail: "Not an advertisement." });
  checks.push({ name: "reused-content", result: "PASS", detail: "Built from original canon, not scraped footage." });
  return { result: rollup(checks), checks, redFlag: false };
}

function rollup(checks: GateCheck[]): "PASS" | "WARN" | "FAIL" {
  if (checks.some((c) => c.result === "FAIL")) return "FAIL";
  if (checks.some((c) => c.result === "WARN")) return "WARN";
  return "PASS";
}

function saveReview(
  db: StudioDb,
  at: string,
  review: Omit<QualityReview, "id" | "at">,
): StudioDb {
  const ided = withId(db, "qa");
  const full: QualityReview = { ...review, id: ided.id, at };
  return { ...ided.db, qualityReviews: [...ided.db.qualityReviews, full] };
}

export function runQa(db: StudioDb, episodeId: string, agentId: string, now?: string): Op<{ stage: EpisodeStage; failed: boolean }> {
  const at = stamp(now);
  const gate = requireAgent(db, agentId, "qa.run", at);
  if (!gate.ok) return fail(gate.db, gate.code, gate.error);
  const episode = db.episodes.find((e) => e.id === episodeId);
  if (!episode) return fail(db, "missing", "Episode not found.");
  const snap = latest(episode).snapshot;
  if (snap.stage !== "STORYBOARD") return fail(db, "stage", "QA runs from the storyboard stage.");
  const storyGate = evaluateStoryGate(db, snap.storyId);
  const script = snap.scriptId ? db.scripts.find((s) => s.id === snap.scriptId) : undefined;
  const hindi = evaluateHindiGate(script ? latest(script).snapshot : null);
  const board = snap.storyboardId ? db.storyboards.find((s) => s.id === snap.storyboardId) : undefined;
  const canon = evaluateCanonGate(db, board ? latest(board).snapshot : null);
  let next = db;
  const qaActor: Actor = { type: "agent", id: agentId, name: "QA Agent" };
  next = saveReview(next, at, { gate: "story", result: storyGate.result, redFlag: false, entityType: "episode", entityId: episodeId, version: episode.currentVersion, checks: storyGate.checks, agentId });
  next = saveReview(next, at, { gate: "hindi", result: hindi.result, redFlag: false, entityType: "episode", entityId: episodeId, version: episode.currentVersion, checks: hindi.checks, agentId });
  next = saveReview(next, at, { gate: "canon", result: canon.result, redFlag: false, entityType: "episode", entityId: episodeId, version: episode.currentVersion, checks: canon.checks, agentId });
  next = recordRun(next, at, agentId, "qa.run", "completed", "episode", episodeId, `${storyGate.result}/${hindi.result}/${canon.result}`, fingerprint([storyGate, hindi, canon]));
  const blocked = [storyGate, hindi, canon].some((g) => g.result === "FAIL");
  let current = next.episodes.find((e) => e.id === episodeId)!;
  if (blocked) {
    const patched = pushEpisodePatch(current, { lastError: "A quality gate failed. Progression is blocked." }, qaActor, at, "QA blocked.");
    next = { ...next, episodes: replaceEntity(next.episodes, patched) };
    next = audit(next, at, qaActor, "qa.blocked", "episode", episodeId, "FAIL on story, Hindi, or canon.");
    return { ok: true, db: next, data: { stage: latest(patched).snapshot.stage, failed: true } };
  }
  const toQa = transitionSnapshot(current, "QUALITY_QA", { lastError: null }, qaActor, at, "Story, Hindi, and canon gates clear.");
  if (!toQa.ok) return fail(next, "stage", toQa.error);
  const rightsActorOk = requireAgent(next, "agent_rights", "rights.review", at);
  const rights = evaluateRightsGate(next, episodeId);
  next = saveReview(rightsActorOk.ok ? rightsActorOk.db : next, at, { gate: "rights", result: rights.result, redFlag: rights.redFlag, entityType: "episode", entityId: episodeId, version: current.currentVersion, checks: rights.checks, agentId: "agent_rights" });
  next = recordRun(next, at, "agent_rights", "rights.review", "completed", "episode", episodeId, rights.result, fingerprint(rights));
  const policy = evaluatePolicyGate(next, episodeId);
  next = saveReview(next, at, { gate: "policy", result: policy.result, redFlag: policy.redFlag, entityType: "episode", entityId: episodeId, version: current.currentVersion, checks: policy.checks, agentId: "agent_policy" });
  next = recordRun(next, at, "agent_policy", "policy.review", "completed", "episode", episodeId, policy.result, fingerprint(policy));
  current = toQa.entity;
  if (rights.result === "FAIL" || policy.result === "FAIL") {
    const patched = pushEpisodePatch(current, { lastError: "Rights or policy gate failed." }, qaActor, at, "Held.");
    next = { ...next, episodes: replaceEntity(next.episodes, patched) };
    return { ok: true, db: next, data: { stage: latest(patched).snapshot.stage, failed: true } };
  }
  const toRights = transitionSnapshot(current, "IP_RIGHTS_QA", {}, { type: "agent", id: "agent_rights", name: "Rights Agent" }, at, rights.redFlag ? "Red flag: rights not cleared." : "Rights pass.");
  if (!toRights.ok) return fail(next, "stage", toRights.error);
  const toPolicy = transitionSnapshot(toRights.entity, "POLICY_QA", {}, { type: "agent", id: "agent_policy", name: "Policy Agent" }, at, "Policy gate.");
  if (!toPolicy.ok) return fail(next, "stage", toPolicy.error);
  const toHuman = transitionSnapshot(toPolicy.entity, "HUMAN_APPROVAL", { holdReason: rights.redFlag ? "Rights are not commercially cleared. Draft may be approved. Publish stays blocked." : null }, { type: "system", id: "system", name: "Orchestrator" }, at, "Waiting for a human. No agent can finish this step.");
  if (!toHuman.ok) return fail(next, "stage", toHuman.error);
  next = { ...next, episodes: replaceEntity(next.episodes, toHuman.entity) };
  next = audit(next, at, qaActor, "qa.completed", "episode", episodeId, "Reached human approval. Not published.", toHuman.entity.currentVersion);
  return { ok: true, db: next, data: { stage: "HUMAN_APPROVAL", failed: false } };
}

export function approveEpisodeDraft(db: StudioDb, episodeId: string, actor: Actor, note: string, now?: string): Op<{ stage: EpisodeStage; hold: string | null }> {
  const at = stamp(now);
  if (actor.type !== "human") {
    return fail(audit(db, at, actor, "permission.denied", "episode", episodeId, "Agent tried to approve the episode."), "human-required", "Final episode approval is human.");
  }
  if (note.trim().length < 12) return fail(db, "note", "Write an approval note.");
  const episode = db.episodes.find((e) => e.id === episodeId);
  if (!episode) return fail(db, "missing", "Episode not found.");
  const snap = latest(episode).snapshot;
  if (snap.stage !== "HUMAN_APPROVAL") return fail(db, "stage", "The episode is not waiting for human approval.");
  const reviews = db.qualityReviews.filter((r) => r.entityId === episodeId);
  if (reviews.some((r) => r.result === "FAIL")) return fail(db, "gate", "A failed gate still blocks approval.");
  const red = reviews.some((r) => r.redFlag);
  let entity = episode;
  let stage: EpisodeStage = "HUMAN_APPROVAL";
  let hold: string | null = snap.holdReason;
  if (red) {
    entity = pushEpisodePatch(episode, { draftApproved: true, holdReason: "Draft approved by a human. Not ready to publish: rights red flag." }, actor, at, note);
    hold = latest(entity).snapshot.holdReason;
  } else {
    const moved = transitionSnapshot(episode, "READY_TO_PUBLISH", { draftApproved: true, holdReason: null }, actor, at, note);
    if (!moved.ok) return fail(db, "stage", moved.error);
    entity = moved.entity;
    stage = "READY_TO_PUBLISH";
    hold = null;
  }
  let next: StudioDb = { ...db, episodes: replaceEntity(db.episodes, entity) };
  next = audit(next, at, actor, "episode.draft_approved", "episode", episodeId, note, entity.currentVersion);
  next = pushApproval(next, at, actor, "episode", episodeId, entity.currentVersion, "approved", note);
  return { ok: true, db: next, data: { stage, hold } };
}

export function publishEpisode(db: StudioDb, episodeId: string, actor: Actor, now?: string): Op<never> {
  const at = stamp(now);
  const next = audit(db, at, actor, "publish.blocked", "episode", episodeId, "Publishing is disabled in this build. No episode can become PUBLISHED.");
  return fail(next, "publish-disabled", "Publishing is disabled. Nothing in this build moves an episode to PUBLISHED.");
}

export function clearCommercialRights(db: StudioDb, assetId: string, actor: Actor, note: string, now?: string): Op<{ id: string }> {
  const denied = requireHuman(db, actor);
  if (denied) return denied;
  if (note.trim().length < 12) return fail(db, "note", "Rights clearance needs a written reason.");
  const asset = db.assets.find((a) => a.id === assetId);
  if (!asset) return fail(db, "missing", "Asset not found.");
  const at = stamp(now);
  const prev = latest(asset).snapshot;
  const body: AssetBody = {
    ...prev,
    commercialUseStatus: "cleared",
    licenseStatus: "human-cleared",
    rightsNotes: note,
    modificationHistory: [...prev.modificationHistory, `${at} cleared by ${actor.name}`],
  };
  const bumped = pushVersion(db, asset, body, "approved", actor, "Human rights clearance. Prior provenance kept.", at);
  const entity = { ...bumped.entity, canonicalVersion: bumped.entity.currentVersion };
  let next: StudioDb = { ...bumped.db, assets: replaceEntity(bumped.db.assets, entity) };
  next = audit(next, at, actor, "rights.cleared", "asset", assetId, note, entity.currentVersion);
  return { ok: true, db: next, data: { id: assetId } };
}

export function counts(db: StudioDb) {
  const stories = db.stories.length;
  const awaiting = [
    ...db.characters.filter((c) => latest(c).status === "in_review"),
    ...db.stories.filter((s) => latest(s).status === "in_review" || latest(s).status === "revision_requested"),
    ...db.scripts.filter((s) => latest(s).status === "in_review" && s.canonicalVersion == null),
    ...db.episodes.filter((e) => latest(e).snapshot.stage === "HUMAN_APPROVAL" && !latest(e).snapshot.draftApproved),
  ];
  const redFlags = db.qualityReviews.filter((r) => r.redFlag);
  const errors = db.episodes.filter((e) => latest(e).snapshot.lastError);
  return {
    characters: canonicalCharacters(db).length,
    characterDrafts: db.characters.length,
    stories,
    episodes: db.episodes.length,
    awaiting: awaiting.length,
    redFlags: redFlags.length,
    errors: errors.length,
  };
}

export function chainForEpisode(db: StudioDb, episodeId: string) {
  const episode = db.episodes.find((e) => e.id === episodeId);
  if (!episode) return [];
  const snap = latest(episode).snapshot;
  const ids = new Set<string>([episodeId, snap.storyId, snap.scriptId ?? "", snap.storyboardId ?? "", snap.planId ?? ""]);
  const story = db.stories.find((s) => s.id === snap.storyId);
  const chars = story ? (canonicalOf(story) ?? latest(story)).snapshot.characterIds : [];
  chars.forEach((id) => ids.add(id));
  return db.audit.filter((event) => ids.has(event.entityId));
}

export function latestSnapshot<T>(entity: VersionedEntity<T>) {
  return latest(entity);
}

function fieldStrength(field: string): "HARD" | "SOFT" {
  return (HARD_FIELDS as readonly string[]).includes(field) ? "HARD" : "SOFT";
}

export function proposeStoryForCast(
  db: StudioDb,
  characterIds: string[],
  agentId: string,
  now?: string,
): Op<{ ids: string[] }> {
  const at = stamp(now);
  const gate = requireAgent(db, agentId, "stories.create", at);
  if (!gate.ok) return fail(gate.db, gate.code, gate.error);
  for (const id of characterIds) {
    const character = db.characters.find((item) => item.id === id);
    const locked = character ? canonicalOf(character) : null;
    if (!character || !locked || locked.status !== "approved") {
      const name = character?.name ?? id;
      const next = audit(gate.db, at, { type: "agent", id: agentId, name: gate.agentName }, "canon.blocked", "character", id, `${name} is not approved canon.`);
      return fail(next, "blocked", `BLOCKED. ${name} is not approved canon. Generation will not use a draft character.`);
    }
  }
  return generateStoryCandidates(db, 1, agentId, at);
}

export function proposeCanonChange(
  db: StudioDb,
  input: { entityId: string; field: string; proposedValue: string; reason: string },
  actor: Actor,
  now?: string,
): Op<{ id: string; status: "PROPOSED" }> {
  const at = stamp(now);
  if (actor.type === "agent") {
    const gate = requireAgent(db, actor.id, "canon.propose", at);
    if (!gate.ok) return fail(gate.db, gate.code, gate.error);
  } else if (actor.type !== "human") {
    return fail(db, "human-required", "Only a human or a proposing agent can open a canon change.");
  }
  if (input.reason.trim().length < 8) return fail(db, "note", "Say why this canon change is being proposed.");
  const character = db.characters.find((item) => item.id === input.entityId);
  const locked = character ? canonicalOf(character) : null;
  if (!character || !locked) return fail(db, "missing", "There is no locked character to change.");
  const currentValue = (() => {
    const patched = patchCharacterField(locked.snapshot, input.field, input.proposedValue);
    if (typeof patched === "string") return null;
    const before = changedCanonFields(locked.snapshot, patched);
    return before.length ? readCanonValue(locked.snapshot, input.field) : "";
  })();
  const patched = patchCharacterField(locked.snapshot, input.field, input.proposedValue);
  if (typeof patched === "string") return fail(db, "field", patched);
  if (!changedCanonFields(locked.snapshot, patched).includes(input.field)) {
    return fail(db, "no-change", "The proposed value matches locked canon.");
  }
  const impact = impactOfCharacter(db, character.id);
  const ided = withId(db, "chg");
  const change = {
    id: ided.id,
    at,
    entityType: "character" as const,
    entityId: character.id,
    entityName: locked.snapshot.name,
    field: input.field,
    strength: fieldStrength(input.field),
    currentValue: currentValue || readCanonValue(locked.snapshot, input.field),
    proposedValue: input.proposedValue.trim(),
    reason: input.reason.trim(),
    proposedByType: actor.type,
    proposedById: actor.id,
    proposedByName: actor.name,
    status: "PROPOSED" as const,
    impact,
  };
  let next: StudioDb = { ...ided.db, canonChanges: [...ided.db.canonChanges, change] };
  next = audit(next, at, actor, "canon.change_proposed", "character", character.id, `${input.field}: “${change.currentValue}” → “${change.proposedValue}”. ${impact.summary}`, locked.version);
  return { ok: true, db: next, data: { id: change.id, status: "PROPOSED" } };
}

function readCanonValue(body: CharacterBody, field: string): string {
  if (field === "likes" || field === "dislikes" || field === "strengths" || field === "weaknesses") {
    const list = body[field];
    return list.join(", ");
  }
  const value = (body as unknown as Record<string, unknown>)[field];
  return typeof value === "string" ? value : "";
}

export function approveCanonChange(
  db: StudioDb,
  changeId: string,
  actor: Actor,
  note: string,
  now?: string,
): Op<{ version: number }> {
  const at = stamp(now);
  if (actor.type !== "human") {
    return fail(audit(db, at, actor, "permission.denied", "canon_change", changeId, "Agent tried to approve canon."), "human-required", "Agents cannot approve canon.");
  }
  if (note.trim().length < 12) return fail(db, "note", "A canon decision needs a written reason.");
  const change = db.canonChanges.find((item) => item.id === changeId);
  if (!change || change.status !== "PROPOSED") return fail(db, "missing", "No proposed canon change with that id.");
  const character = db.characters.find((item) => item.id === change.entityId);
  const locked = character ? canonicalOf(character) : null;
  if (!character || !locked) return fail(db, "missing", "Locked character is missing.");
  const patched = patchCharacterField(locked.snapshot, change.field, change.proposedValue);
  if (typeof patched === "string") return fail(db, "field", patched);
  const bumped = pushVersion(db, character, patched, "approved", actor, "Human approved a new canon version. Prior version kept.", at);
  const entity: VersionedEntity<CharacterBody> = {
    ...bumped.entity,
    canonicalVersion: bumped.entity.currentVersion,
    versions: bumped.entity.versions.map((version) => {
      if (version.version === bumped.entity.currentVersion) return { ...version, status: "approved" as const, canonState: "LOCKED" as const };
      if (version.version === locked.version) return { ...version, status: "superseded" as const, canonState: "SUPERSEDED" as const };
      return version;
    }),
  };
  let next: StudioDb = {
    ...bumped.db,
    characters: replaceEntity(bumped.db.characters, entity),
    canonChanges: bumped.db.canonChanges.map((item) =>
      item.id === changeId
        ? {
            ...item,
            status: "APPROVED" as const,
            decidedAt: at,
            decidedById: actor.id,
            decidedByName: actor.name,
            decisionNote: note.trim(),
            resultingVersion: entity.currentVersion,
          }
        : item,
    ),
  };
  next = audit(next, at, actor, "canon.change_approved", "character", character.id, `${note.trim()} Field ${change.field}. Affected work was not rewritten.`, entity.currentVersion);
  next = pushApproval(next, at, actor, "canon_change", changeId, entity.currentVersion, "approved", note.trim());
  return { ok: true, db: next, data: { version: entity.currentVersion } };
}

export function rejectCanonChange(
  db: StudioDb,
  changeId: string,
  actor: Actor,
  note: string,
  now?: string,
): Op<{ id: string }> {
  const at = stamp(now);
  if (actor.type !== "human") {
    return fail(audit(db, at, actor, "permission.denied", "canon_change", changeId, "Agent tried to reject canon."), "human-required", "Agents cannot decide canon.");
  }
  if (note.trim().length < 8) return fail(db, "note", "Write why this change is rejected.");
  const change = db.canonChanges.find((item) => item.id === changeId);
  if (!change || change.status !== "PROPOSED") return fail(db, "missing", "No proposed canon change with that id.");
  let next: StudioDb = {
    ...db,
    canonChanges: db.canonChanges.map((item) =>
      item.id === changeId
        ? { ...item, status: "REJECTED" as const, decidedAt: at, decidedById: actor.id, decidedByName: actor.name, decisionNote: note.trim() }
        : item,
    ),
  };
  next = audit(next, at, actor, "canon.change_rejected", "character", change.entityId, note.trim(), undefined);
  next = pushApproval(next, at, actor, "canon_change", changeId, 0, "rejected", note.trim());
  return { ok: true, db: next, data: { id: changeId } };
}

export function proposeScriptDrift(
  db: StudioDb,
  scriptId: string,
  agentId: string,
  now?: string,
): Op<{ result: "FAIL"; canonicalAge: string }> {
  const at = stamp(now);
  const gate = requireAgent(db, agentId, "script.revise", at);
  if (!gate.ok) return fail(gate.db, gate.code, gate.error);
  const script = db.scripts.find((item) => item.id === scriptId);
  if (!script) return fail(db, "missing", "Script not found.");
  const snap = latest(script).snapshot;
  const leadId = snap.scenes.flatMap((scene) => scene.characterIds).find(Boolean);
  const lead = leadId ? canonicalCharacters(db).find((item) => item.entity.id === leadId) : undefined;
  if (!lead) return fail(db, "no-character", "No locked character to contradict.");
  const canonicalAge = lead.version.snapshot.age;
  const proposedAge = canonicalAge === "7" ? "9" : "7";
  const name = lead.version.snapshot.name;
  const scenes = snap.scenes.map((scene, index) =>
    index === snap.scenes.length - 1
      ? {
          ...scene,
          lines: [
            ...scene.lines,
            {
              characterId: lead.entity.id,
              speaker: lead.version.snapshot.nameHi || name,
              hi: `मैं ${proposedAge} साल की हूँ।`,
              en: `${name} is ${proposedAge} years old.`,
            },
          ],
        }
      : scene,
  );
  const body: ScriptBody = { ...snap, scenes, languageReview: "pending", languageNotes: ["Drift draft. Not a canon edit."] };
  const actor: Actor = { type: "agent", id: agentId, name: gate.agentName };
  const bumped = pushVersion(db, script, body, "in_review", actor, "Contradiction introduced for canon check. Approved script was not overwritten.", at);
  const ensured = ensureSnapshot(bumped.db, at, "script-drift");
  const recorded = commitValidation(
    ensured.db,
    at,
    "script",
    scriptId,
    bumped.entity.currentVersion,
    { kind: "script", id: scriptId, version: bumped.entity.currentVersion, body },
    ensured.snapshot,
  );
  let next: StudioDb = { ...recorded.db, scripts: replaceEntity(recorded.db.scripts, bumped.entity) };
  next = audit(next, at, actor, "canon.drift_flagged", "script", scriptId, `Age contradiction flagged. Canon age stays ${canonicalAge}. Artifact was not rewritten into canon.`, bumped.entity.currentVersion);
  if (recorded.validation.result !== "FAIL") {
    return fail(next, "canon", "Expected the drifted script to fail canon.");
  }
  return { ok: true, db: next, data: { result: "FAIL", canonicalAge } };
}

export function proposeVisualAsset(
  db: StudioDb,
  input: { characterId: string; claims: VisualClaims; prompt?: string },
  agentId: string,
  now?: string,
): Op<{ assetId: string; drift: "CLEAN" | "DRIFT_FOUND"; result: "PASS" | "WARN" | "FAIL" | "BLOCKED" }> {
  const at = stamp(now);
  const gate = requireAgent(db, agentId, "canon.propose", at);
  if (!gate.ok) {
    const visual = requireAgent(db, agentId, "production_plan.create", at);
    if (!visual.ok) return fail(visual.db, visual.code, visual.error);
  }
  if (!input.characterId) return fail(db, "orphan", "A character asset needs a canonical character id. Orphaned character art is refused.");
  const character = db.characters.find((item) => item.id === input.characterId);
  const locked = character ? canonicalOf(character) : null;
  if (!character || !locked || locked.status !== "approved") {
    return fail(db, "blocked", "BLOCKED. Visual assets cannot cite a character that is not approved canon.");
  }
  const actor: Actor = { type: "agent", id: agentId, name: getAgent(agentId)?.name ?? agentId };
  const ensured = ensureSnapshot(db, at, "asset");
  const body: AssetBody = {
    assetType: "character_visual",
    source: "development-provider",
    creator: agentId,
    model: DEV_MODEL,
    provider: DEV_PROVIDER_ID,
    prompt: input.prompt ?? "Visual claim against locked appearance. Not a render.",
    referenceAssets: [`character:${character.id}:v${locked.version}`],
    licenseStatus: "development-draft",
    commercialUseStatus: "not-cleared",
    rightsNotes: "Claim only. Not a picture. Commercial rights stay uncleared.",
    modificationHistory: [],
    linkedEntityType: "character",
    linkedEntityId: character.id,
    characterId: character.id,
    characterVersion: locked.version,
    worldId: ensured.snapshot.worldId,
    locationId: null,
    canonVersion: ensured.snapshot.canonVersion,
    visualClaims: input.claims,
    canonVersionUsed: ensured.snapshot.canonVersion,
    canonSnapshotHash: ensured.snapshot.hash,
  };
  const made = createEntity(ensured.db, "ast", "asset", body, actor, "Visual claim. Not approved. Canon was not rewritten.", at, "in_review");
  const recorded = commitValidation(
    { ...made.db, assets: [...made.db.assets, made.entity] },
    at,
    "asset",
    made.entity.id,
    1,
    { kind: "asset", id: made.entity.id, version: 1, body },
    ensured.snapshot,
  );
  let next = audit(recorded.db, at, actor, "canon.drift_checked", "asset", made.entity.id, recorded.validation.drift === "DRIFT_FOUND" ? "Drift flagged. Character canon was not changed." : "Visual claim matches canon.", 1);
  return {
    ok: true,
    db: next,
    data: { assetId: made.entity.id, drift: recorded.validation.drift, result: recorded.validation.result },
  };
}

export function reviseScript(
  db: StudioDb,
  scriptId: string,
  lineEn: string,
  actor: Actor,
  now?: string,
): Op<{ version: number; canonicalUnchanged: boolean }> {
  const at = stamp(now);
  if (actor.type === "agent") {
    const gate = requireAgent(db, actor.id, "script.revise", at);
    if (!gate.ok) return fail(gate.db, gate.code, gate.error);
  } else if (actor.type !== "human") {
    return fail(db, "human-required", "Not allowed.");
  }
  const script = db.scripts.find((item) => item.id === scriptId);
  if (!script) return fail(db, "missing", "Script not found.");
  const base = canonicalOf(script)?.snapshot ?? latest(script).snapshot;
  const scenes = base.scenes.map((scene, index) =>
    index === 0
      ? { ...scene, lines: scene.lines.map((line, lineIndex) => (lineIndex === 0 ? { ...line, en: lineEn } : line)) }
      : scene,
  );
  const body: ScriptBody = {
    ...base,
    scenes,
    languageReview: "pending",
    languageNotes: ["New version. Hindi review and human approval are required again."],
    draftLabel: "DEVELOPMENT DRAFT",
  };
  const bumped = pushVersion(db, script, body, "in_review", actor, "New script version. The approved version was not overwritten.", at);
  let next: StudioDb = { ...bumped.db, scripts: replaceEntity(bumped.db.scripts, bumped.entity) };
  next = audit(next, at, actor, "script.revised", "script", scriptId, "New version proposed. Approved script remains.", bumped.entity.currentVersion);
  return { ok: true, db: next, data: { version: bumped.entity.currentVersion, canonicalUnchanged: script.canonicalVersion != null } };
}

export function proposeStoryDrift(db: StudioDb, scriptId: string, agentId: string, now?: string): Op<{ result: "FAIL" }> {
  const at = stamp(now);
  const gate = requireAgent(db, agentId, "script.revise", at);
  if (!gate.ok) return fail(gate.db, gate.code, gate.error);
  const script = db.scripts.find((item) => item.id === scriptId);
  if (!script) return fail(db, "missing", "Script not found.");
  const snap = canonicalOf(script)?.snapshot ?? latest(script).snapshot;
  const story = db.stories.find((item) => item.id === snap.storyId);
  const storySnap = story?.versions.find((item) => item.version === snap.storyVersion)?.snapshot;
  if (!storySnap) return fail(db, "story", "Approved story for this script is missing.");
  const anchors = anchorsFromStory(storySnap);
  const scenes = snap.scenes.map((scene, index) =>
    index === snap.scenes.length - 1
      ? {
          ...scene,
          lines: [...scene.lines, { characterId: null, speaker: "Narration", hi: "अंत बदल गया।", en: "The ending is now a party." }],
        }
      : scene,
  );
  const body: ScriptBody = {
    ...snap,
    scenes,
    storyAnchors: { ...anchors, mainConflict: "different-conflict", resolution: "different ending" },
    languageReview: "pending",
    languageNotes: ["Story drift proposed. Approved script was not overwritten."],
    draftLabel: "DEVELOPMENT DRAFT",
  };
  const actor: Actor = { type: "agent", id: agentId, name: gate.agentName };
  const bumped = pushVersion(db, script, body, "revision_requested", actor, "Story consistency drift. Approved script remains.", at);
  const check = validateStoryConsistency(storySnap, body);
  let next: StudioDb = { ...bumped.db, scripts: replaceEntity(bumped.db.scripts, bumped.entity) };
  next = audit(next, at, actor, "story.consistency_flagged", "script", scriptId, check.failures.map((item) => item.detail).join(" "), bumped.entity.currentVersion);
  if (check.result !== "FAIL") return fail(next, "story-consistency", "Expected story consistency to fail.");
  return { ok: true, db: next, data: { result: "FAIL" } };
}

export function proposeStoryboardDrift(db: StudioDb, storyboardId: string, agentId: string, now?: string): Op<{ result: "FAIL"; shotId: string }> {
  const at = stamp(now);
  const gate = requireAgent(db, agentId, "storyboard.create", at);
  if (!gate.ok) return fail(gate.db, gate.code, gate.error);
  const board = db.storyboards.find((item) => item.id === storyboardId);
  if (!board) return fail(db, "missing", "Storyboard not found.");
  const snap = latest(board).snapshot;
  const shotId = `shot_drift_${board.id}`;
  const scenes = snap.scenes.map((scene, index) =>
    index === snap.scenes.length - 1
      ? {
          ...scene,
          shots: [
            ...scene.shots,
            {
              id: shotId,
              shotNo: scene.shots.length + 1,
              description: "The ending changes. The fear is deleted and everyone cheers.",
              characterIds: [...(scene.shots[0]?.characterIds ?? [])],
              locationId: scene.locationId,
              locationKey: scene.locationKey,
              camera: "wide",
              contradictsScript: true,
            },
          ],
        }
      : scene,
  );
  const body: StoryboardBody = { ...snap, scenes };
  const script = db.scripts.find((item) => item.id === snap.scriptId);
  const scriptSnap = script ? (canonicalOf(script)?.snapshot ?? latest(script).snapshot) : null;
  const actor: Actor = { type: "agent", id: agentId, name: gate.agentName };
  const bumped = pushVersion(db, board, body, "revision_requested", actor, "Shot contradicts the approved script. Prior board remains.", at);
  let next: StudioDb = { ...bumped.db, storyboards: replaceEntity(bumped.db.storyboards, bumped.entity) };
  const check = scriptSnap ? validateBoardConsistency(scriptSnap, body) : { result: "FAIL" as const, failures: [] };
  next = audit(next, at, actor, "storyboard.consistency_flagged", "storyboard", storyboardId, `Shot ${shotId} contradicts the script.`, bumped.entity.currentVersion);
  if (check.result !== "FAIL") return fail(next, "story-consistency", "Expected the storyboard drift to fail.");
  return { ok: true, db: next, data: { result: "FAIL", shotId } };
}

export function approveStoryboard(db: StudioDb, storyboardId: string, actor: Actor, note: string, now?: string): Op<{ version: number }> {
  const at = stamp(now);
  if (actor.type !== "human") {
    return fail(audit(db, at, actor, "permission.denied", "storyboard", storyboardId, "Agent tried to approve a storyboard."), "human-required", "Agents cannot approve a storyboard.");
  }
  if (note.trim().length < 12) return fail(db, "note", "Write why this storyboard matches the script.");
  const board = db.storyboards.find((item) => item.id === storyboardId);
  if (!board) return fail(db, "missing", "Storyboard not found.");
  const snap = latest(board).snapshot;
  const script = db.scripts.find((item) => item.id === snap.scriptId);
  const approved = script ? canonicalOf(script) : null;
  if (!script || !approved || approved.version !== snap.scriptVersion) {
    return fail(db, "script", "A storyboard cannot be approved until the script version it cites is approved.");
  }
  const consistency = validateBoardConsistency(approved.snapshot, snap);
  if (consistency.result === "FAIL") {
    return fail(db, "story-consistency", `STORY CONSISTENCY FAIL. ${consistency.failures[0]?.detail ?? "Storyboard drift."} It was not repaired.`);
  }
  const canonCheck = validateSubject(db, { kind: "storyboard", id: storyboardId, version: board.currentVersion, body: snap });
  if (canonCheck.result === "FAIL" || canonCheck.result === "BLOCKED") {
    const first = canonCheck.violations[0];
    return fail(db, "canon", `CANON FAIL. ${first ? `${first.entityName} ${first.field}` : "Storyboard contradicted canon."}`);
  }
  const versions = board.versions.map((v) => (v.version === board.currentVersion ? { ...v, status: "approved" as const } : v));
  const entity = { ...board, versions, canonicalVersion: board.currentVersion, updatedAt: at };
  let next: StudioDb = { ...db, storyboards: replaceEntity(db.storyboards, entity) };
  next = audit(next, at, actor, "storyboard.approved", "storyboard", storyboardId, note, entity.canonicalVersion ?? undefined);
  next = pushApproval(next, at, actor, "storyboard", storyboardId, entity.canonicalVersion ?? 1, "approved", note);
  return { ok: true, db: next, data: { version: entity.canonicalVersion ?? 1 } };
}

export function reportProductionProblem(
  db: StudioDb,
  input: { episodeId: string; sceneNo?: number; shotId?: string; problem: string; reason: string; recommendedChange: string; impact: string },
  actor: Actor,
  now?: string,
): Op<{ id: string }> {
  const at = stamp(now);
  if (actor.type === "agent") {
    const gate = requireAgent(db, actor.id, "production_plan.create", at);
    if (!gate.ok) return fail(gate.db, gate.code, gate.error);
  } else if (actor.type !== "human") {
    return fail(db, "human-required", "Not allowed.");
  }
  const episode = db.episodes.find((item) => item.id === input.episodeId);
  if (!episode) return fail(db, "missing", "Episode not found.");
  if (input.problem.trim().length < 8) return fail(db, "note", "Describe the production problem.");
  const snap = latest(episode).snapshot;
  const ided = withId(db, "rev");
  const storyBefore = db.stories.find((item) => item.id === snap.storyId);
  let next: StudioDb = {
    ...ided.db,
    productionRevisions: [
      ...ided.db.productionRevisions,
      {
        id: ided.id,
        at,
        episodeId: episode.id,
        storyId: snap.storyId,
        scriptId: snap.scriptId,
        sceneNo: input.sceneNo ?? null,
        shotId: input.shotId ?? null,
        problem: input.problem.trim(),
        reason: input.reason.trim(),
        recommendedChange: input.recommendedChange.trim(),
        impact: input.impact.trim(),
        status: "OPEN",
      },
    ],
  };
  next = audit(next, at, actor, "production.revision_requested", "episode", episode.id, input.problem.trim());
  const storyAfter = next.stories.find((item) => item.id === snap.storyId);
  if (storyBefore && storyAfter && JSON.stringify(storyBefore.versions) !== JSON.stringify(storyAfter.versions)) {
    return fail(next, "story", "A production problem must not rewrite the story.");
  }
  return { ok: true, db: next, data: { id: ided.id } };
}

export function decideProductionRevision(
  db: StudioDb,
  revisionId: string,
  decision: "ACCEPTED" | "REJECTED",
  actor: Actor,
  note: string,
  now?: string,
): Op<{ id: string }> {
  const at = stamp(now);
  if (actor.type !== "human") {
    return fail(audit(db, at, actor, "permission.denied", "production_revision", revisionId, "Agent tried to decide a production revision."), "human-required", "Only a human can accept or reject a production revision.");
  }
  if (note.trim().length < 8) return fail(db, "note", "Write the decision.");
  const revision = db.productionRevisions.find((item) => item.id === revisionId);
  if (!revision || revision.status !== "OPEN") return fail(db, "missing", "No open production revision.");
  const story = db.stories.find((item) => item.id === revision.storyId);
  let next: StudioDb = {
    ...db,
    productionRevisions: db.productionRevisions.map((item) =>
      item.id === revisionId ? { ...item, status: decision, decidedAt: at, decidedById: actor.id, decidedByName: actor.name } : item,
    ),
  };
  next = audit(next, at, actor, "production.revision_decided", "episode", revision.episodeId, `${decision}. ${note.trim()} The approved story was not rewritten.`);
  const after = next.stories.find((item) => item.id === revision.storyId);
  if (story && after && JSON.stringify(story.versions) !== JSON.stringify(after.versions)) {
    return fail(next, "story", "Deciding a production revision must not rewrite the story.");
  }
  return { ok: true, db: next, data: { id: revisionId } };
}

export function proposeNewLocation(
  db: StudioDb,
  input: { episodeId?: string; key: string; name: string; nameHi: string; description: string; reason: string },
  actor: Actor,
  now?: string,
): Op<{ id: string }> {
  const at = stamp(now);
  if (actor.type === "agent") {
    const gate = requireAgent(db, actor.id, "canon.propose", at);
    if (!gate.ok) return fail(gate.db, gate.code, gate.error);
  } else if (actor.type !== "human") {
    return fail(db, "human-required", "Not allowed.");
  }
  if (input.reason.trim().length < 8) return fail(db, "note", "Say why this location is needed.");
  const ided = withId(db, "locp");
  let next: StudioDb = {
    ...ided.db,
    locationProposals: [
      ...ided.db.locationProposals,
      {
        id: ided.id,
        at,
        episodeId: input.episodeId ?? null,
        key: input.key,
        name: input.name,
        nameHi: input.nameHi,
        description: input.description,
        reason: input.reason.trim(),
        status: "PROPOSED",
      },
    ],
  };
  next = audit(next, at, actor, "location.proposed", "location_proposal", ided.id, "Not added to canon.");
  return { ok: true, db: next, data: { id: ided.id } };
}

export function approveProductionAsset(db: StudioDb, assetId: string, actor: Actor, note: string, now?: string): Op<{ id: string }> {
  const at = stamp(now);
  if (actor.type !== "human") {
    return fail(audit(db, at, actor, "permission.denied", "asset", assetId, "Agent tried to approve an asset."), "human-required", "Agents cannot approve a production asset.");
  }
  if (note.trim().length < 12) return fail(db, "note", "Write the asset decision.");
  const asset = db.assets.find((item) => item.id === assetId);
  if (!asset) return fail(db, "missing", "Asset not found.");
  const prev = latest(asset).snapshot;
  const canonCheck = validateSubject(db, { kind: "asset", id: assetId, version: asset.currentVersion, body: prev });
  if (canonCheck.result === "FAIL" || canonCheck.result === "BLOCKED") {
    const first = canonCheck.violations[0];
    return fail(db, "canon", `CANON FAIL. ${first ? `${first.entityName} ${first.field}: proposed ${first.proposed}, canon ${first.canonical}.` : "Asset contradicted canon."} It was not replaced.`);
  }
  if (prev.commercialUseStatus === "not-cleared") {
    return fail(db, "rights", "Commercial rights are not cleared. The episode cannot advance this asset.");
  }
  if (!prev.provider || !prev.source || !prev.creator) {
    return fail(db, "provenance", "Asset is missing provenance.");
  }
  const body = { ...prev, assetStatus: "APPROVED" as const, modificationHistory: [...prev.modificationHistory, `${at} approved by ${actor.name}`] };
  const bumped = pushVersion(db, asset, body, "approved", actor, "Asset approved. Prior version kept.", at);
  const entity = { ...bumped.entity, canonicalVersion: bumped.entity.currentVersion };
  let next: StudioDb = { ...bumped.db, assets: replaceEntity(bumped.db.assets, entity) };
  next = audit(next, at, actor, "asset.approved", "asset", assetId, note, entity.currentVersion);
  next = pushApproval(next, at, actor, "asset", assetId, entity.currentVersion, "approved", note);
  return { ok: true, db: next, data: { id: assetId } };
}

export function assembleDraftEpisode(db: StudioDb, episodeId: string, actor: Actor, now?: string): Op<{ status: "PRODUCTION MOCK" }> {
  const at = stamp(now);
  if (actor.type === "agent") {
    const gate = requireAgent(db, actor.id, "production_plan.create", at);
    if (!gate.ok) return fail(gate.db, gate.code, gate.error);
  } else if (actor.type !== "human") {
    return fail(db, "human-required", "Not allowed.");
  }
  const episode = db.episodes.find((item) => item.id === episodeId);
  if (!episode) return fail(db, "missing", "Episode not found.");
  const snap = latest(episode).snapshot;
  const script = snap.scriptId ? db.scripts.find((item) => item.id === snap.scriptId) : undefined;
  if (!script?.canonicalVersion) return fail(db, "script", "Draft assembly needs an approved script.");
  if (!snap.storyboardId || !snap.planId) return fail(db, "missing", "Draft assembly needs a storyboard and a production plan.");
  const scriptSnap = canonicalOf(script)?.snapshot;
  const scenes = scriptSnap ? sceneBreakdown(scriptSnap, snap.canonVersionUsed ?? "") : [];
  if (scenes.length === 0) return fail(db, "script", "No scenes to assemble.");
  const patched = pushEpisodePatch(episode, { draftAssembled: true }, actor, at, "PRODUCTION MOCK assembled from approved references. No picture or sound was rendered.");
  let next: StudioDb = { ...db, episodes: replaceEntity(db.episodes, patched) };
  next = audit(next, at, actor, "episode.draft_assembled", "episode", episodeId, `PRODUCTION MOCK. ${scenes.length} scenes referenced. Provider NOT CONNECTED.`);
  return { ok: true, db: next, data: { status: "PRODUCTION MOCK" } };
}

export function decideLocationProposal(
  db: StudioDb,
  proposalId: string,
  decision: "APPROVED" | "REJECTED",
  actor: Actor,
  note: string,
  now?: string,
): Op<{ id: string; locationId: string | null }> {
  const at = stamp(now);
  if (actor.type !== "human") {
    return fail(audit(db, at, actor, "permission.denied", "location_proposal", proposalId, "Agent tried to add a location to canon."), "human-required", "Only a human can accept a location into canon.");
  }
  if (note.trim().length < 8) return fail(db, "note", "Write the location decision.");
  const proposal = db.locationProposals.find((item) => item.id === proposalId);
  if (!proposal || proposal.status !== "PROPOSED") return fail(db, "missing", "No open location proposal.");
  if (decision === "REJECTED") {
    let next: StudioDb = {
      ...db,
      locationProposals: db.locationProposals.map((item) => (item.id === proposalId ? { ...item, status: "REJECTED" } : item)),
    };
    next = audit(next, at, actor, "location.rejected", "location_proposal", proposalId, `${note.trim()} Not added to canon.`);
    return { ok: true, db: next, data: { id: proposalId, locationId: null } };
  }
  const before = db.locations.length;
  const created = createLocation(
    db,
    { key: proposal.key, name: proposal.name, nameHi: proposal.nameHi, description: proposal.description, kind: "recurring" },
    actor,
    at,
  );
  if (!created.ok) return created;
  const ensured = ensureSnapshot(created.db, at, "location-approved");
  let next: StudioDb = {
    ...ensured.db,
    locationProposals: ensured.db.locationProposals.map((item) =>
      item.id === proposalId ? { ...item, status: "APPROVED", resultingLocationId: created.data.id } : item,
    ),
  };
  next = audit(next, at, actor, "location.approved", "location", created.data.id, `${note.trim()} Canon snapshot ${ensured.snapshot.canonVersion}.`);
  if (next.locations.length !== before + 1) return fail(next, "canon", "Location approval did not enter canon.");
  return { ok: true, db: next, data: { id: proposalId, locationId: created.data.id } };
}

export function explainCanon(db: StudioDb, entityType: string, entityId: string) {
  const validations = db.canonValidations.filter((item) => item.entityType === entityType && item.entityId === entityId);
  const latestValidation = validations[validations.length - 1] ?? null;
  const run = [...db.generationRuns].reverse().find((item) => item.entityType === entityType && item.entityId === entityId) ?? null;
  return { validation: latestValidation, run };
}
