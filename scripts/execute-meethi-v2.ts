import { readFileSync, writeFileSync } from "node:fs";
import { sessionObjectStore } from "../src/lib/studio/architecture.ts";
import { fingerprint, latestSnapshot, publishEpisode } from "../src/lib/studio/engine.ts";
import { acceptImageGeneration, installRecordedImage, prepareCharacterImage, automatedConsistency, IMAGE_PROVIDER_ID, type RecordedImageInstall } from "../src/lib/studio/image.ts";
import { completeImage } from "../src/lib/studio/image-call.ts";
import { RECORDED_CHARACTER_IMAGES } from "../src/lib/studio/generated/meethi-recorded.ts";
import { buildSeedDb } from "../src/lib/studio/seed.ts";

const actor = { type: "human" as const, id: "human_reviewer", name: "Asha Menon" };
const prior = RECORDED_CHARACTER_IMAGES[0];
if (!prior || prior.asset.id !== "ast_3j" || prior.execution.id !== "aix_3k") {
  console.log(JSON.stringify({ executed: false, reason: "Candidate v1 ast_3j / aix_3k is not on record." }));
  process.exit(1);
}
let db = buildSeedDb();
const installed = installRecordedImage(db, prior, actor);
if (!installed.ok) {
  console.log(JSON.stringify({ executed: false, reason: installed.error }));
  process.exit(1);
}
db = installed.db;
const meethi = db.characters.find((item) => item.id === prior.characterId);
const beforeV1 = JSON.stringify(db.assets.find((item) => item.id === "ast_3j")?.versions[0]);
const prepared = prepareCharacterImage(db, prior.characterId, null);
if (!meethi || typeof prepared === "string") {
  console.log(JSON.stringify({ executed: false, reason: typeof prepared === "string" ? prepared : "Meethi is missing." }));
  process.exit(1);
}
if (prepared.templateVersion !== 3 || prepared.templateKey !== "CHARACTER_IMAGE") {
  console.log(JSON.stringify({ executed: false, reason: "The active template is not CHARACTER_IMAGE version 3." }));
  process.exit(1);
}
if (!prepared.prompt.includes("not a bow") || !prepared.known.clothing?.includes("teal salwar")) {
  console.log(JSON.stringify({ executed: false, reason: "The prompt does not keep the ribbon correction and the approved clothing." }));
  process.exit(1);
}
const provider = prepared.prompt;
console.log(JSON.stringify({
  inspection: {
    characterId: meethi.id,
    canonSnapshotHash: prepared.canonSnapshotHash,
    canonVersion: prepared.canonVersion,
    template: { key: prepared.templateKey, version: prepared.templateVersion },
    providerId: IMAGE_PROVIDER_ID,
    priorAsset: "ast_3j",
    priorVersion: 1,
    priorExecution: "aix_3k",
    credentialConfigured: Boolean(process.env.XAI_API_KEY),
  },
}));
if (process.env.EXECUTE_IMAGE !== "1") process.exit(0);

const live = await completeImage({
  templateKey: prepared.templateKey,
  templateVersion: prepared.templateVersion,
  templateBody: provider.split("\n")[0] ?? "",
  prompt: provider,
  characterId: meethi.id,
});
const key = process.env.XAI_API_KEY ?? "";
if (key && JSON.stringify(live).includes(key)) {
  console.log(JSON.stringify({ executed: false, reason: "The provider result contained the credential. Nothing was filed." }));
  process.exit(1);
}
if (live.status !== "SUCCESS" || !live.storageRef) {
  console.log(JSON.stringify({ executed: false, status: live.status, error: live.error, model: live.model }));
  process.exit(1);
}
const stored = sessionObjectStore().get(live.storageRef);
if (!stored || stored.bytes.byteLength < 32) {
  console.log(JSON.stringify({ executed: false, reason: "The adapter reported success but returned no file." }));
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
if (!asset || asset.id !== "ast_3j" || asset.currentVersion !== 2 || !execution || !objectRecord) {
  console.log(JSON.stringify({ executed: false, reason: "The new picture was not filed as version 2 of ast_3j." }));
  process.exit(1);
}
if (JSON.stringify(asset.versions[0]) !== beforeV1) {
  console.log(JSON.stringify({ executed: false, reason: "Version 1 would have changed. Nothing was saved." }));
  process.exit(1);
}
const record: RecordedImageInstall = {
  seq: filed.db.seq,
  characterId: meethi.id,
  result: { ...live, checksum: objectRecord.checksum, byteLength: objectRecord.byteLength, storageRef: objectRecord.storageRef, storageDurability: "BLOCKED" },
  asset,
  execution,
  objectRecord,
  audits: filed.db.audit.slice(beforeAudit),
};
const imagePath = new URL("../src/lib/studio/generated/meethi-candidate-v2.jpg", import.meta.url);
writeFileSync(imagePath, stored.bytes);
const reread = new Uint8Array(readFileSync(imagePath));
const checksum = fingerprint(Array.from(reread));
const retrieval = checksum === objectRecord.checksum && reread.byteLength === objectRecord.byteLength ? "VERIFIED" : "FAILED";
if (retrieval !== "VERIFIED") {
  console.log(JSON.stringify({ executed: false, reason: "The saved file did not match the checksum." }));
  process.exit(1);
}
const v1File = { storageRef: prior.objectRecord.storageRef, mediaType: prior.objectRecord.mediaType, checksum: prior.objectRecord.checksum, byteLength: prior.objectRecord.byteLength, file: "meethi-candidate.jpg", version: 1 };
const v2File = { storageRef: objectRecord.storageRef, mediaType: objectRecord.mediaType, checksum: objectRecord.checksum, byteLength: objectRecord.byteLength, file: "meethi-candidate-v2.jpg", version: 2 };
writeFileSync(new URL("../src/lib/studio/generated/meethi-candidate.json", import.meta.url), JSON.stringify({ files: [v1File, v2File] }, null, 2));
const records = [prior, record];
writeFileSync(new URL("../src/lib/studio/generated/meethi-recorded.ts", import.meta.url), `import type { RecordedImageInstall } from "../image.ts";\n\nexport const RECORDED_CHARACTER_IMAGE: RecordedImageInstall | null = ${JSON.stringify(prior)} as RecordedImageInstall;\n\nexport const RECORDED_CHARACTER_IMAGES: RecordedImageInstall[] = ${JSON.stringify(records)} as RecordedImageInstall[];\n`);
const thunder = filed.db.episodes.find((item) => latestSnapshot(item).snapshot.title === "Count the Thunder");
console.log(JSON.stringify({
  executed: true,
  assetId: asset.id,
  assetVersion: 2,
  version1Unchanged: true,
  executionId: execution.id,
  providerId: execution.providerId,
  model: execution.model,
  modelVersion: execution.modelVersion,
  externalReference: live.externalReference,
  canonVersion: prepared.canonVersion,
  canonSnapshotHash: prepared.canonSnapshotHash,
  templateKey: prepared.templateKey,
  templateVersion: prepared.templateVersion,
  checksum,
  byteLength: reread.byteLength,
  mediaType: objectRecord.mediaType,
  storageDurability: "BLOCKED",
  retrieval,
  rightsStatus: objectRecord.rightsStatus,
  status: asset.versions[1]?.status ?? null,
  canonicalVersion: asset.canonicalVersion,
  cost: live.cost,
  costNote: live.costNote,
  qa: automatedConsistency(prepared).map((item) => ({ name: item.name, result: item.result })),
  publishOk: thunder ? publishEpisode(filed.db, thunder.id, actor).ok : null,
}, null, 2));
