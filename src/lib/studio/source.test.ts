import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ALPINE_KEY, decideBrain, readPlace, recordBrain } from "./brain.ts";
import { latestSnapshot, migrateStudioDb, publishEpisode } from "./engine.ts";
import { buildSeedDb } from "./seed.ts";
import {
  approveBecauseQaPassed,
  branchStoryVersion,
  fileAlpineProposal,
  importPerformance,
  locationUsableForProduction,
  pinQaRun,
  recordHumanApproval,
  registerAssetWithUnknownRights,
  registerPublication,
  reuseQa,
  rightsAreCleared,
  sourceApproveLocation,
  sourceCatalog,
  sourceClearRights,
  sourcePublish,
  traceEpisode,
} from "./source.ts";
import type { Actor, StudioDb } from "./types.ts";

const human: Actor = { type: "human", id: "human_asha", name: "Asha Menon" };
const agent: Actor = { type: "agent", id: "agent_scriptwriter", name: "Scriptwriter" };
const NOW = "2026-10-07T16:00:00.000Z";

function must<T>(result: { ok: boolean; db: StudioDb; error?: string; data?: T }): StudioDb {
  assert.equal(result.ok, true, result.ok ? "" : result.error);
  return result.db;
}

function openStory(db: StudioDb) {
  const story = db.stories.find((item) => item.canonicalVersion == null && item.currentVersion === 1);
  assert.ok(story);
  return story;
}

function thunder(db: StudioDb) {
  const episode = db.episodes.find((item) => latestSnapshot(item).snapshot.title === "Count the Thunder");
  assert.ok(episode);
  return episode;
}

