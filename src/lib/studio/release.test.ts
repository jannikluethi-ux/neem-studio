import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  approveScript,
  approveStory,
  canonicalOf,
  generateScript,
  generateStoryboard,
  latestSnapshot,
  openEpisode,
  proposeVisualAsset,
  publishEpisode,
  reviewHindi,
} from "./engine.ts";
import { advanceToHumanApproval, agentClearRedFlag, previewRelease, readRelease, runReleaseGate } from "./release.ts";
import { buildSeedDb } from "./seed.ts";
import type { Actor, AssetBody, StudioDb, VersionedEntity } from "./types.ts";

const human: Actor = { type: "human", id: "human_asha", name: "Asha Menon" };
const rightsAgent: Actor = { type: "agent", id: "agent_rights", name: "IP/Rights Agent" };
const NOW = "2026-10-07T12:00:00.000Z";
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
  };
}

function charactersOf(db: StudioDb) {
  return db.characters.map((character) => ({
    id: character.id,
    version: character.currentVersion,
    canonical: character.canonicalVersion,
    hair: canonicalOf(character)?.snapshot.hair ?? "",
    age: canonicalOf(character)?.snapshot.age ?? "",
  }));
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
  db = must(approveStory(db, story.id, human, NOTE, NOW));
  const opened = openEpisode(db, story.id, human, NOW);
  db = must(opened);
  if (!opened.ok) throw new Error("episode");
  const scripted = generateScript(db, story.id, "agent_scriptwriter", NOW);
  db = must(scripted);
  if (!scripted.ok) throw new Error("script");
  db = must(reviewHindi(db, scripted.data.scriptId, "agent_hindi_editor", NOW));
  db = must(approveScript(db, scripted.data.scriptId, human, NOTE, NOW));
  const boarded = generateStoryboard(db, scripted.data.scriptId, "agent_storyboard_director", NOW);
  db = must(boarded);
  return { db, episodeId: opened.data.id, scriptId: scripted.data.scriptId, storyId: story.id };
}

function check(db: StudioDb, episodeId: string, kind: string) {
  return previewRelease(db, episodeId).checks.find((item) => item.checkId === kind);
}

