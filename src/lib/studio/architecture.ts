import { DEV_MODEL, DEV_PROVIDER_ID, allocId, approveStory, fingerprint, latestSnapshot, publishEpisode } from "./engine.ts";
import { importPerformance, locationUsableForProduction, registerPublication, reuseQa } from "./source.ts";
import type {
  Actor,
  AiExecution,
  FeatureFlags,
  ObjectRecord,
  Op,
  PromptVersion,
  ProviderCapability,
  StudioDb,
  StudioJob,
  StudioRole,
} from "./types.ts";

export const CONTROL_PLANE = [
  "Studio",
  "Canon",
  "Story Intelligence",
  "Production",
  "Agents",
  "QA / Rights / Policy",
  "Studio Brain",
  "Analytics",
] as const;

export const PERSISTENCE = {
  sourceOfTruth: "postgresql",
  documentTable: "studio_documents",
  objectStorage: "s3-compatible",
  objectMetadataTable: "object_metadata",
  binariesInPostgres: false,
  region: "single",
  kubernetes: false,
  environment: "LOCAL",
} as const;

export const PROMPT_LIBRARY: PromptVersion[] = [
  {
    id: "prompt_scriptwriter_children_v3",
    key: "SCRIPTWRITER_CHILDREN",
    version: 3,
    purpose: "Create a Hindi development script from an approved story.",
    input: "StoryVersion, CanonVersion, TargetAge",
    output: "ScriptVersion",
    body: "Write a development-draft Hindi script for ages 3–5 from the approved story version and the canon snapshot. Do not approve it. Do not publish it.",
    status: "ACTIVE",
  },
  {
    id: "prompt_story_proposal_v1",
    key: "STORY_PROPOSAL",
    version: 1,
    purpose: "Propose a story from canon. A human approves.",
    input: "CanonVersion, TargetAge",
    output: "StoryVersion",
    body: "Propose one story inside the locked world. Do not approve it.",
    status: "ACTIVE",
  },
  {
    id: "prompt_scriptwriter_hindi_v1",
    key: "SCRIPTWRITER_HINDI",
    version: 1,
    name: "Scriptwriter — Hindi children's episode",
    purpose: "Write a Hindi development draft from one approved story and the active canon snapshot.",
    input: "Approved StoryVersion, CanonSnapshot, target age 3–5, locked characters, approved locations",
    output: "ScriptVersion development draft",
    agentId: "agent_scriptwriter",
    ageBand: "3-5",
    language: "hi",
    createdBy: "studio",
    createdAt: "2026-10-07T21:00:00.000Z",
    changeNote: "First production template. Later edits must be a new version.",
    body: "Write a DEVELOPMENT DRAFT Hindi script for ages 3–5. Use only the approved story, the named characters, and the listed locations. Do not approve the script, change who a character is, invent canon, clear rights, or publish. Return JSON with scenes. Each scene has sceneNo, locationKey, action, and lines. Each line has speaker, hi, and en. Hindi uses Devanagari. Speakers and locationKey must be from the context you were given.",
    status: "ACTIVE",
  },
  {
    id: "prompt_character_image_v1",
    key: "CHARACTER_IMAGE",
    version: 1,
    name: "Character image — initial or follow-up",
    purpose: "Ask for one still image of one canonical character. A human reviews it.",
    input: "Approved character version, canon snapshot, exclusions, reference ids if any",
    output: "One image asset version",
    ageBand: "3-5",
    language: "en",
    createdBy: "studio",
    createdAt: "2026-10-16T18:00:00.000Z",
    changeNote: "First image template. Later edits must be a new version.",
    body: "Make one still image for a children's animation model sheet. Use only the character facts that follow. Do not add a cape, a princess dress, a magic wand, a brand logo, or a written caption. Do not change hair, eyes, clothes, or age. If a fact is marked unknown, leave it unspecified. This image is not approved and not a rights clearance.",
    status: "ACTIVE",
  },
  {
    id: "prompt_character_image_v2",
    key: "CHARACTER_IMAGE",
    version: 2,
    name: "Character image — reference portrait",
    purpose: "Ask for one readable portrait of one canonical character. A human reviews it. Framing is not art-direction canon.",
    input: "Approved character version, canon snapshot, exclusions, reference ids if any",
    output: "One image asset version",
    ageBand: "3-5",
    language: "en",
    createdBy: "studio",
    createdAt: "2026-10-17T01:10:00.000Z",
    changeNote: "Portrait framing for a reference candidate. Version 1 is unchanged. This does not lock art direction.",
    body: "Make one still character-reference portrait for a children's animation, ages 3–5. Show one child alone. The face, hair, ribbon, eyes, and clothes must be clearly readable. Use a plain uncluttered background. Do not add a cape, a princess dress, a magic wand, a brand logo, written text, a watermark, extra characters, or a costume change. Do not change hair, eyes, clothes, or age. If a fact is marked unknown, do not treat the drawn detail as canon. This image is a candidate, not an approval and not a rights clearance.",
    status: "ACTIVE",
  },
  {
    id: "prompt_character_image_v3",
    key: "CHARACTER_IMAGE",
    version: 3,
    name: "Character image — ribbon and full figure",
    purpose: "Ask for one full-figure portrait. A ribbon is not a bow. Art direction stays unlocked.",
    input: "Approved character version, canon snapshot, exclusions",
    output: "One image asset version",
    ageBand: "3-5",
    language: "en",
    createdBy: "studio",
    createdAt: "2026-10-17T02:40:00.000Z",
    changeNote: "Clarifies the red ribbon is a strip of cloth, not a bow. Asks for the whole figure and no unlisted decoration. Versions 1 and 2 are unchanged.",
    body: "Make one still character-reference portrait for a children's animation, ages 3–5. Show one child alone, fully visible from the head through the lower garment. Use soft even light and a plain neutral background. The hair accessory is a simple red ribbon, a strip of cloth tied in the hair, not a bow. Do not add neckline embroidery, extra patterns, props, other characters, captions, logos, or watermarks. Do not add a cape, a princess dress, a magic wand, or a brand logo. Do not change hair, eyes, clothes, or age. Clothes are only the clothing fact below. If a fact is marked unknown, do not treat the drawn detail as canon. This image is a candidate, not an approval, not art-direction canon, and not a rights clearance.",
    status: "ACTIVE",
  },
];

