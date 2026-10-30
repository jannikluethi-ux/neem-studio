import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AGENTS, FORBIDDEN_GRANTS } from "./agents.ts";
import {
  approveScript,
  approveStory,
  approveStoryboard,
  canonicalOf,
  latestSnapshot,
  openEpisode,
  publishEpisode,
  reviseScript,
} from "./engine.ts";
import {
  decideStoryRevision,
  enqueueTask,
  executeTask,
  nextOrchestratedStep,
  recordTechnicalFailure,
  retryTask,
  runScriptChain,
  runStoryboardChain,
} from "./orchestration.ts";
import { buildSeedDb } from "./seed.ts";
import type { Actor, StudioDb } from "./types.ts";

const human: Actor = { type: "human", id: "human_asha", name: "Asha Menon" };
const scriptwriter: Actor = { type: "agent", id: "agent_scriptwriter", name: "Scriptwriter" };
const NOW = "2026-10-07T12:00:00.000Z";
const NOTE = "Human editorial note. Not an agent approval.";

function must<T>(result: { ok: boolean; db: StudioDb; error?: string; data?: T }): StudioDb {
  assert.equal(result.ok, true, result.ok ? "" : result.error);
  return result.db;
}

function thunderPack(db: StudioDb) {
  const episode = db.episodes.find((item) => latestSnapshot(item).snapshot.title === "Count the Thunder");
  assert.ok(episode);
  const snap = latestSnapshot(episode).snapshot;
  const script = db.scripts.find((item) => item.id === snap.scriptId);
  const board = db.storyboards.find((item) => item.id === snap.storyboardId);
  const plan = db.plans.find((item) => item.id === snap.planId);
  assert.ok(script && board && plan);
  return {
    id: episode.id,
    stage: snap.stage,
    versions: episode.versions.length,
    scriptId: script.id,
    scriptVersions: script.versions.length,
    hindi: (canonicalOf(script)?.snapshot ?? latestSnapshot(script).snapshot).scenes.map((scene) => scene.lines.map((line) => line.hi).join("|")).join("||"),
    boardId: board.id,
    boardVersions: board.versions.length,
    shots: latestSnapshot(board).snapshot.scenes.flatMap((scene) => scene.shots.map((shot) => shot.description)).join("||"),
    planId: plan.id,
    planVersions: plan.versions.length,
    disclosure: latestSnapshot(plan).snapshot.disclosure,
    music: latestSnapshot(plan).snapshot.musicStatus,
    red: db.qualityReviews.some((review) => review.entityId === episode.id && review.gate === "rights" && review.redFlag),
  };
}

function secondStory(db: StudioDb) {
  return db.stories.find((story) => {
    const snap = latestSnapshot(story).snapshot;
    return story.canonicalVersion == null && snap.title !== "Count the Thunder" && snap.originality.total >= 75 && !snap.similarity.tooSimilar && snap.recommendation.canonResult === "PASS";
  });
}

function openSecond(db: StudioDb) {
  const story = secondStory(db);
  assert.ok(story, "expected another approvable Gulmohar story");
  db = must(approveStory(db, story.id, human, NOTE, NOW));
  const opened = openEpisode(db, story.id, human, NOW);
  db = must(opened);
  assert.equal(opened.ok, true);
  if (!opened.ok) throw new Error("episode");
  return { db, storyId: story.id, episodeId: opened.data.id };
}

