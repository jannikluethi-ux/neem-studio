import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  approveEpisodeDraft,
  approveProductionAsset,
  approveScript,
  approveStory,
  approveStoryboard,
  assembleDraftEpisode,
  canonicalOf,
  decideLocationProposal,
  decideProductionRevision,
  generateScript,
  generateStoryboard,
  latestSnapshot,
  openEpisode,
  proposeNewLocation,
  proposeStoryboardDrift,
  proposeStoryDrift,
  proposeScriptDrift,
  proposeVisualAsset,
  publishEpisode,
  reportProductionProblem,
  reviewHindi,
  reviseScript,
  runQa,
} from "./engine.ts";
import { sceneBreakdown, validateBoardConsistency, validateStoryConsistency } from "./production.ts";
import { buildSeedDb } from "./seed.ts";
import type { Actor, StudioDb } from "./types.ts";

const human: Actor = { type: "human", id: "human_asha", name: "Asha Menon" };
const scriptwriter: Actor = { type: "agent", id: "agent_scriptwriter", name: "Scriptwriter" };
const director: Actor = { type: "agent", id: "agent_character_director", name: "Character Director" };
const NOW = "2026-10-07T11:00:00.000Z";
const NOTE = "Human editorial note. Not an agent approval.";

function must<T>(result: { ok: boolean; db: StudioDb; error?: string; data?: T }): StudioDb {
  assert.equal(result.ok, true, result.ok ? "" : result.error);
  return result.db;
}

function thunderOf(db: StudioDb) {
  const episode = db.episodes.find((item) => latestSnapshot(item).snapshot.title === "Count the Thunder");
  assert.ok(episode);
  const snap = latestSnapshot(episode).snapshot;
  const script = db.scripts.find((item) => item.id === snap.scriptId);
  const board = db.storyboards.find((item) => item.id === snap.storyboardId);
  const plan = db.plans.find((item) => item.id === snap.planId);
  assert.ok(script && board && plan);
  return {
    stage: snap.stage,
    episodeNumber: snap.episodeNumber,
    hindi: (canonicalOf(script)?.snapshot ?? latestSnapshot(script).snapshot).scenes.map((scene) => scene.lines.map((line) => line.hi).join("|")).join("||"),
    shots: latestSnapshot(board).snapshot.scenes.flatMap((scene) => scene.shots.map((shot) => shot.description)).join("||"),
    disclosure: latestSnapshot(plan).snapshot.disclosure,
    music: latestSnapshot(plan).snapshot.musicStatus,
    red: db.qualityReviews.some((review) => review.entityId === episode.id && review.gate === "rights" && review.redFlag),
    versions: episode.versions.length,
  };
}

function secondStory(db: StudioDb) {
  return db.stories.find((story) => {
    const snap = latestSnapshot(story).snapshot;
    return story.canonicalVersion == null && snap.title !== "Count the Thunder" && snap.originality.total >= 75 && !snap.similarity.tooSimilar && snap.recommendation.canonResult === "PASS";
  });
}

function produce(db: StudioDb) {
  const story = secondStory(db);
  assert.ok(story, "expected another approvable Gulmohar story");
  const thunder = thunderOf(db);
  db = must(approveStory(db, story.id, human, NOTE, NOW));
  const opened = openEpisode(db, story.id, human, NOW);
  db = must(opened);
  assert.equal(opened.ok, true);
  if (!opened.ok) throw new Error("episode");
  const scripted = generateScript(db, story.id, "agent_scriptwriter", NOW);
  db = must(scripted);
  if (!scripted.ok) throw new Error("script");
  db = must(reviewHindi(db, scripted.data.scriptId, "agent_hindi_editor", NOW));
  const approved = approveScript(db, scripted.data.scriptId, human, NOTE, NOW);
  db = must(approved);
  return { db, storyId: story.id, episodeId: opened.data.id, scriptId: scripted.data.scriptId, thunder };
}

