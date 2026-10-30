import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateSubject } from "./canon.ts";
import {
  approveCanonChange,
  canonicalOf,
  createCharacter,
  explainCanon,
  latestSnapshot,
  proposeCanonChange,
  proposeScriptDrift,
  proposeStoryForCast,
  proposeVisualAsset,
  publishEpisode,
  reviseCharacter,
  snapshotOf,
} from "./engine.ts";
import { buildSeedDb } from "./seed.ts";
import type { Actor, CharacterBody } from "./types.ts";

const human: Actor = { type: "human", id: "human_asha", name: "Asha Menon" };
const director: Actor = { type: "agent", id: "agent_character_director", name: "Character Director" };

function byName(db: ReturnType<typeof buildSeedDb>, name: string) {
  const character = db.characters.find((item) => item.name === name);
  assert.ok(character, name);
  return character;
}

describe("canon enforcement", () => {
  it("A: Gulmohar Gali content passes, Count the Thunder stays held, publish stays impossible", () => {
    const db = buildSeedDb();
    const meethi = byName(db, "Meethi");
    const golu = byName(db, "Golu");
    const dadi = byName(db, "Dadi Kamla");
    assert.equal(snapshotOf(meethi)?.age, "5");
    assert.equal(snapshotOf(golu)?.species, "palm squirrel");
    assert.equal(snapshotOf(dadi)?.name, "Dadi Kamla");
    assert.equal(canonicalOf(meethi)?.canonState, "LOCKED");

    const episode = db.episodes.find((item) => latestSnapshot(item).snapshot.title === "Count the Thunder");
    assert.ok(episode);
    const snap = latestSnapshot(episode).snapshot;
    assert.notEqual(snap.stage, "PUBLISHED");
    assert.ok(snap.canonVersionUsed);
    assert.ok(snap.canonSnapshotHash);
    const story = db.stories.find((item) => item.id === snap.storyId);
    assert.ok(story);
    const storyBody = canonicalOf(story)?.snapshot ?? latestSnapshot(story).snapshot;
    const storyCheck = validateSubject(db, { kind: "story", id: story.id, version: story.canonicalVersion ?? 1, body: storyBody });
    assert.equal(storyCheck.result, "PASS", JSON.stringify(storyCheck.violations));

    const script = snap.scriptId ? db.scripts.find((item) => item.id === snap.scriptId) : undefined;
    assert.ok(script);
    const scriptBody = canonicalOf(script)?.snapshot ?? latestSnapshot(script).snapshot;
    const scriptCheck = validateSubject(db, { kind: "script", id: script.id, version: script.canonicalVersion ?? 1, body: scriptBody });
    assert.equal(scriptCheck.result, "PASS", JSON.stringify(scriptCheck.violations));
    assert.equal(scriptBody.canonVersionUsed, snap.canonVersionUsed);

    const board = snap.storyboardId ? db.storyboards.find((item) => item.id === snap.storyboardId) : undefined;
    assert.ok(board);
    const boardCheck = validateSubject(db, { kind: "storyboard", id: board.id, version: 1, body: latestSnapshot(board).snapshot });
    assert.equal(boardCheck.result, "PASS", JSON.stringify(boardCheck.violations));

    const plan = snap.planId ? db.plans.find((item) => item.id === snap.planId) : undefined;
    assert.ok(plan);
    const planCheck = validateSubject(db, { kind: "plan", id: plan.id, version: 1, body: latestSnapshot(plan).snapshot });
    assert.equal(planCheck.result, "PASS", JSON.stringify(planCheck.violations));

    assert.ok(db.qualityReviews.some((review) => review.gate === "rights" && review.redFlag));
    const published = publishEpisode(db, episode.id, human);
    assert.equal(published.ok, false);
    assert.equal(latestSnapshot(published.db.episodes.find((item) => item.id === episode.id)!).snapshot.stage, snap.stage);
    assert.equal(snapshotOf(published.db.characters.find((item) => item.id === meethi.id) ?? null)?.age, "5");
  });

  it("B: a locked attribute cannot be silently changed", () => {
    const db = buildSeedDb();
    const meethi = byName(db, "Meethi");
    const claim = validateSubject(db, {
      kind: "character_claim",
      id: meethi.id,
      version: 1,
      characterId: meethi.id,
      field: "age",
      proposed: "7",
    });
    assert.equal(claim.result, "FAIL");
    const violation = claim.violations.find((item) => item.field === "age");
    assert.ok(violation);
    assert.equal(violation.proposed, "7");
    assert.equal(violation.canonical, "5");
    assert.equal(violation.strength, "HARD");
    const body = snapshotOf(meethi);
    assert.ok(body);
    const edited: CharacterBody = { ...body, age: "7" };
    const revised = reviseCharacter(db, meethi.id, edited, human);
    assert.equal(revised.ok, false);
    if (!revised.ok) assert.equal(revised.code, "canon-change-required");
    assert.equal(snapshotOf(revised.db.characters.find((item) => item.id === meethi.id) ?? null)?.age, "5");
  });

  it("C: a draft character cannot be used to generate", () => {
    let db = buildSeedDb();
    const before = db.stories.length;
    const draftBody = snapshotOf(byName(db, "Meethi"));
    assert.ok(draftBody);
    const draft = createCharacter(db, { ...draftBody, name: "Draft Child", nameHi: "ड्राफ्ट", catchphrases: ["देखो।"] }, human);
    assert.equal(draft.ok, true);
    if (!draft.ok) return;
    db = draft.db;
    const blocked = proposeStoryForCast(db, [draft.data.id], "agent_story_architect");
    assert.equal(blocked.ok, false);
    if (!blocked.ok) {
      assert.equal(blocked.code, "blocked");
      assert.match(blocked.error, /BLOCKED/);
    }
    assert.equal(blocked.db.stories.length, before);
    assert.equal(canonicalOf(blocked.db.characters.find((item) => item.id === draft.data.id)), null);
  });

  it("D: a contradictory Hindi line fails canon and does not rewrite the approved script", () => {
    const db = buildSeedDb();
    const episode = db.episodes.find((item) => latestSnapshot(item).snapshot.title === "Count the Thunder");
    assert.ok(episode);
    const scriptId = latestSnapshot(episode).snapshot.scriptId;
    assert.ok(scriptId);
    const before = canonicalOf(db.scripts.find((item) => item.id === scriptId) ?? null)?.snapshot;
    assert.ok(before);
    const drifted = proposeScriptDrift(db, scriptId, "agent_scriptwriter");
    assert.equal(drifted.ok, true, drifted.ok ? "" : drifted.error);
    if (!drifted.ok) return;
    assert.equal(drifted.data.result, "FAIL");
    assert.equal(drifted.data.canonicalAge, "5");
    const script = drifted.db.scripts.find((item) => item.id === scriptId);
    assert.ok(script);
    assert.equal(canonicalOf(script)?.snapshot.scenes.flatMap((scene) => scene.lines.map((line) => line.en)).join(" "), before.scenes.flatMap((scene) => scene.lines.map((line) => line.en)).join(" "));
    const why = explainCanon(drifted.db, "script", scriptId);
    assert.equal(why.validation?.validation.result, "FAIL");
    assert.match(why.validation?.validation.violations.map((item) => item.field).join(" ") ?? "", /age/);
    assert.equal(snapshotOf(drifted.db.characters.find((item) => item.name === "Meethi") ?? null)?.age, "5");
  });

  it("E: a visual claim that contradicts appearance is drift, not a rewrite", () => {
    const db = buildSeedDb();
    const meethi = byName(db, "Meethi");
    const appearance = snapshotOf(meethi)?.appearance;
    const asset = proposeVisualAsset(
      db,
      { characterId: meethi.id, claims: { age: "7", hair: "blonde", clothing: "cape" } },
      "agent_character_director",
    );
    assert.equal(asset.ok, true, asset.ok ? "" : asset.error);
    if (!asset.ok) return;
    assert.equal(asset.data.drift, "DRIFT_FOUND");
    assert.equal(asset.data.result, "FAIL");
    const stored = asset.db.assets.find((item) => item.id === asset.data.assetId);
    assert.ok(stored);
    assert.equal(stored.canonicalVersion, null);
    assert.equal(latestSnapshot(stored).status, "in_review");
    assert.equal(latestSnapshot(stored).snapshot.characterId, meethi.id);
    assert.ok(latestSnapshot(stored).snapshot.canonVersion);
    assert.equal(snapshotOf(asset.db.characters.find((item) => item.id === meethi.id) ?? null)?.appearance, appearance);
  });

  it("F: a canon change stays proposed until a human approves, and old episodes keep their text", () => {
    let db = buildSeedDb();
    const meethi = byName(db, "Meethi");
    const episode = db.episodes.find((item) => latestSnapshot(item).snapshot.title === "Count the Thunder");
    assert.ok(episode);
    const scriptBefore = latestSnapshot(db.scripts.find((item) => item.id === latestSnapshot(episode).snapshot.scriptId)!).snapshot;
    const proposed = proposeCanonChange(
      db,
      { entityId: meethi.id, field: "age", proposedValue: "6", reason: "Testing the change gate, not a real retcon." },
      director,
    );
    assert.equal(proposed.ok, true, proposed.ok ? "" : proposed.error);
    if (!proposed.ok) return;
    db = proposed.db;
    const change = db.canonChanges.find((item) => item.id === proposed.data.id);
    assert.ok(change);
    assert.equal(change.status, "PROPOSED");
    assert.ok(change.impact.episodes.some((item) => item.title === "Count the Thunder"));
    assert.ok(change.impact.stories.length > 0);
    assert.equal(snapshotOf(db.characters.find((item) => item.id === meethi.id) ?? null)?.age, "5");
    const agentApproves = approveCanonChange(db, change.id, director, "An agent must not lock this.");
    assert.equal(agentApproves.ok, false);
    db = agentApproves.db;
    assert.equal(snapshotOf(db.characters.find((item) => item.id === meethi.id) ?? null)?.age, "5");
    const approved = approveCanonChange(db, change.id, human, "Human accepts a new age version. Old work stays as written.");
    assert.equal(approved.ok, true, approved.ok ? "" : approved.error);
    if (!approved.ok) return;
    db = approved.db;
    const after = db.characters.find((item) => item.id === meethi.id);
    assert.ok(after);
    assert.equal(snapshotOf(after)?.age, "6");
    const previous = after.versions.find((version) => version.version === 1);
    assert.equal(previous?.snapshot.age, "5");
    assert.equal(previous?.canonState, "SUPERSEDED");
    assert.equal(after.versions.find((version) => version.version === after.canonicalVersion)?.canonState, "LOCKED");
    const scriptAfter = latestSnapshot(db.scripts.find((item) => item.id === latestSnapshot(episode).snapshot.scriptId)!).snapshot;
    assert.equal(scriptAfter.scenes.flatMap((scene) => scene.lines.map((line) => line.hi)).join("|"), scriptBefore.scenes.flatMap((scene) => scene.lines.map((line) => line.hi)).join("|"));
    assert.equal(latestSnapshot(db.episodes.find((item) => item.id === episode.id)!).snapshot.title, "Count the Thunder");
    const trail = explainCanon(db, "episode", episode.id);
    assert.ok(trail.run?.canonVersion || latestSnapshot(db.episodes.find((item) => item.id === episode.id)!).snapshot.canonVersionUsed);
  });
});
