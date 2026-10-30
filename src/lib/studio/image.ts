import { activePrompt, type ObjectStore } from "./architecture.ts";
import { allocId, canonicalOf, fingerprint, latestSnapshot, publishEpisode } from "./engine.ts";
import type { Actor, AiExecution, AssetBody, AuditEvent, HumanApprovalRecord, ObjectRecord, Op, ScriptBody, StudioDb, VersionedEntity } from "./types.ts";

export const IMAGE_PROVIDER_ID = "image.xai";
export const IMAGE_MODEL = "grok-imagine-image-2.0";
export const CHARACTER_IMAGE_KEY = "CHARACTER_IMAGE";

export type ImageCallStatus = "SUCCESS" | "AUTH_ERROR" | "TIMEOUT" | "RATE_LIMITED" | "PROVIDER_ERROR" | "VALIDATION_ERROR" | "INTERNAL_ERROR";

export interface ImageCallResult {
  status: ImageCallStatus;
  providerId: string;
  model: string;
  modelVersion: string | null;
  mediaType: string | null;
  byteLength: number | null;
  checksum: string | null;
  storageRef: string | null;
  storageDurability: "BLOCKED" | "DURABLE";
  durationMs: number | null;
  cost: number | null;
  costNote: string;
  error: string | null;
  externalReference: string | null;
  prompt: string;
  templateKey: string;
  templateVersion: number;
}

export interface ConsistencyCheck {
  name: string;
  result: "PASS" | "WARN" | "FAIL" | "UNKNOWN" | "HUMAN_REVIEW";
  owner: "automated" | "human";
  detail: string;
}

export interface CharacterImageContext {
  characterId: string;
  characterName: string;
  characterVersion: number;
  canonVersion: string;
  canonSnapshotHash: string;
  worldId: string | null;
  scriptId: string | null;
  scriptVersion: number | null;
  storyId: string | null;
  storyVersion: number | null;
  known: Record<string, string>;
  unknown: string[];
  exclusions: string[];
  referenceAssetId: string | null;
  referenceAssetVersion: number | null;
  referenceSentToProvider: false;
  role: "INITIAL_DESIGN" | "FOLLOW_UP";
  prompt: string;
  templateKey: string;
  templateVersion: number;
}

function stamp(now?: string): string {
  return now ?? new Date().toISOString();
}

function fail<T>(db: StudioDb, code: string, error: string): Op<T> {
  return { ok: false, db, code, error };
}

function audit(db: StudioDb, at: string, actor: Actor, action: string, entityType: string, entityId: string, detail: string, version?: number): StudioDb {
  const ided = allocId(db, "aud");
  const event: AuditEvent = { id: ided.id, at, actorType: actor.type, actorId: actor.id, action, entityType, entityId, version, detail };
  return { ...ided.db, audit: [...ided.db.audit, event] };
}

function thunderScript(db: StudioDb, scriptId: string | null): boolean {
  if (!scriptId) return false;
  return db.episodes.some((episode) => {
    const snap = latestSnapshot(episode).snapshot;
    return snap.scriptId === scriptId && snap.title === "Count the Thunder";
  });
}

export function approvedCharacterReference(db: StudioDb, characterId: string): { assetId: string; version: number } | null {
  for (const asset of db.assets) {
    const approved = asset.canonicalVersion == null ? null : asset.versions.find((item) => item.version === asset.canonicalVersion && item.status === "approved");
    if (!approved || approved.snapshot.characterId !== characterId) continue;
    if (approved.snapshot.commercialUseStatus === "cleared") continue;
    if (approved.snapshot.imageRole !== "INITIAL_DESIGN" && approved.snapshot.imageRole !== "FOLLOW_UP") continue;
    return { assetId: asset.id, version: approved.version };
  }
  return null;
}

