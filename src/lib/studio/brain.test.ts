import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ALPINE_KEY,
  approveProposedLocation,
  brainAdvance,
  brainApproveLocation,
  brainBrief,
  brainChangeCanon,
  brainClearRights,
  decideBrain,
  locationGate,
  readPlace,
  recordBrain,
  recordBrainOutcome,
  recordPerformance,
  setAutonomy,
} from "./brain.ts";
import {
  approveScript,
  approveStory,
  canonicalOf,
  generateScript,
  generateStoryboard,
  latestSnapshot,
  openEpisode,
  publishEpisode,
  reviewHindi,
} from "./engine.ts";
import { advanceToHumanApproval, runReleaseGate } from "./release.ts";
import { buildSeedDb } from "./seed.ts";
import type { Actor, StudioDb } from "./types.ts";

const human: Actor = { type: "human", id: "human_asha", name: "Asha Menon" };
const agent: Actor = { type: "agent", id: "agent_rights", name: "IP/Rights Agent" };
const NOW = "2026-10-07T13:00:00.000Z";
const NOTE = "Human editorial note. Not an agent approval.";

function must<T>(result: { ok: boolean; db: StudioDb; error?: string; data?: T }): StudioDb {
  assert.equal(result.ok, true, result.ok ? "" : result.error);
  return result.db;
}

function thunderEpisode(db: StudioDb) {
  const episode = db.episodes.find((item) => latestSnapshot(item).snapshot.title === "Count the Thunder");
  assert.ok(episode);
  return episode;
}

function pack(db: StudioDb) {
  const episode = thunderEpisode(db);
  const snap = latestSnapshot(episode).snapshot;
  const script = db.scripts.find((item) => item.id === snap.scriptId);
  const board = db.storyboards.find((item) => item.id === snap.storyboardId);
  const plan = db.plans.find((item) => item.id === snap.planId);
  assert.ok(script && board && plan);
  return {
    stage: snap.stage,
    episodeVersions: episode.versions.length,
    scriptVersions: script.versions.length,
    hindi: (canonicalOf(script)?.snapshot ?? latestSnapshot(script).snapshot).scenes.map((scene) => scene.lines.map((line) => line.hi).join("|")).join("||"),
    boardVersions: board.versions.length,
    shots: latestSnapshot(board).snapshot.scenes.flatMap((scene) => scene.shots.map((shot) => shot.description)).join("||"),
    planVersions: plan.versions.length,
    disclosure: latestSnapshot(plan).snapshot.disclosure,
    music: latestSnapshot(plan).snapshot.musicStatus,
    red: db.qualityReviews.some((review) => review.entityId === episode.id && review.gate === "rights" && review.redFlag),
    release: latestSnapshot(episode).snapshot.stage === "PUBLISHED",
  };
}

function repeatStructures(db: StudioDb): StudioDb {
  const base = db.stories[0];
  assert.ok(base);
  const latest = base.versions[base.versions.length - 1];
  const extras = [1, 2, 3, 4].map((index) => {
    const snapshot = {
      ...latest.snapshot,
      title: `Lost object drill ${index}`,
      dna: { ...latest.snapshot.dna, storyStructure: "lost-object", premise: "lost-object" },
    };
    return {
      ...base,
      id: `story_rep_${index}`,
      name: snapshot.title,
      currentVersion: 1,
      canonicalVersion: 1,
      versions: [{ ...latest, version: 1, snapshot, note: "Development repetition fixture. Not a rewrite of canon stories." }],
    };
  });
  return { ...db, stories: [...db.stories, ...extras] };
}

function secondStory(db: StudioDb) {
  return db.stories.find((story) => {
    const snap = latestSnapshot(story).snapshot;
    return story.canonicalVersion == null && snap.title !== "Count the Thunder" && snap.originality.total >= 75 && !snap.similarity.tooSimilar && snap.recommendation.canonResult === "PASS";
  });
}

