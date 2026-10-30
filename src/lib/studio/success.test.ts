import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  approveCharacter,
  approveEpisodeDraft,
  approveScript,
  approveStory,
  attemptOverwriteSnapshot,
  canonicalOf,
  createCharacter,
  createEmptyDb,
  createLocation,
  createStudio,
  evaluateCanonGate,
  generateScript,
  generateStoryboard,
  generateStoryCandidates,
  latestSnapshot,
  openEpisode,
  proposeSimilarVariant,
  publishEpisode,
  reviewHindi,
  reviseCharacter,
  reviseStoryNote,
  runQa,
  setAgeBand,
  snapshotOf,
} from "./engine.ts";
import type { Actor, CharacterBody, StoryboardBody } from "./types.ts";

const NOW = "2026-10-07T08:00:00.000Z";
const human: Actor = { type: "human", id: "human_asha", name: "Asha Menon" };
const architect: Actor = { type: "agent", id: "agent_story_architect", name: "Story Architect" };
const scriptwriter: Actor = { type: "agent", id: "agent_scriptwriter", name: "Scriptwriter" };

function meethi(): CharacterBody {
  return {
    name: "Meethi",
    nameHi: "मीठी",
    age: "5",
    species: "human",
    personality: "Notices small things. Rushes when excited.",
    strengths: ["attention", "kindness"],
    weaknesses: ["impatience"],
    likes: ["mango", "drawing"],
    dislikes: ["being hurried past something interesting"],
    fears: ["thunder"],
    relationshipNotes: ["Lives with her grandmother in the lane."],
    appearance: "Dark brown eyes, short hair, a red ribbon.",
    clothing: "mustard kurta and teal salwar",
    colorPalette: ["#E08A2C", "#1F6B4A", "#9C341F"],
    voiceProfile: {
      ageImpression: "five",
      pitch: "medium-high",
      tempo: "quicker when excited",
      energy: "bright",
      accent: "everyday Hindi",
      pronunciation: "Clear, not formal.",
      emotionalRange: "curious to quiet",
      provider: "unassigned",
      commercialRights: "not-cleared",
      voiceId: "voice_meethi_unassigned",
    },
    speechStyle: "Short sentences. One question at a time.",
    catchphrases: ["देखो ना!"],
    characterArc: "Learning to pause without losing curiosity.",
    storyFunction: "lead",
    visualRules: ["Red ribbon stays red.", "Eyes stay dark brown."],
    forbiddenVariations: ["cape", "princess dress", "magic wand"],
    developmentTokens: ["impatience", "thunder", "honesty", "sharing", "friendship", "curiosity", "consent"],
  };
}

function locations(db: ReturnType<typeof createEmptyDb>) {
  let cursor = db;
  const specs = [
    ["courtyard", "Courtyard", "आँगन"],
    ["veranda", "Veranda", "बरामदा"],
    ["kitchen", "Kitchen", "रसोई"],
    ["lane", "Lane", "गली"],
    ["bridge", "Footbridge", "पुल"],
  ] as const;
  for (const [key, name, nameHi] of specs) {
    const made = createLocation(
      cursor,
      { key, name, nameHi, description: `${name} in the lane.`, kind: "home" },
      human,
      NOW,
    );
    assert.equal(made.ok, true);
    cursor = made.db;
  }
  return cursor;
}