interface ProviderDescriptor {
  id: string;
  capability: ProviderCapability;
  adapter: string;
  label: string;
  model: string;
  modelVersion: string;
  availability: "AVAILABLE" | "NOT_CONNECTED";
  region: string;
  commercialUse: "not-cleared" | "unknown";
  status: "ACTIVE" | "STANDBY" | "DISABLED";
  secretRef: string | null;
  costAvailable: boolean;
  qualityNote: string;
}

export const PROVIDER_REGISTRY: ProviderDescriptor[] = [
  {
    id: DEV_PROVIDER_ID,
    capability: "LLM",
    adapter: "development",
    label: "Development text adapter",
    model: DEV_MODEL,
    modelVersion: "1",
    availability: "AVAILABLE",
    region: "local",
    commercialUse: "not-cleared",
    status: "ACTIVE",
    secretRef: null,
    costAvailable: false,
    qualityNote: "Templated from canon. Not a live model.",
  },
  {
    id: "llm.standby",
    capability: "LLM",
    adapter: "standby",
    label: "Standby text adapter",
    model: "standby-template-v1",
    modelVersion: "1",
    availability: "AVAILABLE",
    region: "local",
    commercialUse: "not-cleared",
    status: "STANDBY",
    secretRef: null,
    costAvailable: false,
    qualityNote: "Replacement adapter. The studio workflow does not change.",
  },
  {
    id: "llm.xai",
    capability: "LLM",
    adapter: "xai",
    label: "Live text adapter",
    model: "grok-4.5",
    modelVersion: "UNKNOWN",
    availability: "AVAILABLE",
    region: "server",
    commercialUse: "unknown",
    status: "ACTIVE",
    secretRef: null,
    costAvailable: false,
    qualityNote: "Live text model. Output is a development draft. Cost is unknown unless the provider reports it. Commercial use is not cleared.",
  },
  {
    id: "image.xai",
    capability: "IMAGE",
    adapter: "xai",
    label: "Live image adapter",
    model: "grok-imagine-image-2.0",
    modelVersion: "UNKNOWN",
    availability: "AVAILABLE",
    region: "server",
    commercialUse: "unknown",
    status: "ACTIVE",
    secretRef: null,
    costAvailable: false,
    qualityNote: "Live image model. One image per request. Commercial use is not cleared. A picture is not canon until a human approves that exact version.",
  },
  disconnected("image.none", "IMAGE", "Image adapter"),
  disconnected("video.none", "VIDEO", "Video adapter"),
  disconnected("voice.none", "VOICE", "Voice adapter"),
  disconnected("music.none", "MUSIC", "Music adapter"),
  disconnected("embedding.none", "EMBEDDING", "Embedding adapter"),
  disconnected("moderation.none", "MODERATION", "Moderation adapter"),
];

function disconnected(id: string, capability: ProviderCapability, label: string): ProviderDescriptor {
  return {
    id,
    capability,
    adapter: "unassigned",
    label,
    model: "none",
    modelVersion: "0",
    availability: "NOT_CONNECTED",
    region: "unassigned",
    commercialUse: "unknown",
    status: "DISABLED",
    secretRef: null,
    costAvailable: false,
    qualityNote: "Not connected. The studio does not pretend this rendered.",
  };
}

export interface StoredObject {
  storageRef: string;
  checksum: string;
  mediaType: string;
  bytes: Uint8Array;
}

