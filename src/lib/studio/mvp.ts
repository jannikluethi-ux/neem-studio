import { memoryObjectStore, requestGeneration } from "./architecture.ts";
import { activeCanonVersion } from "./canon.ts";
import {
  allocId,
  approveEpisodeDraft,
  approveScript,
  approveStory,
  clearCommercialRights,
  generateScript,
  generateStoryboard,
  generateStoryCandidates,
  latestSnapshot,
  openEpisode,
  publishEpisode,
  reviewCulture,
  reviewHindi,
} from "./engine.ts";
import { advanceToHumanApproval, previewRelease, runReleaseGate } from "./release.ts";
import { recordHumanApproval } from "./source.ts";
import type { Actor, ArtifactPin, EpisodeStage, Op, ProductionPlanBody, ProvenanceRecord, RightsRecord, StudioDb } from "./types.ts";

export type BuildStatus = "IMPLEMENTED" | "PARTIALLY IMPLEMENTED" | "STUBBED" | "NOT IMPLEMENTED";

export interface BuildPhase {
  id: string;
  name: string;
  status: BuildStatus;
  note: string;
}

export const MVP_PHASES: BuildPhase[] = [
  { id: "foundation", name: "Application foundation", status: "PARTIALLY IMPLEMENTED", note: "The studio shell, audit log, feature flags, and role checks are in place. Managed sign-in is not turned on. Postgres is the hosted document store. This device still keeps the record you edit." },
  { id: "source", name: "Versioned source of truth", status: "IMPLEMENTED", note: "Stable ids, versions, rights, approvals, and audit. Approved history is not overwritten." },
  { id: "canon", name: "Canon", status: "IMPLEMENTED", note: "Gulmohar Gali, ages 3–5, Meethi, Golu, and Dadi Kamla. Hard and soft canon. A change does not rewrite old episodes." },
  { id: "story", name: "Story intelligence", status: "IMPLEMENTED", note: "Separate originality and similarity. Internal bar 75. An agent cannot approve a story or lower the bar." },
  { id: "workflow", name: "Episode workflow", status: "IMPLEMENTED", note: "Server-side stages through ready to publish. Published stays unreachable." },
  { id: "agents", name: "Agent orchestration", status: "PARTIALLY IMPLEMENTED", note: "Story, script, Hindi, culture, storyboard, QA, rights, and policy run. Voice, music, analytics, and executive agents are not implemented. The creative director stays inactive." },
  { id: "gateway", name: "AI gateway", status: "PARTIALLY IMPLEMENTED", note: "Text can use the live model through the gateway. The development adapter still stands in for tests and for a swap. Image, video, voice, and music stay disconnected. Cost is unknown unless the provider reports it." },
  { id: "assets", name: "Assets, provenance, rights", status: "PARTIALLY IMPLEMENTED", note: "Metadata, hashes, and new versions are stored. File bytes are not in the studio record. No bucket is connected. Unknown rights are not cleared." },
  { id: "qa", name: "Quality, rights, and policy", status: "IMPLEMENTED", note: "Independent checks. A later version makes the old QA outdated. QA does not rewrite the artifact." },
  { id: "approval", name: "Human approval", status: "IMPLEMENTED", note: "Approval names exact versions. It is not inferred from a QA pass." },
  { id: "brain", name: "Studio brain", status: "IMPLEMENTED", note: "Recommendations only. It cannot approve, clear rights, or publish." },
  { id: "analytics", name: "Analytics", status: "IMPLEMENTED", note: "Evidence only. Unpublished episodes stay unknown, not zero. No warehouse." },
  { id: "ui", name: "Studio interface", status: "PARTIALLY IMPLEMENTED", note: "Dashboard, canon, production, agents, brain, analytics, and settings are usable. Localization is Hindi first. Rights and compliance are gates, not separate products." },
];

export const MVP_NON_GOALS = [
  "YouTube publishing",
  "Automatic channel creation",
  "Autonomous publishing",
  "Other countries or languages as production",
  "Video generation at scale",
  "A rendering farm",
  "A data warehouse",
  "Kubernetes or multi-region hosting",
  "Billing, marketplace, merch, or games",
  "An autonomous studio",
] as const;

const NOTE = "Human editorial note for this version. Not an agent approval.";

function fail<T>(db: StudioDb, code: string, error: string): Op<T> {
  return { ok: false, db, code, error };
}