export function prepareCharacterImage(db: StudioDb, characterId: string, scriptId: string | null): CharacterImageContext | string {
  const character = db.characters.find((item) => item.id === characterId);
  const locked = character ? canonicalOf(character) : null;
  if (!character || !locked || locked.status !== "approved") return "Image generation needs the approved character version. An unapproved look is not a reference.";
  if (thunderScript(db, scriptId)) return "Count the Thunder is not an eligible source while its rights stay blocked.";
  let script: VersionedEntity<ScriptBody> | null = null;
  let scriptVersion: number | null = null;
  if (scriptId) {
    script = db.scripts.find((item) => item.id === scriptId) ?? null;
    const approved = script ? canonicalOf(script) : null;
    if (!script || !approved || approved.status !== "approved") return "A source script must be the human-approved version. A draft is not eligible.";
    if (approved.snapshot.storyAnchors && !approved.snapshot.storyAnchors.characterIds.includes(characterId) && !approved.snapshot.scenes.some((scene) => scene.characterIds.includes(characterId))) {
      return "That approved script does not use this character.";
    }
    scriptVersion = approved.version;
  }
  const body = locked.snapshot;
  const known: Record<string, string> = {
    name: body.name,
    age: body.age,
    species: body.species,
    appearance: body.appearance,
    clothing: body.clothing,
  };
  if (body.hair) known.hair = body.hair;
  if (body.eyes) known.eyes = body.eyes;
  if (body.face) known.face = body.face;
  if (body.body) known.body = body.body;
  if (body.accessories) known.accessories = body.accessories;
  const unknown = ["face", "body"].filter((field) => !known[field]);
  const template = activePrompt(db, CHARACTER_IMAGE_KEY);
  if (!template) return "The character image template is not on record.";
  const reference = approvedCharacterReference(db, characterId);
  const role = reference ? "FOLLOW_UP" : "INITIAL_DESIGN";
  const lines = [
    template.body,
    `Character ${body.name}, approved version ${locked.version}.`,
    `Canon ${db.canonSnapshots.at(-1)?.canonVersion ?? "unstamped"} ${db.canonSnapshots.at(-1)?.hash ?? ""}.`,
    ...Object.entries(known).map(([key, value]) => `${key}: ${value}`),
    unknown.length ? `Unknown, do not invent: ${unknown.join(", ")}.` : "No listed attribute was missing.",
    `Do not depict: ${body.forbiddenVariations.join(", ") || "none listed"}.`,
    ...body.visualRules.map((rule) => `Rule: ${rule}`),
    reference
      ? `An approved design exists: asset ${reference.assetId} version ${reference.version}. The provider is not given that picture. A person must compare them.`
      : "No approved visual reference exists. This is an initial design, not a consistency proof.",
  ];
  const story = script ? db.stories.find((item) => item.id === latestSnapshot(script).snapshot.storyId) : null;
  return {
    characterId,
    characterName: body.name,
    characterVersion: locked.version,
    canonVersion: db.canonSnapshots.at(-1)?.canonVersion ?? "",
    canonSnapshotHash: db.canonSnapshots.at(-1)?.hash ?? "",
    worldId: db.world?.id ?? null,
    scriptId,
    scriptVersion,
    storyId: story?.id ?? null,
    storyVersion: script ? latestSnapshot(script).snapshot.storyVersion : null,
    known,
    unknown,
    exclusions: [...body.forbiddenVariations],
    referenceAssetId: reference?.assetId ?? null,
    referenceAssetVersion: reference?.version ?? null,
    referenceSentToProvider: false,
    role,
    prompt: lines.join("\n"),
    templateKey: template.key,
    templateVersion: template.version,
  };
}

