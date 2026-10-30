import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { architecturePublish, putProductionFile, memoryObjectStore, retryJob, runJob, enqueueJob, setFeatureFlag, switchProvider } from "./architecture.ts";
import { audienceFor } from "./analytics.ts";
import { ALPINE_KEY } from "./brain.ts";
import { approveStory, latestSnapshot, publishEpisode } from "./engine.ts";
import { branchStoryVersion, fileAlpineProposal, pinQaRun, registerAssetWithUnknownRights, rightsAreCleared, sourceClearRights } from "./source.ts";
import { useProposedLocation } from "./architecture.ts";
import { proposeCanonBreach } from "./engine.ts";
import { buildSeedDb } from "./seed.ts";
import { approvalMatchesCurrent, clearPlanRights, MVP_NON_GOALS, MVP_PHASES, promoteToReady, runVerticalSlice } from "./mvp.ts";
import type { Actor, StudioDb } from "./types.ts";

const human: Actor = { type: "human", id: "human_asha", name: "Asha Menon" };
const agent: Actor = { type: "agent", id: "agent_scriptwriter", name: "Scriptwriter" };
const NOW = "2026-10-07T20:00:00.000Z";

function must<T>(result: { ok: boolean; db: StudioDb; error?: string; data?: T }): StudioDb {
  assert.equal(result.ok, true, result.ok ? "" : result.error);
  return result.db;
}

function thunder(db: StudioDb) {
  const episode = db.episodes.find((item) => latestSnapshot(item).snapshot.title === "Count the Thunder");
  assert.ok(episode);
  return episode;
}