function stamp(now?: string): string {
  return now ?? new Date().toISOString();
}

export interface SliceReport {
  storyId: string;
  episodeId: string;
  title: string;
  stage: EpisodeStage;
  storyVersion: number;
  canonHash: string;
  scriptId: string;
  scriptVersion: number;
  storyboardId: string;
  planId: string;
  planVersion: number;
  sceneCount: number;
  shotCount: number;
  assetIds: string[];
  approvalId: string;
  published: false;
}

function thunderStage(db: StudioDb): string | null {
  const episode = db.episodes.find((item) => latestSnapshot(item).snapshot.title === "Count the Thunder");
  return episode ? latestSnapshot(episode).snapshot.stage : null;
}

export function clearPlanRights(db: StudioDb, planId: string, actor: Actor, note: string, now?: string): Op<{ version: number }> {
  const at = stamp(now);
  if (actor.type !== "human") return fail(db, "permission", "An agent cannot clear music, sound, or voice rights.");
  if (note.trim().length < 12) return fail(db, "note", "Rights clearance needs a written reason.");
  const plan = db.plans.find((item) => item.id === planId);
  if (!plan) return fail(db, "missing", "Production plan not found.");
  const current = latestSnapshot(plan);
  const before = JSON.stringify(current.snapshot);
  const snapshot: ProductionPlanBody = structuredClone(current.snapshot);
  snapshot.musicStatus = "Original motif composed for this episode. Human cleared.";
  snapshot.musicCues = (snapshot.musicCues ?? []).map((cue) => ({ ...cue, rightsStatus: "cleared" as const }));
  snapshot.soundCues = (snapshot.soundCues ?? []).map((cue) => ({ ...cue, rightsStatus: "cleared" as const }));
  snapshot.voices = (snapshot.voices ?? []).map((voice) => ({ ...voice, commercialRights: "cleared" as const }));
  if (JSON.stringify(current.snapshot) !== before) return fail(db, "history", "The previous plan version would have been rewritten. Stopped.");
  const version = plan.currentVersion + 1;
  const entity = {
    ...plan,
    currentVersion: version,
    updatedAt: at,
    versions: [
      ...plan.versions,
      { version, status: "approved" as const, snapshot, createdAt: at, createdBy: actor.id, note: note.trim(), immutable: true },
    ],
  };
  const kept = entity.versions.find((item) => item.version === current.version);
  if (!kept || JSON.stringify(kept.snapshot) !== before) return fail(db, "history", "The previous plan version would have been rewritten. Stopped.");
  return { ok: true, db: { ...db, plans: db.plans.map((item) => (item.id === planId ? entity : item)) }, data: { version } };
}

function provenanceFor(db: StudioDb, assetId: string, actor: Actor, at: string): StudioDb {
  const asset = db.assets.find((item) => item.id === assetId);
  if (!asset) return db;
  const body = latestSnapshot(asset).snapshot;
  const ided = allocId(db, "prov");
  const row: ProvenanceRecord = {
    id: ided.id,
    at,
    assetId,
    assetVersion: asset.currentVersion,
    source: body.source,
    creator: body.creator,
    tool: body.provider,
    model: body.model,
    promptReference: body.prompt,
    sourceLicense: body.licenseStatus,
    modificationHistory: [...body.modificationHistory],
    notes: "Recorded when a human cleared commercial use. The file bytes are not in this row.",
  };
  const rightsId = allocId(ided.db, "rght");
  const rights: RightsRecord = {
    id: rightsId.id,
    at,
    subjectType: "asset",
    subjectId: assetId,
    assetId,
    assetVersion: asset.currentVersion,
    licenseType: body.licenseStatus,
    commercialUse: "CLEARED",
    territory: "IN",
    restrictions: "Development clearance for this episode only. Not a publish grant.",
    evidenceReference: actor.id,
    status: "CLEARED",
    reviewedBy: actor.id,
    reviewedAt: at,
    notes: body.rightsNotes,
  };
  return { ...rightsId.db, provenanceRecords: [...(rightsId.db.provenanceRecords ?? []), row], rightsRecords: [...(rightsId.db.rightsRecords ?? []), rights] };
}

