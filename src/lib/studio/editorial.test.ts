import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  approveEditorialScript,
  currentQa,
  currentReviews,
  realDrafts,
  reviewCultureEditorial,
  reviewHindiEditorial,
  reviewsFor,
  reviseScript,
  rightsStanding,
  runEditorialQa,
} from "./editorial.ts";
import { approveStory, latestSnapshot, openEpisode, publishEpisode } from "./engine.ts";
import { buildSeedDb } from "./seed.ts";
import { acceptNormalizedDraft, assembleScriptContext, SCRIPT_TEMPLATE_KEY, type NormalizedTextResult } from "./text.ts";
import type { Actor, StudioDb } from "./types.ts";

const human: Actor = { type: "human", id: "human_asha", name: "Asha Menon" };
const editor: Actor = { type: "agent", id: "agent_hindi_editor", name: "Hindi Language Editor" };
const admin: Actor = { type: "human", id: "human_admin", name: "Studio Admin" };
const NOW = "2026-10-16T12:00:00.000Z";

function must<T>(result: { ok: boolean; db: StudioDb; error?: string; data?: T }): StudioDb {
  assert.equal(result.ok, true, result.ok ? "" : result.error);
  return result.db;
}

function thunder(db: StudioDb) {
  const episode = db.episodes.find((item) => latestSnapshot(item).snapshot.title === "Count the Thunder");
  assert.ok(episode);
  return episode;
}

function otherStory(db: StudioDb) {
  return db.stories.find((story) => {
    const snap = latestSnapshot(story).snapshot;
    return story.canonicalVersion == null && snap.title !== "Count the Thunder" && snap.originality.total >= 75 && !snap.similarity.tooSimilar && snap.recommendation.canonResult === "PASS";
  });
}

function result(partial: Partial<NormalizedTextResult>): NormalizedTextResult {
  return {
    status: "SUCCESS",
    providerId: "llm.xai",
    model: "grok-4.5",
    modelVersion: null,
    text: null,
    inputTokens: null,
    outputTokens: null,
    durationMs: 20,
    cost: null,
    error: null,
    externalReference: null,
    templateKey: SCRIPT_TEMPLATE_KEY,
    templateVersion: 1,
    retryOf: null,
    ...partial,
  };
}

function draftText(context: Exclude<ReturnType<typeof assembleScriptContext>, string>, locationKey: string, action = "Meethi watches the courtyard tree.") {
  const lead = context.characters[0];
  const elder = context.characters.find((item) => item.name !== lead?.name) ?? lead;
  assert.ok(lead && elder);
  return JSON.stringify({
    scenes: [{
      sceneNo: 1,
      locationKey,
      action,
      lines: [
        { speaker: lead.name, hi: "देखो ना! फूल गिर रहा है।", en: "Look, a flower is falling." },
        { speaker: elder.name, hi: "धीरे, बेटा।", en: "Slowly, child." },
      ],
    }],
    vocabulary: [{ word: "फूल", meaning: "flower", pronunciation: "phool" }],
  });
}

function fileReal(providerId = "llm.xai", action?: string) {
  const seeded = buildSeedDb();
  const before = JSON.stringify(latestSnapshot(thunder(seeded)).snapshot);
  const story = otherStory(seeded);
  assert.ok(story);
  let db = must(approveStory(seeded, story.id, human, "Human approval of this story. Not a model approval.", NOW));
  db = must(openEpisode(db, story.id, human, NOW));
  const context = assembleScriptContext(db, story.id);
  assert.equal(typeof context, "object");
  if (typeof context === "string") throw new Error(context);
  const place = context.locations[0];
  assert.ok(place);
  const filed = acceptNormalizedDraft(db, story.id, result({ text: draftText(context, place.key, action), providerId }), human, NOW);
  assert.equal(filed.ok, true, filed.ok ? "" : filed.error);
  if (!filed.ok || !filed.data.scriptId) throw new Error("draft missing");
  return { db: filed.db, scriptId: filed.data.scriptId, before, storyId: story.id };
}

