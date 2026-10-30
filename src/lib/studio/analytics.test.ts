import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  analyticsApproveEpisode,
  analyticsBrief,
  analyticsChangeCanon,
  analyticsClearRights,
  analyticsOverview,
  analyticsPublish,
  audienceFor,
  commitAnalysis,
  concludeExperiment,
  correctInterpretation,
  excludeOutlier,
  handEvidenceToBrain,
  importObservation,
  locationRankings,
  proposeExperiment,
  setBaselineMethod,
  statesCausation,
  type ObservationInput,
} from "./analytics.ts";
import { ALPINE_KEY } from "./brain.ts";
import { latestSnapshot, migrateStudioDb, publishEpisode } from "./engine.ts";
import { previewRelease } from "./release.ts";
import { buildSeedDb } from "./seed.ts";
import type { Actor, StudioDb } from "./types.ts";

const human: Actor = { type: "human", id: "human_asha", name: "Asha Menon" };
const agent: Actor = { type: "agent", id: "agent_analytics", name: "Analytics Agent" };
const NOW = "2026-10-07T15:00:00.000Z";

function must<T>(result: { ok: boolean; db: StudioDb; error?: string; data?: T }): StudioDb {
  assert.equal(result.ok, true, result.ok ? "" : result.error);
  return result.db;
}

function thunder(db: StudioDb) {
  const episode = db.episodes.find((item) => latestSnapshot(item).snapshot.title === "Count the Thunder");
  assert.ok(episode);
  return episode;
}

function guard(db: StudioDb) {
  const episode = thunder(db);
  const snap = latestSnapshot(episode).snapshot;
  return {
    stage: snap.stage,
    versions: episode.versions.length,
    red: db.qualityReviews.some((review) => review.entityId === episode.id && review.gate === "rights" && review.redFlag),
    release: previewRelease(db, episode.id).status,
    tasks: db.agentTasks.length,
    locations: db.locations.length,
    stories: db.stories.length,
  };
}

let sampleNo = 0;

function sample(over: Partial<ObservationInput> = {}): ObservationInput {
  sampleNo += 1;
  return {
    episodeId: `sample_${sampleNo}`,
    title: `Sample ${sampleNo}`,
    hypothetical: true,
    source: "hypothetical",
    provider: "manual",
    format: "long-form",
    language: "hi",
    runtimeSeconds: 360,
    locationKey: "gulmohar-gali",
    worldKey: "gulmohar-gali",
    characterNames: ["Meethi"],
    storyStructure: "help-a-friend",
    targetAge: "3-5",
    songUsage: "none",
    episodeVersion: 1,
    metrics: { retention: 60, views: 1000, completion: 50 },
    note: "Hypothetical sample for learning. Not a live platform export.",
    ...over,
  };
}

