import { PROMPT_LIBRARY, activePrompt } from "./architecture.ts";
import { activeCanonVersion } from "./canon.ts";
import { allocId, canonicalOf, latestSnapshot } from "./engine.ts";
import type { Actor, AiExecution, AuditEvent, ObjectRecord, Op, PromptVersion, QualityReview, ScriptBody, ScriptScene, StudioDb, VersionedEntity } from "./types.ts";

export const LIVE_TEXT_PROVIDER_ID = "llm.xai";
export const LIVE_TEXT_MODEL = "grok-4.5";
export const SCRIPT_TEMPLATE_KEY = "SCRIPTWRITER_HINDI";
export const TOKEN_WARNING = 4000;

export type ProviderCallStatus =
  | "SUCCESS"
  | "TIMEOUT"
  | "PROVIDER_ERROR"
  | "RATE_LIMITED"
  | "AUTH_ERROR"
  | "VALIDATION_ERROR"
  | "INTERNAL_ERROR"
  | "CANCELLED";

export interface ScriptCharacterContext {
  id: string;
  name: string;
  nameHi: string;
  age: string;
  species: string;
  hair: string;
  eyes: string;
  role: string;
  relationship: string;
}

export interface ScriptLocationContext {
  key: string;
  name: string;
}

export interface ScriptContext {
  storyId: string;
  storyVersion: number;
  title: string;
  titleHi: string;
  logline: string;
  beginning: string;
  middle: string;
  resolution: string;
  mainConflict: string;
  learningObjective: string;
  emotionalObjective: string;
  ageBand: "3-5";
  language: "hi";
  canonVersion: string;
  canonHash: string;
  canonSnapshotId: string;
  characters: ScriptCharacterContext[];
  locations: ScriptLocationContext[];
  constraints: string[];
  templateKey: string;
  templateVersion: number;
}

export interface NormalizedTextResult {
  status: ProviderCallStatus;
  providerId: string;
  model: string;
  modelVersion: string | null;
  text: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  durationMs: number | null;
  cost: number | null;
  error: string | null;
  externalReference: string | null;
  templateKey: string;
  templateVersion: number;
  retryOf: string | null;
}

const WRITER: Actor = { type: "agent", id: "agent_scriptwriter", name: "Scriptwriter" };

function stamp(now?: string): string {
  return now ?? new Date().toISOString();
}

function fail<T>(db: StudioDb, code: string, error: string): Op<T> {
  return { ok: false, db, code, error };
}

export function promptByVersion(db: StudioDb, key: string, version: number): PromptVersion | null {
  return [...PROMPT_LIBRARY, ...(db.promptVersions ?? [])].find((item) => item.key === key && item.version === version) ?? null;
}

export function promptHistory(db: StudioDb, key: string): PromptVersion[] {
  return [...PROMPT_LIBRARY, ...(db.promptVersions ?? [])].filter((item) => item.key === key).sort((a, b) => a.version - b.version);
}

export function assembleScriptContext(db: StudioDb, storyId: string): ScriptContext | string {
  const story = db.stories.find((item) => item.id === storyId);
  const approved = story ? canonicalOf(story) : null;
  if (!story || !approved) return "A Hindi draft needs an approved story version.";
  const body = approved.snapshot;
  if (body.title === "Count the Thunder") return "Count the Thunder is a fixture. The text model does not draft it.";
  if (body.targetAge !== "3-5") return "This template is for ages 3–5.";
  const canon = activeCanonVersion(db);
  const snapshot = db.canonSnapshots.find((item) => item.hash === (body.canonSnapshotHash || canon.hash));
  const characters = body.characterIds.flatMap((id) => {
    const character = db.characters.find((item) => item.id === id);
    const version = character ? canonicalOf(character) : null;
    if (!character || !version) return [];
    const snap = version.snapshot;
    const relationship = db.relationships.find((item) => item.fromId === id || item.toId === id)?.note ?? snap.relationshipNotes[0] ?? "";
    return [{
      id,
      name: snap.name,
      nameHi: snap.nameHi,
      age: snap.age,
      species: snap.species,
      hair: snap.hair ?? "",
      eyes: snap.eyes ?? "",
      role: snap.storyFunction,
      relationship,
    }];
  });
  const locations = db.locations.flatMap((location) => {
    const version = canonicalOf(location) ?? latestSnapshot(location);
    if (!version || version.snapshot.key === "alpine-inspired") return [];
    return [{ key: version.snapshot.key, name: version.snapshot.name }];
  });
  const template = activePrompt(db, SCRIPT_TEMPLATE_KEY);
  if (!template) return "The Hindi script template is not on record.";
  return {
    storyId,
    storyVersion: approved.version,
    title: body.title,
    titleHi: body.titleHi,
    logline: body.logline,
    beginning: body.beginning,
    middle: body.middle,
    resolution: body.resolution,
    mainConflict: body.mainConflict,
    learningObjective: body.learningObjective,
    emotionalObjective: body.emotionalObjective,
    ageBand: "3-5",
    language: "hi",
    canonVersion: canon.version,
    canonHash: body.canonSnapshotHash || canon.hash,
    canonSnapshotId: snapshot?.id ?? "",
    characters,
    locations,
    constraints: [
      "Development draft only. Do not approve.",
      "Do not change character identity, age, or relationships.",
      "Do not use a location that is not in this list.",
      "The fictional Alpine range is not an approved location.",
    ],
    templateKey: template.key,
    templateVersion: template.version,
  };
}