function pushAsset(db: StudioDb, body: AssetBody, id: string): StudioDb {
  const entity: VersionedEntity<AssetBody> = {
    id,
    type: "asset",
    name: body.assetType,
    currentVersion: 1,
    canonicalVersion: null,
    createdAt: NOW,
    updatedAt: NOW,
    versions: [{ version: 1, status: "in_review", snapshot: body, createdAt: NOW, createdBy: "human_asha", note: "Development fixture. Not a render.", immutable: true }],
  };
  return { ...db, assets: [...db.assets, entity] };
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

describe("quality, rights, and policy", () => {
  it("1: Count the Thunder stays blocked on its commercial-rights red flag and is not rewritten", () => {
    const seeded = buildSeedDb();
    const before = pack(seeded);
    const people = charactersOf(seeded);
    const episode = thunderEpisode(seeded);
    const recorded = runReleaseGate(seeded, episode.id, human, NOW);
    assert.equal(recorded.ok, true, recorded.ok ? "" : recorded.error);
    if (!recorded.ok) return;
    assert.deepEqual(pack(recorded.db), before);
    assert.deepEqual(charactersOf(recorded.db), people);
    assert.equal(before.red, true);
    const live = previewRelease(recorded.db, episode.id);
    assert.equal(check(recorded.db, episode.id, "canon")?.result, "PASS");
    assert.equal(check(recorded.db, episode.id, "story")?.result, "PASS");
    assert.equal(check(recorded.db, episode.id, "hindi")?.result, "PASS");
    assert.equal(check(recorded.db, episode.id, "culture")?.result, "PASS");
    assert.equal(check(recorded.db, episode.id, "asset")?.result, "PASS");
    assert.equal(check(recorded.db, episode.id, "rights")?.result, "RED_FLAG");
    assert.equal(check(recorded.db, episode.id, "policy")?.result, "PASS");
    assert.equal(check(recorded.db, episode.id, "production")?.result, "PASS");
    assert.equal(live.status, "RELEASE_BLOCKED");
    assert.match(live.blocking.map((item) => item.what).join(" "), /RIGHTS RED FLAG/);
    const saved = readRelease(recorded.db, episode.id);
    assert.ok(saved);
    assert.equal(saved?.stale, false);
    assert.equal(saved?.report.status, "RELEASE_BLOCKED");
    const published = publishEpisode(recorded.db, episode.id, human, NOW);
    assert.equal(published.ok, false);
    assert.equal(latestSnapshot(thunderEpisode(published.db)).snapshot.stage, "HUMAN_APPROVAL");
    assert.notEqual(latestSnapshot(thunderEpisode(published.db)).snapshot.stage, "PUBLISHED");
  });

  it("2: a Meethi hard-canon violation fails canon QA and leaves canon unchanged", () => {
    const made = produce(buildSeedDb());
    const before = charactersOf(made.db);
    const meethi = made.db.characters.find((item) => item.name === "Meethi");
    assert.ok(meethi);
    const visual = proposeVisualAsset(made.db, { characterId: meethi.id, claims: { hair: "blonde" } }, "agent_character_director", NOW);
    assert.equal(visual.ok, true, visual.ok ? "" : visual.error);
    if (!visual.ok) return;
    assert.equal(visual.data.result, "FAIL");
    const db = {
      ...visual.db,
      assets: visual.db.assets.map((asset) =>
        asset.id === visual.data.assetId
          ? {
              ...asset,
              versions: asset.versions.map((version, index) =>
                index === asset.versions.length - 1 ? { ...version, snapshot: { ...version.snapshot, episodeId: made.episodeId } } : version,
              ),
            }
          : asset,
      ),
    };
    const live = previewRelease(db, made.episodeId);
    assert.equal(check(db, made.episodeId, "canon")?.result, "FAIL");
    assert.match(live.checks.find((item) => item.checkId === "canon")?.findings.map((item) => item.what).join(" ") ?? "", /Meethi/);
    assert.equal(live.status, "RELEASE_BLOCKED");
    assert.deepEqual(charactersOf(db), before);
    assert.equal(canonicalOf(db.characters.find((item) => item.id === meethi.id)!)?.snapshot.hair, "Short black hair");
    const published = publishEpisode(db, made.episodeId, human, NOW);
    assert.equal(published.ok, false);
  });

  it("3: missing commercial-rights information is a rights red flag an agent cannot clear", () => {
    const made = produce(buildSeedDb());
    const episode = made.db.episodes.find((item) => item.id === made.episodeId);
    assert.ok(episode);
    const snap = latestSnapshot(episode).snapshot;
    const db = pushAsset(made.db, {
      assetType: "character_image",
      source: "development-provider",
      creator: "human_asha",
      model: "dev-template-v1",
      provider: "development",
      prompt: "Reference only. Not a render.",
      referenceAssets: [`script:${snap.scriptId}`],
      licenseStatus: "development-draft",
      commercialUseStatus: "not-cleared",
      rightsNotes: "",
      modificationHistory: [],
      linkedEntityType: "script",
      linkedEntityId: snap.scriptId ?? "",
      episodeId: made.episodeId,
      createdAt: NOW,
    }, "ast_rights_gap");
    const live = previewRelease(db, made.episodeId);
    assert.equal(check(db, made.episodeId, "rights")?.result, "RED_FLAG");
    assert.match(live.blocking.map((item) => item.what).join(" "), /ast_rights_gap/);
    assert.match(live.blocking.map((item) => item.why).join(" "), /UNKNOWN = NOT CLEARED|missing commercial-rights/i);
    assert.equal(live.status, "RELEASE_BLOCKED");
    const flags = db.qualityReviews.filter((review) => review.redFlag).length;
    const denied = agentClearRedFlag(db, made.episodeId, rightsAgent, NOW);
    assert.equal(denied.ok, false);
    assert.equal(denied.db.qualityReviews.filter((review) => review.redFlag).length, flags);
    assert.equal(latestSnapshot(denied.db.assets.find((item) => item.id === "ast_rights_gap")!).snapshot.commercialUseStatus, "not-cleared");
    assert.equal(previewRelease(denied.db, made.episodeId).status, "RELEASE_BLOCKED");
  });

  it("4: an asset without provenance is an asset red flag", () => {
    const made = produce(buildSeedDb());
    const episode = made.db.episodes.find((item) => item.id === made.episodeId);
    assert.ok(episode);
    const snap = latestSnapshot(episode).snapshot;
    const db = pushAsset(made.db, {
      assetType: "character_image",
      source: "",
      creator: "",
      model: "",
      provider: "",
      prompt: "",
      referenceAssets: [],
      licenseStatus: "",
      commercialUseStatus: "cleared",
      rightsNotes: "Human cleared for this development test.",
      modificationHistory: [],
      linkedEntityType: "script",
      linkedEntityId: snap.scriptId ?? "",
      episodeId: made.episodeId,
      createdAt: NOW,
    }, "ast_no_provenance");
    const live = previewRelease(db, made.episodeId);
    assert.equal(check(db, made.episodeId, "asset")?.result, "RED_FLAG");
    assert.match(live.checks.find((item) => item.checkId === "asset")?.findings.map((item) => item.what).join(" ") ?? "", /ast_no_provenance/);
    assert.equal(live.status, "RELEASE_BLOCKED");
    assert.ok(live.checks.find((item) => item.checkId === "rights"));
  });

  it("5: a bad Hindi development version fails Hindi QA and does not rewrite the approved script", () => {
    const made = produce(buildSeedDb());
    const script = made.db.scripts.find((item) => item.id === made.scriptId);
    assert.ok(script);
    const approved = canonicalOf(script)?.snapshot.scenes.map((scene) => scene.lines.map((line) => line.hi).join("|")).join("||");
    const latest = latestSnapshot(script);
    const version = script.currentVersion + 1;
    const db: StudioDb = {
      ...made.db,
      scripts: made.db.scripts.map((item) =>
        item.id === script.id
          ? {
              ...item,
              currentVersion: version,
              versions: [
                ...item.versions,
                {
                  ...latest,
                  version,
                  status: "in_review" as const,
                  note: "Bad Hindi development version. Approved script was not overwritten.",
                  snapshot: {
                    ...latest.snapshot,
                    languageReview: "fail" as const,
                    languageNotes: ["Machine translation artifact. Not approved."],
                    scenes: latest.snapshot.scenes.map((scene) => ({
                      ...scene,
                      lines: scene.lines.map((line) => ({ ...line, hi: "Hello this is a machine translation artifact" })),
                    })),
                  },
                },
              ],
            }
          : item,
      ),
    };
    const beforeCanon = canonicalOf(db.scripts.find((item) => item.id === script.id)!)?.snapshot;
    const recorded = runReleaseGate(db, made.episodeId, human, NOW);
    assert.equal(recorded.ok, true, recorded.ok ? "" : recorded.error);
    if (!recorded.ok) return;
    assert.equal(check(recorded.db, made.episodeId, "hindi")?.result, "FAIL");
    assert.equal(previewRelease(recorded.db, made.episodeId).status, "RELEASE_BLOCKED");
    const after = canonicalOf(recorded.db.scripts.find((item) => item.id === script.id)!);
    assert.equal(after?.snapshot.scenes.map((scene) => scene.lines.map((line) => line.hi).join("|")).join("||"), approved);
    assert.equal(after?.version, beforeCanon ? canonicalOf(script)?.version : -1);
    assert.equal(latestSnapshot(recorded.db.scripts.find((item) => item.id === script.id)!).snapshot.languageReview, "fail");
    assert.ok(recorded.db.releaseRepairs.some((item) => item.episodeId === made.episodeId && item.checkId === "hindi"));
  });

  it("6: a new story version makes the recorded QA outdated", () => {
    const made = produce(buildSeedDb());
    const recorded = runReleaseGate(made.db, made.episodeId, human, NOW);
    assert.equal(recorded.ok, true, recorded.ok ? "" : recorded.error);
    if (!recorded.ok) return;
    const story = recorded.db.stories.find((item) => item.id === made.storyId);
    assert.ok(story);
    const latest = latestSnapshot(story);
    const bumped: StudioDb = {
      ...recorded.db,
      stories: recorded.db.stories.map((item) =>
        item.id === story.id
          ? {
              ...item,
              currentVersion: item.currentVersion + 1,
              versions: [
                ...item.versions,
                { ...latest, version: item.currentVersion + 1, status: "draft" as const, note: "New story version. Previous QA is stale.", immutable: true },
              ],
            }
          : item,
      ),
    };
    const stageBefore = latestSnapshot(bumped.episodes.find((item) => item.id === made.episodeId)!).snapshot.stage;
    const view = readRelease(bumped, made.episodeId);
    assert.equal(view?.stale, true);
    assert.equal(view?.staleReason, "QA OUTDATED — STORY VERSION CHANGED");
    const advanced = advanceToHumanApproval(bumped, made.episodeId, human, NOW);
    assert.equal(advanced.ok, false);
    if (!advanced.ok) assert.match(advanced.error, /QA OUTDATED — STORY VERSION CHANGED/);
    assert.equal(latestSnapshot(advanced.db.episodes.find((item) => item.id === made.episodeId)!).snapshot.stage, stageBefore);
    assert.equal(canonicalOf(advanced.db.stories.find((item) => item.id === story.id)!)?.version, story.canonicalVersion);
  });

  it("7: canon and rights failures both stay visible", () => {
    const made = produce(buildSeedDb());
    const meethi = made.db.characters.find((item) => item.name === "Meethi");
    assert.ok(meethi);
    const visual = proposeVisualAsset(made.db, { characterId: meethi.id, claims: { hair: "blonde" } }, "agent_character_director", NOW);
    assert.equal(visual.ok, true, visual.ok ? "" : visual.error);
    if (!visual.ok) return;
    const linked = {
      ...visual.db,
      assets: visual.db.assets.map((asset) =>
        asset.id === visual.data.assetId
          ? {
              ...asset,
              versions: asset.versions.map((version, index) =>
                index === asset.versions.length - 1 ? { ...version, snapshot: { ...version.snapshot, episodeId: made.episodeId } } : version,
              ),
            }
          : asset,
      ),
    };
    const live = previewRelease(linked, made.episodeId);
    const canon = live.checks.find((item) => item.checkId === "canon");
    const rights = live.checks.find((item) => item.checkId === "rights");
    assert.equal(canon?.result, "FAIL");
    assert.equal(canon?.severity, "RED");
    assert.equal(rights?.result, "RED_FLAG");
    assert.equal(rights?.severity, "RED");
    assert.ok(live.blocking.some((item) => item.code === "CANON_FAIL"));
    assert.ok(live.blocking.some((item) => item.code === "RIGHTS_RED"));
    assert.equal(live.status, "RELEASE_BLOCKED");
  });

  it("8: a fully passing episode can move only to human approval", () => {
    const made = produce(buildSeedDb());
    const thunder = pack(made.db);
    const cleared = clearPackage(made.db, made.episodeId);
    const live = previewRelease(cleared, made.episodeId);
    const failed = live.checks.filter((item) => item.severity === "RED" || item.severity === "HUMAN_REVIEW");
    assert.deepEqual(
      failed.map((item) => `${item.checkId}:${item.result}`),
      [],
      failed.map((item) => `${item.label} ${item.findings[0]?.what ?? item.result}`).join(" | "),
    );
    const recorded = runReleaseGate(cleared, made.episodeId, human, NOW);
    assert.equal(recorded.ok, true, recorded.ok ? "" : recorded.error);
    if (!recorded.ok) return;
    assert.equal(recorded.data.status, "RELEASE_READY");
    const agentMove = advanceToHumanApproval(recorded.db, made.episodeId, rightsAgent, NOW);
    assert.equal(agentMove.ok, false);
    assert.equal(latestSnapshot(agentMove.db.episodes.find((item) => item.id === made.episodeId)!).snapshot.stage, "STORYBOARD");
    const moved = advanceToHumanApproval(recorded.db, made.episodeId, human, NOW);
    assert.equal(moved.ok, true, moved.ok ? "" : moved.error);
    if (!moved.ok) return;
    assert.equal(moved.data.stage, "HUMAN_APPROVAL");
    const published = publishEpisode(moved.db, made.episodeId, human, NOW);
    assert.equal(published.ok, false);
    assert.equal(latestSnapshot(published.db.episodes.find((item) => item.id === made.episodeId)!).snapshot.stage, "HUMAN_APPROVAL");
    assert.deepEqual(pack(published.db), thunder);
  });

  it("keeps child-safety uncertainty in human review instead of passing it", () => {
    const made = produce(buildSeedDb());
    const cleared = clearPackage(made.db, made.episodeId);
    const script = cleared.scripts.find((item) => item.id === made.scriptId);
    assert.ok(script);
    const latest = latestSnapshot(script);
    const db: StudioDb = {
      ...cleared,
      scripts: cleared.scripts.map((item) =>
        item.id === script.id
          ? {
              ...item,
              currentVersion: item.currentVersion + 1,
              versions: [
                ...item.versions,
                {
                  ...latest,
                  version: item.currentVersion + 1,
                  snapshot: {
                    ...latest.snapshot,
                    scenes: latest.snapshot.scenes.map((scene, index) =>
                      index === 0
                        ? { ...scene, action: `${scene.action} Safety is unclear for this beat.` }
                        : scene,
                    ),
                  },
                },
              ],
            }
          : item,
      ),
    };
    const live = previewRelease(db, made.episodeId);
    assert.equal(check(db, made.episodeId, "policy")?.result, "HUMAN_REVIEW");
    assert.equal(live.status, "HUMAN_REVIEW_REQUIRED");
    const recorded = runReleaseGate(db, made.episodeId, human, NOW);
    assert.equal(recorded.ok, true, recorded.ok ? "" : recorded.error);
    if (!recorded.ok) return;
    const advanced = advanceToHumanApproval(recorded.db, made.episodeId, human, NOW);
    assert.equal(advanced.ok, false);
    const published = publishEpisode(recorded.db, made.episodeId, human, NOW);
    assert.equal(published.ok, false);
  });
});