describe("episode production", () => {
  it("1: an approved story becomes a Hindi development script on a new episode", () => {
    const seeded = buildSeedDb();
    const before = thunderOf(seeded);
    const made = produce(seeded);
    assert.deepEqual(thunderOf(made.db), before);
    const episode = made.db.episodes.find((item) => item.id === made.episodeId);
    assert.ok(episode);
    const snap = latestSnapshot(episode).snapshot;
    const story = made.db.stories.find((item) => item.id === made.storyId);
    assert.ok(story?.canonicalVersion);
    assert.equal(snap.storyId, made.storyId);
    assert.equal(snap.storyVersion, story.canonicalVersion);
    assert.ok(snap.canonVersionUsed);
    assert.ok(snap.canonSnapshotHash);
    assert.equal(snap.targetAge, "3-5");
    assert.ok(snap.episodeNumber && snap.episodeNumber > 1);
    const script = made.db.scripts.find((item) => item.id === made.scriptId);
    assert.ok(script);
    const body = canonicalOf(script)?.snapshot ?? latestSnapshot(script).snapshot;
    assert.equal(body.language, "hi");
    assert.equal(body.draftLabel, "DEVELOPMENT DRAFT");
    assert.equal(body.storyId, made.storyId);
    assert.equal(body.storyVersion, story.canonicalVersion);
    assert.equal(body.canonVersionUsed, snap.canonVersionUsed);
    assert.ok(body.generationRunId);
    assert.ok(body.scenes.length >= 2);
    assert.ok(body.scenes.every((scene) => scene.purpose && scene.emotionalBeat && scene.lines.some((line) => /[\u0900-\u097F]/.test(line.hi))));
    assert.equal(validateStoryConsistency(canonicalOf(story)!.snapshot, body).result, "PASS");
    const agent = approveScript(made.db, made.scriptId, scriptwriter, NOTE, NOW);
    assert.equal(agent.ok, false);
  });

  it("2: a character contradiction fails canon and cannot be approved", () => {
    const made = produce(buildSeedDb());
    const before = canonicalOf(made.db.scripts.find((item) => item.id === made.scriptId)!)!.snapshot;
    const drifted = proposeScriptDrift(made.db, made.scriptId, "agent_scriptwriter", NOW);
    assert.equal(drifted.ok, true, drifted.ok ? "" : drifted.error);
    if (!drifted.ok) return;
    assert.equal(drifted.data.result, "FAIL");
    const script = drifted.db.scripts.find((item) => item.id === made.scriptId);
    assert.ok(script);
    assert.equal(canonicalOf(script)?.snapshot.scenes.at(-1)?.lines.at(-1)?.en, before.scenes.at(-1)?.lines.at(-1)?.en);
    const reviewed = reviewHindi(drifted.db, made.scriptId, "agent_hindi_editor", NOW);
    assert.equal(reviewed.ok, true, reviewed.ok ? "" : reviewed.error);
    if (!reviewed.ok) return;
    const approved = approveScript(reviewed.db, made.scriptId, human, NOTE, NOW);
    assert.equal(approved.ok, false);
    if (!approved.ok) assert.match(approved.error, /CANON FAIL|Canon failed/i);
    assert.equal(canonicalOf(approved.db.scripts.find((item) => item.id === made.scriptId)!)?.version, script.canonicalVersion);
  });

  it("3: a changed ending fails story consistency and stays a revision", () => {
    const made = produce(buildSeedDb());
    const story = canonicalOf(made.db.stories.find((item) => item.id === made.storyId)!)!.snapshot;
    const drifted = proposeStoryDrift(made.db, made.scriptId, "agent_scriptwriter", NOW);
    assert.equal(drifted.ok, true, drifted.ok ? "" : drifted.error);
    if (!drifted.ok) return;
    assert.equal(drifted.data.result, "FAIL");
    const script = drifted.db.scripts.find((item) => item.id === made.scriptId)!;
    const latest = latestSnapshot(script).snapshot;
    const check = validateStoryConsistency(story, latest);
    assert.equal(check.result, "FAIL");
    assert.match(check.failures.map((item) => item.detail).join(" "), /conflict|ending|resolution/i);
    assert.equal(latestSnapshot(script).status, "revision_requested");
    const approved = approveScript(drifted.db, made.scriptId, human, NOTE, NOW);
    assert.equal(approved.ok, false);
    assert.equal(canonicalOf(script)?.snapshot.storyAnchors?.resolution, story.resolution);
    assert.equal(canonicalOf(made.db.stories.find((item) => item.id === made.storyId)!)?.snapshot.resolution, story.resolution);
  });

  it("4: a storyboard comes from the approved script and canon snapshot", () => {
    const made = produce(buildSeedDb());
    const boarded = generateStoryboard(made.db, made.scriptId, "agent_storyboard_director", NOW);
    assert.equal(boarded.ok, true, boarded.ok ? "" : boarded.error);
    if (!boarded.ok) return;
    const board = boarded.db.storyboards.find((item) => item.id === boarded.data.storyboardId);
    assert.ok(board);
    const body = latestSnapshot(board).snapshot;
    const script = canonicalOf(boarded.db.scripts.find((item) => item.id === made.scriptId)!)!;
    assert.equal(body.scriptId, made.scriptId);
    assert.equal(body.scriptVersion, script.version);
    assert.equal(body.storyVersion, script.snapshot.storyVersion);
    assert.ok(body.canonVersionUsed);
    assert.ok(body.canonSnapshotHash);
    assert.equal(body.providerDisclosure.includes("Not a live model"), true);
    assert.ok(body.scenes.every((scene) => scene.shots.every((shot) => shot.framing && shot.contradictsScript !== true)));
    assert.equal(validateBoardConsistency(script.snapshot, body).result, "PASS");
    const episode = latestSnapshot(boarded.db.episodes.find((item) => item.id === made.episodeId)!).snapshot;
    assert.equal(episode.storyboardId, board.id);
    assert.ok(episode.planId);
    const plan = latestSnapshot(boarded.db.plans.find((item) => item.id === episode.planId)!).snapshot;
    assert.equal(plan.providerStatus, "NOT CONNECTED");
    assert.equal(plan.disclosure, "Plan only. The development provider did not render picture, voice, or music.");
    assert.ok((plan.assetRequests ?? []).length > 0);
    assert.ok((plan.musicCues ?? []).every((cue) => cue.source === "not-connected" && cue.rightsStatus === "not-cleared"));
    assert.equal(sceneBreakdown(script.snapshot, body.canonVersionUsed ?? "").length, script.snapshot.scenes.length);
    const unapproved = generateStoryboard(made.db, made.scriptId, "agent_storyboard_director", NOW);
    // already approved; a second call is allowed. An unapproved script is not.
    const raw = made.db.scripts.find((item) => item.id === made.scriptId)!;
    const stripped = { ...raw, canonicalVersion: null };
    const refused = generateStoryboard({ ...made.db, scripts: made.db.scripts.map((item) => (item.id === raw.id ? stripped : item)) }, raw.id, "agent_storyboard_director", NOW);
    assert.equal(refused.ok, false);
    assert.equal(unapproved.ok, true);
  });

  it("5: a shot that changes the ending fails story consistency", () => {
    const made = produce(buildSeedDb());
    const boarded = generateStoryboard(made.db, made.scriptId, "agent_storyboard_director", NOW);
    assert.equal(boarded.ok, true);
    if (!boarded.ok) return;
    const drifted = proposeStoryboardDrift(boarded.db, boarded.data.storyboardId, "agent_storyboard_director", NOW);
    assert.equal(drifted.ok, true, drifted.ok ? "" : drifted.error);
    if (!drifted.ok) return;
    assert.equal(drifted.data.result, "FAIL");
    const board = drifted.db.storyboards.find((item) => item.id === boarded.data.storyboardId)!;
    const script = canonicalOf(drifted.db.scripts.find((item) => item.id === made.scriptId)!)!.snapshot;
    const check = validateBoardConsistency(script, latestSnapshot(board).snapshot);
    assert.equal(check.result, "FAIL");
    assert.equal(check.failures.some((item) => item.shotId === drifted.data.shotId), true);
    const approved = approveStoryboard(drifted.db, board.id, human, NOTE, NOW);
    assert.equal(approved.ok, false);
    if (!approved.ok) assert.match(approved.error, /STORY CONSISTENCY FAIL/);
    const agent = approveStoryboard(boarded.db, boarded.data.storyboardId, scriptwriter, NOTE, NOW);
    assert.equal(agent.ok, false);
  });

  it("6: a visual claim that breaks a locked character fails canon and is not approved", () => {
    const db = buildSeedDb();
    const meethi = db.characters.find((item) => item.name === "Meethi");
    assert.ok(meethi);
    const age = canonicalOf(meethi)?.snapshot.age;
    const asset = proposeVisualAsset(db, { characterId: meethi.id, claims: { age: "9", clothing: "cape" } }, "agent_character_director", NOW);
    assert.equal(asset.ok, true, asset.ok ? "" : asset.error);
    if (!asset.ok) return;
    assert.equal(asset.data.result, "FAIL");
    assert.equal(asset.data.drift, "DRIFT_FOUND");
    const stored = asset.db.assets.find((item) => item.id === asset.data.assetId)!;
    const body = latestSnapshot(stored).snapshot;
    assert.equal(body.characterId, meethi.id);
    assert.equal(body.characterVersion, canonicalOf(meethi)?.version);
    assert.ok(body.canonVersionUsed);
    assert.equal(body.provider, "development");
    assert.equal(body.commercialUseStatus, "not-cleared");
    const cleared = approveProductionAsset(asset.db, stored.id, human, NOTE, NOW);
    assert.equal(cleared.ok, false);
    if (!cleared.ok) assert.match(cleared.error, /CANON FAIL/);
    assert.equal(canonicalOf(cleared.db.characters.find((item) => item.id === meethi.id)!)?.snapshot.age, age);
    assert.equal(cleared.db.assets.find((item) => item.id === stored.id)?.canonicalVersion ?? null, null);
    const agent = approveProductionAsset(asset.db, stored.id, director, NOTE, NOW);
    assert.equal(agent.ok, false);
  });

  it("7: revising an approved script creates a new version and keeps the approved one", () => {
    const made = produce(buildSeedDb());
    const script = made.db.scripts.find((item) => item.id === made.scriptId)!;
    const approvedText = canonicalOf(script)!.snapshot.scenes[0]?.lines[0]?.en;
    const revised = reviseScript(made.db, made.scriptId, "A different English gloss that still needs review.", human, NOW);
    assert.equal(revised.ok, true, revised.ok ? "" : revised.error);
    if (!revised.ok) return;
    assert.equal(revised.data.canonicalUnchanged, true);
    const next = revised.db.scripts.find((item) => item.id === made.scriptId)!;
    assert.ok(next.currentVersion > (script.canonicalVersion ?? 0));
    assert.equal(next.canonicalVersion, script.canonicalVersion);
    assert.equal(canonicalOf(next)?.snapshot.scenes[0]?.lines[0]?.en, approvedText);
    assert.equal(latestSnapshot(next).snapshot.scenes[0]?.lines[0]?.en, "A different English gloss that still needs review.");
    assert.equal(latestSnapshot(next).snapshot.languageReview, "pending");
    assert.equal(latestSnapshot(next).status, "in_review");
    const approved = approveScript(revised.db, made.scriptId, human, NOTE, NOW);
    assert.equal(approved.ok, false);
    assert.equal(canonicalOf(approved.db.scripts.find((item) => item.id === made.scriptId)!)?.snapshot.scenes[0]?.lines[0]?.en, approvedText);
  });

  it("8: uncleared rights block asset approval and publishing", () => {
    const made = produce(buildSeedDb());
    const boarded = generateStoryboard(made.db, made.scriptId, "agent_storyboard_director", NOW);
    assert.equal(boarded.ok, true);
    if (!boarded.ok) return;
    let db = boarded.db;
    const qa = runQa(db, made.episodeId, "agent_qa", NOW);
    assert.equal(qa.ok, true, qa.ok ? "" : qa.error);
    if (!qa.ok) return;
    db = qa.db;
    const episode = db.episodes.find((item) => item.id === made.episodeId)!;
    assert.equal(latestSnapshot(episode).snapshot.stage, "HUMAN_APPROVAL");
    const asset = db.assets.find((item) => latestSnapshot(item).snapshot.commercialUseStatus === "not-cleared");
    assert.ok(asset);
    const rights = approveProductionAsset(db, asset.id, human, NOTE, NOW);
    assert.equal(rights.ok, false);
    if (!rights.ok) assert.equal(rights.code, "rights");
    const draft = approveEpisodeDraft(db, made.episodeId, human, NOTE, NOW);
    assert.equal(draft.ok, true, draft.ok ? "" : draft.error);
    if (!draft.ok) return;
    assert.equal(draft.data.stage, "HUMAN_APPROVAL");
    assert.match(draft.data.hold ?? "", /rights/i);
    assert.notEqual(latestSnapshot(draft.db.episodes.find((item) => item.id === made.episodeId)!).snapshot.stage, "READY_TO_PUBLISH");
    const published = publishEpisode(draft.db, made.episodeId, human, NOW);
    assert.equal(published.ok, false);
    if (!published.ok) assert.equal(published.code, "publish-disabled");
    assert.notEqual(latestSnapshot(published.db.episodes.find((item) => item.id === made.episodeId)!).snapshot.stage, "PUBLISHED");
    const assembled = assembleDraftEpisode(draft.db, made.episodeId, human, NOW);
    assert.equal(assembled.ok, true, assembled.ok ? "" : assembled.error);
    if (!assembled.ok) return;
    assert.equal(assembled.data.status, "PRODUCTION MOCK");
    assert.equal(latestSnapshot(assembled.db.episodes.find((item) => item.id === made.episodeId)!).snapshot.stage, "HUMAN_APPROVAL");
  });

  it("9: Count the Thunder keeps its script, storyboard, plan, and rights red flag", () => {
    const db = buildSeedDb();
    const before = thunderOf(db);
    assert.equal(before.stage, "HUMAN_APPROVAL");
    assert.equal(before.red, true);
    assert.match(before.hindi, /मुझे डर लग रहा है/);
    assert.match(before.hindi, /देखो ना/);
    assert.equal(before.disclosure, "Plan only. The development provider did not render picture, voice, or music.");
    assert.equal(before.music, "Original motif required. Not composed. No library track attached.");
    const episode = db.episodes.find((item) => latestSnapshot(item).snapshot.title === "Count the Thunder")!;
    const published = publishEpisode(db, episode.id, human, NOW);
    assert.equal(published.ok, false);
    const after = thunderOf(published.db);
    assert.equal(after.stage, before.stage);
    assert.equal(after.hindi, before.hindi);
    assert.equal(after.shots, before.shots);
    assert.equal(after.disclosure, before.disclosure);
    assert.equal(after.music, before.music);
    assert.equal(after.red, true);
    assert.equal(after.versions, before.versions);
    assert.notEqual(after.stage, "PUBLISHED");
  });

  it("a production problem and a new location do not rewrite the story or canon", () => {
    const made = produce(buildSeedDb());
    const story = made.db.stories.find((item) => item.id === made.storyId)!;
    const versions = JSON.stringify(story.versions);
    const places = made.db.locations.length;
    const problem = reportProductionProblem(
      made.db,
      {
        episodeId: made.episodeId,
        sceneNo: 1,
        problem: "The veranda cannot hold this beat as written.",
        reason: "The approved ending needs the existing veranda, not a new place.",
        recommendedChange: "Keep the veranda. Do not rewrite the story.",
        impact: "Production only. Story version stays.",
      },
      human,
      NOW,
    );
    assert.equal(problem.ok, true, problem.ok ? "" : problem.error);
    if (!problem.ok) return;
    assert.equal(JSON.stringify(problem.db.stories.find((item) => item.id === made.storyId)?.versions), versions);
    const agentDecides = decideProductionRevision(problem.db, problem.data.id, "ACCEPTED", scriptwriter, NOTE, NOW);
    assert.equal(agentDecides.ok, false);
    const decided = decideProductionRevision(problem.db, problem.data.id, "REJECTED", human, "Revise the shot, not the story.", NOW);
    assert.equal(decided.ok, true, decided.ok ? "" : decided.error);
    if (!decided.ok) return;
    assert.equal(JSON.stringify(decided.db.stories.find((item) => item.id === made.storyId)?.versions), versions);
    const proposed = proposeNewLocation(
      decided.db,
      { episodeId: made.episodeId, key: "roof-tank", name: "Roof tank", nameHi: "छत की टंकी", description: "A water tank. Not in canon yet.", reason: "A shot wants a new recurring roof." },
      director,
      NOW,
    );
    assert.equal(proposed.ok, true, proposed.ok ? "" : proposed.error);
    if (!proposed.ok) return;
    assert.equal(proposed.db.locations.length, places);
    assert.equal(proposed.db.locationProposals.find((item) => item.id === proposed.data.id)?.status, "PROPOSED");
    const agentApproves = decideLocationProposal(proposed.db, proposed.data.id, "APPROVED", director, NOTE, NOW);
    assert.equal(agentApproves.ok, false);
    assert.equal(agentApproves.db.locations.length, places);
    const accepted = decideLocationProposal(proposed.db, proposed.data.id, "APPROVED", human, "The roof tank can recur.", NOW);
    assert.equal(accepted.ok, true, accepted.ok ? "" : accepted.error);
    if (!accepted.ok) return;
    assert.equal(accepted.db.locations.length, places + 1);
    assert.equal(accepted.db.locationProposals.find((item) => item.id === proposed.data.id)?.status, "APPROVED");
  });
});
