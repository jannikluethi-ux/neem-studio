import { readFileSync, writeFileSync } from "node:fs";
import { PROVIDER_REGISTRY, sessionObjectStore } from "../src/lib/studio/architecture.ts";
import { canonicalOf, fingerprint, latestSnapshot, publishEpisode } from "../src/lib/studio/engine.ts";
import { acceptImageGeneration, approvedCharacterReference, automatedConsistency, prepareCharacterImage, IMAGE_PROVIDER_ID, type RecordedImageInstall } from "../src/lib/studio/image.ts";
import { completeImage } from "../src/lib/studio/image-call.ts";
import { buildSeedDb } from "../src/lib/studio/seed.ts";

const actor = { type: "human" as const, id: "human_reviewer", name: "Asha Menon" };
const db = buildSeedDb();
const meethi = db.characters.find((item) => latestSnapshot(item).snapshot.name === "Meethi");
if (!meethi) throw new Error("Meethi is not in the studio database.");
const locked = canonicalOf(meethi);
const snapshot = db.canonSnapshots.at(-1);
const prepared = prepareCharacterImage(db, meethi.id, null);
const reference = approvedCharacterReference(db, meethi.id);
const storageEnv = ["S3_BUCKET", "AWS_BUCKET", "AWS_S3_BUCKET", "OBJECT_STORE", "BLOB_READ_WRITE_TOKEN"].filter((key) => Boolean(process.env[key]));

const inspection = {
  characterId: meethi.id,
  characterVersion: locked?.version ?? null,
  characterStatus: locked?.status ?? null,
  canonSnapshotId: snapshot?.id ?? null,
  canonVersion: snapshot?.canonVersion ?? null,
  canonSnapshotHash: snapshot?.hash ?? null,
  known: typeof prepared === "string" ? null : prepared.known,
  unknown: typeof prepared === "string" ? null : prepared.unknown,
  exclusions: typeof prepared === "string" ? null : prepared.exclusions,
  template: typeof prepared === "string" ? null : { key: prepared.templateKey, version: prepared.templateVersion },
  approvedReference: reference,
  imageProviders: PROVIDER_REGISTRY.filter((item) => item.capability === "IMAGE").map((item) => ({ id: item.id, model: item.model, availability: item.availability, status: item.status })),
  credentialConfigured: Boolean(process.env.XAI_API_KEY),
  objectStorageConfigured: storageEnv,
  roleBindings: db.roleBindings ?? [],
  reviewer: actor,
  artDirection: "NOT_LOCKED",
  publishing: db.featureFlags?.publishing ?? null,
};
console.log(JSON.stringify({ inspection }, null, 2));

if (process.env.EXECUTE_IMAGE !== "1") {
  console.log(JSON.stringify({ executed: false, reason: "EXECUTE_IMAGE is not 1" }));
  process.exit(0);
}
if (typeof prepared === "string") {
  console.log(JSON.stringify({ executed: false, reason: prepared }));
  process.exit(1);
}

const live = await completeImage({
  templateKey: prepared.templateKey,
  templateVersion: prepared.templateVersion,
  templateBody: prepared.prompt.split("\n")[0] ?? "",
  prompt: prepared.prompt,
  characterId: meethi.id,
});
const key = process.env.XAI_API_KEY ?? "";
if (key && JSON.stringify(live).includes(key)) {
  console.log(JSON.stringify({ executed: false, reason: "The provider result contained the credential. Nothing was filed." }));
  process.exit(1);
}
if (live.status !== "SUCCESS" || !live.storageRef) {
  console.log(JSON.stringify({ executed: false, status: live.status, error: live.error, model: live.model, providerId: live.providerId }));
  process.exit(1);
}