describe("agent orchestration", () => {
  it("keeps approval and publish off every agent", () => {
    assert.ok(AGENTS.some((agent) => agent.status === "IMPLEMENTED"));
    assert.ok(AGENTS.some((agent) => agent.status === "INACTIVE"));
    assert.ok(AGENTS.some((agent) => agent.status === "NOT_IMPLEMENTED"));
    for (const agent of AGENTS) {
      for (const grant of agent.grants) assert.equal(FORBIDDEN_GRANTS.includes(grant), false, agent.id);
    }
    const voice = AGENTS.find((agent) => agent.id === "agent_voice_director");
    assert.equal(voice?.status, "NOT_IMPLEMENTED");
    const analytics = AGENTS.find((agent) => agent.id === "agent_analytics");
    assert.equal(analytics?.status, "NOT_IMPLEMENTED");
  });

  it("1: follows story to script draft to human stop to storyboard draft", () => {
    const seeded = buildSeedDb();
    const before = thunderPack(seeded);
    const opened = openSecond(seeded);
    const chain = runScriptChain(opened.db, opened.episodeId, human, NOW);
    assert.equal(chain.ok, true, chain.ok ? "" : chain.error);
    if (!chain.ok) return;
    assert.equal(chain.data.status, "REQUIRES_HUMAN_REVIEW");
    const episode = chain.db.episodes.find((item) => item.id === opened.episodeId);
    assert.ok(episode);
    const snap = latestSnapshot(episode).snapshot;
    assert.equal(snap.stage, "SCRIPT_DRAFT");
    const script = chain.db.scripts.find((item) => item.id === snap.scriptId);
    assert.ok(script);
    assert.equal(script.canonicalVersion, null);
    const body = latestSnapshot(script).snapshot;
    assert.equal(body.draftLabel, "DEVELOPMENT DRAFT");
    assert.equal(body.language, "hi");
    assert.equal(body.storyVersion, snap.storyVersion);
    const draftTask = chain.db.agentTasks.find((task) => task.taskType === "script.draft" && task.episodeId === opened.episodeId);
    assert.equal(draftTask?.status, "COMPLETED");
    assert.ok(draftTask?.validationResults.some((item) => item.name === "canon" && item.result === "PASS"));
    assert.equal(draftTask?.outputArtifacts[0]?.label, "DEVELOPMENT DRAFT");
    assert.ok(chain.db.agentTasks.some((task) => task.taskType === "human.script_approval" && task.status === "REQUIRES_HUMAN_REVIEW"));
    const approved = approveScript(chain.db, script.id, human, NOTE, NOW);
    assert.equal(approved.ok, true, approved.ok ? "" : approved.error);
    const boarded = runStoryboardChain(approved.db, opened.episodeId, human, NOW);
    assert.equal(boarded.ok, true, boarded.ok ? "" : boarded.error);
    if (!boarded.ok) return;
    const after = boarded.db.episodes.find((item) => item.id === opened.episodeId);
    assert.ok(after);
    const afterSnap = latestSnapshot(after).snapshot;
    assert.equal(afterSnap.stage, "STORYBOARD");
    assert.ok(afterSnap.storyboardId);
    const board = boarded.db.storyboards.find((item) => item.id === afterSnap.storyboardId);
    assert.equal(board?.canonicalVersion, null);
    assert.equal(boarded.db.agentTasks.find((task) => task.taskType === "storyboard.draft")?.outputArtifacts[0]?.label, "STORYBOARD DRAFT");
    assert.ok(boarded.db.agentTasks.some((task) => task.taskType === "human.storyboard_approval" && task.status === "REQUIRES_HUMAN_REVIEW"));
    assert.equal(latestSnapshot(after).snapshot.stage === "PUBLISHED", false);
    assert.deepEqual(thunderPack(boarded.db), before);
  });

  it("2: an agent cannot approve its own script", () => {
    const opened = openSecond(buildSeedDb());
    const queued = enqueueTask(opened.db, {
      taskType: "script.approve",
      agentId: "agent_scriptwriter",
      episodeId: opened.episodeId,
      storyId: opened.storyId,
      instructions: "Approve my script.",
    }, human, NOW);
    assert.equal(queued.ok, true);
    if (!queued.ok) return;
    const blocked = executeTask(queued.db, queued.data.taskId, human, NOW);
    assert.equal(blocked.ok, false);
    if (blocked.ok) return;
    assert.equal(blocked.code, "permission");
    const task = blocked.db.agentTasks.find((item) => item.id === queued.data.taskId);
    assert.equal(task?.status, "BLOCKED");
    assert.equal(blocked.db.approvals.some((item) => item.actorId === "agent_scriptwriter" && item.entityType === "script"), false);
    const self = enqueueTask(opened.db, { taskType: "script.draft", agentId: "agent_scriptwriter", episodeId: opened.episodeId }, scriptwriter, NOW);
    assert.equal(self.ok, false);
  });

  it("3: a canon contradiction stops the workflow", () => {
    const opened = openSecond(buildSeedDb());
    const chain = runScriptChain(opened.db, opened.episodeId, human, NOW);
    dbStep(chain);
    if (!chain.ok) return;
    const scriptId = latestSnapshot(chain.db.episodes.find((item) => item.id === opened.episodeId)!).snapshot.scriptId;
    assert.ok(scriptId);
    const approved = approveScript(chain.db, scriptId, human, NOTE, NOW);
    dbStep(approved);
    if (!approved.ok) return;
    const before = canonicalOf(approved.db.scripts.find((item) => item.id === scriptId)!)?.snapshot;
    assert.ok(before);
    const queued = enqueueTask(approved.db, {
      taskType: "script.revise",
      agentId: "agent_scriptwriter",
      episodeId: opened.episodeId,
      scriptId,
      instructions: "CANON_AGE_PROBE",
    }, human, NOW);
    dbStep(queued);
    if (!queued.ok) return;
    const ran = executeTask(queued.db, queued.data.taskId, human, NOW);
    dbStep(ran);
    if (!ran.ok) return;
    assert.equal(ran.data.status, "BLOCKED");
    const task = ran.db.agentTasks.find((item) => item.id === queued.data.taskId);
    assert.ok(task?.validationResults.some((item) => item.result === "FAIL"));
    const script = ran.db.scripts.find((item) => item.id === scriptId);
    assert.ok(script);
    assert.equal(JSON.stringify(canonicalOf(script)?.snapshot.scenes), JSON.stringify(before.scenes));
    const continued = runStoryboardChain(ran.db, opened.episodeId, human, NOW);
    assert.equal(continued.ok, false);
    assert.equal(latestSnapshot(continued.db.episodes.find((item) => item.id === opened.episodeId)!).snapshot.storyboardId, null);
    assert.ok(ran.db.agentRevisions.some((item) => item.failedArtifactId === scriptId));
  });

  it("4: a failed storyboard queues a revision and keeps the previous version", () => {
    const opened = openSecond(buildSeedDb());
    const chain = runScriptChain(opened.db, opened.episodeId, human, NOW);
    dbStep(chain);
    if (!chain.ok) return;
    const scriptId = latestSnapshot(chain.db.episodes.find((item) => item.id === opened.episodeId)!).snapshot.scriptId;
    assert.ok(scriptId);
    const approved = approveScript(chain.db, scriptId, human, NOTE, NOW);
    dbStep(approved);
    const boarded = runStoryboardChain(approved.db, opened.episodeId, human, NOW);
    dbStep(boarded);
    if (!boarded.ok) return;
    const episode = boarded.db.episodes.find((item) => item.id === opened.episodeId);
    assert.ok(episode);
    const boardId = latestSnapshot(episode).snapshot.storyboardId;
    assert.ok(boardId);
    const before = boarded.db.storyboards.find((item) => item.id === boardId);
    assert.ok(before);
    const first = before.versions[0]?.snapshot.scenes.flatMap((scene) => scene.shots.map((shot) => shot.description)).join(" ");
    const queued = enqueueTask(boarded.db, {
      taskType: "storyboard.revise",
      agentId: "agent_storyboard_director",
      episodeId: opened.episodeId,
      storyboardId: boardId,
      instructions: "STORY_DRIFT_PROBE",
    }, human, NOW);
    dbStep(queued);
    if (!queued.ok) return;
    const ran = executeTask(queued.db, queued.data.taskId, human, NOW);
    dbStep(ran);
    if (!ran.ok) return;
    assert.equal(ran.data.status, "BLOCKED");
    const board = ran.db.storyboards.find((item) => item.id === boardId);
    assert.ok(board);
    assert.ok(board.versions.length > before.versions.length);
    assert.equal(board.versions[0]?.snapshot.scenes.flatMap((scene) => scene.shots.map((shot) => shot.description)).join(" "), first);
    assert.match(latestSnapshot(board).snapshot.scenes.flatMap((scene) => scene.shots.map((shot) => shot.description)).join(" "), /fear is deleted/i);
    assert.equal(board.canonicalVersion, null);
    const revision = ran.db.agentRevisions.find((item) => item.failedArtifactId === boardId);
    assert.ok(revision);
    const follow = ran.db.agentTasks.find((item) => item.id === revision.followUpTaskId);
    assert.equal(follow?.status, "QUEUED");
    assert.equal(follow?.instructions, "REPAIR");
    const agent = approveStoryboard(ran.db, boardId, scriptwriter, NOTE, NOW);
    assert.equal(agent.ok, false);
  });

  it("5: a pass and a fail stay in human review", () => {
    const opened = openSecond(buildSeedDb());
    const chain = runScriptChain(opened.db, opened.episodeId, human, NOW);
    dbStep(chain);
    if (!chain.ok) return;
    const scriptId = latestSnapshot(chain.db.episodes.find((item) => item.id === opened.episodeId)!).snapshot.scriptId;
    assert.ok(scriptId);
    const revised = reviseScript(chain.db, scriptId, "This is generic cartoon India.", scriptwriter, NOW);
    dbStep(revised);
    const again = runScriptChain(revised.db, opened.episodeId, human, NOW);
    dbStep(again);
    if (!again.ok) return;
    assert.equal(again.data.status, "REQUIRES_HUMAN_REVIEW");
    const gate = again.db.agentTasks.find((item) => item.id === again.data.taskId);
    assert.match(gate?.blockedReason ?? "", /Neither review overrides/i);
    assert.match(gate?.blockedReason ?? "", /PASS/);
    assert.match(gate?.blockedReason ?? "", /FAIL/);
    const script = again.db.scripts.find((item) => item.id === scriptId);
    assert.equal(script?.canonicalVersion, null);
    const boarded = runStoryboardChain(again.db, opened.episodeId, human, NOW);
    assert.equal(boarded.ok, false);
  });

  it("6: unresolved rights stay a red flag and block publishing", () => {
    const opened = openSecond(buildSeedDb());
    const chain = runScriptChain(opened.db, opened.episodeId, human, NOW);
    dbStep(chain);
    if (!chain.ok) return;
    const scriptId = latestSnapshot(chain.db.episodes.find((item) => item.id === opened.episodeId)!).snapshot.scriptId;
    assert.ok(scriptId);
    const approved = approveScript(chain.db, scriptId, human, NOTE, NOW);
    dbStep(approved);
    const boarded = runStoryboardChain(approved.db, opened.episodeId, human, NOW);
    dbStep(boarded);
    if (!boarded.ok) return;
    const stageBefore = latestSnapshot(boarded.db.episodes.find((item) => item.id === opened.episodeId)!).snapshot.stage;
    const rights = enqueueTask(boarded.db, { taskType: "rights.review", agentId: "agent_rights", episodeId: opened.episodeId, priority: "BLOCKING", instructions: "Inspect provenance. Do not grant rights." }, human, NOW);
    dbStep(rights);
    if (!rights.ok) return;
    const reviewed = executeTask(rights.db, rights.data.taskId, human, NOW);
    dbStep(reviewed);
    if (!reviewed.ok) return;
    const task = reviewed.db.agentTasks.find((item) => item.id === rights.data.taskId);
    assert.ok(task?.validationResults.some((item) => item.result === "RED FLAG"));
    assert.match(task?.blockedReason ?? "", /RED FLAG/);
    assert.ok(reviewed.db.qualityReviews.some((item) => item.entityId === opened.episodeId && item.redFlag));
    const cleared = enqueueTask(reviewed.db, { taskType: "rights.clear", agentId: "agent_rights", episodeId: opened.episodeId }, human, NOW);
    dbStep(cleared);
    if (!cleared.ok) return;
    const deny = executeTask(cleared.db, cleared.data.taskId, human, NOW);
    assert.equal(deny.ok, false);
    const published = publishEpisode(deny.db, opened.episodeId, human, NOW);
    assert.equal(published.ok, false);
    const snap = latestSnapshot(published.db.episodes.find((item) => item.id === opened.episodeId)!).snapshot;
    assert.equal(snap.stage, stageBefore);
    assert.notEqual(snap.stage, "PUBLISHED");
    assert.notEqual(snap.stage, "READY_TO_PUBLISH");
    assert.ok(published.db.assets.some((asset) => latestSnapshot(asset).snapshot.commercialUseStatus === "not-cleared"));
  });

  it("7: Count the Thunder is unchanged, still flagged, and still unpublished", () => {
    const db = buildSeedDb();
    const before = thunderPack(db);
    const held = nextOrchestratedStep(db, before.id, human, NOW);
    dbStep(held);
    if (!held.ok) return;
    assert.equal(held.data.status, "BLOCKED");
    assert.deepEqual(thunderPack(held.db), before);
    const task = held.db.agentTasks.find((item) => item.id === held.data.taskId);
    assert.match(task?.blockedReason ?? "", /RED FLAG/);
    const published = publishEpisode(held.db, before.id, human, NOW);
    assert.equal(published.ok, false);
    assert.deepEqual(thunderPack(published.db), before);
  });

  it("8: a technical failure retries the same task without a duplicate script", () => {
    const opened = openSecond(buildSeedDb());
    const before = opened.db.scripts.length;
    const queued = enqueueTask(opened.db, { taskType: "script.draft", agentId: "agent_scriptwriter", episodeId: opened.episodeId, storyId: opened.storyId }, human, NOW);
    dbStep(queued);
    if (!queued.ok) return;
    const failed = recordTechnicalFailure(queued.db, queued.data.taskId, "Development provider unavailable.", human, NOW);
    dbStep(failed);
    assert.equal(failed.db.scripts.length, before);
    assert.equal(failed.db.agentTasks.find((item) => item.id === queued.data.taskId)?.errorCode, "TECHNICAL");
    const retried = retryTask(failed.db, queued.data.taskId, human, NOW);
    dbStep(retried);
    if (!retried.ok) return;
    assert.equal(retried.data.status, "COMPLETED");
    assert.equal(retried.db.scripts.length, before + 1);
    assert.equal(retried.db.orchestrationRuns.filter((run) => run.taskId === queued.data.taskId).length, 2);
    const again = executeTask(retried.db, queued.data.taskId, human, NOW);
    dbStep(again);
    assert.equal(again.db.scripts.length, before + 1);
    assert.equal(again.db.orchestrationRuns.filter((run) => run.taskId === queued.data.taskId).length, 3);
    const validationRetry = retryTask(again.db, queued.data.taskId, human, NOW);
    assert.equal(validationRetry.ok, false);
  });

  it("does not let an agent rewrite canon or an approved story", () => {
    const db = buildSeedDb();
    const meethi = db.characters.find((item) => item.name === "Meethi");
    assert.ok(meethi);
    const age = canonicalOf(meethi)?.snapshot.age;
    const proposed = enqueueTask(db, { taskType: "canon.propose", agentId: "agent_character_director", characterId: meethi.id, instructions: "Propose an age change." }, human, NOW);
    dbStep(proposed);
    if (!proposed.ok) return;
    const ran = executeTask(proposed.db, proposed.data.taskId, human, NOW);
    dbStep(ran);
    if (!ran.ok) return;
    assert.equal(ran.data.status, "REQUIRES_HUMAN_REVIEW");
    assert.equal(canonicalOf(ran.db.characters.find((item) => item.id === meethi.id)!)?.snapshot.age, age);
    const thunder = db.stories.find((story) => story.versions.some((version) => version.snapshot.title === "Count the Thunder"));
    assert.ok(thunder);
    const versions = JSON.stringify(thunder.versions);
    const change = enqueueTask(ran.db, { taskType: "story.change", agentId: "agent_story_architect", storyId: thunder.id, instructions: "The ending may need a different image. Do not edit it." }, human, NOW);
    dbStep(change);
    if (!change.ok) return;
    const requested = executeTask(change.db, change.data.taskId, human, NOW);
    dbStep(requested);
    if (!requested.ok) return;
    assert.equal(JSON.stringify(requested.db.stories.find((item) => item.id === thunder.id)?.versions), versions);
    const request = requested.db.storyRevisionRequests.find((item) => item.storyId === thunder.id);
    assert.ok(request);
    const agent = decideStoryRevision(requested.db, request.id, "ACCEPTED", scriptwriter, "The architect accepts it.", NOW);
    assert.equal(agent.ok, false);
    const humanDecision = decideStoryRevision(requested.db, request.id, "REJECTED", human, "Leave the approved story as it is.", NOW);
    dbStep(humanDecision);
    assert.equal(JSON.stringify(humanDecision.db.stories.find((item) => item.id === thunder.id)?.versions), versions);
    const inactive = enqueueTask(db, { taskType: "script.draft", agentId: "agent_voice_director", episodeId: db.episodes[0]?.id ?? null }, human, NOW);
    dbStep(inactive);
    if (!inactive.ok) return;
    const refused = executeTask(inactive.db, inactive.data.taskId, human, NOW);
    assert.equal(refused.ok, false);
    if (refused.ok) return;
    assert.match(refused.error, /NOT_IMPLEMENTED/);
  });
});

function dbStep(result: { ok: boolean; error?: string }): void {
  assert.equal(result.ok, true, result.ok ? "" : result.error);
}