export interface ObjectStore {
  put(input: { storageRef: string; mediaType: string; bytes: Uint8Array }): { checksum: string; byteLength: number };
  get(storageRef: string): StoredObject | null;
}

export function memoryObjectStore(): ObjectStore {
  const objects = new Map<string, StoredObject>();
  return {
    put(input) {
      const checksum = fingerprint(Array.from(input.bytes));
      const existing = objects.get(input.storageRef);
      if (existing) return { checksum: existing.checksum, byteLength: existing.bytes.byteLength };
      const bytes = input.bytes.slice();
      objects.set(input.storageRef, { storageRef: input.storageRef, checksum, mediaType: input.mediaType, bytes });
      return { checksum, byteLength: bytes.byteLength };
    },
    get(storageRef) {
      const found = objects.get(storageRef);
      return found ? { ...found, bytes: found.bytes.slice() } : null;
    },
  };
}

const sessionObjects = memoryObjectStore();

export function sessionObjectStore(): ObjectStore {
  return sessionObjects;
}

function fail<T>(db: StudioDb, code: string, error: string): Op<T> {
  return { ok: false, db, code, error };
}

function stamp(now?: string): string {
  return now ?? new Date().toISOString();
}

function providerById(id: string): ProviderDescriptor | undefined {
  return PROVIDER_REGISTRY.find((item) => item.id === id);
}

export function effectiveAvailability(db: StudioDb, providerId: string): "AVAILABLE" | "UNAVAILABLE" | "NOT_CONNECTED" | "UNKNOWN" {
  const provider = providerById(providerId);
  if (!provider) return "UNKNOWN";
  if (provider.availability === "NOT_CONNECTED") return "NOT_CONNECTED";
  if ((db.providerHolds ?? []).some((hold) => hold.providerId === providerId)) return "UNAVAILABLE";
  return "AVAILABLE";
}

export function activePrompt(db: StudioDb, key: string): PromptVersion | null {
  const extras = (db.promptVersions ?? []).filter((item) => item.key === key);
  const all = [...PROMPT_LIBRARY.filter((item) => item.key === key), ...extras];
  if (!all.length) return null;
  return all.reduce((best, item) => (item.version > best.version ? item : best));
}

export function listPrompts(db: StudioDb): PromptVersion[] {
  const keys = new Set([...PROMPT_LIBRARY.map((item) => item.key), ...(db.promptVersions ?? []).map((item) => item.key)]);
  return [...keys].map((key) => activePrompt(db, key)).filter((item): item is PromptVersion => item != null);
}

export function effectiveRole(db: StudioDb, actor: Actor): StudioRole | null {
  if (actor.type === "agent") return null;
  const bound = (db.roleBindings ?? []).find((item) => item.actorId === actor.id);
  if (bound) return bound.role;
  if (actor.type === "human") return "ADMIN";
  return null;
}

function remember(
  db: StudioDb,
  at: string,
  actor: Actor,
  action: string,
  entityType: string,
  entityId: string,
  detail: string,
  version?: number,
): StudioDb {
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
        entityType,
        entityId,
        detail,
        ...(version === undefined ? {} : { version }),
      },
    ],
  };
}

function logOp(
  db: StudioDb,
  at: string,
  actor: Actor,
  operation: string,
  entityType: string,
  entityId: string,
  providerId: string | null,
  error: string | null,
): StudioDb {
  const ided = allocId(db, "log");
  return {
    ...ided.db,
    opsLogs: [
      ...(ided.db.opsLogs ?? []),
      {
        id: ided.id,
        at,
        requestId: ided.id,
        actorId: actor.id,
        operation,
        entityType,
        entityId,
        providerId,
        error,
        durationMs: error ? null : 1,
      },
    ],
  };
}

function emit(db: StudioDb, at: string, name: string, entityId: string, detail: string): StudioDb {
  const ided = allocId(db, "evt");
  return {
    ...ided.db,
    domainEvents: [...(ided.db.domainEvents ?? []), { id: ided.id, at, name, entityId, detail }],
  };
}

export function publishBlockers(db: StudioDb, episodeId: string): string[] {
  const episode = db.episodes.find((item) => item.id === episodeId);
  if (!episode) return ["Episode not found.", "Publishing is disabled."];
  const snap = latestSnapshot(episode).snapshot;
  const reasons = ["Publishing is disabled."];
  if (db.qualityReviews.some((review) => review.entityId === episodeId && review.redFlag)) reasons.push("RIGHTS BLOCKED");
  if (snap.stage !== "READY_TO_PUBLISH") reasons.push("HUMAN APPROVAL REQUIRED");
  reasons.push("The YouTube adapter is not callable.");
  return reasons;
}