describe("mvp build plan", () => {
  it("walks one new story to ready to publish and still cannot publish", () => {
    const seeded = buildSeedDb();
    const before = {
      stage: latestSnapshot(thunder(seeded)).snapshot.stage,
      versions: thunder(seeded).versions.length,
      hindi: seeded.scripts.find((item) => item.id === latestSnapshot(thunder(seeded)).snapshot.scriptId)?.versions.length,
    };
    const slice = runVerticalSlice(seeded, human, NOW);
    assert.equal(slice.ok, true, slice.ok ? "" : slice.error);
    if (!slice.ok) return;
    assert.equal(slice.data.stage, "READY_TO_PUBLISH");
    assert.equal(slice.data.published, false);
    assert.ok(slice.data.canonHash);
    assert.ok(slice.data.storyVersion >= 1);
    assert.ok(slice.data.scriptVersion >= 1);
    assert.ok(slice.data.sceneCount > 0);
    assert.ok(slice.data.shotCount > 0);
    assert.ok(slice.data.assetIds.length > 0);
    const episode = slice.db.episodes.find((item) => item.id === slice.data.episodeId);
    assert.ok(episode);
    assert.equal(latestSnapshot(episode).snapshot.stage, "READY_TO_PUBLISH");
    const published = publishEpisode(slice.db, slice.data.episodeId, human, NOW);
    assert.equal(published.ok, false);
    assert.equal(latestSnapshot(published.db.episodes.find((item) => item.id === slice.data.episodeId)!).snapshot.stage, "READY_TO_PUBLISH");
    assert.equal(latestSnapshot(thunder(published.db)).snapshot.stage, before.stage);
    assert.equal(thunder(published.db).versions.length, before.versions);
    const provenance = published.db.provenanceRecords.filter((item) => slice.data.assetIds.includes(item.assetId));
    assert.ok(provenance.length > 0);
    const rights = published.db.rightsRecords.filter((item) => item.assetId && slice.data.assetIds.includes(item.assetId));
    assert.ok(rights.every((item) => item.status === "CLEARED"));
    assert.equal(published.db.performanceRecords.filter((item) => item.episodeId === slice.data.episodeId).length, 0);
    const reading = audienceFor(published.db, thunder(published.db).id);
    assert.equal(reading.views, null);
    assert.notEqual(reading.views, 0);
    const agentRun = runVerticalSlice(seeded, agent, NOW);
    assert.equal(agentRun.ok, false);
    const staleStory = published.db.stories.find((item) => item.id === slice.data.storyId);
    assert.ok(staleStory);
    const branched = branchStoryVersion(published.db, staleStory.id, staleStory.currentVersion, "A later logline that the old approval does not cover.", human, "Show that the old approval does not follow the new version.", NOW);
    assert.equal(branched.ok, true, branched.ok ? "" : branched.error);
    if (!branched.ok) return;
    const match = approvalMatchesCurrent(branched.db, slice.data.approvalId);
    assert.equal(match.ok, false);
    const promoted = promoteToReady(branched.db, slice.data.episodeId, slice.data.approvalId, human, NOW);
    assert.equal(promoted.ok, false);
    assert.match(promoted.error, /approval|version|story/i);
  });

  it("keeps the frozen guards: canon, rights, Alpine, adapters, and retries", () => {
    const seeded = buildSeedDb();
    const breach = proposeCanonBreach(seeded, "agent_story_architect", NOW);
    assert.equal(breach.ok, true, breach.ok ? "" : breach.error);
    if (!breach.ok) return;
    const approved = approveStory(breach.db, breach.data.id, human, "This must not approve a canon breach.", NOW);
    assert.equal(approved.ok, false);
    const unknown = registerAssetWithUnknownRights(seeded, "Unassigned plate", human, NOW);
    assert.equal(unknown.ok, true);
    if (!unknown.ok) return;
    assert.equal(rightsAreCleared(unknown.data.status), false);
    assert.equal(sourceClearRights(unknown.db, unknown.data.rightsId, human, NOW).ok, false);
    const episode = thunder(seeded);
    assert.equal(architecturePublish(seeded, episode.id, human, NOW).ok, false);
    assert.equal(setFeatureFlag(seeded, "publishing", true, human).ok, false);
    const blockedPublish = architecturePublish(seeded, episode.id, human, NOW);
    assert.equal(blockedPublish.ok, false);
    if (blockedPublish.ok) return;
    assert.match(blockedPublish.error, /RIGHTS BLOCKED/);
    const alpine = must(fileAlpineProposal(seeded, human, NOW));
    assert.equal(useProposedLocation(alpine, ALPINE_KEY, human, NOW).ok, false);
    const stories = JSON.stringify(seeded.stories);
    const switched = must(switchProvider(seeded, "LLM", "llm.standby", human, NOW));
    assert.equal(JSON.stringify(switched.stories), stories);
    const store = memoryObjectStore();
    const first = putProductionFile(seeded, store, { name: "frame", mediaType: "image/png", bytes: new Uint8Array([1]), assetKey: "frame_a" }, human, NOW);
    assert.equal(first.ok, true);
    if (!first.ok) return;
    const second = putProductionFile(first.db, store, { name: "frame", mediaType: "image/png", bytes: new Uint8Array([2]), assetKey: "frame_a" }, human, NOW);
    assert.equal(second.ok, true);
    if (!second.ok) return;
    assert.equal(second.db.objectRecords.filter((item) => item.assetKey === "frame_a").length, 2);
    const story = seeded.stories[0];
    const queued = must(enqueueJob(seeded, { capability: "LLM", promptKey: "STORY_PROPOSAL", inputArtifactIds: [story.id], idempotencyKey: "mvp-timeout" }, human, NOW));
    const jobId = queued.jobs.at(-1)?.id ?? "";
    assert.ok(jobId);
    const failed = runJob(queued, store, jobId, human, { failure: "timeout" }, NOW);
    assert.equal(failed.ok, true);
    if (!failed.ok) return;
    assert.equal(failed.db.jobs.find((job) => job.id === jobId)?.failureClass, "TECHNICAL");
    const creative = must(enqueueJob(failed.db, { capability: "LLM", promptKey: "STORY_PROPOSAL", inputArtifactIds: [story.id], idempotencyKey: "mvp-creative" }, human, NOW));
    const creativeId = creative.jobs.at(-1)?.id ?? "";
    assert.ok(creativeId);
    const blocked = runJob(creative, store, creativeId, human, { failure: "creative" }, NOW);
    assert.equal(blocked.ok, true);
    if (!blocked.ok) return;
    assert.equal(retryJob(blocked.db, store, creativeId, human, undefined, NOW).ok, false);
    const open = seeded.stories.find((item) => item.canonicalVersion == null);
    assert.ok(open);
    const pinned = must(pinQaRun(seeded, open.id, 1, human, NOW));
    const run = pinned.qaRuns.find((item) => item.storyId === open.id);
    assert.ok(run);
    const branched = must(branchStoryVersion(pinned, open.id, 1, "Version two for the QA pin.", human, "The previous QA must not authorize this.", NOW));
    assert.equal(branched.qaRuns.find((item) => item.id === run.id)?.overallStatus, "OUTDATED");
    assert.equal(audienceFor(seeded, episode.id).dataState, "NOT_AVAILABLE");
    assert.ok(MVP_PHASES.some((phase) => phase.status === "IMPLEMENTED"));
    assert.ok(MVP_NON_GOALS.includes("YouTube publishing"));
    assert.equal(clearPlanRights(seeded, "missing", agent, "An agent must not clear this plan.", NOW).ok, false);
  });
});