/** What the model is allowed to see. No audit log, no credentials, no other episodes. */
export function modelPayload(context: ScriptContext): Record<string, unknown> {
  return {
    storyId: context.storyId,
    storyVersion: context.storyVersion,
    title: context.title,
    titleHi: context.titleHi,
    logline: context.logline,
    beginning: context.beginning,
    middle: context.middle,
    resolution: context.resolution,
    conflict: context.mainConflict,
    learning: context.learningObjective,
    ageBand: context.ageBand,
    language: context.language,
    canonVersion: context.canonVersion,
    canonHash: context.canonHash,
    characters: context.characters.map((item) => ({
      name: item.name,
      nameHi: item.nameHi,
      age: item.age,
      species: item.species,
      hair: item.hair,
      eyes: item.eyes,
      role: item.role,
      relationship: item.relationship,
    })),
    locations: context.locations.map((item) => ({ key: item.key, name: item.name })),
    constraints: context.constraints,
  };
}

interface DraftLine {
  speaker?: string;
  hi?: string;
  en?: string;
}

interface DraftScene {
  sceneNo?: number;
  locationKey?: string;
  action?: string;
  lines?: DraftLine[];
}

interface DraftJson {
  scenes?: DraftScene[];
  vocabulary?: Array<{ word?: string; meaning?: string; pronunciation?: string }>;
}

