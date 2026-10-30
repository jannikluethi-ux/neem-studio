import { EPISODE_STAGES, type EpisodeStage } from "./types.ts";

/** Legal hops. Stages not in the MVP slice exist so later stages do not require a rewrite. */
export const TRANSITIONS: Record<EpisodeStage, EpisodeStage[]> = {
  IDEA: ["CONCEPT_REVIEW"],
  CONCEPT_REVIEW: ["STORY_APPROVED", "IDEA"],
  STORY_APPROVED: ["SCRIPT_DRAFT"],
  SCRIPT_DRAFT: ["SCRIPT_APPROVED", "CONCEPT_REVIEW"],
  SCRIPT_APPROVED: ["STORYBOARD"],
  STORYBOARD: ["QUALITY_QA"],
  VISUAL_PRODUCTION: ["ANIMATION"],
  ANIMATION: ["VOICE"],
  VOICE: ["AUDIO_MIX"],
  AUDIO_MIX: ["EDIT"],
  EDIT: ["QUALITY_QA"],
  QUALITY_QA: ["IP_RIGHTS_QA", "STORYBOARD"],
  IP_RIGHTS_QA: ["POLICY_QA", "STORYBOARD"],
  POLICY_QA: ["HUMAN_APPROVAL", "STORYBOARD"],
  HUMAN_APPROVAL: ["READY_TO_PUBLISH", "SCRIPT_DRAFT"],
  READY_TO_PUBLISH: [],
  PUBLISHED: ["PERFORMANCE_REVIEW"],
  PERFORMANCE_REVIEW: [],
};

export function canTransition(from: EpisodeStage, to: EpisodeStage): boolean {
  return TRANSITIONS[from].includes(to);
}

export function stageIndex(stage: EpisodeStage): number {
  return EPISODE_STAGES.indexOf(stage);
}

/** Stages this build actually drives. The rest stay in the machine, unused. */
export const MVP_STAGES: EpisodeStage[] = [
  "STORY_APPROVED",
  "SCRIPT_DRAFT",
  "SCRIPT_APPROVED",
  "STORYBOARD",
  "QUALITY_QA",
  "IP_RIGHTS_QA",
  "POLICY_QA",
  "HUMAN_APPROVAL",
  "READY_TO_PUBLISH",
];