export function switchProvider(
  db: StudioDb,
  capability: ProviderCapability,
  providerId: string,
  actor: Actor,
  now?: string,
): Op<{ providerId: string }> {
  const at = stamp(now);
  if (actor.type !== "human") return fail(db, "permission", "An agent cannot change the studio's provider.");
  const provider = providerById(providerId);
  if (!provider || provider.capability !== capability) return fail(db, "provider", "That adapter does not serve this capability.");
  const previous = db.providerBindings?.[capability] || "";
  if (previous === providerId) return { ok: true, db, data: { providerId } };
  let next: StudioDb = {
    ...db,
    providerBindings: { ...db.providerBindings, [capability]: providerId },
    settings: capability === "LLM" ? { ...db.settings, textProviderId: providerId } : db.settings,
  };
  next = remember(next, at, actor, "provider.switched", "provider", providerId, `${capability} ${previous || "unassigned"} → ${providerId}. Stories were not rewritten.`, undefined);
  next = emit(next, at, "ProviderSwitched", providerId, `${capability} now uses ${provider.label}. Historical executions stay on the adapter that ran them.`);
  return { ok: true, db: next, data: { providerId } };
}

export function switchTextAdapter(db: StudioDb, actor: Actor, now?: string): Op<{ providerId: string }> {
  const current = db.providerBindings?.LLM || DEV_PROVIDER_ID;
  const next = current === DEV_PROVIDER_ID ? "llm.standby" : DEV_PROVIDER_ID;
  return switchProvider(db, "LLM", next, actor, now);
}

export function markProviderUnavailable(db: StudioDb, providerId: string, actor: Actor, reason: string, now?: string): Op<{ providerId: string }> {
  const at = stamp(now);
  if (actor.type !== "human") return fail(db, "permission", "An agent cannot take an adapter offline.");
  if (!providerById(providerId)) return fail(db, "provider", "Unknown adapter.");
  if (reason.trim().length < 8) return fail(db, "note", "Write why the adapter is unavailable.");
  if ((db.providerHolds ?? []).some((hold) => hold.providerId === providerId)) return { ok: true, db, data: { providerId } };
  const next = remember(
    {
      ...db,
      providerHolds: [...(db.providerHolds ?? []), { providerId, availability: "UNAVAILABLE", at, reason: reason.trim() }],
    },
    at,
    actor,
    "provider.unavailable",
    "provider",
    providerId,
    reason.trim(),
  );
  return { ok: true, db: next, data: { providerId } };
}

export function registerPromptVersion(
  db: StudioDb,
  input: { key: string; purpose: string; input: string; output: string; body: string },
  actor: Actor,
  now?: string,
): Op<{ version: number }> {
  const at = stamp(now);
  if (actor.type !== "human") return fail(db, "permission", "An agent cannot replace a prompt version.");
  if (input.body.trim().length < 8) return fail(db, "note", "Write the template. The previous version stays.");
  const current = activePrompt(db, input.key);
  const version = (current?.version ?? 0) + 1;
  const row: PromptVersion = {
    id: `prompt_${input.key.toLowerCase()}_v${version}`,
    key: input.key,
    version,
    purpose: input.purpose.trim() || current?.purpose || "Versioned template.",
    input: input.input.trim() || current?.input || "",
    output: input.output.trim() || current?.output || "",
    body: input.body.trim(),
    status: "ACTIVE",
    name: current?.name,
    agentId: current?.agentId,
    ageBand: current?.ageBand,
    language: current?.language,
    createdBy: actor.id,
    createdAt: at,
    changeNote: "New version. The previous template body was not edited.",
  };
  const next = remember(
    { ...db, promptVersions: [...(db.promptVersions ?? []), row] },
    at,
    actor,
    "prompt.versioned",
    "prompt",
    row.id,
    `${input.key} v${current?.version ?? 0} stays. v${version} is a new record.`,
    version,
  );
  return { ok: true, db: next, data: { version } };
}

export interface GenerationRequest {
  capability: ProviderCapability;
  promptKey: string;
  inputArtifactIds: string[];
  idempotencyKey: string;
  taskId?: string | null;
}

export function enqueueJob(db: StudioDb, input: GenerationRequest, actor: Actor, now?: string): Op<{ jobId: string; duplicate: boolean }> {
  const at = stamp(now);
  if (!input.idempotencyKey.trim()) return fail(db, "idempotency", "This job needs an idempotency key.");
  const existing = (db.jobs ?? []).find((job) => job.idempotencyKey === input.idempotencyKey);
  if (existing) return { ok: true, db, data: { jobId: existing.id, duplicate: true } };
  const prompt = activePrompt(db, input.promptKey);
  if (!prompt) return fail(db, "prompt", "That template is not on record.");
  const providerId = db.providerBindings?.[input.capability] || "";
  const provider = providerById(providerId);
  if (!provider) return fail(logOp(db, at, actor, "job.enqueue", "provider", input.capability, null, "No adapter is connected."), "provider", "No adapter is connected for this capability.");
  const ided = allocId(db, "job");
  const job: StudioJob = {
    id: ided.id,
    at,
    updatedAt: at,
    kind: `generate_${input.capability.toLowerCase()}`,
    capability: input.capability,
    state: "queued",
    failureClass: null,
    attempts: 0,
    maxTechnicalRetries: 3,
    idempotencyKey: input.idempotencyKey.trim(),
    providerId,
    model: provider.model,
    modelVersion: provider.modelVersion,
    promptKey: prompt.key,
    promptVersion: prompt.version,
    inputArtifactIds: [...input.inputArtifactIds],
    outputArtifactIds: [],
    executionIds: [],
    error: null,
    taskId: input.taskId ?? null,
  };
  return { ok: true, db: { ...ided.db, jobs: [...(ided.db.jobs ?? []), job] }, data: { jobId: job.id, duplicate: false } };
}