describe("analytics and learning", () => {
  it("1: no published audience data stays insufficient, and Alpine is not ranked", () => {
    const seeded = buildSeedDb();
    const view = analyticsOverview(seeded);
    assert.equal(view.evidenceState, "INSUFFICIENT_DATA");
    assert.equal(view.confidence, "INSUFFICIENT");
    assert.equal(view.publishedEpisodes, 0);
    assert.equal(view.totalViews, null);
    assert.equal(view.liveConnected, false);
    assert.equal(view.insights.length, 0);
    assert.match(view.statement, /INSUFFICIENT DATA/);
    assert.equal(view.medianRetention, null);
    const reading = audienceFor(seeded, thunder(seeded).id);
    assert.equal(reading.dataState, "NOT_AVAILABLE");
    assert.equal(reading.views, null);
    assert.equal(reading.retention, null);
    assert.equal(reading.ctr, null);
    const migrated = migrateStudioDb({ schemaVersion: 7, studio: null });
    assert.equal(migrated.schemaVersion, 10);
    assert.deepEqual(migrated.analyticsObservations, []);
    const alpine = must(importObservation(seeded, sample({ title: "Alpine drill", locationKey: ALPINE_KEY, worldKey: ALPINE_KEY, metrics: { retention: 99, views: 5000 } }), human, NOW));
    assert.equal(alpine.analyticsObservations[0]?.rankable, false);
    assert.equal(locationRankings(alpine).some((row) => row.key === ALPINE_KEY), false);
    assert.ok(alpine.analyticsQuality.some((flag) => flag.code === "proposed_location" && flag.repaired === false));
    assert.equal(analyticsOverview(alpine).evidenceState, "INSUFFICIENT_DATA");
    assert.equal(analyticsOverview(alpine).medianRetention, null);
  });

  it("2: one strong hypothetical episode stays low confidence and is not copied", () => {
    let db = buildSeedDb();
    db = must(importObservation(db, sample({ title: "One strong hour", metrics: { retention: 84, views: 8000, completion: 80 } }), human, NOW));
    db = must(commitAnalysis(db, human, NOW));
    const overview = analyticsOverview(db);
    assert.equal(overview.medianRetention, 84);
    assert.equal(overview.totalViews, null);
    assert.equal(overview.confidence, "LOW");
    const finding = db.analyticsInterpretations.find((item) => item.kind === "episode");
    assert.ok(finding);
    assert.equal(finding.confidence, "LOW");
    assert.match(finding.observed, /84/);
    assert.match(`${finding.interpretation} ${finding.recommendation}`, /investigat/i);
    assert.doesNotMatch(`${finding.interpretation} ${finding.recommendation}`, /make more|make ten|produce another/i);
    assert.equal(statesCausation(`${finding.interpretation} ${finding.recommendation}`), false);
  });

  it("3: a repeated pattern shows sample size, baseline, confidence, and evidence", () => {
    let db = buildSeedDb();
    for (let index = 0; index < 8; index += 1) {
      db = must(importObservation(db, sample({ title: `Lost ${index}`, storyStructure: "lost-object", metrics: { retention: 68 + index, views: 1000, completion: 60 } }), human, NOW));
    }
    for (let index = 0; index < 4; index += 1) {
      db = must(importObservation(db, sample({ title: `Help ${index}`, storyStructure: "help-a-friend", metrics: { retention: 40 + index, views: 900, completion: 40 } }), human, NOW));
    }
    db = must(commitAnalysis(db, human, NOW));
    const pattern = db.analyticsInterpretations.find((item) => item.kind === "pattern" && item.title === "lost-object");
    assert.ok(pattern);
    assert.equal(pattern.sampleSize, 8);
    assert.equal(pattern.confidence, "MEDIUM");
    assert.match(pattern.compared ?? "", /baseline/i);
    assert.match(pattern.limitations, /n = 8/);
    assert.match(pattern.observed, /8/);
    assert.equal(statesCausation(pattern.interpretation), false);
  });

  it("4: Golu is associated with higher retention, not said to cause it", () => {
    let db = buildSeedDb();
    for (const retention of [78, 80, 82]) {
      db = must(importObservation(db, sample({ characterNames: ["Golu"], metrics: { retention, views: 1100, completion: 70 }, storyStructure: "chase" }), human, NOW));
    }
    for (const retention of [50, 52, 54]) {
      db = must(importObservation(db, sample({ characterNames: ["Meethi"], metrics: { retention, views: 1000, completion: 48 }, storyStructure: "chase" }), human, NOW));
    }
    db = must(commitAnalysis(db, human, NOW));
    const finding = db.analyticsInterpretations.find((item) => item.kind === "character" && item.title === "Golu");
    assert.ok(finding);
    const text = `${finding.observed} ${finding.interpretation} ${finding.recommendation}`;
    assert.match(text, /associated with higher retention/i);
    assert.equal(statesCausation(text), false);
    assert.doesNotMatch(text, /golu causes/i);
  });

  it("5: an experiment can be supported, unsupported, or inconclusive", () => {
    let db = buildSeedDb();
    const inconclusive = must(proposeExperiment(db, { hypothesis: "A shorter cold open may hold the first minute." }, human, NOW));
    const first = inconclusive.analyticsExperiments[0];
    assert.ok(first);
    db = must(concludeExperiment(inconclusive, first.id, "inconclusive", "The two samples overlap. No separation.", human, NOW));
    assert.equal(db.analyticsExperiments.find((item) => item.id === first.id)?.status, "INCONCLUSIVE");
    assert.equal(db.analyticsExperiments.find((item) => item.id === first.id)?.conclusion, "inconclusive");
    db = must(proposeExperiment(db, { hypothesis: "A shared song may raise repeat viewing." }, human, NOW));
    const supported = db.analyticsExperiments.find((item) => item.hypothesis.includes("shared song"));
    assert.ok(supported);
    db = must(concludeExperiment(db, supported.id, "supported", "The test group finished more often in this small test.", human, NOW));
    assert.equal(db.analyticsExperiments.find((item) => item.id === supported.id)?.conclusion, "supported");
    db = must(proposeExperiment(db, { hypothesis: "A second problem in the story may help." }, human, NOW));
    const failed = db.analyticsExperiments.find((item) => item.hypothesis.includes("second problem"));
    assert.ok(failed);
    db = must(concludeExperiment(db, failed.id, "not_supported", "Completion was lower. The failure stays on record.", human, NOW));
    const kept = db.analyticsExperiments.find((item) => item.id === failed.id);
    assert.equal(kept?.conclusion, "not_supported");
    assert.equal(kept?.status, "COMPLETED");
    assert.ok(db.analyticsLessons.some((item) => item.negative && item.affected.includes("second problem")));
    assert.equal(db.analyticsExperiments.length, 3);
    const blocked = analyticsPublish(db, thunder(db).id, human, NOW);
    assert.equal(blocked.ok, false);
    assert.equal(db.analyticsExperiments.length, blocked.db.analyticsExperiments.length);
  });

  it("6: a retention spike asks for investigation and does not order a copy", () => {
    let db = buildSeedDb();
    for (const retention of [50, 51, 52, 88]) {
      db = must(importObservation(db, sample({ title: `Beat ${retention}`, metrics: { retention, views: 1000, completion: retention } }), human, NOW));
    }
    db = must(commitAnalysis(db, human, NOW));
    const anomaly = db.analyticsAnomalies.find((item) => item.kind === "spike");
    assert.ok(anomaly);
    assert.equal(anomaly.action, "INVESTIGATE");
    assert.match(anomaly.summary, /88/);
    const text = `${anomaly.summary} ${anomaly.detail}`;
    assert.match(text, /investigat/i);
    assert.doesNotMatch(text, /make more|produce another|copy this episode/i);
    assert.equal(db.episodes.length, buildSeedDb().episodes.length);
  });

  it("7: impossible metrics are flagged and not repaired", () => {
    let db = buildSeedDb();
    db = must(importObservation(db, sample({ title: "Broken row", metrics: { retention: 140, views: -5, completion: 40 } }), human, NOW));
    const raw = db.analyticsObservations[0];
    assert.ok(raw);
    assert.equal(raw.metrics.retention, 140);
    assert.equal(raw.metrics.views, -5);
    const flags = db.analyticsQuality.filter((flag) => flag.observationId === raw.id && flag.code === "impossible_value");
    assert.ok(flags.length >= 2);
    assert.equal(flags.every((flag) => flag.status === "DATA_QUALITY_ISSUE" && flag.repaired === false), true);
    db = must(commitAnalysis(db, human, NOW));
    assert.equal(db.analyticsObservations[0]?.metrics.retention, 140);
    assert.equal(db.analyticsObservations[0]?.metrics.views, -5);
    const prose = db.analyticsInterpretations.map((item) => `${item.observed} ${item.interpretation}`).join(" ");
    assert.doesNotMatch(prose, /140/);
    db = must(excludeOutlier(db, raw.id, "Holiday upload. Leave the raw row, drop it from comparisons.", human, NOW));
    assert.equal(db.analyticsObservations[0]?.metrics.retention, 140);
    assert.equal(db.analyticsCorrections.some((item) => item.verdict === "EXCLUDE_OUTLIER" && item.targetId === raw.id), true);
  });

  it("8: a later content version does not rewrite the earlier measurement", () => {
    let db = buildSeedDb();
    db = must(importObservation(db, sample({ episodeId: "sample_hist", title: "Versioned", episodeVersion: 1, metrics: { retention: 61, views: 700, completion: 55 } }), human, NOW));
    db = must(commitAnalysis(db, human, NOW));
    const original = db.analyticsObservations[0];
    assert.ok(original);
    const finding = db.analyticsInterpretations.find((item) => item.observationIds.includes(original.id));
    assert.ok(finding);
    const observed = finding.observed;
    db = must(importObservation(db, sample({ episodeId: "sample_hist", title: "Versioned", episodeVersion: 2, metrics: { retention: 33, views: 400, completion: 30 } }), human, NOW));
    assert.equal(db.analyticsObservations[0]?.id, original.id);
    assert.equal(db.analyticsObservations[0]?.episodeVersion, 1);
    assert.equal(db.analyticsObservations[0]?.metrics.retention, 61);
    assert.equal(db.analyticsObservations[1]?.episodeVersion, 2);
    assert.equal(db.analyticsObservations[1]?.metrics.retention, 33);
    db = must(setBaselineMethod(db, "mean", human, NOW));
    db = must(commitAnalysis(db, human, NOW));
    const still = db.analyticsInterpretations.find((item) => item.id === finding.id);
    assert.ok(still);
    assert.equal(still.observed, observed);
    assert.ok(still.status === "OUTDATED" || still.status === "NEEDS_REVIEW");
    const corrected = correctInterpretation(db, still.id, "MISLEADING", "The first cut was measured during a holiday.", human, NOW);
    db = must(corrected);
    assert.equal(db.analyticsObservations[0]?.metrics.retention, 61);
    assert.equal(db.analyticsInterpretations.find((item) => item.id === finding.id)?.observed, observed);
  });

  it("9: Count the Thunder gets no inferred audience performance", () => {
    const seeded = buildSeedDb();
    const before = guard(seeded);
    const episode = thunder(seeded);
    const refused = importObservation(
      seeded,
      sample({ episodeId: episode.id, title: "Count the Thunder", hypothetical: true, metrics: { views: 99999, retention: 99, ctr: 20 } }),
      human,
      NOW,
    );
    assert.equal(refused.ok, false);
    assert.equal(refused.db.analyticsObservations.length, 0);
    const audience = audienceFor(refused.db, episode.id);
    assert.equal(audience.dataState, "NOT_AVAILABLE");
    assert.equal(audience.views, null);
    assert.equal(audience.retention, null);
    assert.equal(audience.ctr, null);
    const published = publishEpisode(refused.db, episode.id, human, NOW);
    assert.equal(published.ok, false);
    const cleared = analyticsClearRights(published.db, episode.id, agent, NOW);
    assert.equal(cleared.ok, false);
    assert.deepEqual(guard(cleared.db), before);
    assert.equal(previewRelease(cleared.db, episode.id).status, "RELEASE_BLOCKED");
  });

  it("10: evidence can reach the brain without touching the queue, rights, canon, or publish", () => {
    let db = buildSeedDb();
    const before = guard(db);
    db = must(importObservation(db, sample({ title: "Packet source", metrics: { retention: 71, views: 1200, completion: 64 } }), human, NOW));
    db = must(commitAnalysis(db, human, NOW));
    const packet = db.analyticsPackets.find((item) => !item.stale);
    assert.ok(packet);
    const tasks = db.agentTasks.length;
    const stages = db.episodes.map((episode) => latestSnapshot(episode).snapshot.stage);
    db = must(handEvidenceToBrain(db, packet.id, human, NOW));
    const recommendation = db.brainRecommendations.find((item) => item.fingerprint === `investigate:analytics:${packet.id}`);
    assert.ok(recommendation);
    assert.equal(recommendation.status, "OPEN");
    assert.equal(recommendation.humanDecision, null);
    assert.match(recommendation.recommendedAction, /did not publish|do not change the production queue/i);
    assert.equal(db.agentTasks.length, tasks);
    assert.deepEqual(db.episodes.map((episode) => latestSnapshot(episode).snapshot.stage), stages);
    assert.equal(analyticsPublish(db, thunder(db).id, human, NOW).ok, false);
    assert.equal(analyticsApproveEpisode(db, thunder(db).id, human, NOW).ok, false);
    assert.equal(analyticsClearRights(db, thunder(db).id, human, NOW).ok, false);
    assert.equal(analyticsChangeCanon(db, agent, NOW).ok, false);
    const agentHand = handEvidenceToBrain(db, packet.id, agent, NOW);
    assert.equal(agentHand.ok, false);
    assert.deepEqual(guard(analyticsPublish(db, thunder(db).id, human, NOW).db), before);
    const brief = analyticsBrief(db);
    assert.equal(brief.liveConnected, false);
    assert.equal(brief.episodes.some((item) => item.title === "Count the Thunder" && item.dataState === "NOT_AVAILABLE"), true);
    assert.equal(brief.locations.some((item) => item.key === ALPINE_KEY), false);
  });
});
