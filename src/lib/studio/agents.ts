export type AgentAction =
  | "canon.read"
  | "stories.read"
  | "stories.create"
  | "stories.revise"
  | "dna.create"
  | "originality.calculate"
  | "script.create"
  | "script.revise"
  | "storyboard.create"
  | "production_plan.create"
  | "language.review"
  | "culture.review"
  | "qa.run"
  | "rights.review"
  | "policy.review"
  | "canon.write"
  | "canon.propose";

/** Enforced by the orchestrator. Approval and publish are never granted. */
export type OrchestrationPermission =
  | "READ_CANON"
  | "READ_STORY"
  | "READ_SCRIPT"
  | "READ_STORYBOARD"
  | "CREATE_STORY_PROPOSAL"
  | "CREATE_SCRIPT_DRAFT"
  | "CREATE_STORYBOARD_DRAFT"
  | "CREATE_PRODUCTION_PLAN"
  | "CREATE_ASSET_REQUEST"
  | "RUN_VALIDATION"
  | "CREATE_REVIEW"
  | "PROPOSE_CANON_CHANGE"
  | "PROPOSE_STORY_CHANGE"
  | "APPROVE_CANON"
  | "APPROVE_STORY"
  | "APPROVE_SCRIPT"
  | "APPROVE_STORYBOARD"
  | "APPROVE_EPISODE"
  | "PUBLISH";

export const FORBIDDEN_GRANTS: readonly OrchestrationPermission[] = [
  "APPROVE_CANON",
  "APPROVE_STORY",
  "APPROVE_SCRIPT",
  "APPROVE_STORYBOARD",
  "APPROVE_EPISODE",
  "PUBLISH",
];

export type AgentRegistryStatus = "IMPLEMENTED" | "INACTIVE" | "NOT_IMPLEMENTED";

export interface ModelConfig {
  provider: string;
  model: string;
  temperature: number;
  structuredOutput: boolean;
}

export interface StudioAgent {
  id: string;
  name: string;
  role: string;
  description: string;
  status: AgentRegistryStatus;
  /** Engine action list. The orchestrator does not treat this as approval power. */
  permissions: AgentAction[];
  grants: OrchestrationPermission[];
  inputSchema: string[];
  outputSchema: string[];
  modelConfig: ModelConfig;
  systemInstructions: string;
  /** True only when an engine function exists. Inactive agents can still be true here and still be refused by the orchestrator. */
  implemented: boolean;
  createdAt: string;
  updatedAt: string;
  version: number;
}

const READ_CANON: AgentAction[] = ["canon.read", "stories.read"];
const AT = "2026-10-07T08:00:00.000Z";
const MODEL: ModelConfig = {
  provider: "development",
  model: "dev-template-v1",
  temperature: 0,
  structuredOutput: true,
};

function spec(
  input: Omit<StudioAgent, "modelConfig" | "createdAt" | "updatedAt" | "version"> & { modelConfig?: ModelConfig },
): StudioAgent {
  return {
    ...input,
    modelConfig: input.modelConfig ?? MODEL,
    createdAt: AT,
    updatedAt: AT,
    version: 1,
  };
}

