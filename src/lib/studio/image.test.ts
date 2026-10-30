import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { describe, it } from "node:test";
import { memoryObjectStore, sessionObjectStore } from "./architecture.ts";
import { latestSnapshot, publishEpisode } from "./engine.ts";
import { acceptImageGeneration, approvedCharacterReference, decideCharacterImage, imageCovers, prepareCharacterImage, IMAGE_PROVIDER_ID, type ImageCallResult } from "./image.ts";
import { completeImage } from "./image-call.ts";
import { buildSeedDb } from "./seed.ts";
import type { Actor } from "./types.ts";

const human: Actor = { type: "human", id: "human_asha", name: "Asha Menon" };
const agent: Actor = { type: "agent", id: "agent_image", name: "Image" };
const NOW = "2026-10-16T18:30:00.000Z";

function result(partial: Partial<ImageCallResult>): ImageCallResult {
  return {
    status: "SUCCESS",
    providerId: IMAGE_PROVIDER_ID,
    model: "grok-imagine-image-2.0",
    modelVersion: null,
    mediaType: "image/jpeg",
    byteLength: 40,
    checksum: null,
    storageRef: "session/test",
    storageDurability: "BLOCKED",
    durationMs: 10,
    cost: null,
    costNote: "UNKNOWN",
    error: null,
    externalReference: "req_1",
    prompt: "",
    templateKey: "CHARACTER_IMAGE",
    templateVersion: 1,
    ...partial,
  };
}