const stored = sessionObjectStore().get(live.storageRef);
if (!stored) {
  console.log(JSON.stringify({ executed: false, reason: "The adapter reported success but the server process has no bytes." }));
  process.exit(1);
}
const beforeAudit = db.audit.length;
const filed = acceptImageGeneration(db, prepared, live, actor, sessionObjectStore(), stored.bytes);
if (!filed.ok || !filed.data.assetId) {
  console.log(JSON.stringify({ executed: false, reason: filed.ok ? "No asset id" : filed.error }));
  process.exit(1);
}
const asset = filed.db.assets.find((item) => item.id === filed.data.assetId);
const execution = filed.db.aiExecutions.find((item) => item.id === filed.data.executionId);
const objectRecord = filed.db.objectRecords.find((item) => item.provenanceExecutionId === filed.data.executionId);
if (!asset || !execution || !objectRecord) throw new Error("The filing did not keep the asset, execution, and file record together.");
const record: RecordedImageInstall = {
  seq: filed.db.seq,
  characterId: meethi.id,
  result: { ...live, checksum: objectRecord.checksum, byteLength: objectRecord.byteLength, storageRef: objectRecord.storageRef, storageDurability: "BLOCKED" },
  asset,
  execution,
  objectRecord,
  audits: filed.db.audit.slice(beforeAudit),
};
const imagePath = new URL("../src/lib/studio/generated/meethi-candidate.jpg", import.meta.url);
const metaPath = new URL("../src/lib/studio/generated/meethi-candidate.json", import.meta.url);
const modulePath = new URL("../src/lib/studio/generated/meethi-recorded.ts", import.meta.url);
writeFileSync(imagePath, stored.bytes);
const reread = new Uint8Array(readFileSync(imagePath));
const checksum = fingerprint(Array.from(reread));
const retrieval = checksum === objectRecord.checksum && reread.byteLength === objectRecord.byteLength ? "VERIFIED" : "FAILED";
writeFileSync(metaPath, JSON.stringify({ storageRef: objectRecord.storageRef, mediaType: objectRecord.mediaType, checksum: objectRecord.checksum, byteLength: objectRecord.byteLength }, null, 2));
writeFileSync(modulePath, `import type { RecordedImageInstall } from "../image.ts";\n\nexport const RECORDED_CHARACTER_IMAGE: RecordedImageInstall | null = ${JSON.stringify(record)} as RecordedImageInstall;\n`);
const thunder = filed.db.episodes.find((item) => latestSnapshot(item).snapshot.title === "Count the Thunder");
const published = thunder ? publishEpisode(filed.db, thunder.id, actor) : null;
console.log(JSON.stringify({
  executed: true,
  providerId: IMAGE_PROVIDER_ID,
  model: live.model,
  modelVersion: live.modelVersion,
  executionId: execution.id,
  externalReference: live.externalReference,
  canonSnapshotId: snapshot?.id ?? null,
  canonVersion: snapshot?.canonVersion ?? null,
  canonSnapshotHash: snapshot?.hash ?? null,
  templateKey: prepared.templateKey,
  templateVersion: prepared.templateVersion,
  assetId: asset.id,
  assetVersion: asset.currentVersion,
  canonicalVersion: asset.canonicalVersion,
  checksum,
  byteLength: reread.byteLength,
  mediaType: objectRecord.mediaType,
  storageRef: objectRecord.storageRef,
  storageDurability: "BLOCKED",
  retrieval,
  objectStorageConfigured: storageEnv,
  rightsStatus: objectRecord.rightsStatus,
  commercialUseStatus: latestSnapshot(asset).snapshot.commercialUseStatus,
  approved: false,
  qa: automatedConsistency(prepared),
  cost: live.cost,
  costNote: live.costNote,
  durationMs: live.durationMs,
  characterUnchanged: JSON.stringify(filed.db.characters.find((item) => item.id === meethi.id)) === JSON.stringify(meethi),
  publishOk: published?.ok ?? null,
  alpineStatus: filed.db.locationLibrary?.find((item) => item.key === "alpine-inspired")?.status ?? null,
}, null, 2));