export const AGENTS: StudioAgent[] = [
  spec({
    id: "agent_creative_director",
    name: "Creative Director",
    role: "Brand and canon consistency",
    description: "Can propose a canon note. Not assigned production work in this stage.",
    status: "INACTIVE",
    permissions: ["canon.read", "stories.read", "culture.review", "canon.propose"],
    grants: ["READ_CANON", "READ_STORY", "PROPOSE_CANON_CHANGE"],
    inputSchema: ["canonSnapshot", "brand"],
    outputSchema: ["canonChangeRequest"],
    implemented: true,
    systemInstructions: "Read canon. Propose changes. Do not rewrite it. Do not approve.",
  }),
  spec({
    id: "agent_story_architect",
    name: "Story Architect",
    role: "Original story candidates and story DNA",
    description: "Proposes stories from canon and story rules. Cannot approve them.",
    status: "IMPLEMENTED",
    permissions: [...READ_CANON, "stories.create", "stories.revise", "dna.create", "originality.calculate"],
    grants: ["READ_CANON", "READ_STORY", "CREATE_STORY_PROPOSAL", "PROPOSE_STORY_CHANGE"],
    inputSchema: ["canonSnapshot", "storyRules", "targetAge", "priorStories"],
    outputSchema: ["storyProposal"],
    implemented: true,
    systemInstructions:
      "Propose stories only from canon, prior stories, and story rules. Never modify characters. Never approve. Never publish.",
  }),
  spec({
    id: "agent_scriptwriter",
    name: "Scriptwriter",
    role: "Hindi scripts from approved stories",
    description: "Writes a Hindi development draft from one approved story version and the canon snapshot. The live text model is reached only through the gateway.",
    status: "IMPLEMENTED",
    permissions: ["canon.read", "stories.read", "script.create", "script.revise"],
    grants: ["READ_CANON", "READ_STORY", "READ_SCRIPT", "CREATE_SCRIPT_DRAFT", "PROPOSE_STORY_CHANGE"],
    inputSchema: ["approvedStoryVersion", "canonSnapshot", "targetAge", "storyRules"],
    outputSchema: ["scriptDraft"],
    implemented: true,
    systemInstructions:
      "Write only from the approved story version and canonical characters. Do not invent cast. Do not approve.",
  }),
  spec({
    id: "agent_hindi_editor",
    name: "Hindi Language Editor",
    role: "Grammar, register, child comprehension",
    description: "Reviews Hindi register. The review is an opinion, not an approval.",
    status: "IMPLEMENTED",
    permissions: ["canon.read", "stories.read", "language.review"],
    grants: ["READ_CANON", "READ_STORY", "READ_SCRIPT", "CREATE_REVIEW"],
    inputSchema: ["scriptVersion", "targetAge"],
    outputSchema: ["languageReview"],
    implemented: true,
    systemInstructions: "Review Hindi. Do not approve the script. Do not change canon.",
  }),
  spec({
    id: "agent_cultural_reviewer",
    name: "Cultural Reviewer",
    role: "Indian cultural context",
    description: "Flags generic or careless cultural use. Cannot override the Hindi editor.",
    status: "IMPLEMENTED",
    permissions: ["canon.read", "stories.read", "culture.review"],
    grants: ["READ_CANON", "READ_STORY", "READ_SCRIPT", "CREATE_REVIEW"],
    inputSchema: ["scriptVersion", "storyCulturalElement"],
    outputSchema: ["culturalReview"],
    implemented: true,
    systemInstructions: "Flag generic or careless cultural use. Do not approve.",
  }),
  spec({
    id: "agent_character_director",
    name: "Character Director",
    role: "Visual and personality consistency",
    description: "Proposes canon changes and visual claims. Cannot lock canon.",
    status: "IMPLEMENTED",
    permissions: ["canon.read", "stories.read", "canon.propose"],
    grants: ["READ_CANON", "READ_STORY", "PROPOSE_CANON_CHANGE"],
    inputSchema: ["characterVersion", "canonSnapshot"],
    outputSchema: ["canonChangeRequest", "visualClaim"],
    implemented: true,
    systemInstructions: "Report drift. Propose canon changes. Do not change canon. Do not approve.",
  }),
  spec({
    id: "agent_storyboard_director",
    name: "Storyboard Director",
    role: "Scenes and shots from an approved script",
    description: "Drafts a storyboard from the approved script only.",
    status: "IMPLEMENTED",
    permissions: ["canon.read", "stories.read", "storyboard.create"],
    grants: ["READ_CANON", "READ_SCRIPT", "READ_STORYBOARD", "CREATE_STORYBOARD_DRAFT"],
    inputSchema: ["approvedScriptVersion", "canonSnapshot"],
    outputSchema: ["storyboardDraft"],
    implemented: true,
    systemInstructions: "Use only approved characters and known locations.",
  }),
  spec({
    id: "agent_visual_director",
    name: "Visual Director",
    role: "Production plan for pictures",
    description: "Plans shots inside storyboard generation. Does not render.",
    status: "IMPLEMENTED",
    permissions: ["canon.read", "stories.read", "production_plan.create"],
    grants: ["READ_CANON", "READ_STORYBOARD", "CREATE_PRODUCTION_PLAN"],
    inputSchema: ["storyboardDraft", "canonSnapshot"],
    outputSchema: ["productionPlan"],
    implemented: true,
    systemInstructions: "Plan shots. Do not claim rendered footage exists.",
  }),
  spec({
    id: "agent_animation_producer",
    name: "Animation Producer",
    role: "Asset requests from an approved plan",
    description: "Records the asset requests already required by the plan. No picture is rendered.",
    status: "IMPLEMENTED",
    permissions: ["canon.read", "stories.read", "production_plan.create"],
    grants: ["READ_CANON", "READ_STORYBOARD", "CREATE_PRODUCTION_PLAN", "CREATE_ASSET_REQUEST"],
    inputSchema: ["productionPlan", "storyboardVersion", "canonSnapshot"],
    outputSchema: ["assetRequests"],
    implemented: true,
    systemInstructions: "Request assets from the plan. Do not invent a render. Do not approve assets.",
  }),
  spec({
    id: "agent_voice_director",
    name: "Voice Director",
    role: "Voice consistency",
    description: "No voice execution is wired. The canonical voice profile is the only source.",
    status: "NOT_IMPLEMENTED",
    permissions: ["canon.read"],
    grants: ["READ_CANON"],
    inputSchema: ["voiceProfile"],
    outputSchema: [],
    implemented: false,
    systemInstructions: "Voice stays on the canonical profile. No celebrity imitation.",
  }),
  spec({
    id: "agent_music_director",
    name: "Music Director",
    role: "Original music",
    description: "No music execution is wired. Nothing is composed.",
    status: "NOT_IMPLEMENTED",
    permissions: ["canon.read"],
    grants: ["READ_CANON"],
    inputSchema: ["musicCue"],
    outputSchema: [],
    implemented: false,
    systemInstructions: "Original motifs only. Do not clear rights you do not hold.",
  }),
  spec({
    id: "agent_qa",
    name: "QA Agent",
    role: "Story, Hindi, and canon gates",
    description: "Runs quality checks. Cannot approve the episode.",
    status: "IMPLEMENTED",
    permissions: ["canon.read", "stories.read", "qa.run"],
    grants: ["READ_CANON", "READ_STORY", "READ_SCRIPT", "READ_STORYBOARD", "RUN_VALIDATION", "CREATE_REVIEW"],
    inputSchema: ["episodeVersion", "scriptVersion", "storyboardVersion"],
    outputSchema: ["qualityReview"],
    implemented: true,
    systemInstructions: "Score the work. Do not approve it.",
  }),
  spec({
    id: "agent_rights",
    name: "IP/Rights Agent",
    role: "Provenance and commercial clearance",
    description: "Inspects provenance and raises a red flag. Cannot grant rights or clear a flag.",
    status: "IMPLEMENTED",
    permissions: ["canon.read", "rights.review"],
    grants: ["READ_CANON", "READ_SCRIPT", "READ_STORYBOARD", "CREATE_REVIEW"],
    inputSchema: ["assetProvenance", "episodeVersion"],
    outputSchema: ["rightsReview"],
    implemented: true,
    systemInstructions: "Unresolved rights are a red flag. Do not clear them yourself. Do not publish.",
  }),
  spec({
    id: "agent_policy",
    name: "YouTube Policy Agent",
    role: "Child safety and made-for-kids",
    description: "Reviews policy risk. Cannot publish or override rights.",
    status: "IMPLEMENTED",
    permissions: ["canon.read", "stories.read", "policy.review"],
    grants: ["READ_CANON", "READ_STORY", "READ_SCRIPT", "CREATE_REVIEW"],
    inputSchema: ["scriptText", "episodeAudience"],
    outputSchema: ["policyReview"],
    implemented: true,
    systemInstructions: "Block unsafe or misleading beats. Do not approve release. Do not override rights.",
  }),
  spec({
    id: "agent_analytics",
    name: "Analytics Agent",
    role: "Performance reading",
    description: "No analytics execution is wired. This build does not collect child data.",
    status: "NOT_IMPLEMENTED",
    permissions: ["canon.read"],
    grants: ["READ_CANON"],
    inputSchema: [],
    outputSchema: [],
    implemented: false,
    systemInstructions: "Do not invent performance metrics. Do not collect child data.",
  }),
  spec({
    id: "agent_executive",
    name: "Executive Agent",
    role: "Scale decisions",
    description: "Not active. This build does not scale production or publish.",
    status: "NOT_IMPLEMENTED",
    permissions: ["canon.read", "stories.read"],
    grants: ["READ_CANON", "READ_STORY"],
    inputSchema: [],
    outputSchema: [],
    implemented: false,
    systemInstructions: "Do not scale production from this build. Do not approve. Do not publish.",
  }),
];

for (const agent of AGENTS) {
  for (const grant of agent.grants) {
    if (FORBIDDEN_GRANTS.includes(grant)) {
      throw new Error(`${agent.id} cannot hold ${grant}.`);
    }
  }
}

const byId = new Map(AGENTS.map((agent) => [agent.id, agent]));

export function getAgent(id: string): StudioAgent | undefined {
  return byId.get(id);
}

export function agentCan(agent: StudioAgent, action: AgentAction): boolean {
  return agent.permissions.includes(action);
}