describe("children studio vertical slice", () => {
  it("keeps canon, rejects sameness, and walks story to storyboard with an audit trail", () => {
    let db = createEmptyDb();
    const studio = createStudio(db, { name: "Neem Studio", reviewerName: "Asha Menon" }, human, NOW);
    assert.equal(studio.ok, true);
    db = studio.db;

    const tooSoon = generateStoryCandidates(db, 10, architect.id, NOW);
    assert.equal(tooSoon.ok, false);
    if (!tooSoon.ok) assert.equal(tooSoon.code, "age");
    db = tooSoon.db;

    const aged = setAgeBand(db, "3-5", human, NOW);
    assert.equal(aged.ok, true);
    db = aged.db;
    db = locations(db);

    const proposed = createCharacter(db, meethi(), human, NOW);
    assert.equal(proposed.ok, true);
    if (!proposed.ok) return;
    db = proposed.db;
    const characterId = proposed.data.id;

    const agentEdit = reviseCharacter(db, characterId, meethi(), architect, NOW);
    assert.equal(agentEdit.ok, false);
    db = agentEdit.db;

    const character = db.characters.find((c) => c.id === characterId);
    assert.ok(character);
    const before = latestSnapshot(character).snapshot;
    const approvedChar = approveCharacter(db, characterId, human, "Canon lock: ribbon, eyes, no cape.", NOW);
    assert.equal(approvedChar.ok, true);
    db = approvedChar.db;
    const canon = snapshotOf(db.characters.find((c) => c.id === characterId) ?? null);
    assert.deepEqual(canon, before);
    assert.equal(canonicalOf(db.characters.find((c) => c.id === characterId))?.immutable, true);

    const selfApprove = approveStory(db, "missing", architect, "An agent must not approve this story at all.", NOW);
    assert.equal(selfApprove.ok, false);

    const generated = generateStoryCandidates(db, 10, architect.id, NOW);
    assert.equal(generated.ok, true);
    if (!generated.ok) return;
    db = generated.db;
    assert.equal(generated.data.ids.length, 10);

    const stories = generated.data.ids.map((id) => {
      const entity = db.stories.find((s) => s.id === id);
      assert.ok(entity);
      return latestSnapshot(entity).snapshot;
    });
    const premises = new Set(stories.map((s) => s.dna.premise));
    assert.equal(premises.size, 10);
    const conflicts = new Set(stories.map((s) => s.dna.conflict).filter(Boolean));
    assert.ok(conflicts.size >= 8);
    assert.deepEqual(snapshotOf(db.characters.find((c) => c.id === characterId) ?? null), canon);

    const low = stories.find((s) => !s.originality.meetsThreshold);
    assert.ok(low, "expected a below-threshold story");
    const lowEntity = db.stories.find((s) => latestSnapshot(s).snapshot.blueprintKey === "just-walks");
    assert.ok(lowEntity);
    const lowApprove = approveStory(
      db,
      lowEntity.id,
      human,
      "This walk has no conflict and should not be produced.",
      NOW,
    );
    assert.equal(lowApprove.ok, false);
    if (!lowApprove.ok) assert.match(lowApprove.error, /Originality|threshold/i);
    db = lowApprove.db;

    const good = db.stories.find((s) => {
      const snap = latestSnapshot(s).snapshot;
      return snap.originality.meetsThreshold && !snap.similarity.tooSimilar && !snap.thin;
    });
    assert.ok(good);

    const agentStoryOk = approveStory(
      db,
      good.id,
      architect,
      "The architect tries to approve the story it just shaped.",
      NOW,
    );
    assert.equal(agentStoryOk.ok, false);
    db = agentStoryOk.db;

    const originalLogline = latestSnapshot(db.stories.find((s) => s.id === good.id)!).snapshot.logline;
    const approvedStory = approveStory(
      db,
      good.id,
      human,
      "Editorial: keep the pause. Do not add a villain or a lesson speech.",
      NOW,
    );
    assert.equal(approvedStory.ok, true, approvedStory.ok ? "" : approvedStory.error);
    if (!approvedStory.ok) return;
    db = approvedStory.db;

    const twin = proposeSimilarVariant(db, good.id, architect.id, NOW);
    assert.equal(twin.ok, true);
    if (!twin.ok) return;
    db = twin.db;
    assert.equal(twin.data.story.similarity.tooSimilar, true);
    assert.ok(twin.data.story.similarity.score >= 55);
    const twinApprove = approveStory(
      db,
      twin.data.id,
      human,
      "Rejecting this because it repeats a story we already have.",
      NOW,
    );
    assert.equal(twinApprove.ok, false);
    if (!twinApprove.ok) assert.match(twinApprove.error, /similar/i);
    db = twinApprove.db;

    const sealed = canonicalOf(db.stories.find((s) => s.id === good.id));
    assert.ok(sealed);
    assert.equal(sealed.immutable, true);
    assert.equal(sealed.status, "approved");
    assert.equal(attemptOverwriteSnapshot(sealed.immutable).ok, false);

    const revised = reviseStoryNote(db, good.id, "REVISED LOG LINE XYZ", architect, NOW);
    assert.equal(revised.ok, true);
    db = revised.db;
    const still = canonicalOf(db.stories.find((s) => s.id === good.id));
    assert.equal(still?.snapshot.logline, originalLogline);
    assert.notEqual(latestSnapshot(db.stories.find((s) => s.id === good.id)!).snapshot.logline, originalLogline);

    const episode = openEpisode(db, good.id, human, NOW);
    assert.equal(episode.ok, true);
    if (!episode.ok) return;
    db = episode.db;

    const script = generateScript(db, good.id, scriptwriter.id, NOW);
    assert.equal(script.ok, true);
    if (!script.ok) return;
    db = script.db;
    const scriptEntity = db.scripts.find((s) => s.id === script.data.scriptId);
    assert.ok(scriptEntity);
    const scriptSnap = latestSnapshot(scriptEntity).snapshot;
    const blob = JSON.stringify(scriptSnap);
    assert.ok(blob.includes("mustard kurta and teal salwar"));
    assert.ok(blob.includes("देखो ना!"));
    assert.ok(scriptSnap.canonRefs.some((ref) => ref.includes(originalLogline)));
    assert.equal(scriptSnap.canonRefs.some((ref) => ref.includes("REVISED LOG LINE XYZ")), false);
    assert.equal(scriptSnap.language, "hi");
    assert.equal(scriptSnap.storyVersion, sealed.version);

    const earlyBoard = generateStoryboard(db, script.data.scriptId, "agent_storyboard_director", NOW);
    assert.equal(earlyBoard.ok, false);

    const hindi = reviewHindi(db, script.data.scriptId, "agent_hindi_editor", NOW);
    assert.equal(hindi.ok, true);
    if (!hindi.ok) return;
    db = hindi.db;
    assert.equal(hindi.data.review, "pass");

    const writerApproves = approveScript(db, script.data.scriptId, scriptwriter, "The writer must not approve this.", NOW);
    assert.equal(writerApproves.ok, false);
    db = writerApproves.db;

    const scriptOk = approveScript(db, script.data.scriptId, human, "Hindi is simple enough for the age band.", NOW);
    assert.equal(scriptOk.ok, true);
    db = scriptOk.db;

    const board = generateStoryboard(db, script.data.scriptId, "agent_storyboard_director", NOW);
    assert.equal(board.ok, true);
    if (!board.ok) return;
    db = board.db;
    const boardSnap = latestSnapshot(db.storyboards.find((s) => s.id === board.data.storyboardId)!).snapshot;
    const canonGate = evaluateCanonGate(db, boardSnap);
    assert.equal(canonGate.result, "PASS");

    const illegal: StoryboardBody = {
      ...boardSnap,
      scenes: [
        {
          ...boardSnap.scenes[0]!,
          shots: [
            {
              ...boardSnap.scenes[0]!.shots[0]!,
              characterIds: ["char_not_in_canon"],
              description: "A stranger in a cape enters.",
            },
          ],
        },
      ],
    };
    const broken = evaluateCanonGate(db, illegal);
    assert.equal(broken.result, "FAIL");

    const qa = runQa(db, episode.data.id, "agent_qa", NOW);
    assert.equal(qa.ok, true);
    if (!qa.ok) return;
    db = qa.db;
    assert.equal(qa.data.failed, false);
    assert.equal(qa.data.stage, "HUMAN_APPROVAL");

    const draft = approveEpisodeDraft(db, episode.data.id, human, "Draft accepted for internal review only.", NOW);
    assert.equal(draft.ok, true);
    if (!draft.ok) return;
    db = draft.db;
    assert.ok(draft.data.hold);
    const stage = latestSnapshot(db.episodes.find((e) => e.id === episode.data.id)!).snapshot.stage;
    assert.equal(stage, "HUMAN_APPROVAL");
    assert.notEqual(stage, "PUBLISHED");

    const published = publishEpisode(db, episode.data.id, human, NOW);
    assert.equal(published.ok, false);
    db = published.db;
    assert.equal(latestSnapshot(db.episodes.find((e) => e.id === episode.data.id)!).snapshot.stage, "HUMAN_APPROVAL");

    const actions = db.audit.map((event) => event.action);
    for (const action of [
      "character.approved",
      "story.approved",
      "script.generated",
      "storyboard.generated",
      "qa.completed",
      "episode.draft_approved",
      "publish.blocked",
      "permission.denied",
    ]) {
      assert.ok(actions.includes(action), action);
    }
    assert.ok(db.agentRuns.some((run) => run.agentId === "agent_story_architect" && run.status === "completed"));
    assert.ok(db.agentRuns.some((run) => run.agentId === "agent_scriptwriter"));
    assert.ok(db.agentRuns.some((run) => run.agentId === "agent_hindi_editor"));
    assert.ok(db.agentRuns.some((run) => run.agentId === "agent_storyboard_director"));
    assert.ok(db.agentRuns.some((run) => run.agentId === "agent_rights"));
    assert.ok(db.agentRuns.some((run) => run.agentId === "agent_policy"));
    assert.ok(db.qualityReviews.some((review) => review.gate === "rights" && review.redFlag));
    assert.ok(db.approvals.some((item) => item.entityType === "story" && item.decision === "approved"));
    const versions = db.stories.find((s) => s.id === good.id)?.versions.map((v) => v.version);
    assert.deepEqual(versions, [1, 2, 3]);
  });
});
