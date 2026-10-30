import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  architectureApproveStory,
  architectureImportPerformance,
  architecturePublish,
  assignRole,
  authorizeQaReuse,
  backupManifest,
  effectiveAvailability,
  enqueueJob,
  markProviderUnavailable,
  memoryObjectStore,
  mutateProductionFromLocal,
  openChildProfile,
  PROMPT_LIBRARY,
  PROVIDER_REGISTRY,
  publishBlockers,
  putProductionFile,
  registerExternalPublication,
  registerPromptVersion,
  requestGeneration,
  retryJob,
  runJob,
  setFeatureFlag,
  storeSecret,
  switchProvider,
  useProposedLocation,
  youtubeUpload,
} from "./architecture.ts";
import { latestSnapshot, migrateStudioDb, publishEpisode } from "./engine.ts";
import { buildSeedDb } from "./seed.ts";
import { ALPINE_KEY } from "./brain.ts";
import { branchStoryVersion, fileAlpineProposal, pinQaRun, registerAssetWithUnknownRights, rightsAreCleared } from "./source.ts";
import type { Actor, StudioDb } from "./types.ts";

const human: Actor = { type: "human", id: "human_asha", name: "Asha Menon" };
const agent: Actor = { type: "agent", id: "agent_scriptwriter", name: "Scriptwriter" };
const NOW = "2026-10-07T18:00:00.000Z";

function must<T>(result: { ok: boolean; db: StudioDb; error?: string; data?: T }): StudioDb {
  assert.equal(result.ok, true, result.ok ? "" : result.error);
  return result.db;
}

function storyShape(db: StudioDb) {
  return db.stories.map((story) => ({
    id: story.id,
    currentVersion: story.currentVersion,
    canonicalVersion: story.canonicalVersion,
    versions: story.versions.map((version) => JSON.stringify(version.snapshot)),
  }));
}

function approvable(db: StudioDb) {
  const story = db.stories.find((item) => {
    const snap = latestSnapshot(item).snapshot;
    return item.canonicalVersion == null && snap.title !== "Count the Thunder" && snap.originality.total >= 75 && !snap.similarity.tooSimilar && snap.recommendation.canonResult === "PASS";
  });
  assert.ok(story);
  return story;
}

function thunder(db: StudioDb) {
  const episode = db.episodes.find((item) => latestSnapshot(item).snapshot.title === "Count the Thunder");
  assert.ok(episode);
  return episode;
}