function writeExecution(
  db: StudioDb,
  at: string,
  actor: Actor,
  job: StudioJob,
  status: AiExecution["status"],
  error: string | null,
  outputArtifactIds: string[],
  units: { input: number | null; output: number | null },
): { db: StudioDb; execution: AiExecution } {
  const ided = allocId(db, "aix");
  const execution: AiExecution = {
    id: ided.id,
    at,
    actorType: actor.type,
    actorId: actor.id,
    taskId: job.taskId,
    jobId: job.id,
    providerId: job.providerId,
    model: job.model,
    modelVersion: job.modelVersion,
    capability: job.capability,
    inputArtifactIds: [...job.inputArtifactIds],
    promptKey: job.promptKey,
    promptVersion: job.promptVersion,
    parameters: { template: job.promptKey, templateVersion: job.promptVersion },
    outputArtifactIds,
    durationMs: 1,
    status,
    error,
    estimatedCost: null,
    currency: null,
    inputUnits: units.input,
    outputUnits: units.output,
    idempotencyKey: job.idempotencyKey,
  };
  return { db: { ...ided.db, aiExecutions: [...(ided.db.aiExecutions ?? []), execution] }, execution };
}

function replaceJob(db: StudioDb, job: StudioJob): StudioDb {
  return { ...db, jobs: (db.jobs ?? []).map((item) => (item.id === job.id ? job : item)) };
}

