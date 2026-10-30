import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  approveStory,
  canonicalOf,
  latestSnapshot,
  proposeCanonBreach,
  proposeLookalike,
  proposeUnderOriginalityBar,
  publishEpisode,
  reviseStoryNote,
  setCreativeThresholds,
  variationFor,
} from "./engine.ts";
import { canonResultFor, foldToken } from "./intelligence.ts";
import { buildSeedDb } from "./seed.ts";
import type { Actor } from "./types.ts";

const human: Actor = { type: "human", id: "human_asha", name: "Asha Menon" };
const architect: Actor = { type: "agent", id: "agent_story_architect", name: "Story Architect" };
const NOW = "2026-10-07T09:00:00.000Z";

function storyByTitle(db: ReturnType<typeof buildSeedDb>, title: string) {
  return db.stories.find((story) => story.versions.some((version) => version.snapshot.title === title));
}

describe("story intelligence", () => {
  it("keeps Gulmohar Gali, separates originality from similarity, and blocks lookalikes", () => {
    const db = buildSeedDb();
    assert.equal(db.studio?.name, "Neem Studio");
    assert.equal(db.studio?.ageBand, "3-5");
    assert.equal(db.characters.filter((character) => character.canonicalVersion != null).length, 3);
    const episode = db.episodes.find((item) => latestSnapshot(item).snapshot.title === "Count the Thunder");
    assert.ok(episode, "Count the Thunder must stay");
    assert.notEqual(latestSnapshot(episode).snapshot.stage, "PUBLISHED");

    const thunder = storyByTitle(db, "Count the Thunder");
    assert.ok(thunder);
    const thunderSnap = canonicalOf(thunder)?.snapshot ?? latestSnapshot(thunder).snapshot;
    assert.equal(thunderSnap.dna.storyStructure, "fear-named-with-company");
    assert.ok(thunderSnap.fingerprint.hash);
    assert.equal(thunderSnap.originality.dimensions.length, 7);
    assert.ok(thunderSnap.originality.total >= 75);
    assert.equal(thunderSnap.similarity.tooSimilar, false);
    assert.equal(thunderSnap.recommendation.decision, "HUMAN_REVIEW");
    assert.equal(canonResultFor(db, "story", thunder.id, thunder.canonicalVersion ?? 1), "PASS");
    assert.notEqual(thunderSnap.originality.total, thunderSnap.similarity.score);

    const strong = db.stories.find((story) => {
      const snap = latestSnapshot(story).snapshot;
      return story.canonicalVersion == null && snap.originality.total >= 75 && !snap.similarity.tooSimilar && snap.recommendation.canonResult === "PASS";
    });
    assert.ok(strong, "expected a strong original still waiting for a human");
    const strongSnap = latestSnapshot(strong).snapshot;
    assert.equal(strongSnap.recommendation.decision, "HUMAN_REVIEW");
    assert.ok(strongSnap.fingerprint.hash);
    assert.ok(strongSnap.dna.premise);
    assert.ok(strongSnap.dna.storyStructure);

    const agentGate = setCreativeThresholds(db, { originalityThreshold: 10 }, architect, NOW);
    assert.equal(agentGate.ok, false);
    assert.equal(agentGate.db.settings.originalityThreshold, 75);

    const agentApproves = approveStory(db, strong.id, architect, "The architect must not approve this story.", NOW);
    assert.equal(agentApproves.ok, false);

    const low = proposeUnderOriginalityBar(db, architect.id, NOW);
    assert.equal(low.ok, true);
    if (!low.ok) return;
    assert.ok(low.data.story.originality.total < 75);
    assert.equal(low.data.story.similarity.tooSimilar, false);
    assert.equal(low.data.story.recommendation.decision, "REQUIRES_REVISION");
    assert.equal(low.data.story.recommendation.canonResult, "PASS");
    assert.ok(low.data.story.originality.dimensions.length === 7);
    const lowApprove = approveStory(low.db, low.data.id, human, "This snack is reasonable and still not distinctive enough.", NOW);
    assert.equal(lowApprove.ok, false);
    if (!lowApprove.ok) assert.match(lowApprove.error, /Originality|threshold/i);

    const surface = proposeLookalike(db, thunder.id, "surface", architect.id, NOW);
    assert.equal(surface.ok, true);
    if (!surface.ok) return;
    assert.notEqual(surface.data.story.title, thunderSnap.title);
    assert.notDeepEqual([...surface.data.story.characterIds].sort(), [...thunderSnap.characterIds].sort());
    assert.notEqual(surface.data.story.dna.premise, thunderSnap.dna.premise);
    assert.equal(foldToken(surface.data.story.dna.premise), foldToken(thunderSnap.dna.premise));
    assert.equal(surface.data.story.dna.storyStructure, thunderSnap.dna.storyStructure);
    assert.ok(surface.data.story.similarity.score >= 55);
    assert.equal(surface.data.story.similarity.tooSimilar, true);
    assert.equal(surface.data.story.similarity.status, "LOOKALIKE");
    assert.match(surface.data.story.similarity.explanation, /same/i);
    assert.equal(surface.data.story.recommendation.decision, "BLOCKED");
    const surfaceApprove = approveStory(surface.db, surface.data.id, human, "Well written or not, this repeats Count the Thunder.", NOW);
    assert.equal(surfaceApprove.ok, false);
    if (!surfaceApprove.ok) assert.match(surfaceApprove.error, /similar/i);

    const polished = proposeLookalike(db, thunder.id, "polished", architect.id, NOW);
    assert.equal(polished.ok, true);
    if (!polished.ok) return;
    assert.ok(polished.data.story.originality.total >= 75, `originality ${polished.data.story.originality.total}`);
    assert.ok(polished.data.story.similarity.score >= 55);
    assert.equal(polished.data.story.similarity.tooSimilar, true);
    assert.equal(polished.data.story.recommendation.decision, "BLOCKED");
    assert.notEqual(polished.data.story.originality.total, polished.data.story.similarity.score);
    const polishedApprove = approveStory(polished.db, polished.data.id, human, "Excellent prose still cannot copy the structure.", NOW);
    assert.equal(polishedApprove.ok, false);
    if (!polishedApprove.ok) assert.match(polishedApprove.error, /similar/i);

    const breach = proposeCanonBreach(db, architect.id, NOW);
    assert.equal(breach.ok, true);
    if (!breach.ok) return;
    assert.equal(breach.data.story.recommendation.canonResult, "FAIL");
    assert.equal(breach.data.story.recommendation.decision, "BLOCKED");
    assert.match(breach.data.story.beginning, /cape/);
    const breachApprove = approveStory(breach.db, breach.data.id, human, "Canon has to fail closed even if the beats are tidy.", NOW);
    assert.equal(breachApprove.ok, false);
    if (!breachApprove.ok) assert.match(breachApprove.error, /Canon/i);

    assert.ok(db.stories.length >= 10);
    const library = db.stories.map((story) => latestSnapshot(story).snapshot);
    const structures = new Set(library.map((snap) => snap.dna.storyStructure));
    assert.ok(structures.size >= 8, `structures ${structures.size}`);
    const premises = new Set(library.map((snap) => snap.dna.premise));
    assert.ok(premises.size >= 8);
    for (const snap of library) {
      assert.ok(snap.fingerprint?.hash, snap.title);
      assert.equal(typeof snap.originality.total, "number");
      assert.equal(typeof snap.similarity.score, "number");
      assert.ok(snap.recommendation);
      assert.notEqual(snap.recommendation.canonResult, "NOT_EVALUATED");
    }
    const variation = variationFor(db);
    assert.equal(variation.librarySize, db.stories.length);
    assert.ok(variation.recommendations.length >= 1);
    assert.ok(variation.gaps.length >= 1);

    const before = canonicalOf(thunder)?.snapshot.logline;
    const revised = reviseStoryNote(db, thunder.id, "REVISED THUNDER LINE", architect, NOW);
    assert.equal(revised.ok, true);
    if (!revised.ok) return;
    const still = canonicalOf(revised.db.stories.find((story) => story.id === thunder.id));
    assert.equal(still?.snapshot.logline, before);
    assert.equal(still?.immutable, true);
    const newest = latestSnapshot(revised.db.stories.find((story) => story.id === thunder.id)!);
    assert.equal(newest.snapshot.logline, "REVISED THUNDER LINE");
    assert.notEqual(newest.version, still?.version);
    assert.ok(newest.snapshot.fingerprint.hash);
    assert.equal(typeof newest.snapshot.originality.total, "number");
    assert.equal(typeof newest.snapshot.similarity.score, "number");
    assert.notEqual(newest.snapshot.recommendation.canonResult, "NOT_EVALUATED");

    const published = publishEpisode(revised.db, episode.id, human, NOW);
    assert.equal(published.ok, false);
    assert.notEqual(latestSnapshot(published.db.episodes.find((item) => item.id === episode.id)!).snapshot.stage, "PUBLISHED");
  });
});