export function clearEpisodeRights(db: StudioDb, episodeId: string, actor: Actor, note: string, now?: string): Op<{ planVersion: number }> {
  const at = stamp(now);
  if (actor.type !== "human") return fail(db, "permission", "An agent cannot clear rights.");
  const episode = db.episodes.find((item) => item.id === episodeId);
  if (!episode) return fail(db, "missing", "Episode not found.");
  if (latestSnapshot(episode).snapshot.title === "Count the Thunder") return fail(db, "rights", "Count the Thunder keeps its commercial-rights red flag.");
  const snap = latestSnapshot(episode).snapshot;
  let next = db;
  const linked = next.assets.filter((asset) => {
    const body = latestSnapshot(asset).snapshot;
    return body.linkedEntityId === snap.scriptId || body.linkedEntityId === snap.storyboardId || body.episodeId === episodeId;
  });
  for (const asset of linked) {
    if (latestSnapshot(asset).snapshot.commercialUseStatus === "cleared") continue;
    const cleared = clearCommercialRights(next, asset.id, actor, note, at);
    if (!cleared.ok) return cleared;
    next = provenanceFor(cleared.db, asset.id, actor, at);
  }
  if (!snap.planId) return fail(next, "plan", "No production plan to clear.");
  const planned = clearPlanRights(next, snap.planId, actor, note, at);
  if (!planned.ok) return planned;
  return { ok: true, db: planned.db, data: { planVersion: planned.data.version } };
}

export function approvalMatchesCurrent(db: StudioDb, approvalId: string): { ok: boolean; reason: string } {
  const approval = (db.humanApprovals ?? []).find((item) => item.id === approvalId);
  if (!approval) return { ok: false, reason: "No human approval." };
  for (const pin of approval.approvedArtifactVersions) {
    if (pin.type === "story") {
      const story = db.stories.find((item) => item.id === pin.id);
      if (!story || story.currentVersion !== pin.version) return { ok: false, reason: "The story moved on. This approval does not cover the new version." };
    }
    if (pin.type === "script") {
      const script = db.scripts.find((item) => item.id === pin.id);
      if (!script || script.currentVersion !== pin.version) return { ok: false, reason: "The script moved on. This approval does not cover the new version." };
    }
    if (pin.type === "storyboard") {
      const board = db.storyboards.find((item) => item.id === pin.id);
      if (!board || board.currentVersion !== pin.version) return { ok: false, reason: "The storyboard moved on. This approval does not cover the new version." };
    }
    if (pin.type === "plan") {
      const plan = db.plans.find((item) => item.id === pin.id);
      if (!plan || plan.currentVersion !== pin.version) return { ok: false, reason: "The plan moved on. This approval does not cover the new version." };
    }
    if (pin.type === "canon") {
      const snap = db.canonSnapshots.find((item) => item.id === pin.id);
      const episode = approval.episodeId ? db.episodes.find((item) => item.id === approval.episodeId) : undefined;
      if (!snap || !episode || latestSnapshot(episode).snapshot.canonSnapshotHash !== snap.hash) {
        return { ok: false, reason: "The canon snapshot on the episode is not the one that was approved." };
      }
    }
  }
  return { ok: true, reason: "The approval still names the current versions." };
}

export function promoteToReady(db: StudioDb, episodeId: string, approvalId: string, actor: Actor, now?: string): Op<{ stage: EpisodeStage }> {
  if (actor.type !== "human") return fail(db, "permission", "An agent cannot move an episode to ready to publish.");
  const match = approvalMatchesCurrent(db, approvalId);
  if (!match.ok) return fail(db, "stale-approval", match.reason);
  const episode = db.episodes.find((item) => item.id === episodeId);
  if (!episode) return fail(db, "missing", "Episode not found.");
  if (latestSnapshot(episode).snapshot.stage !== "HUMAN_APPROVAL") return fail(db, "stage", "Ready to publish only follows human approval.");
  const live = previewRelease(db, episodeId);
  if (live.status !== "RELEASE_READY") {
    const why = live.blocking[0]?.what ?? live.status;
    return fail(db, "blocked", `Release is not ready. ${why}`);
  }
  const approved = approveEpisodeDraft(db, episodeId, actor, "Human approved these exact versions. Publishing stays disabled.", now);
  if (!approved.ok) return approved;
  if (approved.data.stage !== "READY_TO_PUBLISH") return fail(approved.db, "rights", approved.data.hold ?? "Rights still block ready to publish.");
  return approved;
}