function parseDraft(raw: string): DraftJson | null {
  const trimmed = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    const value = JSON.parse(trimmed) as DraftJson;
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

export function validateDraftText(db: StudioDb, context: ScriptContext, raw: string): { ok: boolean; reasons: string[]; scenes: ScriptScene[]; vocabulary: ScriptBody["vocabulary"] } {
  const reasons: string[] = [];
  const parsed = parseDraft(raw);
  if (!parsed?.scenes?.length) {
    return { ok: false, reasons: ["The model did not return a script with scenes. The raw output is kept. It was not rewritten."], scenes: [], vocabulary: [] };
  }
  const names = new Map(context.characters.map((item) => [item.name.toLowerCase(), item]));
  const places = new Map(context.locations.map((item) => [item.key, item]));
  const scenes: ScriptScene[] = [];
  parsed.scenes.forEach((scene, index) => {
    const key = (scene.locationKey ?? "").trim();
    if (/alpine|आल्प्स/i.test(`${key} ${scene.action ?? ""}`)) {
      reasons.push("The draft names the Alpine range. That proposal was not approved as a location.");
    }
    const place = places.get(key);
    if (!place) reasons.push(`Scene ${index + 1} uses a location that is not approved canon.`);
    const location = db.locations.find((item) => {
      const version = canonicalOf(item) ?? latestSnapshot(item);
      return version.snapshot.key === key;
    });
    const lines = (scene.lines ?? []).flatMap((line) => {
      const speaker = (line.speaker ?? "").trim();
      const character = names.get(speaker.toLowerCase());
      if (!character) {
        reasons.push(`Scene ${index + 1} uses a speaker who is not in the approved cast.`);
        return [];
      }
      return [{ characterId: character.id, speaker: character.name, hi: (line.hi ?? "").trim(), en: (line.en ?? "").trim() }];
    });
    scenes.push({
      sceneNo: index + 1,
      locationKey: place ? key : "unapproved",
      locationId: location?.id ?? null,
      characterIds: [...new Set(lines.map((line) => line.characterId).filter((id): id is string => Boolean(id)))],
      action: (scene.action ?? "").trim() || "Action missing.",
      lines,
    });
  });
  const text = JSON.stringify(parsed);
  const devanagari = (text.match(/[\u0900-\u097F]/g) ?? []).length;
  if (devanagari < 12) reasons.push("Not enough Devanagari for a Hindi-first draft.");
  if (/blonde|blue eyes|golden hair/i.test(text)) reasons.push("The draft contradicts a locked appearance. Meethi’s hair stays black and her eyes stay dark brown.");
  if (/meethi is\s*(?:[6-9]|[1-9]\d)|मीठी\s*[6-9]\s*साल/i.test(text)) reasons.push("The draft changes Meethi’s age. She stays 5.");
  if (/cape|princess dress|magic wand/i.test(text)) reasons.push("The draft uses a forbidden character variation.");
  const vocabulary = (parsed.vocabulary ?? []).flatMap((item) => {
    const word = (item.word ?? "").trim();
    if (!word) return [];
    return [{ word, meaning: (item.meaning ?? "").trim(), pronunciation: (item.pronunciation ?? "").trim() }];
  });
  return { ok: reasons.length === 0, reasons, scenes, vocabulary };
}

function audit(db: StudioDb, at: string, actor: Actor, action: string, entityType: string, entityId: string, detail: string, version?: number): StudioDb {
  const ided = allocId(db, "aud");
  const event: AuditEvent = { id: ided.id, at, actorType: actor.type, actorId: actor.id, action, entityType, entityId, version, detail };
  return { ...ided.db, audit: [...ided.db.audit, event] };
}

function executionFor(
  db: StudioDb,
  at: string,
  result: NormalizedTextResult,
  storyId: string,
  canonSnapshotId: string,
  outputIds: string[],
  validation: "PASS" | "FAIL" | "NOT_RUN",
  idempotencyKey: string,
  error: string | null,
): { db: StudioDb; execution: AiExecution } {
  const ided = allocId(db, "aix");
  const tokens = result.inputTokens != null && result.outputTokens != null ? result.inputTokens + result.outputTokens : null;
  const execution: AiExecution = {
    id: ided.id,
    at,
    actorType: WRITER.type,
    actorId: WRITER.id,
    taskId: storyId,
    jobId: null,
    providerId: result.providerId,
    model: result.model,
    modelVersion: result.modelVersion ?? "UNKNOWN",
    capability: "LLM",
    inputArtifactIds: [storyId, canonSnapshotId].filter(Boolean),
    promptKey: result.templateKey,
    promptVersion: result.templateVersion,
    parameters: {
      template: result.templateKey,
      templateVersion: result.templateVersion,
      providerCall: result.status,
      validation,
      cost: "UNKNOWN",
      ...(result.externalReference ? { externalReference: result.externalReference } : {}),
      ...(result.retryOf ? { retryOf: result.retryOf } : {}),
      ...(tokens != null && tokens > TOKEN_WARNING ? { usageWarning: "Above the 4000 token warning. Cost is still unknown." } : {}),
    },
    outputArtifactIds: outputIds,
    durationMs: result.durationMs,
    status: result.status === "SUCCESS" && validation !== "FAIL" ? "COMPLETED" : result.status === "TIMEOUT" || result.status === "RATE_LIMITED" || result.status === "PROVIDER_ERROR" ? "RETRYABLE" : "FAILED",
    error,
    estimatedCost: result.cost,
    currency: null,
    inputUnits: result.inputTokens,
    outputUnits: result.outputTokens,
    idempotencyKey,
  };
  return { db: { ...ided.db, aiExecutions: [...(ided.db.aiExecutions ?? []), execution] }, execution };
}

export function acceptNormalizedDraft(
  db: StudioDb,
  storyId: string,
  result: NormalizedTextResult,
  actor: Actor,
  now?: string,
): Op<{ scriptId: string | null; executionId: string; validation: "PASS" | "FAIL" | "NOT_RUN" }> {
  const at = stamp(now);
  if (actor.type !== "human") return fail(db, "permission", "A human asks for the draft. The scriptwriter still cannot approve it.");
  const context = assembleScriptContext(db, storyId);
  if (typeof context === "string") return fail(db, "story", context);
  const template = promptByVersion(db, result.templateKey, result.templateVersion);
  if (!template) return fail(db, "prompt", "That template version is not on record.");
  const key = `hindi:${storyId}:v${context.storyVersion}:prompt:${result.templateKey}:v${result.templateVersion}`;
  const prior = (db.aiExecutions ?? []).filter((item) => item.idempotencyKey === key);
  if (prior.some((item) => item.parameters.validation === "PASS" || item.parameters.validation === "FAIL")) {
    const existing = prior[prior.length - 1];
    return { ok: true, db, data: { scriptId: null, executionId: existing?.id ?? "", validation: existing?.parameters.validation === "PASS" ? "PASS" : "FAIL" } };
  }
  if (prior.length >= 2) return fail(db, "retry", "This draft already used its technical retry. Another variation was not created.");
  if (prior.length === 1 && prior[0]?.status !== "RETRYABLE" && result.status === "SUCCESS") {
    return fail(db, "retry", "A content failure is not retried automatically.");
  }
  const thunder = db.episodes.find((item) => latestSnapshot(item).snapshot.title === "Count the Thunder");
  const thunderBefore = thunder ? JSON.stringify(latestSnapshot(thunder).snapshot) : null;

  if (result.status !== "SUCCESS" || !result.text?.trim()) {
    const error = result.error || result.status;
    const written = executionFor(db, at, result, storyId, context.canonSnapshotId, [], "NOT_RUN", key, error);
    let next = audit(written.db, at, actor, "text.failed", "story", storyId, `${result.providerId} ${result.status}. No script version was created. Cost unknown.`, undefined);
    if (result.retryOf) next = audit(next, at, actor, "text.retried", "ai_execution", written.execution.id, `Retry of ${result.retryOf}.`, undefined);
    return { ok: true, db: next, data: { scriptId: null, executionId: written.execution.id, validation: "NOT_RUN" } };
  }

  const checked = validateDraftText(db, context, result.text);
  const objectId = allocId(db, "obj");
  const record: ObjectRecord = {
    id: objectId.id,
    assetKey: `script-raw:${storyId}:v${context.storyVersion}:p${result.templateVersion}`,
    version: 1 + (objectId.db.objectRecords ?? []).filter((item) => item.assetKey.startsWith(`script-raw:${storyId}`)).length,
    name: `${context.title} raw draft`,
    checksum: String(result.text.length),
    byteLength: result.text.length,
    mediaType: "application/json",
    storageRef: `studio-record/${storyId}/prompt-v${result.templateVersion}`,
    rightsStatus: "UNKNOWN",
    provenanceExecutionId: null,
    createdAt: at,
    bodyText: result.text,
  };
  let next: StudioDb = { ...objectId.db, objectRecords: [...(objectId.db.objectRecords ?? []), record] };
  const story = next.stories.find((item) => item.id === storyId);
  const approved = story ? canonicalOf(story) : null;
  if (!approved) return fail(db, "story", "The approved story disappeared before the draft was filed.");
  const scriptBody: ScriptBody = {
    storyId,
    storyVersion: approved.version,
    language: "hi",
    titleHi: approved.snapshot.titleHi,
    titleEn: approved.snapshot.title,
    ageBand: "3-5",
    vocabulary: checked.vocabulary,
    pronunciationNotes: [],
    scenes: checked.scenes,
    languageReview: checked.ok ? "pending" : "fail",
    languageNotes: checked.ok ? ["Development draft. Hindi review has not passed. This is not an approval."] : checked.reasons,
    canonRefs: [`canon:${context.canonHash}`, `story:${storyId}:v${approved.version}`, `prompt:${result.templateKey}:v${result.templateVersion}`],
    providerId: result.providerId,
    providerDisclosure: "Development draft from the text gateway. Not approved. Commercial rights are not cleared.",
    canonVersionUsed: context.canonVersion,
    canonSnapshotHash: context.canonHash,
    draftLabel: "DEVELOPMENT DRAFT",
    storyAnchors: {
      premise: approved.snapshot.logline,
      mainConflict: approved.snapshot.mainConflict,
      emotionalObjective: approved.snapshot.emotionalObjective,
      learningObjective: approved.snapshot.learningObjective,
      resolution: approved.snapshot.resolution,
      characterIds: [...approved.snapshot.characterIds],
    },
  };
  const scriptIded = allocId(next, "scr");
  const script: VersionedEntity<ScriptBody> = {
    id: scriptIded.id,
    type: "script",
    name: scriptBody.titleEn,
    currentVersion: 1,
    canonicalVersion: null,
    createdAt: at,
    updatedAt: at,
    versions: [{ version: 1, status: checked.ok ? "in_review" : "draft", snapshot: scriptBody, createdAt: at, createdBy: WRITER.id, note: checked.ok ? "Development draft. Not approved." : checked.reasons.join(" "), immutable: true }],
  };
  next = { ...scriptIded.db, scripts: [...scriptIded.db.scripts, script] };
  const written = executionFor(next, at, result, storyId, context.canonSnapshotId, [script.id, record.id], checked.ok ? "PASS" : "FAIL", key, checked.ok ? null : checked.reasons.join(" "));
  next = written.db;
  next = {
    ...next,
    objectRecords: (next.objectRecords ?? []).map((item) => (item.id === record.id ? { ...item, provenanceExecutionId: written.execution.id } : item)),
    scripts: next.scripts.map((item) =>
      item.id === script.id
        ? { ...item, versions: item.versions.map((version) => ({ ...version, snapshot: { ...version.snapshot, generationRunId: written.execution.id } })) }
        : item,
    ),
  };
  if (!checked.ok) {
    const reviewId = allocId(next, "qa");
    const review: QualityReview = {
      id: reviewId.id,
      at,
      gate: "canon",
      result: "FAIL",
      redFlag: false,
      entityType: "script",
      entityId: script.id,
      version: 1,
      checks: checked.reasons.map((reason) => ({ name: "canon", result: "FAIL" as const, detail: reason })),
      agentId: WRITER.id,
    };
    next = { ...reviewId.db, qualityReviews: [...reviewId.db.qualityReviews, review] };
    next = audit(next, at, actor, "text.validation_failed", "script", script.id, checked.reasons.join(" "), 1);
  } else {
    const episode = next.episodes.find((item) => latestSnapshot(item).snapshot.storyId === storyId && latestSnapshot(item).snapshot.title !== "Count the Thunder");
    if (episode && latestSnapshot(episode).snapshot.stage === "STORY_APPROVED") {
      const current = latestSnapshot(episode).snapshot;
      const version = episode.currentVersion + 1;
      const moved: VersionedEntity<typeof current> = {
        ...episode,
        currentVersion: version,
        updatedAt: at,
        versions: [...episode.versions, { version, status: "approved", snapshot: { ...current, stage: "SCRIPT_DRAFT", scriptId: script.id, scriptVersion: 1, lastError: null }, createdAt: at, createdBy: actor.id, note: "Script draft filed. Not approved.", immutable: true }],
      };
      next = { ...next, episodes: next.episodes.map((item) => (item.id === episode.id ? moved : item)) };
    }
    next = audit(next, at, actor, "text.generated", "script", script.id, `Development draft. Template ${result.templateKey} v${result.templateVersion}. Provider ${result.providerId}. Not approved.`, 1);
  }
  if (result.retryOf) next = audit(next, at, actor, "text.retried", "ai_execution", written.execution.id, `Retry of ${result.retryOf}.`, undefined);
  const thunderAfter = next.episodes.find((item) => item.id === thunder?.id);
  if (thunderBefore && thunderAfter && JSON.stringify(latestSnapshot(thunderAfter).snapshot) !== thunderBefore) {
    return fail(db, "regression", "Count the Thunder would have changed. The draft was rejected.");
  }
  return { ok: true, db: next, data: { scriptId: script.id, executionId: written.execution.id, validation: checked.ok ? "PASS" : "FAIL" } };
}

export function appendScriptVersion(db: StudioDb, scriptId: string, note: string, actor: Actor, now?: string): Op<{ version: number }> {
  const at = stamp(now);
  if (actor.type !== "human") return fail(db, "permission", "A human files the next script version.");
  if (note.trim().length < 8) return fail(db, "note", "Write what changed. The previous version stays.");
  const script = db.scripts.find((item) => item.id === scriptId);
  if (!script) return fail(db, "missing", "Script not found.");
  const current = latestSnapshot(script);
  const before = JSON.stringify(current.snapshot);
  const snapshot: ScriptBody = { ...structuredClone(current.snapshot), languageNotes: [...current.snapshot.languageNotes, note.trim()] };
  if (JSON.stringify(current.snapshot) !== before) return fail(db, "history", "The previous script version would have been rewritten.");
  const version = script.currentVersion + 1;
  const entity = {
    ...script,
    currentVersion: version,
    canonicalVersion: script.canonicalVersion,
    updatedAt: at,
    versions: [...script.versions, { version, status: "draft" as const, snapshot, createdAt: at, createdBy: actor.id, note: note.trim(), immutable: true }],
  };
  const kept = entity.versions.find((item) => item.version === current.version);
  if (!kept || JSON.stringify(kept.snapshot) !== before) return fail(db, "history", "The previous script version would have been rewritten.");
  const next = audit({ ...db, scripts: db.scripts.map((item) => (item.id === scriptId ? entity : item)) }, at, actor, "script.versioned", "script", scriptId, `v${version} added. v${current.version} was not overwritten.`, version);
  return { ok: true, db: next, data: { version } };
}