describe("step 12 editorial review", () => {
  it("takes one real draft through review, revision, re-review, QA, and human approval", () => {
    const filed = fileReal();
    const script = filed.db.scripts.find((item) => item.id === filed.scriptId);
    assert.ok(script);
    const original = JSON.stringify(script.versions.find((item) => item.version === 1)?.snapshot);
    assert.equal(realDrafts(filed.db).some((item) => item.scriptId === filed.scriptId), true);
    assert.equal(script.versions[0]?.snapshot.storyVersion >= 1, true);
    assert.ok(script.versions[0]?.snapshot.canonSnapshotHash);
    assert.equal(script.versions[0]?.snapshot.generationRunId != null, true);

    const hindi = must(reviewHindiEditorial(filed.db, filed.scriptId, "agent_hindi_editor", NOW));
    const culture = must(reviewCultureEditorial(hindi, filed.scriptId, "agent_cultural_reviewer", NOW));
    const afterReview = culture.scripts.find((item) => item.id === filed.scriptId);
    assert.equal(JSON.stringify(afterReview?.versions.find((item) => item.version === 1)?.snapshot), original);
    const pair = currentReviews(culture, filed.scriptId);
    assert.ok(pair.hindi && pair.culture);
    assert.notEqual(pair.hindi.id, pair.culture.id);
    assert.equal(pair.hindi.scriptVersion, 1);
    assert.equal(pair.culture.scriptVersion, 1);

    const agent = approveEditorialScript(culture, filed.scriptId, editor, "The editor tried to approve its own review.", NOW);
    assert.equal(agent.ok, false);

    const qa = must(runEditorialQa(culture, filed.scriptId, "agent_qa", NOW));
    const revised = must(reviseScript(qa, filed.scriptId, {
      reason: "Human shortened nothing. Kept the spoken line and rejected no required change.",
      lines: [{ sceneNo: 1, lineIndex: 0, hi: "देखो, फूल गिरा।", en: "Look, the flower fell." }],
      acceptedFindingIds: [],
    }, human, NOW));
    const next = revised.scripts.find((item) => item.id === filed.scriptId);
    assert.ok(next);
    assert.equal(next.currentVersion, 2);
    assert.equal(JSON.stringify(next.versions.find((item) => item.version === 1)?.snapshot), original);
    assert.equal(next.versions.find((item) => item.version === 2)?.snapshot.parentVersion, 1);
    assert.equal(next.versions.find((item) => item.version === 2)?.snapshot.generationRunId, next.versions[0]?.snapshot.generationRunId);
    assert.equal(reviewsFor(revised, filed.scriptId, 1, "hindi").length, 1);
    assert.equal(currentReviews(revised, filed.scriptId).hindi, null);
    assert.equal(currentQa(revised, filed.scriptId), null);
    assert.equal((revised.qaRuns ?? []).some((run) => run.scriptId === filed.scriptId && run.overallStatus === "OUTDATED"), true);

    const againHindi = must(reviewHindiEditorial(revised, filed.scriptId, "agent_hindi_editor", NOW));
    const againCulture = must(reviewCultureEditorial(againHindi, filed.scriptId, "agent_cultural_reviewer", NOW));
    const againQa = must(runEditorialQa(againCulture, filed.scriptId, "agent_qa", NOW));
    const note = currentReviews(againQa, filed.scriptId).disagreement
      ? "Human resolved the reviewer disagreement and approved this exact version only."
      : "Human approved this exact script version.";
    const boards = againQa.storyboards.length;
    const rights = JSON.stringify(againQa.rightsRecords ?? []);
    const approved = must(approveEditorialScript(againQa, filed.scriptId, human, note, NOW));
    const finalScript = approved.scripts.find((item) => item.id === filed.scriptId);
    assert.equal(finalScript?.canonicalVersion, 2);
    const record = approved.humanApprovals.find((item) => item.subjectId === filed.scriptId);
    assert.ok(record);
    assert.equal(record.approvedArtifactVersions.find((pin) => pin.type === "script")?.version, 2);
    assert.equal(record.reviewerId, human.id);
    assert.equal(rightsStanding(approved, filed.scriptId), "UNKNOWN");
    assert.equal(JSON.stringify(approved.rightsRecords ?? []), rights);
    assert.equal(approved.storyboards.length, boards);
    const episode = approved.episodes.find((item) => latestSnapshot(item).snapshot.storyId === filed.storyId && latestSnapshot(item).snapshot.title !== "Count the Thunder");
    assert.equal(latestSnapshot(episode!).snapshot.stage, "SCRIPT_APPROVED");
    assert.equal(publishEpisode(approved, episode!.id, admin, NOW).ok, false);
    assert.equal(JSON.stringify(latestSnapshot(thunder(approved)).snapshot), filed.before);
    const alpine = (approved.locationLibrary ?? []).find((item) => item.key === "alpine-inspired");
    if (alpine) assert.equal(alpine.status, "PROPOSED");
    assert.equal(approved.locations.some((item) => latestSnapshot(item).snapshot.key === "alpine-inspired" && latestSnapshot(item).status === "approved"), false);
    const afterApproval = must(reviseScript(approved, filed.scriptId, {
      reason: "Human changed the approved line. The old approval must not cover this version.",
      lines: [{ sceneNo: 1, lineIndex: 1, hi: "आराम से, बेटा।", en: "Gently, child." }],
      acceptedFindingIds: [],
    }, human, NOW));
    const moved = afterApproval.scripts.find((item) => item.id === filed.scriptId);
    assert.equal(moved?.currentVersion, 3);
    assert.equal(moved?.canonicalVersion, 2);
    assert.equal(JSON.stringify(moved?.versions.find((item) => item.version === 1)?.snapshot), original);
    assert.equal((afterApproval.qaRuns ?? []).some((run) => run.scriptId === filed.scriptId && run.scriptVersion === 2 && run.overallStatus === "OUTDATED"), true);
    assert.equal(afterApproval.humanApprovals.find((item) => item.subjectId === filed.scriptId)?.approvedArtifactVersions.find((pin) => pin.type === "script")?.version, 2);
    assert.equal(afterApproval.storyboards.length, boards);
    assert.notEqual(latestSnapshot(afterApproval.episodes.find((item) => item.id === episode!.id)!).snapshot.stage, "STORYBOARD");
  });

  it("keeps disagreement, blocks a fake draft, and does not reuse an old review", () => {
    const filed = fileReal("llm.xai", "A festival lecture about generic cartoon India.");
    const hindi = must(reviewHindiEditorial(filed.db, filed.scriptId, "agent_hindi_editor", NOW));
    const culture = must(reviewCultureEditorial(hindi, filed.scriptId, "agent_cultural_reviewer", NOW));
    const pair = currentReviews(culture, filed.scriptId);
    assert.equal(pair.disagreement, true);
    assert.notEqual(pair.hindi?.outcome, pair.culture?.outcome);
    const qa = runEditorialQa(culture, filed.scriptId, "agent_qa", NOW);
    assert.equal(qa.ok, true);
    if (!qa.ok) return;
    assert.equal(qa.data.status, "BLOCKED");
    const approved = approveEditorialScript(qa.db, filed.scriptId, human, "Human resolved the reviewer disagreement in writing here.", NOW);
    assert.equal(approved.ok, false);

    const dev = fileReal("development");
    assert.equal(realDrafts(dev.db).some((item) => item.scriptId === dev.scriptId), false);
    assert.equal(reviewHindiEditorial(dev.db, dev.scriptId, "agent_hindi_editor", NOW).ok, false);
  });
});