export function runVerticalSlice(db: StudioDb, actor: Actor, now?: string): Op<SliceReport> {
  const at = stamp(now);
  if (actor.type !== "human") return fail(db, "permission", "A human runs the slice. Agents still cannot approve.");
  const beforeThunder = thunderStage(db);
  const drafted = generateStoryCandidates(db, 1, "agent_story_architect", at);
  if (!drafted.ok) return drafted;
  const storyId = drafted.data.ids[0];
  if (!storyId) return fail(drafted.db, "story", "No story was drafted.");
  const story = drafted.db.stories.find((item) => item.id === storyId);
  const body = story ? latestSnapshot(story).snapshot : null;
  if (!story || !body) return fail(drafted.db, "story", "The draft story is missing.");
  if (!body.canonSnapshotHash) return fail(drafted.db, "canon", "A story cannot proceed without a canon snapshot.");
  if (body.canonSnapshotHash !== activeCanonVersion(drafted.db).hash && body.recommendation.canonResult === "FAIL") {
    return fail(drafted.db, "canon", "A story cannot use a canon snapshot that fails the active canon.");
  }
  if (!body.originality.meetsThreshold || body.similarity.tooSimilar || body.recommendation.canonResult === "FAIL") {
    return fail(drafted.db, "story-intelligence", "Story intelligence held this draft. It is not approved.");
  }
  const approvedStory = approveStory(drafted.db, storyId, actor, NOTE, at);
  if (!approvedStory.ok) return approvedStory;
  const gateway = requestGeneration(approvedStory.db, memoryObjectStore(), {
    capability: "LLM",
    promptKey: "SCRIPTWRITER_CHILDREN",
    inputArtifactIds: [storyId],
    idempotencyKey: `slice-script:${storyId}`,
    taskId: "slice-script",
  }, actor, at);
  if (!gateway.ok) return gateway;
  const opened = openEpisode(gateway.db, storyId, actor, at);
  if (!opened.ok) return opened;
  const scripted = generateScript(opened.db, storyId, "agent_scriptwriter", at);
  if (!scripted.ok) return scripted;
  const hindi = reviewHindi(scripted.db, scripted.data.scriptId, "agent_hindi_editor", at);
  if (!hindi.ok) return hindi;
  if (hindi.data.review === "fail") return fail(hindi.db, "hindi", "Hindi review failed. The script was not approved.");
  const culture = reviewCulture(hindi.db, scripted.data.scriptId, "agent_cultural_reviewer", at);
  if (!culture.ok) return culture;
  if (culture.data.result === "FAIL") return fail(culture.db, "culture", "Cultural review failed. The script was not approved.");
  const approvedScript = approveScript(culture.db, scripted.data.scriptId, actor, NOTE, at);
  if (!approvedScript.ok) return approvedScript;
  const boarded = generateStoryboard(approvedScript.db, scripted.data.scriptId, "agent_storyboard_director", at);
  if (!boarded.ok) return boarded;
  const episodeId = opened.data.id;
  const cleared = clearEpisodeRights(boarded.db, episodeId, actor, "Human cleared commercial use for this development episode only.", at);
  if (!cleared.ok) return cleared;
  const recorded = runReleaseGate(cleared.db, episodeId, actor, at);
  if (!recorded.ok) return recorded;
  if (recorded.data.status !== "RELEASE_READY") return fail(recorded.db, "qa", `QA did not clear the episode. ${recorded.data.status}`);
  const advanced = advanceToHumanApproval(recorded.db, episodeId, actor, at);
  if (!advanced.ok) return advanced;
  const episode = advanced.db.episodes.find((item) => item.id === episodeId);
  const snap = episode ? latestSnapshot(episode).snapshot : null;
  const script = snap?.scriptId ? advanced.db.scripts.find((item) => item.id === snap.scriptId) : undefined;
  const board = snap?.storyboardId ? advanced.db.storyboards.find((item) => item.id === snap.storyboardId) : undefined;
  const plan = snap?.planId ? advanced.db.plans.find((item) => item.id === snap.planId) : undefined;
  const storyEntity = advanced.db.stories.find((item) => item.id === storyId);
  const canon = advanced.db.canonSnapshots.find((item) => item.hash === snap?.canonSnapshotHash);
  if (!snap || !script || !board || !plan || !storyEntity || !canon || storyEntity.canonicalVersion == null || script.canonicalVersion == null) {
    return fail(advanced.db, "chain", "The production chain is incomplete.");
  }
  const assets = advanced.db.assets.filter((asset) => {
    const item = latestSnapshot(asset).snapshot;
    return item.linkedEntityId === script.id || item.linkedEntityId === board.id;
  });
  const pins: ArtifactPin[] = [
    { type: "canon", id: canon.id, version: 1 },
    { type: "story", id: storyId, version: storyEntity.currentVersion },
    { type: "script", id: script.id, version: script.currentVersion },
    { type: "storyboard", id: board.id, version: board.currentVersion },
    { type: "plan", id: plan.id, version: plan.currentVersion },
    ...assets.map((asset) => ({ type: "asset", id: asset.id, version: asset.currentVersion })),
  ];
  const approval = recordHumanApproval(advanced.db, {
    episodeId,
    subjectType: "episode",
    subjectId: episodeId,
    pins,
    decision: "APPROVED",
    notes: "Approved these exact versions. Publishing stays off.",
  }, actor, at);
  if (!approval.ok) return approval;
  const ready = promoteToReady(approval.db, episodeId, approval.data.id, actor, at);
  if (!ready.ok) return ready;
  const blocked = publishEpisode(ready.db, episodeId, actor, at);
  if (blocked.ok) return fail(ready.db, "publish-disabled", "Publishing must stay disabled.");
  const after = blocked.db.episodes.find((item) => item.id === episodeId);
  const afterSnap = after ? latestSnapshot(after).snapshot : null;
  if (!afterSnap || afterSnap.stage !== "READY_TO_PUBLISH") return fail(blocked.db, "stage", "The episode did not stay ready to publish.");
  if (thunderStage(blocked.db) !== beforeThunder) return fail(db, "regression", "Count the Thunder changed. The slice was rejected.");
  const shots = latestSnapshot(board).snapshot.scenes.reduce((sum, scene) => sum + scene.shots.length, 0);
  return {
    ok: true,
    db: blocked.db,
    data: {
      storyId,
      episodeId,
      title: afterSnap.title,
      stage: afterSnap.stage,
      storyVersion: storyEntity.canonicalVersion,
      canonHash: snap.canonSnapshotHash ?? canon.hash,
      scriptId: script.id,
      scriptVersion: script.canonicalVersion,
      storyboardId: board.id,
      planId: plan.id,
      planVersion: plan.currentVersion,
      sceneCount: latestSnapshot(board).snapshot.scenes.length,
      shotCount: shots,
      assetIds: assets.map((asset) => asset.id),
      approvalId: approval.data.id,
      published: false,
    },
  };
}

