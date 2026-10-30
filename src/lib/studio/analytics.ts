import { ALPINE_KEY } from "./brain.ts";
import { allocId, freshAnalyticsConfig, latestSnapshot } from "./engine.ts";
import type {
  Actor,
  AnalyticsAnomaly,
  AnalyticsBaseline,
  AnalyticsComparison,
  AnalyticsConfidence,
  AnalyticsConfig,
  AnalyticsCorrection,
  AnalyticsDataState,
  AnalyticsEvidencePacket,
  AnalyticsExperiment,
  AnalyticsFormat,
  AnalyticsInterpretation,
  AnalyticsLesson,
  AnalyticsMetric,
  AnalyticsObservation,
  AnalyticsProvider,
  AnalyticsQualityFlag,
  AnalyticsSource,
  BrainConfidence,
  BrainDecisionLog,
  BrainRecommendation,
  EvidenceSignal,
  ExperimentConclusion,
  InterpretationStatus,
  LessonStatus,
  Op,
  RetentionShape,
  SongUsage,
  StudioDb,
} from "./types.ts";

const PERCENT: ReadonlySet<AnalyticsMetric> = new Set(["ctr", "average_percentage_viewed", "retention", "completion"]);
const PII = /\b(e-?mail|phone number|date of birth|child profile|home address|school name|private message)\b/i;
const CAUSATION = /\b(causes|caused|causing|proves|proved|proven|guarantees|guaranteed)\b/i;

export interface ObservationInput {
  episodeId: string;
  title?: string;
  hypothetical?: boolean;
  source?: AnalyticsSource;
  provider?: AnalyticsProvider;
  publishedAt?: string | null;
  format?: AnalyticsFormat;
  language?: string;
  runtimeSeconds?: number | null;
  locationKey?: string | null;
  worldKey?: string | null;
  characterNames?: string[];
  characterIds?: string[];
  storyStructure?: string | null;
  storyId?: string | null;
  storyVersion?: number | null;
  scriptVersion?: number | null;
  episodeVersion?: number | null;
  planVersion?: number | null;
  targetAge?: string | null;
  songUsage?: SongUsage;
  retentionShape?: RetentionShape | null;
  metrics?: Partial<Record<AnalyticsMetric, number | null>>;
  trafficSources?: string[];
  audienceGeography?: string[];
  note?: string;
  productionCost?: number | null;
  productionMinutes?: number | null;
  claimPublished?: boolean;
}

export interface AudienceReading {
  dataState: AnalyticsDataState;
  views: number | null;
  retention: number | null;
  ctr: number | null;
  watchTime: number | null;
  completion: number | null;
  reason: string;
  hypothetical: boolean;
}

export interface AnalyticsOverview {
  evidenceState: EvidenceSignal;
  confidence: AnalyticsConfidence;
  publishedEpisodes: number;
  liveConnected: false;
  totalViews: number | null;
  totalWatchTime: number | null;
  averageRetention: number | null;
  averageCompletion: number | null;
  statement: string;
  insights: string[];
  sampleSize: number;
  hypotheticalCount: number;
  medianRetention: number | null;
}

export interface LocationRank {
  key: string;
  sampleSize: number;
  medianRetention: number | null;
}

export interface AnalyticsBrief {
  happened: string;
  learning: string[];
  uncertain: string[];
  investigate: string[];
  experiments: Array<{ id: string; hypothesis: string; status: string; conclusion: string | null }>;
  episodes: Array<{ id: string; title: string; dataState: AnalyticsDataState; detail: string }>;
  patterns: string[];
  anomalies: string[];
  lessons: string[];
  quality: string[];
  locations: LocationRank[];
  overview: AnalyticsOverview;
  liveConnected: false;
}

export function statesCausation(text: string): boolean {
  return CAUSATION.test(text);
}

export function confidenceFor(sampleSize: number, hypothetical: boolean): { confidence: AnalyticsConfidence; evidence: EvidenceSignal } {
  if (sampleSize <= 0) return { confidence: "INSUFFICIENT", evidence: "INSUFFICIENT_DATA" };
  if (sampleSize < 8) return { confidence: "LOW", evidence: "EARLY_SIGNAL" };
  if (hypothetical || sampleSize < 12) return { confidence: "MEDIUM", evidence: "REPEATED_SIGNAL" };
  return { confidence: "HIGH", evidence: "STRONG_SIGNAL" };
}

function fail<T>(db: StudioDb, code: string, error: string): Op<T> {
  return { ok: false, db, code, error };
}

function stamp(now?: string): string {
  return now ?? new Date().toISOString();
}

function guard(text: string): string {
  if (statesCausation(text)) return "This is an association in the current sample. Causality is unknown.";
  return text;
}

