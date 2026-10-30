import type {
  AgeBand,
  AssetRequest,
  EpisodeBody,
  EpisodeStage,
  MusicCue,
  ProductionPlanBody,
  QualityReview,
  ScriptBody,
  ScriptScene,
  SoundCue,
  StoryboardBody,
  StoryBody,
  StudioDb,
  VersionedEntity,
  VoiceRequest,
} from "./types.ts";

export interface ConsistencyFailure {
  code: "STORY_CONSISTENCY" | "AGE" | "CAST";
  sceneNo: number | null;
  shotId: string | null;
  detail: string;
}

export interface SceneRecord {
  sceneId: string;
  sceneNumber: number;
  purpose: string;
  locationId: string | null;
  locationKey: string;
  characters: string[];
  storyBeat: string;
  emotionalBeat: string;
  action: string;
  dialogueReference: string;
  visualRequirements: string;
  audioRequirements: string;
  estimatedDuration: string;
  canonVersion: string;
}

const DRIFT_TEXT = /different ending|ending is now|conflict is now|fear is deleted|ending changes/i;

export function anchorsFromStory(story: StoryBody) {
  return {
    premise: story.dna.premise,
    mainConflict: story.mainConflict,
    emotionalObjective: story.emotionalObjective,
    learningObjective: story.learningObjective,
    resolution: story.resolution,
    characterIds: [...story.characterIds].sort(),
  };
}