export function sliceOnRecord(db: StudioDb): SliceReport | null {
  const episode = db.episodes.find((item) => latestSnapshot(item).snapshot.stage === "READY_TO_PUBLISH");
  if (!episode) return null;
  const snap = latestSnapshot(episode).snapshot;
  const story = db.stories.find((item) => item.id === snap.storyId);
  const script = snap.scriptId ? db.scripts.find((item) => item.id === snap.scriptId) : undefined;
  const board = snap.storyboardId ? db.storyboards.find((item) => item.id === snap.storyboardId) : undefined;
  const plan = snap.planId ? db.plans.find((item) => item.id === snap.planId) : undefined;
  const approval = (db.humanApprovals ?? []).find((item) => item.episodeId === episode.id && item.decision === "APPROVED");
  if (!story || !script || !board || !plan || !approval || story.canonicalVersion == null || script.canonicalVersion == null) return null;
  return {
    storyId: story.id,
    episodeId: episode.id,
    title: snap.title,
    stage: snap.stage,
    storyVersion: story.canonicalVersion,
    canonHash: snap.canonSnapshotHash ?? "",
    scriptId: script.id,
    scriptVersion: script.canonicalVersion,
    storyboardId: board.id,
    planId: plan.id,
    planVersion: plan.currentVersion,
    sceneCount: latestSnapshot(board).snapshot.scenes.length,
    shotCount: latestSnapshot(board).snapshot.scenes.reduce((sum, scene) => sum + scene.shots.length, 0),
    assetIds: db.assets.filter((asset) => {
      const body = latestSnapshot(asset).snapshot;
      return body.linkedEntityId === script.id || body.linkedEntityId === board.id;
    }).map((asset) => asset.id),
    approvalId: approval.id,
    published: false,
  };
}