export function runJob(
  db: StudioDb,
  store: ObjectStore,
  jobId: string,
  actor: Actor,
  options?: { failure?: "timeout" | "creative" },
  now?: string,
): Op<{ jobId: string; state: StudioJob["state"]; executionId: string | null; outputIds: string[] }> {
  const at = stamp(now);
  const job = (db.jobs ?? []).find((item) => item.id === jobId);
  if (!job) return fail(db, "missing", "Job not found.");
  if (job.state === "completed") {
    return { ok: true, db, data: { jobId, state: job.state, executionId: job.executionIds[job.executionIds.length - 1] ?? null, outputIds: [...job.outputArtifactIds] } };
  }
  if (job.state === "failed" || job.state === "cancelled") {
    return fail(db, "job", job.error || "The job is not runnable.");
  }
  let active = job;
  const pinned = effectiveAvailability(db, job.providerId);
  if (pinned !== "AVAILABLE") {
    const boundId = db.providerBindings?.[job.capability] || "";
    const bound = providerById(boundId);
    if (bound && bound.id !== job.providerId && effectiveAvailability(db, bound.id) === "AVAILABLE") {
      active = { ...job, providerId: bound.id, model: bound.model, modelVersion: bound.modelVersion };
    }
  }
  const availability = effectiveAvailability(db, active.providerId);
  const failure = options?.failure;
  const technical = failure === "timeout" || availability === "UNAVAILABLE" || availability === "NOT_CONNECTED" || availability === "UNKNOWN";
  const creative = failure === "creative";
  const attempts = job.attempts + 1;
  if (technical || creative) {
    const error = creative
      ? "Creative failure. Canon or quality must be reviewed. This is not retried automatically."
      : availability === "NOT_CONNECTED"
        ? "Technical failure. The adapter is not connected. No artifact was created."
        : availability === "UNAVAILABLE"
          ? "Technical failure. The adapter is unavailable. No artifact was created."
          : "Technical failure. Provider timeout. The job can be retried. No artifact was created.";
    const written = writeExecution(db, at, actor, { ...active, attempts }, creative ? "FAILED" : "RETRYABLE", error, [], { input: null, output: null });
    const failed: StudioJob = {
      ...active,
      state: "failed",
      failureClass: creative ? "CREATIVE" : "TECHNICAL",
      attempts,
      updatedAt: at,
      error,
      executionIds: [...job.executionIds, written.execution.id],
    };
    let next = replaceJob(written.db, failed);
    next = emit(next, at, "JobFailed", job.id, error);
    next = logOp(next, at, actor, "job.run", "job", job.id, active.providerId, error);
    return { ok: true, db: next, data: { jobId, state: "failed", executionId: written.execution.id, outputIds: [] } };
  }
  const prompt = activePrompt(db, active.promptKey);
  const provider = providerById(active.providerId);
  if (provider?.adapter === "xai") {
    const error = "The live text adapter is not called from this runner. No script was invented.";
    const written = writeExecution(db, at, actor, { ...active, attempts }, "RETRYABLE", error, [], { input: null, output: null });
    const failed: StudioJob = {
      ...active,
      state: "failed",
      failureClass: "TECHNICAL",
      attempts,
      updatedAt: at,
      error,
      executionIds: [...job.executionIds, written.execution.id],
    };
    let next = replaceJob(written.db, failed);
    next = emit(next, at, "JobFailed", job.id, error);
    next = logOp(next, at, actor, "job.run", "job", job.id, active.providerId, error);
    return { ok: true, db: next, data: { jobId, state: "failed", executionId: written.execution.id, outputIds: [] } };
  }
  const text = `Development draft.\nAdapter ${provider?.adapter ?? active.providerId}.\nModel ${active.model} ${active.modelVersion}.\nTemplate ${active.promptKey} v${active.promptVersion}.\nNot approved. Not cleared for commercial use.`;
  const bytes = new TextEncoder().encode(prompt ? `${text}\n${prompt.purpose}` : text);
  const version = 1;
  const storageRef = `objects/${active.id}/v${version}`;
  const stored = store.put({ storageRef, mediaType: "text/plain", bytes });
  const metaId = allocId(db, "obj");
  const record: ObjectRecord = {
    id: metaId.id,
    assetKey: active.id,
    version,
    name: `${active.promptKey} draft`,
    checksum: stored.checksum,
    byteLength: stored.byteLength,
    mediaType: "text/plain",
    storageRef,
    rightsStatus: "UNKNOWN",
    provenanceExecutionId: null,
    createdAt: at,
  };
  const withMeta: StudioDb = { ...metaId.db, objectRecords: [...(metaId.db.objectRecords ?? []), record] };
  const written = writeExecution(withMeta, at, actor, active, "COMPLETED", null, [record.id], { input: prompt?.body.length ?? null, output: bytes.byteLength });
  const linked: ObjectRecord = { ...record, provenanceExecutionId: written.execution.id };
  const completed: StudioJob = {
    ...active,
    state: "completed",
    failureClass: null,
    attempts,
    updatedAt: at,
    error: null,
    outputArtifactIds: job.outputArtifactIds.length ? [...job.outputArtifactIds] : [record.id],
    executionIds: [...job.executionIds, written.execution.id],
  };
  let next = replaceJob({ ...written.db, objectRecords: (written.db.objectRecords ?? []).map((item) => (item.id === record.id ? linked : item)) }, completed);
  next = emit(next, at, "JobCompleted", job.id, `Draft stored as ${storageRef}. Rights remain UNKNOWN.`);
  next = logOp(next, at, actor, "job.run", "job", job.id, active.providerId, null);
  return { ok: true, db: next, data: { jobId, state: "completed", executionId: written.execution.id, outputIds: [record.id] } };
}

export function retryJob(
  db: StudioDb,
  store: ObjectStore,
  jobId: string,
  actor: Actor,
  options?: { failure?: "timeout" | "creative" },
  now?: string,
): Op<{ jobId: string; state: StudioJob["state"]; executionId: string | null; outputIds: string[] }> {
  const job = (db.jobs ?? []).find((item) => item.id === jobId);
  if (!job) return fail(db, "missing", "Job not found.");
  if (job.failureClass === "CREATIVE") return fail(db, "creative", "Creative failures are not retried. Open a review instead of generating another variation.");
  if (job.state !== "failed" || job.failureClass !== "TECHNICAL") return fail(db, "job", "Only a failed technical job can be retried.");
  if (job.attempts >= job.maxTechnicalRetries) return fail(db, "retry", "Technical retries are exhausted.");
  const queued: StudioJob = { ...job, state: "queued", error: null, updatedAt: stamp(now) };
  return runJob(replaceJob(db, queued), store, jobId, actor, options, now);
}

export function requestGeneration(
  db: StudioDb,
  store: ObjectStore,
  input: GenerationRequest,
  actor: Actor,
  now?: string,
): Op<{ jobId: string; executionId: string | null; outputIds: string[] }> {
  const enqueued = enqueueJob(db, input, actor, now);
  if (!enqueued.ok) return enqueued;
  const ran = runJob(enqueued.db, store, enqueued.data.jobId, actor, undefined, now);
  if (!ran.ok) return ran;
  return { ok: true, db: ran.db, data: { jobId: ran.data.jobId, executionId: ran.data.executionId, outputIds: ran.data.outputIds } };
}