export function automatedConsistency(context: CharacterImageContext): ConsistencyCheck[] {
  const checks: ConsistencyCheck[] = [
    { name: "identity", result: "HUMAN_REVIEW", owner: "human", detail: "A person has to say whether the picture is this character. The prompt cannot prove it." },
    { name: "child-suitability", result: "HUMAN_REVIEW", owner: "human", detail: "A person has to look at the picture before it is used with children." },
    { name: "reference", result: context.referenceAssetId ? "HUMAN_REVIEW" : "UNKNOWN", owner: context.referenceAssetId ? "human" : "automated", detail: context.referenceAssetId ? `Compare with ${context.referenceAssetId} version ${context.referenceAssetVersion}. The provider did not receive that file.` : "No approved visual reference. This cannot be called reference-consistent." },
    { name: "forbidden-prompt", result: context.exclusions.every((item) => context.prompt.toLowerCase().includes(item.toLowerCase())) ? "PASS" : "FAIL", owner: "automated", detail: "Exclusions are in the prompt. That does not mean the picture obeyed them." },
    { name: "storage", result: "UNKNOWN", owner: "automated", detail: "Durable object storage is not configured." },
    { name: "rights", result: "UNKNOWN", owner: "automated", detail: "Generation does not clear commercial use." },
    { name: "art-direction", result: "HUMAN_REVIEW", owner: "human", detail: "No approved art direction is on record. The model's drawn style is not canon." },
  ];
  for (const field of context.unknown) {
    checks.push({ name: field, result: "UNKNOWN", owner: "automated", detail: `${field} is not in the canonical record. It was not invented.` });
  }
  for (const field of ["hair", "eyes", "clothing"] as const) {
    if (context.known[field]) checks.push({ name: field, result: "HUMAN_REVIEW", owner: "human", detail: `Canon says ${context.known[field]}. The picture was not measured.` });
  }
  return checks;
}

function executionFor(db: StudioDb, at: string, context: CharacterImageContext, result: ImageCallResult, outputIds: string[], error: string | null): { db: StudioDb; execution: AiExecution } {
  const ided = allocId(db, "aix");
  const execution: AiExecution = {
    id: ided.id,
    at,
    actorType: "human",
    actorId: "image",
    taskId: context.characterId,
    jobId: null,
    providerId: result.providerId,
    model: result.model,
    modelVersion: result.modelVersion ?? "UNKNOWN",
    capability: "IMAGE",
    inputArtifactIds: [context.characterId, context.scriptId, context.referenceAssetId].filter((item): item is string => Boolean(item)),
    promptKey: result.templateKey,
    promptVersion: result.templateVersion,
    parameters: {
      role: context.role,
      canon: context.canonSnapshotHash,
      characterVersion: context.characterVersion,
      referenceSentToProvider: false,
      cost: result.cost == null ? "UNKNOWN" : String(result.cost),
      costNote: result.costNote,
      storage: result.storageDurability,
    },
    outputArtifactIds: outputIds,
    durationMs: result.durationMs,
    status: result.status === "SUCCESS" ? "COMPLETED" : result.status === "TIMEOUT" || result.status === "RATE_LIMITED" || result.status === "PROVIDER_ERROR" ? "RETRYABLE" : "FAILED",
    error,
    estimatedCost: result.cost,
    currency: null,
    inputUnits: null,
    outputUnits: null,
    idempotencyKey: `image:${context.characterId}:v${context.characterVersion}:${result.externalReference ?? result.checksum ?? result.error ?? result.status}`,
  };
  return { db: { ...ided.db, aiExecutions: [...(ided.db.aiExecutions ?? []), execution] }, execution };
}