function clearPackage(db: StudioDb, episodeId: string): StudioDb {
  const episode = db.episodes.find((item) => item.id === episodeId);
  assert.ok(episode);
  const snap = latestSnapshot(episode).snapshot;
  const linked = new Set([snap.scriptId, snap.storyboardId, snap.planId].filter((item): item is string => Boolean(item)));
  return {
    ...db,
    assets: db.assets.map((asset) => {
      const body = latestSnapshot(asset).snapshot;
      if (body.episodeId !== episodeId && !linked.has(body.linkedEntityId)) return asset;
      return {
        ...asset,
        versions: asset.versions.map((version, index) =>
          index === asset.versions.length - 1
            ? {
                ...version,
                snapshot: {
                  ...version.snapshot,
                  commercialUseStatus: "cleared" as const,
                  licenseStatus: version.snapshot.licenseStatus || "human-cleared",
                  rightsNotes: version.snapshot.rightsNotes || "Human cleared for this development test.",
                  source: version.snapshot.source || "development-provider",
                  creator: version.snapshot.creator || "human_asha",
                  model: version.snapshot.model || "dev-template-v1",
                  provider: version.snapshot.provider || "development",
                  prompt: version.snapshot.prompt || "Cleared development record.",
                },
              }
            : version,
        ),
      };
    }),
    plans: db.plans.map((plan) => {
      if (plan.id !== snap.planId) return plan;
      return {
        ...plan,
        versions: plan.versions.map((version, index) =>
          index === plan.versions.length - 1
            ? {
                ...version,
                snapshot: {
                  ...version.snapshot,
                  musicStatus: "Original motif composed for this episode. Human cleared.",
                  musicCues: (version.snapshot.musicCues ?? []).map((cue) => ({ ...cue, rightsStatus: "cleared" as const })),
                  soundCues: (version.snapshot.soundCues ?? []).map((cue) => ({ ...cue, rightsStatus: "cleared" as const })),
                  voices: (version.snapshot.voices ?? []).map((voice) => ({ ...voice, commercialRights: "cleared" as const })),
                },
              }
            : version,
        ),
      };
    }),
  };
}