function num(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function configOf(db: StudioDb): AnalyticsConfig {
  return db.analyticsConfig ?? freshAnalyticsConfig();
}

function rowsOf(db: StudioDb): AnalyticsObservation[] {
  return db.analyticsObservations ?? [];
}

function humanOnly(actor: Actor): boolean {
  return actor.type === "human";
}

function audit(db: StudioDb, at: string, actor: Actor, action: string, entityId: string, detail: string): StudioDb {
  const ided = allocId(db, "aud");
  return {
    ...ided.db,
    audit: [
      ...ided.db.audit,
      { id: ided.id, at, actorType: actor.type, actorId: actor.id, action, entityType: "analytics", entityId, detail },
    ],
  };
}

function isPossible(metric: AnalyticsMetric, value: number): boolean {
  if (!Number.isFinite(value)) return false;
  if (PERCENT.has(metric)) return value >= 0 && value <= 100;
  return value >= 0;
}

function usable(row: AnalyticsObservation, metric: AnalyticsMetric): number | null {
  const value = row.metrics[metric];
  if (value == null || !isPossible(metric, value)) return null;
  return value;
}

function center(values: number[], method: "median" | "mean"): number | null {
  if (!values.length) return null;
  if (method === "mean") return values.reduce((sum, value) => sum + value, 0) / values.length;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function excluded(db: StudioDb, observationId: string): boolean {
  return (db.analyticsCorrections ?? []).some((item) => item.targetType === "observation" && item.targetId === observationId && item.verdict === "EXCLUDE_OUTLIER");
}

function blockedLocation(db: StudioDb, key: string | null): boolean {
  if (!key) return false;
  if (key === ALPINE_KEY) {
    return !db.episodes.some((episode) => latestSnapshot(episode).snapshot.stage === "PUBLISHED");
  }
  const entry = (db.locationLibrary ?? []).find((item) => item.key === key);
  return Boolean(entry && (entry.status === "PROPOSED" || entry.status === "RETIRED"));
}

function rankableRows(db: StudioDb): AnalyticsObservation[] {
  return rowsOf(db).filter((row) => row.rankable && !excluded(db, row.id) && !blockedLocation(db, row.locationKey));
}

function isUnpublishedStudioEpisode(db: StudioDb, episodeId: string): boolean {
  const episode = db.episodes.find((item) => item.id === episodeId);
  if (!episode) return false;
  return latestSnapshot(episode).snapshot.stage !== "PUBLISHED";
}

function namedThunder(db: StudioDb, episodeId: string, title: string | undefined): boolean {
  if ((title ?? "").trim().toLowerCase() === "count the thunder") return true;
  const episode = db.episodes.find((item) => item.id === episodeId);
  if (!episode) return false;
  return latestSnapshot(episode).snapshot.title === "Count the Thunder";
}

function bucketKey(config: AnalyticsConfig, seconds: number | null): string | null {
  if (seconds == null || !Number.isFinite(seconds)) return null;
  const found = config.lengthBuckets.find((bucket) => seconds >= bucket.minSeconds && (bucket.maxSeconds == null || seconds < bucket.maxSeconds));
  return found?.key ?? null;
}

function pushFlag(
  db: StudioDb,
  at: string,
  flag: Omit<AnalyticsQualityFlag, "id" | "at" | "status" | "repaired">,
): StudioDb {
  const exists = (db.analyticsQuality ?? []).some(
    (item) => item.code === flag.code && item.observationId === flag.observationId && item.detail === flag.detail,
  );
  if (exists) return db;
  const ided = allocId(db, "aq");
  const row: AnalyticsQualityFlag = { ...flag, id: ided.id, at, status: "DATA_QUALITY_ISSUE", repaired: false };
  return { ...ided.db, analyticsQuality: [...(ided.db.analyticsQuality ?? []), row] };
}

export function audienceFor(db: StudioDb, episodeId: string): AudienceReading {
  const empty: AudienceReading = {
    dataState: "NOT_AVAILABLE",
    views: null,
    retention: null,
    ctr: null,
    watchTime: null,
    completion: null,
    reason: "No audience measurement is stored.",
    hypothetical: false,
  };
  if (isUnpublishedStudioEpisode(db, episodeId) || namedThunder(db, episodeId, undefined)) {
    return {
      ...empty,
      reason: "Audience performance is not available. This episode is unpublished, so views, retention, and click-through rate are not inferred.",
    };
  }
  const rows = rowsOf(db).filter((row) => row.episodeId === episodeId);
  if (!rows.length) return empty;
  const latest = rows[rows.length - 1];
  const retention = usable(latest, "retention");
  const views = usable(latest, "views");
  const ctr = usable(latest, "ctr");
  const watchTime = usable(latest, "watch_time");
  const completion = usable(latest, "completion");
  const unusable = retention == null && views == null && ctr == null && completion == null;
  return {
    dataState: unusable ? "INSUFFICIENT_DATA" : "OBSERVED",
    views,
    retention,
    ctr,
    watchTime,
    completion,
    hypothetical: latest.hypothetical,
    reason: latest.hypothetical
      ? "Hypothetical sample. Not a live platform measurement, and not a reason to copy the episode."
      : "Observed measurement for the stored content version. Missing metrics stay unknown.",
  };
}

export function analyticsOverview(db: StudioDb): AnalyticsOverview {
  const publishedEpisodes = db.episodes.filter((episode) => latestSnapshot(episode).snapshot.stage === "PUBLISHED").length;
  const sample = rankableRows(db);
  const hypotheticalCount = sample.filter((row) => row.hypothetical).length;
  const live = sample.filter((row) => !row.hypothetical);
  const retentions = sample.map((row) => usable(row, "retention")).filter((value): value is number => value != null);
  const completions = sample.map((row) => usable(row, "completion")).filter((value): value is number => value != null);
  const liveViews = live.map((row) => usable(row, "views")).filter((value): value is number => value != null);
  const liveWatch = live.map((row) => usable(row, "watch_time")).filter((value): value is number => value != null);
  const confidence = confidenceFor(retentions.length, hypotheticalCount > 0 || live.length === 0);
  const insights = (db.analyticsInterpretations ?? [])
    .filter((item) => item.status === "OPEN" || item.status === "CORRECT")
    .map((item) => item.interpretation)
    .filter((text) => !statesCausation(text));
  let statement: string;
  if (!rowsOf(db).length && publishedEpisodes === 0) {
    statement = "INSUFFICIENT DATA. No episode has been published, and no audience measurement is stored. Unpublished episodes are not treated as successes or failures.";
  } else if (!retentions.length) {
    statement = "INSUFFICIENT DATA. Records may exist, but there is no usable audience measurement. Impossible values were not repaired.";
  } else if (live.length === 0) {
    statement = `Early signal only. ${sample.length} hypothetical measurement${sample.length === 1 ? "" : "s"} ${sample.length === 1 ? "is" : "are"} stored. Confidence is ${confidence.confidence}. This is not live audience data and it is not a reason to copy an episode.`;
  } else {
    statement = `${live.length} live measurement${live.length === 1 ? "" : "s"}. Confidence ${confidence.confidence}. A higher number is a reason to investigate, not to make more episodes.`;
  }
  return {
    evidenceState: retentions.length ? confidence.evidence : "INSUFFICIENT_DATA",
    confidence: retentions.length ? confidence.confidence : "INSUFFICIENT",
    publishedEpisodes,
    liveConnected: false,
    totalViews: liveViews.length ? liveViews.reduce((sum, value) => sum + value, 0) : null,
    totalWatchTime: liveWatch.length ? liveWatch.reduce((sum, value) => sum + value, 0) : null,
    averageRetention: live.length ? center(live.map((row) => usable(row, "retention")).filter((value): value is number => value != null), configOf(db).baselineMethod) : null,
    averageCompletion: live.length ? center(live.map((row) => usable(row, "completion")).filter((value): value is number => value != null), configOf(db).baselineMethod) : null,
    statement,
    insights: publishedEpisodes === 0 && !sample.length ? [] : insights,
    sampleSize: retentions.length,
    hypotheticalCount,
    medianRetention: retentions.length ? center(retentions, configOf(db).baselineMethod) : null,
  };
}

export function locationRankings(db: StudioDb): LocationRank[] {
  const groups = new Map<string, number[]>();
  for (const row of rankableRows(db)) {
    if (!row.locationKey || blockedLocation(db, row.locationKey)) continue;
    const value = usable(row, "retention");
    if (value == null) continue;
    groups.set(row.locationKey, [...(groups.get(row.locationKey) ?? []), value]);
  }
  return [...groups.entries()].map(([key, values]) => ({
    key,
    sampleSize: values.length,
    medianRetention: center(values, configOf(db).baselineMethod),
  }));
}

export function importObservation(db: StudioDb, input: ObservationInput, actor: Actor, now?: string): Op<{ id: string }> {
  const at = stamp(now);
  if (!humanOnly(actor)) {
    return fail(audit(db, at, actor, "analytics.import_denied", input.episodeId, "An agent tried to invent audience data."), "permission", "An agent cannot import audience data or turn it into a production order.");
  }
  const note = (input.note ?? "").trim();
  const geography = (input.audienceGeography ?? []).join(" ");
  if (PII.test(`${note} ${geography} ${(input.characterNames ?? []).join(" ")}`)) {
    return fail(audit(db, at, actor, "analytics.privacy_denied", input.episodeId, "Personal data was refused."), "privacy", "Personal data is not stored. Analytics accepts aggregated platform metrics only.");
  }
  if (namedThunder(db, input.episodeId, input.title) || isUnpublishedStudioEpisode(db, input.episodeId)) {
    return fail(
      audit(db, at, actor, "analytics.unpublished_refused", input.episodeId, "No audience numbers were written for an unpublished episode."),
      "not-available",
      "Audience performance is not available. This episode is unpublished, so no views, retention, or click-through rate are recorded.",
    );
  }
  const config = configOf(db);
  const episode = db.episodes.find((item) => item.id === input.episodeId);
  const linked = Boolean(episode);
  const metrics = { ...(input.metrics ?? {}) };
  const hypothetical = input.hypothetical === true || input.source === "hypothetical";
  const locationKey = input.locationKey ?? null;
  const rankable = !blockedLocation(db, locationKey);
  const episodeVersion = input.episodeVersion ?? (episode ? episode.versions.length : 1);
  const ided = allocId(db, "obs");
  const row: AnalyticsObservation = {
    id: ided.id,
    at,
    episodeId: input.episodeId,
    title: (input.title ?? episode?.name ?? input.episodeId).trim() || input.episodeId,
    storyId: input.storyId ?? null,
    storyVersion: input.storyVersion ?? null,
    scriptVersion: input.scriptVersion ?? null,
    episodeVersion,
    planVersion: input.planVersion ?? null,
    storyStructure: input.storyStructure ?? null,
    targetAge: input.targetAge ?? null,
    characterIds: input.characterIds ?? [],
    characterNames: input.characterNames ?? [],
    locationKey,
    worldKey: input.worldKey ?? null,
    runtimeSeconds: input.runtimeSeconds ?? null,
    lengthBucket: bucketKey(config, input.runtimeSeconds ?? null),
    format: input.format ?? "long-form",
    language: input.language ?? "hi",
    publishedAt: input.publishedAt ?? null,
    source: input.source ?? (hypothetical ? "hypothetical" : "manual"),
    provider: input.provider ?? "manual",
    hypothetical,
    linkedToStudioEpisode: linked,
    rankable,
    metrics,
    trafficSources: input.trafficSources ?? [],
    audienceGeography: input.audienceGeography ?? [],
    songUsage: input.songUsage ?? "unknown",
    retentionShape: input.retentionShape ?? null,
    productionCost: input.productionCost ?? null,
    productionMinutes: input.productionMinutes ?? null,
    note,
    privacy: "aggregated-platform-only",
  };
  let next: StudioDb = { ...ided.db, analyticsObservations: [...rowsOf(ided.db), row] };
  for (const [key, value] of Object.entries(metrics) as Array<[AnalyticsMetric, number | null | undefined]>) {
    if (value == null) continue;
    if (!isPossible(key, value)) {
      next = pushFlag(next, at, {
        observationId: row.id,
        episodeId: row.episodeId,
        code: "impossible_value",
        detail: `${key} was stored as ${value}. It was not changed and it is excluded from comparisons.`,
      });
    }
  }
  const hasCore = ["views", "retention", "completion", "watch_time"].some((key) => metrics[key as AnalyticsMetric] != null);
  if (!hasCore) {
    next = pushFlag(next, at, {
      observationId: row.id,
      episodeId: row.episodeId,
      code: "missing_metrics",
      detail: "Core audience metrics are missing. They stay unknown rather than zero.",
    });
  }
  if (!row.targetAge) {
    next = pushFlag(next, at, { observationId: row.id, episodeId: row.episodeId, code: "missing_age", detail: "Target age is missing." });
  }
  if (!row.storyStructure) {
    next = pushFlag(next, at, { observationId: row.id, episodeId: row.episodeId, code: "missing_dna", detail: "Story structure is missing, so this row cannot support a story pattern." });
  }
  if (!row.characterNames.length && !row.characterIds.length) {
    next = pushFlag(next, at, { observationId: row.id, episodeId: row.episodeId, code: "missing_characters", detail: "No character reference is stored on this measurement." });
  }
  if (!linked && !hypothetical) {
    next = pushFlag(next, at, { observationId: row.id, episodeId: row.episodeId, code: "bad_episode_id", detail: "This episode id is not in the studio. The row was kept and was not remapped." });
  }
  if (input.claimPublished && !row.publishedAt) {
    next = pushFlag(next, at, { observationId: row.id, episodeId: row.episodeId, code: "missing_timestamp", detail: "A published measurement was claimed without a publication time." });
  }
  if (linked && episode && input.episodeVersion != null && input.episodeVersion !== episode.versions.length) {
    next = pushFlag(next, at, {
      observationId: row.id,
      episodeId: row.episodeId,
      code: "inconsistent_version",
      detail: `Measurement is linked to episode version ${input.episodeVersion}. The studio episode is now version ${episode.versions.length}. The historical row was not rewritten.`,
    });
  }
  if (locationKey && blockedLocation(next, locationKey)) {
    next = pushFlag(next, at, {
      observationId: row.id,
      episodeId: row.episodeId,
      code: "proposed_location",
      detail: "This place is not approved, produced, and published. It is excluded from performance rankings.",
    });
  }
  const duplicate = rowsOf(db).some(
    (item) => item.episodeId === row.episodeId && item.episodeVersion === row.episodeVersion && item.source === row.source && JSON.stringify(item.metrics) === JSON.stringify(row.metrics),
  );
  if (duplicate) {
    next = pushFlag(next, at, {
      observationId: row.id,
      episodeId: row.episodeId,
      code: "duplicate",
      detail: "A matching measurement already exists. Both rows are kept. Nothing was merged.",
    });
  }
  if (input.productionCost != null && input.productionCost < 0) {
    next = pushFlag(next, at, { observationId: row.id, episodeId: row.episodeId, code: "impossible_value", detail: `Production cost was stored as ${input.productionCost}. It was not repaired.` });
  }
  next = audit(next, at, actor, "analytics.imported", row.id, "Raw measurement stored. It was not interpreted as an order to produce or publish.");
  return { ok: true, db: next, data: { id: row.id } };
}

export function correctInterpretation(
  db: StudioDb,
  interpretationId: string,
  verdict: "CORRECT" | "INCORRECT" | "NEEDS_MORE_DATA" | "MISLEADING",
  note: string,
  actor: Actor,
  now?: string,
): Op<{ status: InterpretationStatus }> {
  const at = stamp(now);
  if (!humanOnly(actor)) return fail(db, "human-required", "Only a human can correct an interpretation.");
  if (note.trim().length < 8) return fail(db, "note", "Write what is wrong or what context matters.");
  const current = (db.analyticsInterpretations ?? []).find((item) => item.id === interpretationId);
  if (!current) return fail(db, "missing", "No interpretation to correct.");
  const status: InterpretationStatus = verdict === "NEEDS_MORE_DATA" ? "NEEDS_MORE_DATA" : verdict;
  const ided = allocId(db, "acorr");
  const correction: AnalyticsCorrection = {
    id: ided.id,
    at,
    actorId: actor.id,
    actorName: actor.name,
    targetType: "interpretation",
    targetId: current.id,
    verdict,
    note: note.trim(),
  };
  const next = audit(
    {
      ...ided.db,
      analyticsCorrections: [...(ided.db.analyticsCorrections ?? []), correction],
      analyticsInterpretations: (ided.db.analyticsInterpretations ?? []).map((item) => (item.id === current.id ? { ...item, status } : item)),
    },
    at,
    actor,
    "analytics.corrected",
    current.id,
    "Interpretation status changed. Raw measurements were not rewritten.",
  );
  return { ok: true, db: next, data: { status } };
}

export function excludeOutlier(db: StudioDb, observationId: string, note: string, actor: Actor, now?: string): Op<{ id: string }> {
  const at = stamp(now);
  if (!humanOnly(actor)) return fail(db, "human-required", "Only a human can exclude an outlier.");
  if (note.trim().length < 8) return fail(db, "note", "Write why this measurement should leave the comparison.");
  const current = rowsOf(db).find((item) => item.id === observationId);
  if (!current) return fail(db, "missing", "No measurement to exclude.");
  const ided = allocId(db, "acorr");
  const correction: AnalyticsCorrection = {
    id: ided.id,
    at,
    actorId: actor.id,
    actorName: actor.name,
    targetType: "observation",
    targetId: current.id,
    verdict: "EXCLUDE_OUTLIER",
    note: note.trim(),
  };
  const next = audit(
    { ...ided.db, analyticsCorrections: [...(ided.db.analyticsCorrections ?? []), correction] },
    at,
    actor,
    "analytics.outlier_excluded",
    current.id,
    "Outlier left future comparisons. The raw measurement remains.",
  );
  return { ok: true, db: next, data: { id: correction.id } };
}

export function setBaselineMethod(db: StudioDb, method: "median" | "mean", actor: Actor, now?: string): Op<{ version: number }> {
  const at = stamp(now);
  if (!humanOnly(actor)) return fail(db, "human-required", "Only a human can change a baseline definition.");
  const config = configOf(db);
  if (config.baselineMethod === method) return { ok: true, db, data: { version: config.baselineDefinitionVersion } };
  const version = config.baselineDefinitionVersion + 1;
  const next = audit(
    { ...db, analyticsConfig: { ...config, baselineMethod: method, baselineDefinitionVersion: version, liveYouTube: false, privacy: "aggregated-platform-only" } },
    at,
    actor,
    "analytics.baseline_redefined",
    "baseline",
    `Baseline method is now ${method}. Older conclusions stay stored and need review.`,
  );
  return { ok: true, db: next, data: { version } };
}

export function setLengthBuckets(
  db: StudioDb,
  buckets: AnalyticsConfig["lengthBuckets"],
  actor: Actor,
  now?: string,
): Op<{ count: number }> {
  const at = stamp(now);
  if (!humanOnly(actor)) return fail(db, "human-required", "Only a human can change length buckets.");
  if (buckets.length < 1) return fail(db, "note", "Keep at least one length bucket.");
  const config = configOf(db);
  const next = audit(
    { ...db, analyticsConfig: { ...config, lengthBuckets: buckets, liveYouTube: false } },
    at,
    actor,
    "analytics.buckets_set",
    "buckets",
    "Length buckets changed. They are settings, not a rule that shorter is better.",
  );
  return { ok: true, db: next, data: { count: buckets.length } };
}

export interface ExperimentInput {
  hypothesis: string;
  objective?: string;
  variables?: string[];
  controlGroup?: string;
  testGroup?: string;
  targetAge?: string;
  metric?: AnalyticsMetric;
  baselineNote?: string;
}

export function proposeExperiment(db: StudioDb, input: ExperimentInput, actor: Actor, now?: string): Op<{ id: string }> {
  const at = stamp(now);
  if (!humanOnly(actor)) return fail(db, "permission", "An agent cannot open an experiment or publish one.");
  if (input.hypothesis.trim().length < 8) return fail(db, "note", "Write the hypothesis.");
  const ided = allocId(db, "exp");
  const row: AnalyticsExperiment = {
    id: ided.id,
    at,
    hypothesis: input.hypothesis.trim(),
    objective: (input.objective ?? "Learn whether the variable is associated with a difference.").trim(),
    variables: input.variables ?? [],
    controlGroup: input.controlGroup ?? "Comparable episodes that do not change the variable.",
    testGroup: input.testGroup ?? "Episodes that change one variable only.",
    targetAge: input.targetAge ?? db.studio?.ageBand ?? "3-5",
    metric: input.metric ?? "retention",
    baselineNote: input.baselineNote ?? "No result yet. A missing result is not support.",
    result: null,
    interpretation: null,
    confidence: "INSUFFICIENT",
    conclusion: null,
    nextRecommendation: "Do not publish this experiment from analytics.",
    status: "PROPOSED",
  };
  const next = audit({ ...ided.db, analyticsExperiments: [...(ided.db.analyticsExperiments ?? []), row] }, at, actor, "analytics.experiment_proposed", row.id, "Experiment stored. Nothing was published.");
  return { ok: true, db: next, data: { id: row.id } };
}

export function concludeExperiment(
  db: StudioDb,
  experimentId: string,
  conclusion: Exclude<ExperimentConclusion, null>,
  result: string,
  actor: Actor,
  now?: string,
): Op<{ status: AnalyticsExperiment["status"] }> {
  const at = stamp(now);
  if (!humanOnly(actor)) return fail(db, "permission", "An agent cannot conclude an experiment or publish it.");
  if (result.trim().length < 8) return fail(db, "note", "Write the result, including when it is inconclusive.");
  const current = (db.analyticsExperiments ?? []).find((item) => item.id === experimentId);
  if (!current) return fail(db, "missing", "No experiment.");
  const status = conclusion === "inconclusive" ? "INCONCLUSIVE" : "COMPLETED";
  const interpretation =
    conclusion === "supported"
      ? "The result is consistent with the hypothesis in this test. That is not proof for every future episode."
      : conclusion === "not_supported"
        ? "The result did not support the hypothesis. This negative result stays on record."
        : "The test is inconclusive. No conclusion is forced.";
  const nextRecommendation =
    conclusion === "supported"
      ? "A human may ask the studio brain to investigate. Analytics will not publish the test."
      : conclusion === "not_supported"
        ? "Keep the negative result. Do not automatically repeat or reverse the episode."
        : "Leave the question open.";
  const updated: AnalyticsExperiment = {
    ...current,
    result: result.trim(),
    interpretation: guard(interpretation),
    conclusion,
    confidence: "LOW",
    status,
    nextRecommendation,
  };
  let next: StudioDb = {
    ...db,
    analyticsExperiments: (db.analyticsExperiments ?? []).map((item) => (item.id === current.id ? updated : item)),
  };
  if (conclusion === "not_supported") {
    const fingerprint = `lesson:experiment:${current.id}`;
    if (!(next.analyticsLessons ?? []).some((item) => item.fingerprint === fingerprint)) {
      const ided = allocId(next, "learn");
      const lesson: AnalyticsLesson = {
        id: ided.id,
        at,
        fingerprint,
        observation: guard(interpretation),
        evidence: result.trim(),
        sampleSize: 0,
        confidence: "LOW",
        affected: current.hypothesis,
        interpretation: guard(interpretation),
        recommendation: nextRecommendation,
        status: "INVESTIGATING",
        negative: true,
        interpretationId: null,
        reviewNote: "Failed experiments are kept.",
      };
      next = { ...ided.db, analyticsLessons: [...(ided.db.analyticsLessons ?? []), lesson] };
    }
  }
  next = audit(next, at, actor, "analytics.experiment_concluded", current.id, `${conclusion}. The experiment was not published.`);
  return { ok: true, db: next, data: { status } };
}

export function setLessonStatus(db: StudioDb, lessonId: string, status: LessonStatus, actor: Actor, note: string, now?: string): Op<{ status: LessonStatus }> {
  const at = stamp(now);
  if (!humanOnly(actor)) return fail(db, "human-required", "Only a human can confirm or retire a lesson.");
  if (note.trim().length < 8) return fail(db, "note", "Write why the lesson status changes.");
  const current = (db.analyticsLessons ?? []).find((item) => item.id === lessonId);
  if (!current) return fail(db, "missing", "No lesson.");
  const updated: AnalyticsLesson = { ...current, status, reviewNote: note.trim() };
  const next = audit(
    { ...db, analyticsLessons: (db.analyticsLessons ?? []).map((item) => (item.id === current.id ? updated : item)) },
    at,
    actor,
    "analytics.lesson_status",
    current.id,
    "Lesson status changed. The original observation text was kept.",
  );
  return { ok: true, db: next, data: { status } };
}

function sameIds(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const a = [...left].sort();
  const b = [...right].sort();
  return a.every((value, index) => value === b[index]);
}

export function commitAnalysis(db: StudioDb, actor: Actor, now?: string): Op<{ interpretations: number; anomalies: number; packets: number }> {
  const at = stamp(now);
  if (!humanOnly(actor)) return fail(db, "permission", "An agent cannot turn measurements into a production order.");
  const config = configOf(db);
  const def = config.baselineDefinitionVersion;
  const method = config.baselineMethod;
  let next: StudioDb = {
    ...db,
    analyticsInterpretations: (db.analyticsInterpretations ?? []).map((item) => {
      if (item.definitionVersion >= def) return item;
      if (item.status === "OUTDATED" || item.status === "NEEDS_REVIEW") return item;
      const status: InterpretationStatus = item.status === "OPEN" ? "OUTDATED" : "NEEDS_REVIEW";
      return { ...item, status };
    }),
    analyticsBaselines: (db.analyticsBaselines ?? []).map((item) => (item.definitionVersion < def && item.status === "ACTIVE" ? { ...item, status: "RETIRED" } : item)),
  };
  const sample = rankableRows(next);
  const formats = new Set(sample.map((row) => row.format));
  if (formats.size > 1) {
    next = pushFlag(next, at, {
      observationId: null,
      episodeId: null,
      code: "incompatible_format",
      detail: "More than one format is stored. Shorts are not compared with long episodes. View counts stay inside each format.",
    });
  }
  const groups = new Map<string, AnalyticsObservation[]>();
  for (const row of sample) {
    const key = `${row.format}|${row.targetAge ?? "age-unknown"}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const baselineByKey = new Map<string, AnalyticsBaseline>();
  for (const [groupKey, group] of groups) {
    const [format, age] = groupKey.split("|");
    const values = group.map((row) => usable(row, "retention")).filter((value): value is number => value != null);
    const key = `retention:${format}:${age}:${method}`;
    const value = center(values, method);
    const observationIds = group.map((row) => row.id);
    const existing = (next.analyticsBaselines ?? []).find(
      (item) =>
        item.status === "ACTIVE" &&
        item.key === key &&
        item.definitionVersion === def &&
        item.method === method &&
        item.value === value &&
        sameIds(item.observationIds, observationIds),
    );
    if (existing) {
      baselineByKey.set(groupKey, existing);
      continue;
    }
    next = {
      ...next,
      analyticsBaselines: (next.analyticsBaselines ?? []).map((item) => (item.key === key && item.status === "ACTIVE" ? { ...item, status: "RETIRED" } : item)),
    };
    const version = (next.analyticsBaselines ?? []).filter((item) => item.key === key).reduce((max, item) => Math.max(max, item.version), 0) + 1;
    const ided = allocId(next, "base");
    const baseline: AnalyticsBaseline = {
      id: ided.id,
      at,
      key,
      version,
      definitionVersion: def,
      label: `${method} retention for ${format}, ages ${age} (n=${values.length}, baseline v${version}, definition v${def})`,
      metric: "retention",
      method,
      scope: `Same format (${format}) and target age (${age}). Other formats are excluded. Proposed locations are excluded. Unpublished studio episodes are excluded.`,
      value,
      sampleSize: values.length,
      episodeIds: [...new Set(group.map((row) => row.episodeId))],
      observationIds,
      format: format as AnalyticsFormat,
      status: "ACTIVE",
    };
    next = { ...ided.db, analyticsBaselines: [...(ided.db.analyticsBaselines ?? []), baseline] };
    baselineByKey.set(groupKey, baseline);
  }
  for (const row of sample) {
    const baseline = baselineByKey.get(`${row.format}|${row.targetAge ?? "age-unknown"}`);
    const observed = usable(row, "retention");
    if (!baseline || observed == null || baseline.value == null) continue;
    const others = baseline.observationIds.filter((id) => id !== row.id);
    if (others.length < 2) continue;
    const otherRows = sample.filter((item) => others.includes(item.id));
    const otherValues = otherRows.map((item) => usable(item, "retention")).filter((value): value is number => value != null);
    const baselineValue = center(otherValues, method);
    if (baselineValue == null) continue;
    if ((next.analyticsComparisons ?? []).some((item) => item.observationId === row.id && item.baselineId === baseline.id && item.metric === "retention")) continue;
    const delta = observed - baselineValue;
    const ided = allocId(next, "cmp");
    const comparison: AnalyticsComparison = {
      id: ided.id,
      at,
      observationId: row.id,
      episodeId: row.episodeId,
      baselineId: baseline.id,
      baselineVersion: baseline.version,
      definitionVersion: def,
      metric: "retention",
      observed,
      baselineValue,
      delta,
      statement: guard(
        `Retention ${num(observed)} versus ${baseline.label.replace(/n=\d+/, `n=${otherValues.length}`)} excluding this episode (baseline ${num(baselineValue)}).`,
      ),
      compatible: true,
      dataState: "COMPARED",
    };
    next = { ...ided.db, analyticsComparisons: [...(ided.db.analyticsComparisons ?? []), comparison] };
  }
  const addInterpretation = (draft: Omit<AnalyticsInterpretation, "id" | "at" | "status">) => {
    if ((next.analyticsInterpretations ?? []).some((item) => item.fingerprint === draft.fingerprint)) return;
    const ided = allocId(next, "aint");
    const row: AnalyticsInterpretation = { ...draft, id: ided.id, at, observed: guard(draft.observed), interpretation: guard(draft.interpretation), recommendation: guard(draft.recommendation), status: "OPEN" };
    next = { ...ided.db, analyticsInterpretations: [...(ided.db.analyticsInterpretations ?? []), row] };
  };
  if (sample.length > 0 && sample.length < 3) {
    for (const row of sample) {
      const retention = usable(row, "retention");
      if (retention == null) continue;
      const level = confidenceFor(1, row.hypothetical);
      addInterpretation({
        fingerprint: `episode:${row.id}:d${def}`,
        kind: "episode",
        title: row.title,
        observed: `Observed retention ${num(retention)} on “${row.title}”. Episode version ${row.episodeVersion ?? "unknown"}. ${row.hypothetical ? "Hypothetical sample." : "Reported measurement."}`,
        compared: "No separate baseline yet. One or two measurements cannot show a pattern.",
        interpretation: "This is a single early signal. It may be worth investigating. It is not a rule about what to make next.",
        recommendation: "Investigate this measurement before any production decision. Do not copy the episode.",
        confidence: level.confidence,
        evidenceState: level.evidence,
        sampleSize: 1,
        baselineId: null,
        baselineVersion: null,
        definitionVersion: def,
        observationIds: [row.id],
        episodeIds: [row.episodeId],
        limitations: `n = 1. Linked to episode version ${row.episodeVersion ?? "unknown"}. Confidence is LOW because the sample is small. ${row.hypothetical ? "Not live YouTube." : ""}`,
      });
    }
  }
  const structures = new Map<string, AnalyticsObservation[]>();
  for (const row of sample) {
    if (!row.storyStructure) continue;
    const key = `${row.format}|${row.storyStructure}`;
    structures.set(key, [...(structures.get(key) ?? []), row]);
  }
  for (const [key, group] of structures) {
    const [format, structure] = key.split("|");
    const values = group.map((row) => usable(row, "retention")).filter((value): value is number => value != null);
    if (values.length < 3) continue;
    const baseline = baselineByKey.get(`${format}|${group[0]?.targetAge ?? "age-unknown"}`);
    const median = center(values, method);
    const level = confidenceFor(values.length, group.some((row) => row.hypothetical));
    const others = sample.filter((row) => row.format === format && row.storyStructure !== structure);
    const otherValues = others.map((row) => usable(row, "retention")).filter((value): value is number => value != null);
    const otherMedian = center(otherValues, method);
    const weaker = otherMedian != null && median != null && median <= otherMedian - 10 && otherValues.length >= 3;
    const stronger = otherMedian != null && median != null && median >= otherMedian + 10 && otherValues.length >= 3;
    const compared = baseline
      ? `Studio baseline: ${baseline.label}. ${otherMedian == null ? "No other structure is in this format yet." : `Other structures in this format: ${method} ${num(otherMedian)} (n=${otherValues.length}).`}`
      : "No baseline is stored.";
    const ids = group.map((row) => row.id).join(".");
    const fingerprint = `pattern:${structure}:${format}:d${def}:${ids}`;
    next = {
      ...next,
      analyticsInterpretations: (next.analyticsInterpretations ?? []).map((item) =>
        item.kind === "pattern" && item.status === "OPEN" && item.fingerprint.startsWith(`pattern:${structure}:${format}:`) && item.fingerprint !== fingerprint
          ? { ...item, status: "OUTDATED" }
          : item,
      ),
    };
    addInterpretation({
      fingerprint,
      kind: "pattern",
      title: structure,
      observed: `“${structure}” appears in ${values.length} comparable ${format} observations. ${method} retention ${median == null ? "unknown" : num(median)}.`,
      compared,
      interpretation: weaker
        ? `“${structure}” is associated with weaker retention than other structures in this sample. The result is kept. It is not a ban.`
        : stronger
          ? `“${structure}” is associated with higher retention than other structures in this sample. Causality is unknown.`
          : `Possible pattern only. “${structure}” has a measured retention in this sample. More observations are needed before treating it as a rule.`,
      recommendation: "Investigate this structure. Do not ban it, and do not copy it into new episodes automatically.",
      confidence: level.confidence,
      evidenceState: level.evidence,
      sampleSize: values.length,
      baselineId: baseline?.id ?? null,
      baselineVersion: baseline?.version ?? null,
      definitionVersion: def,
      observationIds: group.map((row) => row.id),
      episodeIds: [...new Set(group.map((row) => row.episodeId))],
      limitations: `n = ${values.length}. Baseline ${baseline?.label ?? "not available"}. ${group.some((row) => row.hypothetical) ? "Includes hypothetical rows, so this is not live audience proof." : "Reported rows only."} No statistical significance is claimed.`,
    });
  }
  const names = new Set(sample.flatMap((row) => row.characterNames.map((name) => name.trim()).filter(Boolean)));
  for (const name of names) {
    const withCharacter = sample.filter((row) => row.characterNames.some((item) => item.toLowerCase() === name.toLowerCase()));
    const without = sample.filter((row) => !row.characterNames.some((item) => item.toLowerCase() === name.toLowerCase()));
    const left = withCharacter.map((row) => usable(row, "retention")).filter((value): value is number => value != null);
    const right = without.map((row) => usable(row, "retention")).filter((value): value is number => value != null);
    if (left.length < 2 || right.length < 2) continue;
    const leftMedian = center(left, method);
    const rightMedian = center(right, method);
    if (leftMedian == null || rightMedian == null || leftMedian < rightMedian + 5) continue;
    const level = confidenceFor(left.length + right.length, sample.some((row) => row.hypothetical));
    addInterpretation({
      fingerprint: `character:${name.toLowerCase()}:${method}:d${def}:${[...left, ...right].join(".")}`,
      kind: "character",
      title: name,
      observed: `Episodes featuring ${name}: n=${left.length}, ${method} retention ${num(leftMedian)}. Episodes without ${name}: n=${right.length}, ${method} retention ${num(rightMedian)}.`,
      compared: `Comparison is inside this sample only, using ${method}.`,
      interpretation: `Episodes featuring ${name} are associated with higher retention in this sample. Causality is unknown.`,
      recommendation: `Do not treat this as proof that adding ${name} will improve future episodes.`,
      confidence: level.confidence,
      evidenceState: level.evidence,
      sampleSize: left.length + right.length,
      baselineId: null,
      baselineVersion: null,
      definitionVersion: def,
      observationIds: [...withCharacter, ...without].map((row) => row.id),
      episodeIds: [...new Set(sample.map((row) => row.episodeId))],
      limitations: `n = ${left.length + right.length}. Association only. Character appearance is not a controlled experiment.`,
    });
  }
  for (const [format, group] of groupBy(sample, (row) => row.format)) {
    const values = group.map((row) => usable(row, "retention")).filter((value): value is number => value != null);
    if (!values.length) continue;
    const level = confidenceFor(values.length, group.some((row) => row.hypothetical));
    addInterpretation({
      fingerprint: `format:${format}:d${def}:${group.map((row) => row.id).join(".")}`,
      kind: "format",
      title: format,
      observed: `${format} observations: n=${values.length}. ${method} retention ${num(center(values, method) ?? 0)}.`,
      compared: "This format is not compared with a different format.",
      interpretation: "Format results stay inside their own group. A Short's views are not treated as a long episode's performance.",
      recommendation: "Keep formats separate when investigating. Do not convert one format into another automatically.",
      confidence: level.confidence,
      evidenceState: level.evidence,
      sampleSize: values.length,
      baselineId: null,
      baselineVersion: null,
      definitionVersion: def,
      observationIds: group.map((row) => row.id),
      episodeIds: [...new Set(group.map((row) => row.episodeId))],
      limitations: "Cross-format comparison is a data-quality issue, not a finding.",
    });
  }
  for (const [bucket, group] of groupBy(sample.filter((row) => row.lengthBucket), (row) => row.lengthBucket ?? "unknown")) {
    const values = group.map((row) => usable(row, "retention")).filter((value): value is number => value != null);
    if (values.length < 2) continue;
    const level = confidenceFor(values.length, group.some((row) => row.hypothetical));
    const label = config.lengthBuckets.find((item) => item.key === bucket)?.label ?? bucket;
    addInterpretation({
      fingerprint: `length:${bucket}:d${def}:${group.map((row) => row.id).join(".")}`,
      kind: "length",
      title: label,
      observed: `${label}: n=${values.length}. ${method} retention ${num(center(values, method) ?? 0)}.`,
      compared: "Length buckets are studio settings. They are not a claim that shorter is better.",
      interpretation: "Runtime and retention can be looked at together. A shorter episode is not assumed to be better.",
      recommendation: "Investigate runtime alongside the story. Do not shorten episodes from this number alone.",
      confidence: level.confidence,
      evidenceState: level.evidence,
      sampleSize: values.length,
      baselineId: null,
      baselineVersion: null,
      definitionVersion: def,
      observationIds: group.map((row) => row.id),
      episodeIds: [...new Set(group.map((row) => row.episodeId))],
      limitations: "Buckets can be changed by a human. Historical rows keep the bucket they were given.",
    });
  }
  const songs = sample.filter((row) => row.songUsage === "song" || row.songUsage === "recurring-song" || row.songUsage === "musical-segment");
  const quiet = sample.filter((row) => row.songUsage === "none");
  const songValues = songs.map((row) => usable(row, "retention")).filter((value): value is number => value != null);
  const quietValues = quiet.map((row) => usable(row, "retention")).filter((value): value is number => value != null);
  if (songValues.length >= 2 && quietValues.length >= 2) {
    const songMedian = center(songValues, method);
    const quietMedian = center(quietValues, method);
    if (songMedian != null && quietMedian != null && Math.abs(songMedian - quietMedian) >= 5) {
      const level = confidenceFor(songValues.length + quietValues.length, sample.some((row) => row.hypothetical));
      addInterpretation({
        fingerprint: `song:${method}:d${def}:${songValues.length}:${quietValues.length}`,
        kind: "song",
        title: "Songs",
        observed: `Musical episodes: n=${songValues.length}, ${method} retention ${num(songMedian)}. Episodes with no song: n=${quietValues.length}, ${method} retention ${num(quietMedian)}.`,
        compared: "Same-sample comparison. Not a music quota.",
        interpretation: "Musical episodes currently show a retention difference in this sample. That is an observation, not an instruction to add songs.",
        recommendation: "The studio brain may investigate whether music is contributing. Do not automatically increase song usage.",
        confidence: level.confidence,
        evidenceState: level.evidence,
        sampleSize: songValues.length + quietValues.length,
        baselineId: null,
        baselineVersion: null,
        definitionVersion: def,
        observationIds: [...songs, ...quiet].map((row) => row.id),
        episodeIds: [...new Set([...songs, ...quiet].map((row) => row.episodeId))],
        limitations: "Song usage is associated here. It is not shown to be the cause.",
      });
    }
  }
  for (const rank of locationRankings(next)) {
    if (rank.medianRetention == null || rank.key === ALPINE_KEY) continue;
    const level = confidenceFor(rank.sampleSize, sample.some((row) => row.hypothetical));
    addInterpretation({
      fingerprint: `location:${rank.key}:d${def}:${rank.sampleSize}:${num(rank.medianRetention)}`,
      kind: "location",
      title: rank.key,
      observed: `Location “${rank.key}” in this sample: n=${rank.sampleSize}, ${method} retention ${num(rank.medianRetention)}.`,
      compared: "Proposed places are not included in location rankings.",
      interpretation: "Location figures describe where published or sampled episodes were set. They do not approve a new place.",
      recommendation: "Use this only as evidence. Do not add a location to canon from analytics.",
      confidence: level.confidence,
      evidenceState: level.evidence,
      sampleSize: rank.sampleSize,
      baselineId: null,
      baselineVersion: null,
      definitionVersion: def,
      observationIds: sample.filter((row) => row.locationKey === rank.key).map((row) => row.id),
      episodeIds: sample.filter((row) => row.locationKey === rank.key).map((row) => row.episodeId),
      limitations: "A proposed location stays out of audience conclusions until it is approved, produced, and published.",
    });
  }
  for (const [format, group] of groupBy(sample, (row) => row.format)) {
    const values = group.map((row) => usable(row, "retention")).filter((value): value is number => value != null);
    if (values.length < 3) continue;
    const mid = center(values, method);
    if (mid == null) continue;
    const viewValues = group.map((row) => usable(row, "views")).filter((value): value is number => value != null);
    const viewMid = center(viewValues, method);
    for (const row of group) {
      const retention = usable(row, "retention");
      const views = usable(row, "views");
      if (retention != null && retention >= mid + 20) {
        addAnomaly(next, at, {
          fingerprint: `anomaly:${row.id}:spike`,
          episodeId: row.episodeId,
          observationId: row.id,
          kind: "spike",
          summary: `Retention on “${row.title}” is unusually high compared with other ${format} episodes (${num(retention)} versus ${method} ${num(mid)}, n=${values.length}).`,
          detail: "Investigate the opening, the runtime, the topic, the characters, and the traffic source. This is not an instruction to repeat the episode.",
          confidence: "LOW",
          sampleSize: values.length,
        });
        next = currentDb();
      }
      if (retention != null && retention <= mid - 20) {
        addAnomaly(next, at, {
          fingerprint: `anomaly:${row.id}:drop`,
          episodeId: row.episodeId,
          observationId: row.id,
          kind: "drop",
          summary: `Retention on “${row.title}” is unusually low compared with other ${format} episodes (${num(retention)} versus ${method} ${num(mid)}, n=${values.length}).`,
          detail: "Investigate the drop. Do not delete or publish anything from this signal.",
          confidence: "LOW",
          sampleSize: values.length,
        });
        next = currentDb();
      }
      if (retention != null && views != null && viewMid != null && retention <= 40 && views >= viewMid * 2) {
        addAnomaly(next, at, {
          fingerprint: `anomaly:${row.id}:views-retention-mismatch`,
          episodeId: row.episodeId,
          observationId: row.id,
          kind: "views-retention-mismatch",
          summary: `“${row.title}” has high views beside poor retention. Views ${num(views)} versus sample ${method} ${num(viewMid)}. Retention ${num(retention)}.`,
          detail: "Investigate the mismatch. Do not make more episodes because the view count is high.",
          confidence: "LOW",
          sampleSize: values.length,
        });
        next = currentDb();
      }
    }
  }

  function currentDb(): StudioDb {
    return next;
  }
  function addAnomaly(base: StudioDb, when: string, draft: Omit<AnalyticsAnomaly, "id" | "at" | "action">) {
    if ((base.analyticsAnomalies ?? []).some((item) => item.fingerprint === draft.fingerprint)) return;
    const ided = allocId(base, "anom");
    const row: AnalyticsAnomaly = { ...draft, id: ided.id, at: when, summary: guard(draft.summary), detail: guard(draft.detail), action: "INVESTIGATE" };
    next = { ...ided.db, analyticsAnomalies: [...(ided.db.analyticsAnomalies ?? []), row] };
  }

  const openFindings = (next.analyticsInterpretations ?? []).filter((item) => item.status === "OPEN" || item.status === "CORRECT");
  for (const finding of openFindings) {
    if ((next.analyticsLessons ?? []).some((item) => item.fingerprint === `lesson:${finding.fingerprint}`)) continue;
    const ided = allocId(next, "learn");
    const lesson: AnalyticsLesson = {
      id: ided.id,
      at,
      fingerprint: `lesson:${finding.fingerprint}`,
      observation: finding.observed,
      evidence: finding.compared ?? finding.limitations,
      sampleSize: finding.sampleSize,
      confidence: finding.confidence,
      affected: finding.title,
      interpretation: finding.interpretation,
      recommendation: finding.recommendation,
      status: finding.evidenceState === "INSUFFICIENT_DATA" ? "INCONCLUSIVE" : "INVESTIGATING",
      negative: /weaker|did not support|not a ban/i.test(finding.interpretation),
      interpretationId: finding.id,
      reviewNote: "Review again after more comparable episodes. This is not eternal truth.",
    };
    next = { ...ided.db, analyticsLessons: [...(ided.db.analyticsLessons ?? []), lesson] };
  }
  next = {
    ...next,
    analyticsLessons: (next.analyticsLessons ?? []).map((lesson) => {
      const source = (next.analyticsInterpretations ?? []).find((item) => item.id === lesson.interpretationId);
      if (!source) return lesson;
      if ((source.status === "OUTDATED" || source.status === "NEEDS_REVIEW") && (lesson.status === "NEW" || lesson.status === "INVESTIGATING")) {
        return { ...lesson, status: "RETIRED" };
      }
      return lesson;
    }),
    analyticsPackets: (next.analyticsPackets ?? []).map((packet) => {
      const source = (next.analyticsInterpretations ?? []).find((item) => item.id === packet.interpretationId);
      if (source && (source.status === "OUTDATED" || source.status === "NEEDS_REVIEW")) return { ...packet, stale: true };
      return packet;
    }),
  };
  for (const finding of next.analyticsInterpretations ?? []) {
    if (finding.status !== "OPEN" && finding.status !== "CORRECT") continue;
    if ((next.analyticsPackets ?? []).some((item) => item.interpretationId === finding.id)) continue;
    const ided = allocId(next, "pkt");
    const packet: AnalyticsEvidencePacket = {
      id: ided.id,
      at,
      interpretationId: finding.id,
      finding: finding.interpretation,
      baseline: finding.compared ?? "No separate baseline.",
      sampleSize: finding.sampleSize,
      confidence: finding.confidence,
      limitations: finding.limitations,
      suggestedConsideration: finding.confidence === "INSUFFICIENT" ? "DO_NOT_TREAT_AS_FACT" : "INVESTIGATE",
      handedToBrain: false,
      brainRecommendationId: null,
      stale: false,
    };
    next = { ...ided.db, analyticsPackets: [...(ided.db.analyticsPackets ?? []), packet] };
  }
  next = audit(next, at, actor, "analytics.committed", "analysis", "Comparisons and interpretations were stored beside the raw rows. Production was not changed.");
  return {
    ok: true,
    db: next,
    data: {
      interpretations: (next.analyticsInterpretations ?? []).length,
      anomalies: (next.analyticsAnomalies ?? []).length,
      packets: (next.analyticsPackets ?? []).length,
    },
  };
}

function groupBy<T>(items: T[], keyOf: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return groups;
}

export function handEvidenceToBrain(db: StudioDb, packetId: string, actor: Actor, now?: string): Op<{ recommendationId: string }> {
  const at = stamp(now);
  if (!humanOnly(actor)) return fail(db, "permission", "An agent cannot file analytics as a studio decision.");
  if ((db.brainAutonomy ?? 2) < 1) return fail(db, "autonomy", "Autonomy is observe-only. The packet stays in analytics.");
  const packet = (db.analyticsPackets ?? []).find((item) => item.id === packetId);
  if (!packet) return fail(db, "missing", "No evidence packet.");
  if (packet.stale) return fail(db, "stale", "This finding is outdated or needs review. Analytics will not send it as an order.");
  if (packet.handedToBrain && packet.brainRecommendationId) return { ok: true, db, data: { recommendationId: packet.brainRecommendationId } };
  const category = packet.suggestedConsideration === "EXPERIMENT" ? "EXPERIMENT" : "INVESTIGATE";
  const confidence: BrainConfidence = packet.confidence === "HIGH" ? "HIGH" : packet.confidence === "MEDIUM" ? "MEDIUM" : "LOW";
  const hypothesis = confidence === "LOW" || packet.suggestedConsideration === "DO_NOT_TREAT_AS_FACT";
  const ided = allocId(db, "brain");
  const rec: BrainRecommendation = {
    id: ided.id,
    at,
    category,
    title: packet.suggestedConsideration === "DO_NOT_TREAT_AS_FACT" ? "Do not treat this analytics note as fact" : "Investigate an analytics finding",
    rationale: guard(packet.finding),
    evidence: [packet.baseline, `Sample size ${packet.sampleSize}. Confidence ${packet.confidence}.`, packet.limitations],
    confidence,
    hypothesis,
    targetAge: db.studio?.ageBand ?? "3-5",
    characterIds: [],
    locationKey: null,
    risks: ["Weak or early data must not become a production quota.", "Analytics does not approve, publish, or change canon."],
    recommendedAction:
      packet.suggestedConsideration === "DO_NOT_TREAT_AS_FACT"
        ? "Keep this as a question. Do not change the production queue."
        : "A human may investigate. Analytics did not open production and did not publish.",
    fingerprint: `investigate:analytics:${packet.id}`,
    status: "OPEN",
    humanDecision: null,
    outcomes: [],
  };
  const logId = allocId(ided.db, "blog");
  const log: BrainDecisionLog = {
    id: logId.id,
    at,
    recommendationId: rec.id,
    recommendation: rec.title,
    evidence: rec.evidence,
    reasoning: rec.rationale,
    confidence: rec.confidence,
    humanDecision: null,
    resultingAction: rec.recommendedAction,
    outcome: null,
  };
  let next: StudioDb = {
    ...logId.db,
    brainRecommendations: [...(logId.db.brainRecommendations ?? []), rec],
    brainDecisions: [...(logId.db.brainDecisions ?? []), log],
    analyticsPackets: (logId.db.analyticsPackets ?? []).map((item) => (item.id === packet.id ? { ...item, handedToBrain: true, brainRecommendationId: rec.id } : item)),
  };
  next = audit(next, at, actor, "analytics.handed_to_brain", rec.id, "Evidence was sent to the studio brain as a recommendation. The production queue was not changed.");
  return { ok: true, db: next, data: { recommendationId: rec.id } };
}

export function analyticsPublish(db: StudioDb, episodeId: string, actor: Actor, now?: string): Op<never> {
  const at = stamp(now);
  return fail(audit(db, at, actor, "analytics.publish_denied", episodeId, "Analytics cannot publish."), "publish-disabled", "Analytics cannot publish an episode.");
}

export function analyticsApproveEpisode(db: StudioDb, episodeId: string, actor: Actor, now?: string): Op<never> {
  const at = stamp(now);
  return fail(audit(db, at, actor, "analytics.approve_denied", episodeId, "Analytics cannot approve an episode."), "permission", "Analytics cannot approve an episode, a story, or a script.");
}

export function analyticsClearRights(db: StudioDb, episodeId: string, actor: Actor, now?: string): Op<never> {
  const at = stamp(now);
  return fail(audit(db, at, actor, "analytics.rights_denied", episodeId, "Analytics cannot clear a rights flag."), "rights", "Analytics cannot clear rights or remove a red flag.");
}

export function analyticsChangeCanon(db: StudioDb, actor: Actor, now?: string): Op<never> {
  const at = stamp(now);
  return fail(audit(db, at, actor, "analytics.canon_denied", "canon", "Analytics cannot change canon."), "canon", "Analytics cannot change canon or approve a location.");
}

export function analyticsBrief(db: StudioDb): AnalyticsBrief {
  const overview = analyticsOverview(db);
  const episodes = db.episodes.map((episode) => {
    const snap = latestSnapshot(episode).snapshot;
    const audience = audienceFor(db, episode.id);
    return { id: episode.id, title: snap.title, dataState: audience.dataState, detail: audience.reason };
  });
  const lessons = (db.analyticsLessons ?? []).filter((item) => item.status !== "RETIRED");
  const uncertain = (db.analyticsInterpretations ?? [])
    .filter((item) => item.confidence === "LOW" || item.confidence === "INSUFFICIENT" || item.status === "NEEDS_REVIEW" || item.status === "NEEDS_MORE_DATA")
    .map((item) => `${item.title}: confidence ${item.confidence}. ${item.limitations}`);
  const anomalies = (db.analyticsAnomalies ?? []).map((item) => `${item.action}. ${item.summary} ${item.detail}`);
  const packets = (db.analyticsPackets ?? []).filter((item) => !item.handedToBrain && !item.stale).map((item) => `${item.suggestedConsideration}. ${item.finding} n=${item.sampleSize}. Confidence ${item.confidence}.`);
  return {
    happened: overview.statement,
    learning: lessons.length ? lessons.slice(-4).map((item) => `${item.observation} Confidence ${item.confidence}. n=${item.sampleSize}. ${item.status}.`) : ["No learning entry is stored yet."],
    uncertain: uncertain.length ? uncertain.slice(0, 4) : ["Not enough published audience data to support a rule."],
    investigate: [...anomalies, ...packets].slice(0, 6),
    experiments: (db.analyticsExperiments ?? []).map((item) => ({ id: item.id, hypothesis: item.hypothesis, status: item.status, conclusion: item.conclusion })),
    episodes,
    patterns: (db.analyticsInterpretations ?? []).filter((item) => item.kind === "pattern" && item.status !== "OUTDATED").map((item) => `${item.observed} ${item.interpretation} Confidence ${item.confidence}.`),
    anomalies,
    lessons: lessons.map((item) => `${item.status}${item.negative ? " · negative" : ""}. ${item.observation}`),
    quality: (db.analyticsQuality ?? []).map((item) => `${item.status}: ${item.detail}`),
    locations: locationRankings(db),
    overview,
    liveConnected: false,
  };
}