describe("versioned source of truth", () => {
  it("1: a new story version keeps the previous version readable", () => {
    const seeded = buildSeedDb();
    const story = openStory(seeded);
    const before = JSON.stringify(story.versions[0]?.snapshot);
    const branched = branchStoryVersion(seeded, story.id, 1, "A second logline that does not erase the first.", human, "Open version 2 without overwriting version 1.", NOW);
    const db = must(branched);
    const updated = db.stories.find((item) => item.id === story.id);
    assert.ok(updated);
    assert.equal(JSON.stringify(updated.versions[0]?.snapshot), before);
    assert.equal(updated.versions[1]?.version, 2);
    assert.notEqual(updated.versions[1]?.snapshot.logline, updated.versions[0]?.snapshot.logline);
    const link = db.versionLinks.find((item) => item.entityId === story.id && item.version === 2);
    assert.equal(link?.supersedesVersion, 1);
    assert.equal(updated.canonicalVersion, null);
  });

  it("2: QA pinned to one story version cannot be reused after a newer version", () => {
    let db = buildSeedDb();
    const story = openStory(db);
    db = must(branchStoryVersion(db, story.id, 1, "Version two logline for the QA pin.", human, "Create the version QA will evaluate.", NOW));
    const pinned = pinQaRun(db, story.id, 2, human, NOW);
    db = must(pinned);
    if (!pinned.ok) return;
    const results = db.qaRuns[0]?.checkResults.join("|");
    db = must(branchStoryVersion(db, story.id, 2, "Version three logline after the QA pin.", human, "A later version must stale the earlier QA.", NOW));
    const run = db.qaRuns.find((item) => item.id === pinned.data.id);
    assert.ok(run);
    assert.equal(run.storyVersion, 2);
    assert.equal(run.overallStatus, "OUTDATED");
    assert.equal(run.evaluatedStatus, "HUMAN_REVIEW_REQUIRED");
    assert.equal(run.checkResults.join("|"), results);
    const reused = reuseQa(db, run.id, 3);
    assert.equal(reused.ok, false);
    assert.match(reused.reason, /outdated|different/i);
    const inferred = approveBecauseQaPassed(db, run.id, human, NOW);
    assert.equal(inferred.ok, false);
  });

  it("3: unknown asset rights are not treated as cleared", () => {
    const filed = registerAssetWithUnknownRights(buildSeedDb(), "Lane mat", human, NOW);
    const db = must(filed);
    if (!filed.ok) return;
    const rights = db.rightsRecords.find((item) => item.id === filed.data.rightsId);
    assert.equal(rights?.status, "UNKNOWN");
    assert.equal(rightsAreCleared(rights?.status), false);
    assert.equal(rights?.commercialUse, "UNKNOWN");
    const provenance = db.provenanceRecords.find((item) => item.assetId === filed.data.assetId);
    assert.ok(provenance);
    const cleared = sourceClearRights(db, rights!.id, agent, NOW);
    assert.equal(cleared.ok, false);
    assert.equal(cleared.db.rightsRecords.find((item) => item.id === rights!.id)?.status, "UNKNOWN");
  });

  it("4: a human approval names the exact versions and is not inferred", () => {
    const seeded = buildSeedDb();
    const episode = thunder(seeded);
    const snap = latestSnapshot(episode).snapshot;
    const before = snap.stage;
    const approved = recordHumanApproval(
      seeded,
      {
        episodeId: episode.id,
        subjectType: "episode",
        subjectId: episode.id,
        pins: [
          { type: "story", id: snap.storyId, version: snap.storyVersion },
          { type: "script", id: snap.scriptId ?? "missing", version: snap.scriptVersion },
        ],
        decision: "APPROVED",
        notes: "Approved as a record of these versions only. Not a publish.",
      },
      human,
      NOW,
    );
    const db = must(approved);
    const row = db.humanApprovals[0];
    assert.ok(row);
    assert.equal(row.approvedArtifactVersions[0]?.version, snap.storyVersion);
    assert.equal(row.decision, "APPROVED");
    assert.equal(latestSnapshot(db.episodes.find((item) => item.id === episode.id)!).snapshot.stage, before);
    assert.equal(db.humanApprovals[0]?.qaRunId, null);
    const agentTry = recordHumanApproval(db, { episodeId: episode.id, subjectType: "episode", subjectId: episode.id, pins: [{ type: "story", id: snap.storyId, version: snap.storyVersion }], decision: "APPROVED", notes: "Agent tried to approve the same versions." }, agent, NOW);
    assert.equal(agentTry.ok, false);
  });

  it("5: rejecting a brain recommendation keeps the original text", () => {
    let db = must(recordBrain(buildSeedDb(), human, NOW));
    const original = db.brainRecommendations.find((item) => item.fingerprint === "develop:alpine-inspired");
    assert.ok(original);
    const rationale = original.rationale;
    db = must(decideBrain(db, original.id, "REJECT", human, "Not this season. Keep the lane at home.", undefined, NOW));
    const kept = db.brainRecommendations.find((item) => item.id === original.id);
    assert.equal(kept?.rationale, rationale);
    assert.equal(kept?.status, "REJECTED");
    assert.notEqual(kept?.humanDecision?.note, rationale);
    const separate = db.brainDecisions.filter((item) => item.recommendationId === original.id && item.humanDecision);
    assert.ok(separate.length >= 1);
  });

  it("6: performance points at a publication and a content version", () => {
    const seeded = buildSeedDb();
    const stages = seeded.episodes.map((item) => latestSnapshot(item).snapshot.stage);
    const filed = registerPublication(seeded, { episodeId: "ep_external_sample", title: "Sample already published elsewhere", contentVersionReference: "story:sample@2" }, human, NOW);
    let db = must(filed);
    if (!filed.ok) return;
    assert.deepEqual(db.episodes.map((item) => latestSnapshot(item).snapshot.stage), stages);
    const recorded = importPerformance(db, { publicationId: filed.data.id, episodeId: "ep_external_sample", metric: "retention", value: 64, contentVersionReference: "story:sample@2" }, human, NOW);
    db = must(recorded);
    const row = db.performanceRecords[0];
    assert.equal(row?.publicationId, filed.data.id);
    assert.equal(row?.contentVersionReference, "story:sample@2");
    assert.equal(row?.value, 64);
    const missing = importPerformance(db, { publicationId: "missing", episodeId: "ep_external_sample", metric: "views", value: null, contentVersionReference: "story:sample@2" }, human, NOW);
    assert.equal(missing.ok, false);
    assert.equal(db.performanceRecords.length, 1);
  });

  it("7: Count the Thunder has no publication and no invented performance", () => {
    const seeded = buildSeedDb();
    const episode = thunder(seeded);
    const trace = traceEpisode(seeded, episode.id);
    assert.ok(trace);
    assert.equal(trace.stage === "PUBLISHED", false);
    assert.equal(trace.publications.length, 0);
    assert.equal(trace.performance.length, 0);
    assert.ok(trace.story && trace.canon && trace.script && trace.storyboard && trace.plan);
    assert.ok(trace.scenes.length > 0);
    assert.ok(trace.shots.length > 0);
    assert.ok(trace.reviews.some((review) => review.type === "rights" && review.redFlag));
    assert.ok(trace.assets.every((asset) => asset.rights !== "CLEARED"));
    const publication = registerPublication(seeded, { episodeId: episode.id, title: episode.name, contentVersionReference: "episode:thunder@1" }, human, NOW);
    assert.equal(publication.ok, false);
    assert.equal(publication.db.publications.length, 0);
    const performance = importPerformance(seeded, { publicationId: "none", episodeId: episode.id, metric: "views", value: 10, contentVersionReference: "episode:thunder@1" }, human, NOW);
    assert.equal(performance.ok, false);
    assert.equal(performance.db.performanceRecords.length, 0);
    assert.equal(seeded.analyticsObservations.length, 0);
    const published = publishEpisode(seeded, episode.id, human, NOW);
    assert.equal(published.ok, false);
    const blocked = sourcePublish(seeded, episode.id, human, NOW);
    assert.equal(blocked.ok, false);
    assert.notEqual(latestSnapshot(blocked.db.episodes.find((item) => item.id === episode.id)!).snapshot.stage, "PUBLISHED");
  });

  it("8: the Alpine range stays a proposal and is not production canon", () => {
    const seeded = buildSeedDb();
    const filed = fileAlpineProposal(seeded, human, NOW);
    const db = must(filed);
    const proposal = db.locationProposals.find((item) => item.key === ALPINE_KEY);
    assert.equal(proposal?.status, "PROPOSED");
    const library = db.locationLibrary.find((item) => item.key === ALPINE_KEY);
    assert.equal(library?.status, "PROPOSED");
    assert.equal(db.locations.some((item) => latestSnapshot(item).snapshot.key === ALPINE_KEY), false);
    const gate = locationUsableForProduction(db, ALPINE_KEY);
    assert.equal(gate.usable, false);
    const place = readPlace(db, ALPINE_KEY);
    assert.equal(place.usableInProduction, false);
    assert.equal(place.layer, "proposal");
    const approved = sourceApproveLocation(db, proposal!.id, agent, NOW);
    assert.equal(approved.ok, false);
    assert.equal(approved.db.locations.some((item) => latestSnapshot(item).snapshot.key === ALPINE_KEY), false);
    const catalog = sourceCatalog(db);
    assert.equal(catalog.universe?.label, "Gulmohar Gali");
    assert.equal(catalog.world?.status, "LOCKED");
    assert.ok(catalog.world && catalog.world.id !== catalog.world.label);
    assert.ok(catalog.characters.some((item) => item.label === "Meethi" && item.id !== "Meethi"));
    assert.ok(catalog.proposals.some((item) => item.id === library?.id && item.status === "PROPOSED"));
  });

  it("9: an important change keeps who, when, why, and both states", () => {
    const seeded = buildSeedDb();
    const story = openStory(seeded);
    const db = must(branchStoryVersion(seeded, story.id, 1, "Version two written for the audit trail.", human, "Show the previous version and the new one.", NOW));
    const event = db.sourceAudits.find((item) => item.eventType === "STORY_VERSION_CREATED" && item.entityId === story.id);
    assert.ok(event);
    assert.equal(event.actorType, "human");
    assert.equal(event.actorId, human.id);
    assert.equal(event.at, NOW);
    assert.equal(event.previousState, "v1");
    assert.equal(event.newState, "v2");
    assert.match(event.reason, /previous version/i);
    const mirror = db.audit.find((item) => item.action === "STORY_VERSION_CREATED" && item.entityId === story.id);
    assert.ok(mirror);
    const migrated = migrateStudioDb({ schemaVersion: 8, studio: null });
    assert.equal(migrated.schemaVersion, 10);
    assert.deepEqual(migrated.versionLinks, []);
    assert.deepEqual(migrated.publications, []);
    assert.deepEqual(migrated.performanceRecords, []);
  });
});