export function putProductionFile(
  db: StudioDb,
  store: ObjectStore,
  input: { name: string; mediaType: string; bytes: Uint8Array; assetKey?: string; idempotencyKey?: string },
  actor: Actor,
  now?: string,
): Op<{ id: string; version: number; storageRef: string; checksum: string }> {
  const at = stamp(now);
  if (actor.type === "agent") return fail(db, "permission", "An agent cannot file a production asset.");
  if (input.bytes.byteLength === 0) return fail(db, "empty", "An empty file is not stored.");
  if (input.idempotencyKey) {
    const seen = (db.idempotencyKeys ?? []).find((item) => item.key === input.idempotencyKey && item.operation === "asset.put");
    const prior = seen ? (db.objectRecords ?? []).find((item) => item.id === seen.resultId) : undefined;
    if (prior) return { ok: true, db, data: { id: prior.id, version: prior.version, storageRef: prior.storageRef, checksum: prior.checksum } };
  }
  const assetKey = input.assetKey?.trim() || `asset_${fingerprint(input.name).slice(0, 8)}`;
  const previous = (db.objectRecords ?? []).filter((item) => item.assetKey === assetKey);
  const version = previous.reduce((max, item) => Math.max(max, item.version), 0) + 1;
  const storageRef = `objects/${assetKey}/v${version}`;
  const stored = store.put({ storageRef, mediaType: input.mediaType, bytes: input.bytes });
  const ided = allocId(db, "obj");
  const record: ObjectRecord = {
    id: ided.id,
    assetKey,
    version,
    name: input.name.trim() || assetKey,
    checksum: stored.checksum,
    byteLength: stored.byteLength,
    mediaType: input.mediaType,
    storageRef,
    rightsStatus: "UNKNOWN",
    provenanceExecutionId: null,
    createdAt: at,
  };
  let next: StudioDb = { ...ided.db, objectRecords: [...(ided.db.objectRecords ?? []), record] };
  if (input.idempotencyKey) {
    next = {
      ...next,
      idempotencyKeys: [...(next.idempotencyKeys ?? []), { key: input.idempotencyKey, operation: "asset.put", resultId: record.id, at }],
    };
  }
  next = remember(next, at, actor, "asset.stored", "object", record.id, `v${version} ${storageRef}. Metadata only. Rights UNKNOWN.`, version);
  return { ok: true, db: next, data: { id: record.id, version, storageRef, checksum: record.checksum } };
}

export function architecturePublish(db: StudioDb, episodeId: string, actor: Actor, now?: string): Op<never> {
  const blocked = publishEpisode(db, episodeId, actor, now);
  const reasons = publishBlockers(blocked.db, episodeId);
  const error = `${reasons.join(" ")} ${blocked.ok ? "" : blocked.error}`.trim();
  return fail(blocked.db, "publish-disabled", error);
}

export function youtubeUpload(db: StudioDb, episodeId: string, actor: Actor, now?: string): Op<never> {
  const blocked = architecturePublish(db, episodeId, actor, now);
  return fail(blocked.db, "youtube-disabled", `The YouTube adapter is not callable. ${blocked.error}`);
}

export function useProposedLocation(db: StudioDb, key: string, actor: Actor, now?: string): Op<never> {
  const at = stamp(now);
  const gate = locationUsableForProduction(db, key);
  if (!gate.usable) {
    const next = remember(db, at, actor, "location.rejected", "location", key, gate.reason);
    return fail(next, "location", `Rejected because the location is not approved. ${gate.reason}`);
  }
  return fail(db, "location", "This layer does not write a location into production.");
}

export function authorizeQaReuse(db: StudioDb, qaRunId: string, storyVersion: number) {
  return reuseQa(db, qaRunId, storyVersion);
}

export function architectureApproveStory(db: StudioDb, storyId: string, actor: Actor, note: string, now?: string): Op<{ version: number }> {
  const role = effectiveRole(db, actor);
  if (actor.type !== "human" || role == null) {
    return fail(remember(db, stamp(now), actor, "permission.denied", "story", storyId, "An agent tried to approve its own output."), "permission", "The server rejects this. An agent cannot approve its own output.");
  }
  if (role === "VIEWER" || role === "ANALYTICS" || role === "RIGHTS") {
    return fail(db, "permission", "This role cannot approve a story. Workflow permission is separate from a job title.");
  }
  return approveStory(db, storyId, actor, note, now);
}

export function assignRole(db: StudioDb, actorId: string, role: StudioRole, actor: Actor, now?: string): Op<{ role: StudioRole }> {
  const at = stamp(now);
  if (effectiveRole(db, actor) !== "ADMIN") return fail(db, "permission", "Only an admin can assign a role, and a role still cannot publish.");
  const next = remember(
    {
      ...db,
      roleBindings: [...(db.roleBindings ?? []).filter((item) => item.actorId !== actorId), { actorId, role, at }],
    },
    at,
    actor,
    "role.assigned",
    "principal",
    actorId,
    role,
  );
  return { ok: true, db: next, data: { role } };
}