export function acceptImageGeneration(
  db: StudioDb,
  context: CharacterImageContext,
  result: ImageCallResult,
  actor: Actor,
  store: ObjectStore | null,
  bytes: Uint8Array | null,
  now?: string,
): Op<{ assetId: string | null; executionId: string }> {
  const at = stamp(now);
  if (actor.type !== "human") return fail(db, "permission", "A person asks for the picture. The model cannot file its own canon.");
  const prepared = prepareCharacterImage(db, context.characterId, context.scriptId);
  if (typeof prepared === "string") return fail(db, "character", prepared);
  if (prepared.prompt !== context.prompt || prepared.characterVersion !== context.characterVersion) return fail(db, "canon", "The canon used for this picture no longer matches. It was not filed.");
  const beforeCharacter = JSON.stringify(db.characters.find((item) => item.id === context.characterId));
  const thunderBefore = JSON.stringify(db.episodes.find((item) => latestSnapshot(item).snapshot.title === "Count the Thunder")?.versions ?? []);
  const alpineBefore = JSON.stringify((db.locationLibrary ?? []).find((item) => item.key === "alpine-inspired") ?? null);
  if (result.status !== "SUCCESS" || !result.mediaType) {
    const written = executionFor(db, at, context, result, [], result.error ?? result.status);
    const next = audit(written.db, at, actor, "image.failed", "character", context.characterId, `${result.providerId} ${result.status}. No asset was invented. ${result.costNote}`, undefined);
    return { ok: true, db: next, data: { assetId: null, executionId: written.execution.id } };
  }
  const storageRef = result.storageRef || `image/${context.characterId}/${fingerprint(Array.from((bytes ?? new Uint8Array([result.prompt.length])).slice(0, 64)))}`;
  const stored = bytes && store
    ? store.put({ storageRef, mediaType: result.mediaType, bytes })
    : result.checksum && result.byteLength
      ? { checksum: result.checksum, byteLength: result.byteLength }
      : null;
  if (!stored) return fail(db, "storage", "The provider returned no file the studio could record. No asset was invented.");
  const objectId = allocId(db, "obj");
  const prior = (db.assets ?? []).filter((asset) => asset.versions.some((version) => version.snapshot.characterId === context.characterId && version.snapshot.promptKey === CHARACTER_IMAGE_KEY));
  const assetIded = allocId(objectId.db, "ast");
  const versionNumber = prior.length ? Math.max(...prior.flatMap((asset) => asset.versions.map((version) => version.version))) + 1 : 1;
  const host = prior[0] ?? null;
  const checks = automatedConsistency(context);
  const body: AssetBody = {
    assetType: "character-image",
    source: "image-provider",
    creator: actor.id,
    model: result.model,
    provider: result.providerId,
    prompt: context.prompt,
    referenceAssets: context.referenceAssetId ? [`asset:${context.referenceAssetId}:v${context.referenceAssetVersion}`] : [],
    licenseStatus: "development-draft",
    commercialUseStatus: "not-cleared",
    rightsNotes: "UNKNOWN. A successful image does not clear commercial use.",
    modificationHistory: [`${at} generated. Not approved.`],
    linkedEntityType: "character",
    linkedEntityId: context.characterId,
    characterId: context.characterId,
    characterVersion: context.characterVersion,
    worldId: context.worldId,
    locationId: null,
    canonVersion: context.canonVersion,
    visualClaims: {
      age: context.known.age,
      species: context.known.species,
      hair: context.known.hair,
      face: context.known.face,
      eyes: context.known.eyes,
      body: context.known.body,
      clothing: context.known.clothing,
      accessories: context.known.accessories,
    },
    canonVersionUsed: context.canonVersion,
    canonSnapshotHash: context.canonSnapshotHash,
    promptKey: context.templateKey,
    promptVersion: context.templateVersion,
    modelVersion: result.modelVersion ?? "UNKNOWN",
    externalReference: result.externalReference,
    imageRole: context.role,
    storageDurability: "BLOCKED",
    storageNote: "No S3 bucket is configured. Bytes, if kept, are only in this server process. A provider URL was not kept as storage.",
    referenceAssetId: context.referenceAssetId,
    referenceAssetVersion: context.referenceAssetVersion,
    lineage: "AI_GENERATED",
    assetStatus: "VALIDATING",
  };
  const version = { version: host ? host.currentVersion + 1 : versionNumber, status: "in_review" as const, snapshot: body, createdAt: at, createdBy: actor.id, note: checks.map((item) => `${item.name} ${item.result}`).join("; "), immutable: true };
  const asset: VersionedEntity<AssetBody> = host
    ? { ...host, currentVersion: version.version, canonicalVersion: host.canonicalVersion, updatedAt: at, versions: [...host.versions, version] }
    : { id: assetIded.id, type: "asset", name: `${context.characterName} image`, currentVersion: version.version, canonicalVersion: null, createdAt: at, updatedAt: at, versions: [{ ...version, version: 1 }] };
  const written = executionFor(assetIded.db, at, context, { ...result, checksum: stored.checksum, byteLength: stored.byteLength, storageRef, storageDurability: "BLOCKED" }, [asset.id], null);
  let next: StudioDb = {
    ...written.db,
    assets: host ? written.db.assets.map((item) => (item.id === host.id ? asset : item)) : [...written.db.assets, asset],
    objectRecords: [...(written.db.objectRecords ?? []), {
      id: objectId.id,
      assetKey: `character-image:${context.characterId}`,
      version: asset.currentVersion,
      name: `${context.characterName} image v${asset.currentVersion}`,
      checksum: stored.checksum,
      byteLength: stored.byteLength,
      mediaType: result.mediaType,
      storageRef,
      rightsStatus: "UNKNOWN",
      provenanceExecutionId: written.execution.id,
      createdAt: at,
    }],
  };
  next = {
    ...next,
    assets: next.assets.map((item) => item.id === asset.id ? { ...item, versions: item.versions.map((row) => row.version === item.currentVersion ? { ...row, snapshot: { ...row.snapshot, generationRunId: written.execution.id } } : row) } : item),
  };
  next = audit(next, at, actor, "image.generated", "asset", asset.id, `${context.role}. Template ${context.templateKey} v${context.templateVersion}. Rights UNKNOWN. Storage BLOCKED. Not approved.`, asset.currentVersion);
  if (JSON.stringify(next.characters.find((item) => item.id === context.characterId)) !== beforeCharacter) return fail(db, "canon", "The picture would have changed the character record. Stopped.");
  const thunderAfter = JSON.stringify(next.episodes.find((item) => latestSnapshot(item).snapshot.title === "Count the Thunder")?.versions ?? []);
  if (thunderAfter !== thunderBefore) return fail(db, "regression", "Count the Thunder would have changed. Stopped.");
  if (JSON.stringify((next.locationLibrary ?? []).find((item) => item.key === "alpine-inspired") ?? null) !== alpineBefore) return fail(db, "regression", "The Alpine proposal would have changed. Stopped.");
  return { ok: true, db: next, data: { assetId: asset.id, executionId: written.execution.id } };
}