describe("step 13 character image", () => {
  it("files an initial design without a reference, keeps rights unknown, and pins approval to one version", () => {
    const db = buildSeedDb();
    const meethi = db.characters.find((item) => latestSnapshot(item).snapshot.name === "Meethi");
    assert.ok(meethi);
    const thunder = db.episodes.find((item) => latestSnapshot(item).snapshot.title === "Count the Thunder");
    assert.equal(typeof prepareCharacterImage(db, meethi.id, thunder?.id ? latestSnapshot(thunder).snapshot.scriptId : "missing"), "string");
    const prepared = prepareCharacterImage(db, meethi.id, null);
    assert.equal(typeof prepared, "object");
    if (typeof prepared === "string") return;
    assert.equal(prepared.role, "INITIAL_DESIGN");
    assert.equal(prepared.referenceAssetId, null);
    assert.equal(prepared.referenceSentToProvider, false);
    assert.ok(prepared.unknown.includes("face"));
    const before = JSON.stringify(meethi);
    const alpine = JSON.stringify((db.locationLibrary ?? []).find((item) => item.key === "alpine-inspired") ?? null);
    const store = memoryObjectStore();
    const bytes = new Uint8Array(40).fill(7);
    const filed = acceptImageGeneration(db, prepared, result({ prompt: prepared.prompt }), human, store, bytes, NOW);
    assert.equal(filed.ok, true, filed.ok ? "" : filed.error);
    if (!filed.ok || !filed.data.assetId) return;
    const asset = filed.db.assets.find((item) => item.id === filed.data.assetId);
    assert.ok(asset);
    assert.equal(asset.canonicalVersion, null);
    assert.equal(latestSnapshot(asset).snapshot.commercialUseStatus, "not-cleared");
    assert.equal(latestSnapshot(asset).snapshot.storageDurability, "BLOCKED");
    assert.equal(latestSnapshot(asset).snapshot.lineage, "AI_GENERATED");
    assert.equal(filed.db.objectRecords.find((item) => item.provenanceExecutionId === filed.data.executionId)?.rightsStatus, "UNKNOWN");
    assert.equal(latestSnapshot(asset).snapshot.characterId, meethi.id);
    assert.equal(latestSnapshot(asset).snapshot.canonSnapshotHash, prepared.canonSnapshotHash);
    assert.equal(latestSnapshot(asset).snapshot.prompt, prepared.prompt);
    assert.equal(latestSnapshot(asset).snapshot.promptVersion, prepared.templateVersion);
    assert.equal(latestSnapshot(asset).snapshot.referenceAssetId, null);
    assert.equal(store.get("session/test")?.bytes.byteLength, 40);
    assert.equal(JSON.stringify(filed.db.characters.find((item) => item.id === meethi.id)), before);
    assert.equal(JSON.stringify((filed.db.locationLibrary ?? []).find((item) => item.key === "alpine-inspired") ?? null), alpine);
    const agentNo = decideCharacterImage(filed.db, asset.id, 1, "APPROVED", agent, "The model tried to approve itself.", NOW);
    assert.equal(agentNo.ok, false);
    const approved = decideCharacterImage(filed.db, asset.id, 1, "APPROVED", human, "Human accepts this exact initial design. Not a rights clearance.", NOW);
    assert.equal(approved.ok, true, approved.ok ? "" : approved.error);
    if (!approved.ok) return;
    assert.equal(imageCovers(approved.db, asset.id, 1), true);
    assert.equal(approved.db.assets.find((item) => item.id === asset.id)?.versions[0]?.snapshot.commercialUseStatus, "not-cleared");
    const again = acceptImageGeneration(approved.db, prepareCharacterImage(approved.db, meethi.id, null) as Exclude<ReturnType<typeof prepareCharacterImage>, string>, result({ prompt: (prepareCharacterImage(approved.db, meethi.id, null) as Exclude<ReturnType<typeof prepareCharacterImage>, string>).prompt, externalReference: "req_2", storageRef: "session/test-2" }), human, store, bytes, NOW);
    assert.equal(again.ok, true, again.ok ? "" : again.error);
    if (!again.ok) return;
    const follow = again.db.assets.find((item) => item.id === asset.id);
    assert.equal(follow?.currentVersion, 2);
    assert.equal(follow?.canonicalVersion, 1);
    assert.equal(imageCovers(again.db, asset.id, 2), false);
    assert.equal(latestSnapshot(follow!).snapshot.referenceAssetId, asset.id);
    assert.equal(latestSnapshot(follow!).snapshot.referenceAssetVersion, 1);
    assert.equal(JSON.stringify(follow?.versions[0]?.snapshot.prompt), JSON.stringify(asset.versions[0]?.snapshot.prompt));
    const rejected = decideCharacterImage(again.db, asset.id, 2, "REJECTED", human, "The ribbon is not the locked red. This version stays rejected.", NOW);
    assert.equal(rejected.ok, true, rejected.ok ? "" : rejected.error);
    if (!rejected.ok) return;
    assert.equal(decideCharacterImage(rejected.db, asset.id, 2, "APPROVED", human, "Trying to approve the rejected picture anyway.", NOW).ok, false);
    assert.equal(approvedCharacterReference(rejected.db, meethi.id)?.version, 1);
    assert.equal(publishEpisode(rejected.db, thunder!.id, human, NOW).ok, false);
  });

  it("does not invent a picture when the credential, the provider, or the clock fails", async () => {
    const db = buildSeedDb();
    const meethi = db.characters.find((item) => latestSnapshot(item).snapshot.name === "Meethi");
    assert.ok(meethi);
    const prepared = prepareCharacterImage(db, meethi.id, null);
    assert.equal(typeof prepared, "object");
    if (typeof prepared === "string") return;
    const input = { templateKey: prepared.templateKey, templateVersion: prepared.templateVersion, templateBody: prepared.prompt.split("\n")[0] ?? "", prompt: prepared.prompt, characterId: meethi.id };
    const missing = await completeImage(input, { apiKey: "", fetch });
    assert.equal(missing.status, "AUTH_ERROR");
    assert.equal(missing.byteLength, null);
    const failed = await completeImage(input, { apiKey: "secret-value", fetch: async () => new Response("no", { status: 500 }) });
    assert.equal(failed.status, "PROVIDER_ERROR");
    assert.equal(failed.error?.includes("secret-value"), false);
    const timed = await completeImage(input, { apiKey: "secret-value", fetch: async () => { const error = new Error("aborted"); error.name = "AbortError"; throw error; } });
    assert.equal(timed.status, "TIMEOUT");
    const pixels = Buffer.from("a".repeat(40)).toString("base64");
    const ok = await completeImage(input, {
      apiKey: "secret-value",
      fetch: async () => Response.json({ id: "req_live_fake", model: "grok-imagine-image-2.0", data: [{ b64_json: pixels, mime_type: "image/jpeg" }], usage: { cost_in_usd_ticks: 200000000 } }),
    });
    assert.equal(ok.status, "SUCCESS");
    assert.equal(ok.cost, null);
    assert.match(ok.costNote, /UNKNOWN USD/);
    assert.equal(ok.storageDurability, "BLOCKED");
    const client = readFileSync(new URL("./image.ts", import.meta.url), "utf8");
    const server = readFileSync(new URL("./image-call.ts", import.meta.url), "utf8");
    assert.equal(client.includes("XAI_API_KEY"), false);
    assert.equal(client.includes("api.x.ai"), false);
    assert.equal(server.includes("console."), false);
    const noisy = await completeImage(input, { apiKey: "secret-value", fetch: async () => { throw new Error("secret-value leaked"); } });
    assert.equal(noisy.error?.includes("secret-value"), false);
  });

  it("requests one real image when IMAGE_LIVE=1", { timeout: 90000, skip: process.env.IMAGE_LIVE !== "1" }, async () => {
    const db = buildSeedDb();
    const meethi = db.characters.find((item) => latestSnapshot(item).snapshot.name === "Meethi");
    assert.ok(meethi);
    const prepared = prepareCharacterImage(db, meethi.id, null);
    assert.equal(typeof prepared, "object");
    if (typeof prepared === "string") return;
    assert.equal(prepared.role, "INITIAL_DESIGN");
    const live = await completeImage({
      templateKey: prepared.templateKey,
      templateVersion: prepared.templateVersion,
      templateBody: prepared.prompt.split("\n")[0] ?? "",
      prompt: prepared.prompt,
      characterId: meethi.id,
    });
    const key = process.env.XAI_API_KEY ?? "";
    assert.equal(key.length > 0 && JSON.stringify(live).includes(key), false);
    assert.equal(live.status, "SUCCESS", live.error ?? live.status);
    assert.equal(live.providerId, IMAGE_PROVIDER_ID);
    assert.equal(live.storageDurability, "BLOCKED");
    assert.ok((live.byteLength ?? 0) >= 32);
    assert.equal(live.prompt, prepared.prompt);
    assert.equal(live.templateVersion, prepared.templateVersion);
    const file = sessionObjectStore().get(live.storageRef ?? "");
    assert.ok(file);
    const ext = file.mediaType.includes("png") ? "png" : "jpg";
    writeFileSync(`/workspace/artifacts/meethi-initial-design.${ext}`, file.bytes);
  });
});