export function storeSecret(db: StudioDb, value: string): Op<never> {
  if (value.trim()) return fail(db, "secret", "Secrets are not stored in the studio record, in prompts, or in assets.");
  return fail(db, "secret", "Secrets are not stored in the studio record.");
}

export function setFeatureFlag(db: StudioDb, flag: keyof FeatureFlags, value: boolean, actor: Actor): Op<{ flag: string; value: boolean }> {
  if (actor.type !== "human") return fail(db, "permission", "An agent cannot change a feature flag.");
  if ((flag === "publishing" || flag === "youtube" || flag === "autonomousExecution") && value) {
    return fail(db, "flag", "Publishing, YouTube, and autonomous execution stay off.");
  }
  return { ok: true, db: { ...db, featureFlags: { ...db.featureFlags, [flag]: value } }, data: { flag, value } };
}

export function architectureImportPerformance(
  db: StudioDb,
  input: { publicationId: string; episodeId: string; metric: string; value: number | null; contentVersionReference: string; idempotencyKey: string; period?: string },
  actor: Actor,
  now?: string,
): Op<{ id: string; value: number | null }> {
  const seen = (db.idempotencyKeys ?? []).find((item) => item.key === input.idempotencyKey && item.operation === "performance.import");
  if (seen) {
    const row = (db.performanceRecords ?? []).find((item) => item.id === seen.resultId);
    if (row) return { ok: true, db, data: { id: row.id, value: row.value } };
  }
  const imported = importPerformance(db, input, actor, now);
  if (!imported.ok) return imported;
  const at = stamp(now);
  const next = emit(
    {
      ...imported.db,
      idempotencyKeys: [...(imported.db.idempotencyKeys ?? []), { key: input.idempotencyKey, operation: "performance.import", resultId: imported.data.id, at }],
    },
    at,
    "PerformanceImported",
    imported.data.id,
    `Publication ${input.publicationId} · ${input.contentVersionReference}`,
  );
  return { ok: true, db: next, data: imported.data };
}

export function registerExternalPublication(
  db: StudioDb,
  input: { episodeId: string; title: string; contentVersionReference: string; idempotencyKey: string },
  actor: Actor,
  now?: string,
) {
  const seen = (db.idempotencyKeys ?? []).find((item) => item.key === input.idempotencyKey && item.operation === "publication.record");
  if (seen) {
    const row = (db.publications ?? []).find((item) => item.id === seen.resultId);
    if (row) return { ok: true as const, db, data: { id: row.id, status: row.status } };
  }
  const recorded = registerPublication(db, input, actor, now);
  if (!recorded.ok) return recorded;
  const at = stamp(now);
  return {
    ok: true as const,
    db: {
      ...recorded.db,
      idempotencyKeys: [...(recorded.db.idempotencyKeys ?? []), { key: input.idempotencyKey, operation: "publication.record", resultId: recorded.data.id, at }],
    },
    data: recorded.data,
  };
}

export function mutateProductionFromLocal(db: StudioDb): Op<never> {
  return fail(db, "environment", "Production data is not edited from the local environment.");
}

export function openChildProfile(db: StudioDb): Op<never> {
  return fail(db, "privacy", "Child profiles, behavioral tracking, and direct messaging are not part of this studio.");
}

export function backupManifest(db: StudioDb): {
  schemaVersion: number;
  checksum: string;
  stories: number;
  episodes: number;
  audits: number;
  objects: number;
  retention: string;
} {
  const body = {
    schemaVersion: db.schemaVersion,
    stories: db.stories.map((story) => ({ id: story.id, currentVersion: story.currentVersion, canonicalVersion: story.canonicalVersion })),
    episodes: db.episodes.map((episode) => ({ id: episode.id, stage: latestSnapshot(episode).snapshot.stage, versions: episode.versions.length })),
    audits: db.audit.length,
    objects: (db.objectRecords ?? []).map((item) => ({ id: item.id, version: item.version, checksum: item.checksum })),
  };
  return {
    schemaVersion: db.schemaVersion,
    checksum: fingerprint(body),
    stories: db.stories.length,
    episodes: db.episodes.length,
    audits: db.audit.length,
    objects: (db.objectRecords ?? []).length,
    retention: "Keep every approved version. Managed Postgres backups apply when the studio is hosted. This document is the portable copy.",
  };
}

export function architectureView(db: StudioDb) {
  const bindings = db.providerBindings;
  return {
    plane: CONTROL_PLANE,
    persistence: PERSISTENCE,
    flags: db.featureFlags,
    prompts: listPrompts(db),
    jobs: db.jobs ?? [],
    executions: db.aiExecutions ?? [],
    providers: PROVIDER_REGISTRY.map((provider) => ({
      ...provider,
      availability: effectiveAvailability(db, provider.id),
      selected: bindings?.[provider.capability] === provider.id,
    })),
    textProviderId: bindings?.LLM || DEV_PROVIDER_ID,
  };
}