describe("hybrid architecture", () => {
  it("1: switching the text adapter leaves the story workflow untouched", () => {
    const seeded = buildSeedDb();
    const before = storyShape(seeded);
    const stages = seeded.episodes.map((episode) => latestSnapshot(episode).snapshot.stage);
    const hashes = seeded.canonSnapshots.map((item) => item.hash);
    assert.equal(JSON.stringify(PROVIDER_REGISTRY).toLowerCase().includes("openai"), false);
    assert.equal(JSON.stringify(PROVIDER_REGISTRY).toLowerCase().includes("runway"), false);
    const agentSwitch = switchProvider(seeded, "LLM", "llm.standby", agent, NOW);
    assert.equal(agentSwitch.ok, false);
    const switched = must(switchProvider(seeded, "LLM", "llm.standby", human, NOW));
    assert.deepEqual(storyShape(switched), before);
    assert.deepEqual(switched.episodes.map((episode) => latestSnapshot(episode).snapshot.stage), stages);
    assert.deepEqual(switched.canonSnapshots.map((item) => item.hash), hashes);
    assert.equal(switched.providerBindings.LLM, "llm.standby");
    assert.equal(switched.settings.textProviderId, "llm.standby");
    const store = memoryObjectStore();
    const story = seeded.stories[0];
    const generated = must(requestGeneration(switched, store, { capability: "LLM", promptKey: "STORY_PROPOSAL", inputArtifactIds: [story.id], idempotencyKey: "gen-standby" }, human, NOW));
    const execution = generated.aiExecutions[0];
    assert.ok(execution);
    assert.equal(execution.providerId, "llm.standby");
    assert.equal(execution.model, "standby-template-v1");
    assert.deepEqual(storyShape(generated), before);
    const held = must(markProviderUnavailable(generated, "llm.standby", human, "Standby adapter timed out in the test.", NOW));
    assert.equal(effectiveAvailability(held, "llm.standby"), "UNAVAILABLE");
    assert.equal(held.aiExecutions[0]?.providerId, "llm.standby");
    assert.equal(held.aiExecutions[0]?.modelVersion, "1");
  });

  it("2: a development generation records provider, model, version, task, and artifacts", () => {
    const seeded = buildSeedDb();
    const story = seeded.stories[0];
    const store = memoryObjectStore();
    const db = must(requestGeneration(seeded, store, { capability: "LLM", promptKey: "SCRIPTWRITER_CHILDREN", inputArtifactIds: [story.id], idempotencyKey: "gen-dev", taskId: "task_dev" }, human, NOW));
    const execution = db.aiExecutions[0];
    assert.ok(execution);
    assert.equal(execution.providerId, "development");
    assert.equal(execution.model, "dev-template-v1");
    assert.equal(execution.modelVersion, "1");
    assert.equal(execution.taskId, "task_dev");
    assert.deepEqual(execution.inputArtifactIds, [story.id]);
    assert.equal(execution.outputArtifactIds.length, 1);
    assert.equal(execution.promptKey, "SCRIPTWRITER_CHILDREN");
    assert.equal(execution.promptVersion, 3);
    assert.equal(execution.estimatedCost, null);
    const output = db.objectRecords.find((item) => item.id === execution.outputArtifactIds[0]);
    assert.ok(output);
    assert.equal(output.rightsStatus, "UNKNOWN");
    assert.equal("bytes" in output, false);
    assert.ok(store.get(output.storageRef));
    assert.equal(db.stories.find((item) => item.id === story.id)?.currentVersion, story.currentVersion);
  });

  it("3: Count the Thunder cannot be published", () => {
    const seeded = buildSeedDb();
    const episode = thunder(seeded);
    const blocked = architecturePublish(seeded, episode.id, human, NOW);
    assert.equal(blocked.ok, false);
    assert.match(blocked.error, /RIGHTS BLOCKED/);
    assert.match(blocked.error, /HUMAN APPROVAL REQUIRED/);
    assert.equal(latestSnapshot(blocked.db.episodes.find((item) => item.id === episode.id)!).snapshot.stage, "HUMAN_APPROVAL");
    const upload = youtubeUpload(seeded, episode.id, human, NOW);
    assert.equal(upload.ok, false);
    assert.match(upload.error, /not callable/);
    assert.equal(publishEpisode(upload.db, episode.id, human, NOW).ok, false);
    const flag = setFeatureFlag(seeded, "publishing", true, human);
    assert.equal(flag.ok, false);
    assert.equal(flag.db.featureFlags.publishing, false);
    assert.deepEqual(publishBlockers(seeded, episode.id).includes("RIGHTS BLOCKED"), true);
  });

  it("4: QA pinned to an older story version cannot authorize the next one", () => {
    const seeded = buildSeedDb();
    const story = seeded.stories.find((item) => item.canonicalVersion == null && item.currentVersion === 1);
    assert.ok(story);
    const pinned = must(pinQaRun(seeded, story.id, 1, human, NOW));
    const run = pinned.qaRuns.find((item) => item.storyId === story.id);
    assert.ok(run);
    const branched = must(branchStoryVersion(pinned, story.id, 1, "A second version for the stale QA check.", human, "The old QA must stay historical.", NOW));
    const stale = branched.qaRuns.find((item) => item.id === run.id);
    assert.equal(stale?.overallStatus, "OUTDATED");
    assert.equal(stale?.storyVersion, 1);
    const reuse = authorizeQaReuse(branched, run.id, 3);
    assert.equal(reuse.ok, false);
    assert.equal(JSON.stringify(stale?.checkResults), JSON.stringify(run.checkResults));
  });

  it("5: the proposed Alpine range cannot enter approved production", () => {
    const seeded = buildSeedDb();
    const filed = must(fileAlpineProposal(seeded, human, NOW));
    const used = useProposedLocation(filed, ALPINE_KEY, human, NOW);
    assert.equal(used.ok, false);
    assert.match(used.error, /not approved/);
    assert.equal(filed.locations.some((item) => latestSnapshot(item).snapshot.key === ALPINE_KEY), false);
  });

  it("6: a file's bytes stay in object storage and the record keeps metadata", () => {
    const store = memoryObjectStore();
    const saved = putProductionFile(buildSeedDb(), store, { name: "lane board", mediaType: "image/png", bytes: new Uint8Array([1, 2, 3, 4]) }, human, NOW);
    assert.equal(saved.ok, true);
    if (!saved.ok) return;
    const meta = saved.db.objectRecords.find((item) => item.id === saved.data.id);
    assert.ok(meta);
    assert.equal(meta.byteLength, 4);
    assert.equal(meta.rightsStatus, "UNKNOWN");
    assert.equal("bytes" in meta, false);
    const blob = store.get(meta.storageRef);
    assert.ok(blob);
    assert.deepEqual(Array.from(blob.bytes), [1, 2, 3, 4]);
    assert.equal(blob.checksum, meta.checksum);
    assert.equal(JSON.stringify(saved.db.objectRecords).includes('"bytes"'), false);
  });

  it("7: replacing a file creates a new version and keeps the old one", () => {
    const store = memoryObjectStore();
    const first = putProductionFile(buildSeedDb(), store, { name: "lane board", mediaType: "image/png", bytes: new Uint8Array([1, 2, 3]), assetKey: "board_lane" }, human, NOW);
    assert.equal(first.ok, true);
    if (!first.ok) return;
    const second = putProductionFile(first.db, store, { name: "lane board", mediaType: "image/png", bytes: new Uint8Array([9, 9]), assetKey: "board_lane" }, human, NOW);
    assert.equal(second.ok, true);
    if (!second.ok) return;
    assert.equal(second.data.version, 2);
    const versions = second.db.objectRecords.filter((item) => item.assetKey === "board_lane");
    assert.equal(versions.length, 2);
    const old = versions.find((item) => item.version === 1);
    const next = versions.find((item) => item.version === 2);
    assert.ok(old && next);
    assert.notEqual(old.checksum, next.checksum);
    assert.deepEqual(Array.from(store.get(old.storageRef)!.bytes), [1, 2, 3]);
    assert.deepEqual(Array.from(store.get(next.storageRef)!.bytes), [9, 9]);
  });

  it("8: an agent cannot approve its own output, and an admin still cannot publish", () => {
    const seeded = buildSeedDb();
    const story = approvable(seeded);
    const self = architectureApproveStory(seeded, story.id, agent, "The scriptwriter must not approve this story.", NOW);
    assert.equal(self.ok, false);
    assert.match(self.error, /cannot approve/);
    assert.equal(self.db.stories.find((item) => item.id === story.id)?.canonicalVersion, null);
    const viewers = must(assignRole(seeded, "human_viewer", "VIEWER", human, NOW));
    const viewer: Actor = { type: "human", id: "human_viewer", name: "Viewer" };
    const viewed = architectureApproveStory(viewers, story.id, viewer, "A viewer must not approve this story either.", NOW);
    assert.equal(viewed.ok, false);
    const published = architecturePublish(seeded, thunder(seeded).id, human, NOW);
    assert.equal(published.ok, false);
    assert.notEqual(latestSnapshot(published.db.episodes.find((item) => item.id === thunder(seeded).id)!).snapshot.stage, "PUBLISHED");
  });

  it("9: unknown rights are not cleared", () => {
    const seeded = buildSeedDb();
    const saved = registerAssetWithUnknownRights(seeded, "Unassigned sky plate", human, NOW);
    assert.equal(saved.ok, true);
    if (!saved.ok) return;
    assert.equal(rightsAreCleared(saved.data.status), false);
    assert.equal(saved.data.status, "UNKNOWN");
    const blocked = architecturePublish(saved.db, thunder(saved.db).id, human, NOW);
    assert.equal(blocked.ok, false);
    assert.match(blocked.error, /RIGHTS BLOCKED/);
  });

  it("10: approving a story writes who, when, what, and which version", () => {
    const seeded = buildSeedDb();
    const story = approvable(seeded);
    const approved = architectureApproveStory(seeded, story.id, human, "Editorial note long enough to approve this version.", NOW);
    assert.equal(approved.ok, true, approved.ok ? "" : approved.error);
    if (!approved.ok) return;
    const event = approved.db.audit.find((item) => item.action === "story.approved" && item.entityId === story.id);
    assert.ok(event);
    assert.equal(event.actorId, human.id);
    assert.equal(event.at, NOW);
    assert.equal(event.entityType, "story");
    assert.equal(event.version, approved.data.version);
    const secret = "sk-live-should-not-land";
    const denied = storeSecret(approved.db, secret);
    assert.equal(denied.ok, false);
    assert.equal(JSON.stringify(denied.db).includes(secret), false);
    const backup = backupManifest(approved.db);
    assert.equal(backup.schemaVersion, 10);
    assert.equal(backup.checksum, backupManifest(approved.db).checksum);
    assert.equal(mutateProductionFromLocal(approved.db).ok, false);
    assert.equal(openChildProfile(approved.db).ok, false);
  });

  it("11: a provider timeout is retryable and does not duplicate the artifact", () => {
    const seeded = buildSeedDb();
    const store = memoryObjectStore();
    const story = seeded.stories[0];
    const input = { capability: "LLM" as const, promptKey: "STORY_PROPOSAL", inputArtifactIds: [story.id], idempotencyKey: "job-timeout-1" };
    const queued = enqueueJob(seeded, input, human, NOW);
    assert.equal(queued.ok, true);
    if (!queued.ok) return;
    const again = enqueueJob(queued.db, input, human, NOW);
    assert.equal(again.ok, true);
    if (!again.ok) return;
    assert.equal(again.data.jobId, queued.data.jobId);
    assert.equal(again.data.duplicate, true);
    const failed = runJob(queued.db, store, queued.data.jobId, human, { failure: "timeout" }, NOW);
    assert.equal(failed.ok, true);
    if (!failed.ok) return;
    assert.equal(failed.data.state, "failed");
    assert.equal(failed.db.jobs[0]?.failureClass, "TECHNICAL");
    assert.equal(failed.db.objectRecords.length, 0);
    assert.equal(failed.data.outputIds.length, 0);
    const recovered = retryJob(failed.db, store, queued.data.jobId, human, undefined, NOW);
    assert.equal(recovered.ok, true);
    if (!recovered.ok) return;
    assert.equal(recovered.data.state, "completed");
    assert.equal(recovered.db.objectRecords.length, 1);
    assert.equal(recovered.db.aiExecutions.length, 2);
    assert.equal(recovered.db.aiExecutions[0]?.status, "RETRYABLE");
    assert.equal(recovered.db.aiExecutions[0]?.outputArtifactIds.length, 0);
    assert.equal(recovered.db.aiExecutions[1]?.outputArtifactIds.length, 1);
    const repeated = runJob(recovered.db, store, queued.data.jobId, human, undefined, NOW);
    assert.equal(repeated.ok, true);
    if (!repeated.ok) return;
    assert.equal(repeated.db.objectRecords.length, 1);
    const creative = enqueueJob(repeated.db, { ...input, idempotencyKey: "job-creative" }, human, NOW);
    assert.equal(creative.ok, true);
    if (!creative.ok) return;
    const blocked = runJob(creative.db, store, creative.data.jobId, human, { failure: "creative" }, NOW);
    assert.equal(blocked.ok, true);
    if (!blocked.ok) return;
    assert.equal(blocked.db.jobs.find((job) => job.id === creative.data.jobId)?.failureClass, "CREATIVE");
    const noRetry = retryJob(blocked.db, store, creative.data.jobId, human, undefined, NOW);
    assert.equal(noRetry.ok, false);
    assert.match(noRetry.error ?? "", /not retried/);
    assert.equal(noRetry.db.objectRecords.length, 1);
    const libraryBefore = PROMPT_LIBRARY.find((item) => item.key === "SCRIPTWRITER_CHILDREN")?.body;
    const versioned = must(registerPromptVersion(blocked.db, { key: "SCRIPTWRITER_CHILDREN", purpose: "Create a Hindi development script from an approved story.", input: "StoryVersion", output: "ScriptVersion", body: "A later template. The old wording stays on record." }, human, NOW));
    assert.equal(versioned.promptVersions[0]?.version, 4);
    assert.equal(PROMPT_LIBRARY.find((item) => item.key === "SCRIPTWRITER_CHILDREN")?.body, libraryBefore);
    assert.notEqual(versioned.promptVersions[0]?.body, libraryBefore);
  });

  it("12: performance hangs off a publication and a content version", () => {
    const seeded = buildSeedDb();
    const recorded = registerExternalPublication(seeded, { episodeId: "ep_external_sample", title: "Sample outside the studio", contentVersionReference: "story:sample@2", idempotencyKey: "pub-sample" }, human, NOW);
    assert.equal(recorded.ok, true);
    if (!recorded.ok) return;
    const twice = registerExternalPublication(recorded.db, { episodeId: "ep_external_sample", title: "Sample outside the studio", contentVersionReference: "story:sample@2", idempotencyKey: "pub-sample" }, human, NOW);
    assert.equal(twice.ok, true);
    if (!twice.ok) return;
    assert.equal(twice.db.publications.length, 1);
    const imported = architectureImportPerformance(twice.db, { publicationId: recorded.data.id, episodeId: "ep_external_sample", metric: "retention", value: 40, contentVersionReference: "story:sample@2", idempotencyKey: "perf-sample" }, human, NOW);
    assert.equal(imported.ok, true);
    if (!imported.ok) return;
    const row = imported.db.performanceRecords.find((item) => item.id === imported.data.id);
    assert.ok(row);
    assert.equal(row.publicationId, recorded.data.id);
    assert.equal(row.contentVersionReference, "story:sample@2");
    const duplicate = architectureImportPerformance(imported.db, { publicationId: recorded.data.id, episodeId: "ep_external_sample", metric: "retention", value: 40, contentVersionReference: "story:sample@2", idempotencyKey: "perf-sample" }, human, NOW);
    assert.equal(duplicate.ok, true);
    if (!duplicate.ok) return;
    assert.equal(duplicate.db.performanceRecords.length, 1);
    assert.equal(latestSnapshot(thunder(duplicate.db)).snapshot.stage, "HUMAN_APPROVAL");
    const migrated = migrateStudioDb({ schemaVersion: 9, studio: null });
    assert.equal(migrated.schemaVersion, 10);
    assert.deepEqual(migrated.jobs, []);
    assert.deepEqual(migrated.aiExecutions, []);
    assert.equal(migrated.featureFlags.publishing, false);
  });
});