export function decideCharacterImage(
  db: StudioDb,
  assetId: string,
  version: number,
  decision: "APPROVED" | "REJECTED" | "CHANGES_REQUESTED",
  actor: Actor,
  note: string,
  now?: string,
): Op<{ version: number }> {
  const at = stamp(now);
  if (actor.type !== "human") return fail(audit(db, at, actor, "permission.denied", "asset", assetId, "A model tried to approve a picture."), "human-required", "Only a person can accept, reject, or ask for another version.");
  if (note.trim().length < 12) return fail(db, "note", "Write what you saw. A generation result is not this note.");
  const asset = db.assets.find((item) => item.id === assetId);
  const row = asset?.versions.find((item) => item.version === version);
  if (!asset || !row) return fail(db, "missing", "That image version is not on record.");
  if (row.snapshot.storageDurability !== "BLOCKED" && row.snapshot.storageDurability !== "DURABLE") return fail(db, "storage", "Storage status is missing. It was not approved.");
  if (row.status === "rejected" && decision === "APPROVED") return fail(db, "rejected", "A rejected version cannot be approved. Generate a new version.");
  const rightsBefore = JSON.stringify(db.rightsRecords ?? []);
  const status = decision === "APPROVED" ? "approved" : decision === "REJECTED" ? "rejected" : "revision_requested";
  const versions = asset.versions.map((item) => {
    if (item.version !== version) return item;
    return { ...item, status: status as typeof item.status, snapshot: { ...item.snapshot, lineage: decision === "APPROVED" ? "HUMAN_APPROVED" as const : item.snapshot.lineage, assetStatus: decision === "APPROVED" ? "APPROVED" as const : decision === "REJECTED" ? "REJECTED" as const : "REQUIRES_REVISION" as const } };
  });
  const entity = { ...asset, versions, canonicalVersion: decision === "APPROVED" ? version : asset.canonicalVersion, updatedAt: at };
  let next: StudioDb = { ...db, assets: db.assets.map((item) => (item.id === assetId ? entity : item)) };
  const ided = allocId(next, "hap");
  const record: HumanApprovalRecord = {
    id: ided.id,
    at,
    episodeId: null,
    subjectType: "asset",
    subjectId: assetId,
    approvedArtifactVersions: [
      { type: "asset", id: assetId, version },
      { type: "character", id: row.snapshot.characterId ?? "", version: row.snapshot.characterVersion ?? null },
      { type: "canon", id: row.snapshot.canonSnapshotHash ?? "", version: null },
      ...(row.snapshot.referenceAssetId ? [{ type: "reference", id: row.snapshot.referenceAssetId, version: row.snapshot.referenceAssetVersion ?? null }] : []),
    ],
    decision,
    reviewerId: actor.id,
    reviewerName: actor.name,
    notes: note.trim(),
    qaRunId: null,
  };
  next = { ...ided.db, humanApprovals: [...(ided.db.humanApprovals ?? []), record] };
  next = audit(next, at, actor, `image.${decision.toLowerCase()}`, "asset", assetId, `${note.trim()} Rights were not cleared. Publishing was not enabled.`, version);
  if (JSON.stringify(next.rightsRecords ?? []) !== rightsBefore) return fail(db, "rights", "The decision would have cleared rights. Stopped.");
  const episode = row.snapshot.episodeId ? next.episodes.find((item) => item.id === row.snapshot.episodeId) : null;
  if (episode && latestSnapshot(episode).snapshot.stage === "PUBLISHED") return fail(db, "publish-disabled", "A picture cannot publish an episode.");
  const published = publishEpisode(next, episode?.id ?? assetId, actor, at);
  if (published.ok) return fail(db, "publish-disabled", "Approval must not publish.");
  return { ok: true, db: published.db, data: { version } };
}