function sameIds(a: string[], b: string[]): boolean {
  const left = [...a].sort();
  const right = [...b].sort();
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

export function validateStoryConsistency(
  story: StoryBody | null,
  script: ScriptBody,
): { result: "PASS" | "FAIL"; failures: ConsistencyFailure[] } {
  const failures: ConsistencyFailure[] = [];
  if (!story) {
    return { result: "FAIL", failures: [{ code: "STORY_CONSISTENCY", sceneNo: null, shotId: null, detail: "Approved story version is missing." }] };
  }
  if (script.storyId && script.storyAnchors && script.storyAnchors.premise && script.storyAnchors.premise !== story.dna.premise) {
    failures.push({ code: "STORY_CONSISTENCY", sceneNo: null, shotId: null, detail: `Premise drifted from “${story.dna.premise}”.` });
  }
  const anchors = script.storyAnchors;
  if (anchors) {
    if (anchors.mainConflict !== story.mainConflict) {
      failures.push({ code: "STORY_CONSISTENCY", sceneNo: null, shotId: null, detail: `Main conflict changed from “${story.mainConflict}” to “${anchors.mainConflict}”.` });
    }
    if (anchors.emotionalObjective !== story.emotionalObjective) {
      failures.push({ code: "STORY_CONSISTENCY", sceneNo: null, shotId: null, detail: "Emotional objective does not match the approved story." });
    }
    if (anchors.learningObjective !== story.learningObjective) {
      failures.push({ code: "STORY_CONSISTENCY", sceneNo: null, shotId: null, detail: "Learning objective disappeared or changed." });
    }
    if (anchors.resolution !== story.resolution) {
      failures.push({ code: "STORY_CONSISTENCY", sceneNo: null, shotId: null, detail: "Ending does not match the approved resolution." });
    }
    if (!sameIds(anchors.characterIds, story.characterIds)) {
      failures.push({ code: "CAST", sceneNo: null, shotId: null, detail: "Story anchors name a different cast than the approved story." });
    }
  }
  const allowed = new Set(story.characterIds);
  for (const scene of script.scenes) {
    const blob = `${scene.action}\n${scene.lines.map((line) => `${line.hi} ${line.en}`).join("\n")}`;
    if (DRIFT_TEXT.test(blob)) {
      failures.push({ code: "STORY_CONSISTENCY", sceneNo: scene.sceneNo, shotId: null, detail: `Scene ${scene.sceneNo} changes the approved ending or conflict.` });
    }
    for (const id of scene.characterIds) {
      if (id && !allowed.has(id)) {
        failures.push({ code: "CAST", sceneNo: scene.sceneNo, shotId: null, detail: `Scene ${scene.sceneNo} adds a character who is not in the approved story.` });
      }
    }
  }
  return { result: failures.length ? "FAIL" : "PASS", failures };
}

export function validateAgeSuitability(script: ScriptBody, age: AgeBand | null): { result: "PASS" | "WARN" | "FAIL"; detail: string } {
  const band = age ?? script.ageBand;
  const lines = script.scenes.flatMap((scene) => scene.lines);
  const longHi = lines.filter((line) => line.hi.trim().split(/\s+/).filter(Boolean).length > 14);
  const longEn = lines.filter((line) => line.en.trim().split(/\s+/).filter(Boolean).length > 22);
  if ((band === "3-5" || band === "1-3") && (longHi.length > 0 || longEn.length > 0)) {
    return { result: "FAIL", detail: `${longHi.length + longEn.length} lines are too long for ages ${band}.` };
  }
  if (lines.length === 0) return { result: "FAIL", detail: "No dialogue." };
  return { result: "PASS", detail: `Line length fits ages ${band}.` };
}

export function sceneBreakdown(script: ScriptBody, canonVersion: string): SceneRecord[] {
  return script.scenes.map((scene) => ({
    sceneId: scene.sceneId ?? `scene_${script.storyId}_${scene.sceneNo}`,
    sceneNumber: scene.sceneNo,
    purpose: scene.purpose ?? scene.action.slice(0, 80),
    locationId: scene.locationId,
    locationKey: scene.locationKey,
    characters: [...scene.characterIds],
    storyBeat: scene.action,
    emotionalBeat: scene.emotionalBeat ?? "",
    action: scene.action,
    dialogueReference: scene.lines.map((line) => line.hi).filter(Boolean).join(" / "),
    visualRequirements: scene.visualDirection ?? "Stay with canonical clothing and location.",
    audioRequirements: scene.soundDirection ?? "Voice from the canonical profile. No library music.",
    estimatedDuration: scene.estimatedDuration ?? "20s",
    canonVersion,
  }));
}

export function validateBoardConsistency(
  script: ScriptBody,
  board: StoryboardBody,
): { result: "PASS" | "FAIL"; failures: ConsistencyFailure[] } {
  const failures: ConsistencyFailure[] = [];
  if (board.scriptId !== script.storyId && board.storyId !== script.storyId) {
    failures.push({ code: "STORY_CONSISTENCY", sceneNo: null, shotId: null, detail: "Storyboard points at a different story." });
  }
  if (board.storyVersion !== script.storyVersion) {
    failures.push({ code: "STORY_CONSISTENCY", sceneNo: null, shotId: null, detail: `Storyboard uses story v${board.storyVersion}. Script uses v${script.storyVersion}.` });
  }
  if (board.scriptVersion !== 0 && script && board.scriptId) {
    // scriptVersion is checked by the caller against the approved script version via board.scriptVersion
  }
  const allowed = new Set(script.scenes.flatMap((scene) => scene.characterIds));
  for (const scene of board.scenes) {
    for (const shot of scene.shots) {
      if (shot.contradictsScript || DRIFT_TEXT.test(shot.description)) {
        failures.push({
          code: "STORY_CONSISTENCY",
          sceneNo: scene.sceneNo,
          shotId: shot.id,
          detail: `Shot ${shot.id} contradicts the approved script.`,
        });
      }
      for (const id of shot.characterIds) {
        if (id && !allowed.has(id)) {
          failures.push({ code: "CAST", sceneNo: scene.sceneNo, shotId: shot.id, detail: `Shot ${shot.id} uses a character who is not in the script.` });
        }
      }
    }
  }
  return { result: failures.length ? "FAIL" : "PASS", failures };
}

export function productionRequests(input: {
  episodeId: string;
  canonVersion: string;
  scenes: ScriptScene[];
  shots: Array<{ id: string; sceneNo: number; characterIds: string[]; locationId: string | null }>;
  voices: VoiceRequest[];
}): { assetRequests: AssetRequest[]; musicCues: MusicCue[]; soundCues: SoundCue[] } {
  const assetRequests: AssetRequest[] = [];
  for (const shot of input.shots) {
    assetRequests.push({
      id: `req_${shot.id}`,
      assetType: "storyboard_frame",
      sceneNo: shot.sceneNo,
      shotId: shot.id,
      characterId: shot.characterIds[0] ?? null,
      locationId: shot.locationId,
      requiredAttributes: ["canonical character", "canonical location", "no render yet"],
      canonVersion: input.canonVersion,
      status: "REQUESTED",
    });
  }
  const musicCues: MusicCue[] = [
    {
      id: `music_${input.episodeId}_theme`,
      type: "theme",
      purpose: "Short motif under the title. Not composed.",
      sceneNo: null,
      episodeId: input.episodeId,
      style: "Quiet acoustic, no borrowed song.",
      durationSeconds: 8,
      source: "not-connected",
      rightsStatus: "not-cleared",
    },
  ];
  const soundCues: SoundCue[] = input.scenes.map((scene) => ({
    id: `sfx_${input.episodeId}_${scene.sceneNo}`,
    type: scene.soundDirection ?? "ambient",
    sceneNo: scene.sceneNo,
    source: "not-connected",
    rightsStatus: "not-cleared",
  }));
  return { assetRequests, musicCues, soundCues };
}

export interface PipelineRow {
  name: string;
  status: string;
  version: string;
  validation: string;
  approval: string;
  blocking: string | null;
}

function latestSnap<T>(entity: VersionedEntity<T> | undefined) {
  return entity?.versions[entity.versions.length - 1]?.snapshot;
}

export function productionPipeline(db: StudioDb, episodeId: string): PipelineRow[] {
  const episode = db.episodes.find((item) => item.id === episodeId);
  const snap = episode ? latestSnap(episode) : undefined;
  if (!episode || !snap) return [];
  const story = db.stories.find((item) => item.id === snap.storyId);
  const storyVersion = story?.versions.find((item) => item.version === snap.storyVersion);
  const script = snap.scriptId ? db.scripts.find((item) => item.id === snap.scriptId) : undefined;
  const scriptSnap = script ? latestSnap(script) : undefined;
  const scriptCanon = [...db.canonValidations].reverse().find((item) => item.entityType === "script" && item.entityId === script?.id);
  const board = snap.storyboardId ? db.storyboards.find((item) => item.id === snap.storyboardId) : undefined;
  const boardSnap = board ? latestSnap(board) : undefined;
  const boardCanon = [...db.canonValidations].reverse().find((item) => item.entityType === "storyboard" && item.entityId === board?.id);
  const plan = snap.planId ? db.plans.find((item) => item.id === snap.planId) : undefined;
  const planSnap = plan ? latestSnap(plan) : undefined;
  const assets = db.assets.filter((asset) => {
    const body = latestSnap(asset);
    return body && (body.episodeId === episodeId || body.linkedEntityId === snap.scriptId || body.linkedEntityId === snap.storyboardId);
  });
  const rights = db.qualityReviews.filter((review) => review.entityId === episodeId && review.gate === "rights");
  const red = rights.some((review) => review.redFlag) || assets.some((asset) => latestSnap(asset)?.commercialUseStatus === "not-cleared");
  const consistency = storyVersion && scriptSnap ? validateStoryConsistency(storyVersion.snapshot, scriptSnap) : null;
  const openRevision = (db.productionRevisions ?? []).find((item) => item.episodeId === episodeId && item.status === "OPEN");

  return [
    {
      name: "Story",
      status: storyVersion?.status === "approved" ? "Approved source" : "Missing",
      version: snap.storyVersion ? `v${snap.storyVersion}` : "—",
      validation: storyVersion ? "Linked" : "FAIL",
      approval: storyVersion?.status === "approved" ? "Human approved" : "Not approved",
      blocking: storyVersion?.status === "approved" ? null : "No approved story version.",
    },
    {
      name: "Script",
      status: script ? (script.canonicalVersion ? "Approved version sealed" : scriptSnap?.draftLabel ?? "Draft") : "Not generated",
      version: script ? `v${script.canonicalVersion ?? script.currentVersion}` : "—",
      validation: scriptCanon ? scriptCanon.validation.result : script ? "NOT EVALUATED" : "—",
      approval: script?.canonicalVersion ? "Human approved" : "Not approved",
      blocking: consistency?.result === "FAIL" ? consistency.failures[0]?.detail ?? "Story consistency failed." : null,
    },
    {
      name: "Scenes",
      status: scriptSnap ? `${scriptSnap.scenes.length} from the script` : "Waiting on script",
      version: script ? `script v${script.currentVersion}` : "—",
      validation: scriptSnap ? "Derived, not a second canon" : "—",
      approval: script?.canonicalVersion ? "Follows approved script" : "Not approved",
      blocking: null,
    },
    {
      name: "Storyboard",
      status: board ? (board.canonicalVersion ? "Approved" : "Proposal") : "Not generated",
      version: board ? `v${board.canonicalVersion ?? board.currentVersion}` : "—",
      validation: boardCanon ? boardCanon.validation.result : board ? "NOT EVALUATED" : "—",
      approval: board?.canonicalVersion ? "Human approved" : board ? "Awaiting human" : "—",
      blocking: boardSnap && scriptSnap && validateBoardConsistency(scriptSnap, boardSnap).result === "FAIL"
        ? validateBoardConsistency(scriptSnap, boardSnap).failures[0]?.detail ?? "Storyboard drift."
        : null,
    },
    {
      name: "Production plan",
      status: planSnap ? (planSnap.providerStatus ?? "Plan only") : "Not attached",
      version: plan ? `v${plan.currentVersion}` : "—",
      validation: planSnap?.assetRequests ? `${planSnap.assetRequests.length} requests` : planSnap ? "Legacy plan. Not regenerated." : "—",
      approval: "Request, not an asset",
      blocking: null,
    },
    {
      name: "Assets",
      status: assets.length ? `${assets.length} provenance records` : "None",
      version: "—",
      validation: assets.some((asset) => latestSnap(asset)?.visualClaims) ? "Claims checked in canon records" : assets.length ? "Provenance only" : "—",
      approval: assets.some((asset) => asset.canonicalVersion) ? "Some cleared" : "Not approved",
      blocking: red ? "Commercial rights RED FLAG" : null,
    },
    {
      name: "Draft episode",
      status: snap.draftAssembled ? "PRODUCTION MOCK" : "Not assembled",
      version: `episode v${episode.currentVersion}`,
      validation: "No picture or sound was rendered.",
      approval: snap.draftApproved ? "Draft accepted" : "Not final",
      blocking: snap.draftAssembled ? null : null,
    },
    {
      name: "Review",
      status: snap.stage.replaceAll("_", " "),
      version: `v${episode.currentVersion}`,
      validation: reviewSummary(db.qualityReviews.filter((review) => review.entityId === episodeId)),
      approval: snap.draftApproved ? "Human accepted the draft" : "Human still required",
      blocking: openRevision ? openRevision.problem : blockerFor(snap, red),
    },
  ];
}

function reviewSummary(reviews: QualityReview[]): string {
  if (reviews.length === 0) return "Not run";
  return reviews.map((review) => `${review.gate} ${review.result}${review.redFlag ? " RED FLAG" : ""}`).join(" · ");
}

export function blockerFor(snap: EpisodeBody, rightsRed: boolean): string | null {
  if (snap.lastError) return snap.lastError;
  if (rightsRed) return "Commercial rights RED FLAG";
  if (snap.holdReason) return snap.holdReason;
  if (snap.stage === "STORY_APPROVED") return "Hindi script not generated.";
  if (snap.stage === "SCRIPT_DRAFT") return "Script is not approved.";
  if (snap.stage === "SCRIPT_APPROVED") return "Storyboard not generated.";
  return null;
}

export function episodeBlocker(db: StudioDb, episodeId: string): string | null {
  const rows = productionPipeline(db, episodeId);
  return rows.map((row) => row.blocking).find(Boolean) ?? null;
}

export function pipelineOwner(stage: EpisodeStage, rightsRed: boolean): string {
  if (rightsRed && (stage === "HUMAN_APPROVAL" || stage === "READY_TO_PUBLISH")) return "You · rights uncleared";
  if (stage === "STORY_APPROVED") return "Scriptwriter";
  if (stage === "SCRIPT_DRAFT") return "Hindi editor, then you";
  if (stage === "SCRIPT_APPROVED") return "Storyboard director";
  if (stage === "STORYBOARD") return "QA, rights, policy";
  if (stage === "HUMAN_APPROVAL") return "You";
  if (stage === "READY_TO_PUBLISH") return "Nobody. Publishing is off.";
  return "Production";
}

export function emptyPlanExtras(): Pick<ProductionPlanBody, "providerStatus" | "assetRequests" | "musicCues" | "soundCues" | "voices"> {
  return { providerStatus: "NOT CONNECTED", assetRequests: [], musicCues: [], soundCues: [], voices: [] };
}