describe("studio brain", () => {
  it("1: names the Count the Thunder rights block and cannot clear it", () => {
    const seeded = buildSeedDb();
    const before = pack(seeded);
    const stories = seeded.stories.map((story) => story.versions.length);
    const recorded = recordBrain(seeded, human, NOW);
    assert.equal(recorded.ok, true, recorded.ok ? "" : recorded.error);
    if (!recorded.ok) return;
    assert.deepEqual(pack(recorded.db), before);
    assert.deepEqual(recorded.db.stories.map((story) => story.versions.length), stories);
    const repair = recorded.db.brainRecommendations.find((item) => item.fingerprint.startsWith("repair:rights"));
    assert.ok(repair);
    assert.match(`${repair.title} ${repair.recommendedAction}`, /rights/i);
    assert.match(repair.recommendedAction, /cannot|do not advance|human/i);
    const cleared = brainClearRights(recorded.db, thunderEpisode(recorded.db).id, agent, NOW);
    assert.equal(cleared.ok, false);
    assert.equal(pack(cleared.db).red, true);
    assert.equal(pack(cleared.db).stage, before.stage);
    const canon = brainChangeCanon(cleared.db, agent, NOW);
    assert.equal(canon.ok, false);
    const published = publishEpisode(canon.db, thunderEpisode(canon.db).id, human, NOW);
    assert.equal(published.ok, false);
    assert.equal(pack(published.db).release, false);
  });

  it("2: flags repeated structures without rewriting stories", () => {
    const seeded = repeatStructures(buildSeedDb());
    const before = seeded.stories.map((story) => JSON.stringify(story.versions));
    const recorded = must(recordBrain(seeded, human, NOW));
    assert.deepEqual(recorded.stories.map((story) => JSON.stringify(story.versions)), before);
    const pause = recorded.brainRecommendations.find((item) => item.category === "PAUSE" || item.category === "DO_NOT_PRODUCE");
    assert.ok(pause);
    assert.match(`${pause.rationale} ${pause.recommendedAction}`, /different|repetition|structure|do not rewrite/i);
    assert.equal(pause.status, "OPEN");
  });

  it("3: proposes an Alpine adventure without adding it to canon", () => {
    const recorded = must(recordBrain(buildSeedDb(), human, NOW));
    const alpine = recorded.locationLibrary.find((item) => item.key === ALPINE_KEY);
    assert.ok(alpine);
    assert.equal(alpine.status, "PROPOSED");
    assert.equal(alpine.realWorld, "fictional");
    assert.equal(recorded.locations.some((item) => latestSnapshot(item).snapshot.key === ALPINE_KEY), false);
    const place = readPlace(recorded, ALPINE_KEY);
    assert.equal(place.layer, "proposal");
    assert.equal(place.usableInProduction, false);
    const opportunity = recorded.brainOpportunities.find((item) => item.title === "Alpine adventure");
    assert.ok(opportunity);
    assert.equal(opportunity.status, "PROPOSED");
    assert.match(opportunity.rationale, /variety|travel/i);
    assert.match(opportunity.risks.join(" "), /Indian identity|disconnected/i);
    assert.equal(opportunity.confidence, "LOW");
    const primary = recorded.locationLibrary.find((item) => item.role === "PRIMARY_WORLD");
    assert.equal(primary?.status, "LOCKED");
    const sneaky = brainApproveLocation(recorded, alpine.id, agent, NOW);
    assert.equal(sneaky.ok, false);
    assert.equal(sneaky.db.locationLibrary.find((item) => item.key === ALPINE_KEY)?.status, "PROPOSED");
  });

  it("4: a human can approve the Alpine location into canon", () => {
    const seeded = buildSeedDb();
    const before = pack(seeded);
    let db = must(recordBrain(seeded, human, NOW));
    const alpine = db.locationLibrary.find((item) => item.key === ALPINE_KEY);
    assert.ok(alpine);
    assert.equal(locationGate(db, ALPINE_KEY).usable, false);
    const denied = approveProposedLocation(db, alpine.id, agent, NOTE, NOW);
    assert.equal(denied.ok, false);
    assert.equal(denied.db.locations.some((item) => latestSnapshot(item).snapshot.key === ALPINE_KEY), false);
    db = must(approveProposedLocation(db, alpine.id, human, "Approve a fictional Alpine place for one story. Not a tourism canon.", NOW));
    const approved = db.locationLibrary.find((item) => item.key === ALPINE_KEY);
    assert.equal(approved?.status, "APPROVED");
    assert.ok(approved?.canonLocationId);
    assert.equal(locationGate(db, ALPINE_KEY).usable, true);
    assert.equal(locationGate(db, ALPINE_KEY).layer === "proposal", false);
    assert.equal(db.world?.name, seeded.world?.name);
    assert.deepEqual(pack(db), before);
  });

  it("5: a strong retention signal becomes an investigation, not copies", () => {
    const seeded = buildSeedDb();
    const count = seeded.stories.length;
    let db = must(recordPerformance(seeded, {
      label: "Home comedy retention",
      storyStructure: "leave-shared-blossom",
      metric: "retention",
      value: 72,
      sampleSize: 6,
      note: "Hypothetical retention for one structure.",
      hypothetical: true,
    }, human, NOW));
    assert.equal(db.stories.length, count);
    db = must(recordBrain(db, human, NOW));
    assert.equal(db.stories.length, count);
    const look = db.brainRecommendations.find((item) => item.fingerprint.startsWith("investigate:retention"));
    assert.ok(look);
    assert.equal(look.category, "INVESTIGATE");
    assert.match(look.recommendedAction, /do not automatically create copies/i);
    assert.equal(look.confidence, "LOW");
    assert.equal(db.stories.filter((story) => story.name.includes("copy")).length, 0);
  });

  it("6: a rejected recommendation stays rejected", () => {
    let db = must(recordBrain(buildSeedDb(), human, NOW));
    const alpine = db.brainRecommendations.find((item) => item.fingerprint === "develop:alpine-inspired");
    assert.ok(alpine);
    const logsBefore = db.brainDecisions.length;
    db = must(decideBrain(db, alpine.id, "REJECT", human, "Not this season. Keep the lane at home.", undefined, NOW));
    assert.equal(db.brainRecommendations.find((item) => item.id === alpine.id)?.status, "REJECTED");
    assert.ok(db.brainDecisions.length > logsBefore);
    assert.equal(db.brainDecisions[0]?.humanDecision, null);
    const again = must(recordBrain(db, human, NOW));
    const open = again.brainRecommendations.filter((item) => item.fingerprint === "develop:alpine-inspired" && item.status === "OPEN");
    assert.equal(open.length, 0);
    assert.equal(again.brainRecommendations.filter((item) => item.fingerprint === "develop:alpine-inspired").length, 1);
    const brief = brainBrief(again);
    assert.equal(brief.next.some((item) => item.title === "Alpine adventure"), false);
  });

  it("7: a modification is stored apart from the original recommendation", () => {
    let db = must(recordBrain(buildSeedDb(), human, NOW));
    const original = db.brainRecommendations.find((item) => item.category === "EXPERIMENT");
    assert.ok(original);
    const rationale = original.rationale;
    db = must(decideBrain(db, original.id, "MODIFY", human, "Narrow the test.", "One home episode and one journey episode, same age, then stop.", NOW));
    const updated = db.brainRecommendations.find((item) => item.id === original.id);
    assert.equal(updated?.rationale, rationale);
    assert.equal(updated?.status, "MODIFIED");
    assert.match(updated?.humanDecision?.modifiedText ?? "", /home episode and one journey/);
    assert.notEqual(updated?.humanDecision?.modifiedText, updated?.rationale);
    const first = db.brainDecisions.find((item) => item.recommendationId === original.id && item.humanDecision == null);
    const second = db.brainDecisions.find((item) => item.recommendationId === original.id && item.humanDecision);
    assert.ok(first && second);
    db = must(recordBrainOutcome(db, original.id, "The test was not run. No copies were ordered.", human, NOW));
    assert.equal(db.brainRecommendations.find((item) => item.id === original.id)?.outcomes.length, 1);
    assert.ok(db.brainDecisions.filter((item) => item.recommendationId === original.id).length >= 3);
  });

  it("8: the brain cannot move a clean episode past human approval", () => {
    const seeded = buildSeedDb();
    const story = secondStory(seeded);
    assert.ok(story);
    let db = must(approveStory(seeded, story.id, human, NOTE, NOW));
    const opened = openEpisode(db, story.id, human, NOW);
    db = must(opened);
    if (!opened.ok) return;
    const scripted = generateScript(db, story.id, "agent_scriptwriter", NOW);
    db = must(scripted);
    if (!scripted.ok) return;
    db = must(reviewHindi(db, scripted.data.scriptId, "agent_hindi_editor", NOW));
    db = must(approveScript(db, scripted.data.scriptId, human, NOTE, NOW));
    db = must(generateStoryboard(db, scripted.data.scriptId, "agent_storyboard_director", NOW));
    db = clearPackage(db, opened.data.id);
    db = must(runReleaseGate(db, opened.data.id, human, NOW));
    const advanced = advanceToHumanApproval(db, opened.data.id, human, NOW);
    db = must(advanced);
    if (!advanced.ok) return;
    assert.equal(advanced.data.stage, "HUMAN_APPROVAL");
    const blocked = brainAdvance(db, opened.data.id, human, NOW);
    assert.equal(blocked.ok, false);
    assert.match(blocked.error, /BLOCKED/);
    const episode = db.episodes.find((item) => item.id === opened.data.id);
    assert.equal(latestSnapshot(episode!).snapshot.stage, "HUMAN_APPROVAL");
    assert.notEqual(latestSnapshot(blocked.db.episodes.find((item) => item.id === opened.data.id)!).snapshot.stage, "PUBLISHED");
    const autonomy = setAutonomy(blocked.db, 5, human, NOW);
    assert.equal(autonomy.ok, false);
    assert.equal(autonomy.db.brainAutonomy, 2);
    const level4 = setAutonomy(autonomy.db, 4, human, NOW);
    assert.equal(level4.ok, false);
    const published = publishEpisode(level4.db, opened.data.id, human, NOW);
    assert.equal(published.ok, false);
    assert.deepEqual(pack(published.db).stage, pack(seeded).stage);
    assert.equal(pack(published.db).red, true);
  });
});