export function imageCovers(db: StudioDb, assetId: string, version: number): boolean {
  const asset = db.assets.find((item) => item.id === assetId);
  const approval = [...(db.humanApprovals ?? [])].reverse().find((item) => item.subjectType === "asset" && item.subjectId === assetId && item.decision === "APPROVED");
  return Boolean(asset?.canonicalVersion === version && approval?.approvedArtifactVersions.some((pin) => pin.type === "asset" && pin.version === version));
}

export interface RecordedImageInstall {
  seq: number;
  characterId: string;
  result: ImageCallResult;
  asset: VersionedEntity<AssetBody>;
  execution: AiExecution;
  objectRecord: ObjectRecord;
  audits: AuditEvent[];
}

function idTaken(db: StudioDb, id: string): boolean {
  return JSON.stringify(db).includes(`"${id}"`);
}

/** Replay filed candidates. A newer template does not rewrite an older version. */
export function installRecordedImage(db: StudioDb, recorded: RecordedImageInstall, actor: Actor): Op<{ assetId: string; executionId: string; version: number }> {
  if (actor.type !== "human") return fail(db, "permission", "A person files the picture. The model cannot file its own canon.");
  const asset = recorded.asset;
  const version = asset.versions.at(-1);
  if (!asset || !version || version.status === "approved" || version.snapshot.lineage === "HUMAN_APPROVED") return fail(db, "approval", "A recorded candidate cannot arrive already approved.");
  if (!db.assets.some((item) => item.id === asset.id) && asset.canonicalVersion != null) return fail(db, "approval", "A recorded candidate cannot arrive already approved.");
  if (version.snapshot.commercialUseStatus !== "not-cleared" || version.snapshot.lineage !== "AI_GENERATED") return fail(db, "rights", "The recorded image is not an uncleared generation.");
  if (version.snapshot.storageDurability !== "BLOCKED") return fail(db, "storage", "Durable storage was not configured. The record cannot claim it.");
  if (recorded.objectRecord.rightsStatus !== "UNKNOWN") return fail(db, "rights", "Rights on the file are not unknown. Stopped.");
  if (version.snapshot.characterId !== recorded.characterId || recorded.execution.outputArtifactIds.includes(asset.id) === false) return fail(db, "character", "The image is not linked to this character and this execution.");
  if (version.snapshot.generationRunId !== recorded.execution.id || recorded.objectRecord.provenanceExecutionId !== recorded.execution.id) return fail(db, "provenance", "The file, the asset, and the execution do not match.");
  if (recorded.objectRecord.checksum !== recorded.result.checksum || recorded.objectRecord.storageRef !== recorded.result.storageRef) return fail(db, "provenance", "The stored file does not match the execution.");
  if (recorded.audits.some((item) => item.action.startsWith("rights") || item.action === "episode.published")) return fail(db, "rights", "The record would change rights or publish. Stopped.");
  const prepared = prepareCharacterImage(db, recorded.characterId, null);
  if (typeof prepared === "string") return fail(db, "character", prepared);
  if (prepared.characterVersion !== version.snapshot.characterVersion || prepared.canonSnapshotHash !== version.snapshot.canonSnapshotHash) {
    return fail(db, "canon", "The canon used for this picture no longer matches. It was not filed.");
  }
  const existing = db.assets.find((item) => item.id === asset.id);
  if (existing) {
    const already = existing.versions.find((item) => item.version === version.version);
    if (already) {
      if (JSON.stringify(already.snapshot) !== JSON.stringify(version.snapshot)) return fail(db, "overwrite", "That image version already exists and was not overwritten.");
      return { ok: true, db, data: { assetId: existing.id, executionId: recorded.execution.id, version: version.version } };
    }
    for (const prior of existing.versions) {
      const recordedPrior = asset.versions.find((item) => item.version === prior.version);
      if (recordedPrior && JSON.stringify(recordedPrior.snapshot) !== JSON.stringify(prior.snapshot)) return fail(db, "overwrite", "An older image version would have changed. Stopped.");
    }
  }
  const newIds = [recorded.execution.id, recorded.objectRecord.id, ...recorded.audits.map((item) => item.id), ...(existing ? [] : [asset.id])];
  if (newIds.some((id) => idTaken(db, id))) return fail(db, "collision", "Those record ids are already used. The picture was not copied over another record.");
  const beforeCharacter = JSON.stringify(db.characters.find((item) => item.id === recorded.characterId));
  const thunderBefore = JSON.stringify(db.episodes.find((item) => latestSnapshot(item).snapshot.title === "Count the Thunder")?.versions ?? []);
  const alpineBefore = JSON.stringify((db.locationLibrary ?? []).find((item) => item.key === "alpine-inspired") ?? null);
  const rightsBefore = JSON.stringify(db.rightsRecords ?? []);
  const merged: VersionedEntity<AssetBody> = existing
    ? { ...existing, name: existing.name, currentVersion: Math.max(existing.currentVersion, version.version), canonicalVersion: existing.canonicalVersion, updatedAt: version.createdAt, versions: [...existing.versions, version] }
    : asset;
  const next: StudioDb = {
    ...db,
    seq: Math.max(db.seq, recorded.seq),
    assets: existing ? db.assets.map((item) => (item.id === asset.id ? merged : item)) : [...db.assets, asset],
    aiExecutions: [...(db.aiExecutions ?? []), recorded.execution],
    objectRecords: [...(db.objectRecords ?? []), recorded.objectRecord],
    audit: [...db.audit, ...recorded.audits],
  };
  if (JSON.stringify(next.characters.find((item) => item.id === recorded.characterId)) !== beforeCharacter) return fail(db, "canon", "The picture would have changed the character record. Stopped.");
  if (JSON.stringify(next.episodes.find((item) => latestSnapshot(item).snapshot.title === "Count the Thunder")?.versions ?? []) !== thunderBefore) return fail(db, "regression", "Count the Thunder would have changed. Stopped.");
  if (JSON.stringify((next.locationLibrary ?? []).find((item) => item.key === "alpine-inspired") ?? null) !== alpineBefore) return fail(db, "regression", "The Alpine proposal would have changed. Stopped.");
  if (JSON.stringify(next.rightsRecords ?? []) !== rightsBefore) return fail(db, "rights", "The picture would have cleared rights. Stopped.");
  return { ok: true, db: next, data: { assetId: asset.id, executionId: recorded.execution.id, version: version.version } };
}
