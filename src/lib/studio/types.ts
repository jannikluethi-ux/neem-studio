export const AGE_BANDS = ["1-3", "3-5", "4-7", "6-9"] as const;
export type AgeBand = (typeof AGE_BANDS)[number];

export const EPISODE_STAGES = [
  "IDEA",
  "CONCEPT_REVIEW",
  "STORY_APPROVED",
  "SCRIPT_DRAFT",
  "SCRIPT_APPROVED",
  "STORYBOARD",
  "VISUAL_PRODUCTION",
  "ANIMATION",
  "VOICE",
  "AUDIO_MIX",
  "EDIT",
  "QUALITY_QA",
  "IP_RIGHTS_QA",
  "POLICY_QA",
  "HUMAN_APPROVAL",
  "READY_TO_PUBLISH",
  "PUBLISHED",
  "PERFORMANCE_REVIEW",
] as const;
export type EpisodeStage = (typeof EPISODE_STAGES)[number];

export type GateResult = "PASS" | "WARN" | "FAIL";
export type EntityStatus =
  | "draft"
  | "in_review"
  | "approved"
  | "rejected"
  | "revision_requested"
  | "blocked"
  | "superseded";

export type ActorType = "human" | "agent" | "system";

export const CANON_LIFECYCLE = [
  "DRAFT",
  "PROPOSED",
  "IN_REVIEW",
  "APPROVED",
  "LOCKED",
  "SUPERSEDED",
  "ARCHIVED",
] as const;
export type CanonLifecycle = (typeof CANON_LIFECYCLE)[number];

export type CanonStrength = "HARD" | "SOFT";

export type CanonRuleKind =
  | "MUST"
  | "MUST_NOT"
  | "ALLOWED_VARIATION"
  | "RELATIONSHIP"
  | "WORLD_RULE"
  | "STORY_RULE"
  | "VISUAL_RULE"
  | "VOICE_RULE";

export interface Actor {
  type: ActorType;
  id: string;
  name: string;
}

export interface AuditEvent {
  id: string;
  at: string;
  actorType: ActorType;
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  version?: number;
  detail: string;
}

export interface VersionRecord<T> {
  version: number;
  status: EntityStatus;
  snapshot: T;
  createdAt: string;
  createdBy: string;
  note: string;
  immutable: boolean;
  /** Canon workflow state. Does not rewrite the snapshot. */
  canonState?: CanonLifecycle;
}

export interface VersionedEntity<T> {
  id: string;
  type: string;
  name: string;
  currentVersion: number;
  canonicalVersion: number | null;
  versions: VersionRecord<T>[];
  createdAt: string;
  updatedAt: string;
}

export interface VoiceProfile {
  ageImpression: string;
  pitch: string;
  tempo: string;
  energy: string;
  accent: string;
  pronunciation: string;
  emotionalRange: string;
  provider: string;
  commercialRights: "not-cleared" | "cleared" | "not-applicable";
  voiceId: string;
}

export interface CharacterBody {
  name: string;
  nameHi: string;
  age: string;
  species: string;
  personality: string;
  strengths: string[];
  weaknesses: string[];
  likes: string[];
  dislikes: string[];
  fears: string[];
  relationshipNotes: string[];
  appearance: string;
  hair?: string;
  face?: string;
  eyes?: string;
  /** Proportions. Empty means the appearance line is the record. */
  body?: string;
  accessories?: string;
  clothing: string;
  colorPalette: string[];
  voiceProfile: VoiceProfile;
  speechStyle: string;
  catchphrases: string[];
  characterArc: string;
  storyFunction: string;
  visualRules: string[];
  behaviorRules?: string[];
  forbiddenVariations: string[];
  /** Tokens the story engine may exercise. Not a free-text prompt. */
  developmentTokens: string[];
}

export interface BrandBody {
  name: string;
  nameHi: string;
  tagline: string;
  taglineHi: string;
  colors: string[];
  voice: string;
  parentPositioning: string;
  notPositioning: string;
}

export interface UniverseBody {
  name: string;
  premise: string;
  rules: string[];
}

export interface WorldBody {
  name: string;
  geography: string;
  timeFeel: string;
  rules: string[];
}

export interface LocationBody {
  key: string;
  name: string;
  nameHi: string;
  description: string;
  kind: string;
}

export interface StoryRulesBody {
  ageBand: AgeBand;
  mustHave: string[];
  never: string[];
  tone: string;
  hindiRegister: string;
}

export interface PlatformRules {
  source: string;
  lastReviewed: string;
  note: string;
  yppSubscribers: number;
  yppWatchHours: number;
  yppShortsViews90d: number;
  madeForKids: boolean;
}

export interface Studio {
  id: string;
  name: string;
  market: "IN";
  primaryLanguage: "hi";
  ageBand: AgeBand | null;
  reviewerName: string;
  positioning: string;
  platformRules: PlatformRules;
  createdAt: string;
  updatedAt: string;
}

export interface StoryDna {
  premise: string;
  theme: string;
  conflict: string;
  characterCombination: string[];
  setting: string;
  emotionalArc: string;
  learningObjective: string;
  resolutionType: string;
  humorMechanism: string;
  adventureMechanism: string;
  mysteryMechanism: string;
  culturalElement: string;
  songUsage: string;
  visualMotif: string;
  storyStructure: string;
}

export type SimilarityStatus = "CLEAR" | "WATCH" | "LOOKALIKE";

export interface SimilarityMatch {
  field: string;
  detail: string;
}

export interface SimilarityDimension {
  key: string;
  label: string;
  score: number;
  max: number;
  matched: boolean;
  detail: string;
}

export interface SimilarityHit {
  storyId: string;
  title: string;
  score: number;
  reasons: string[];
}

export interface SimilarityReport {
  score: number;
  againstStoryId: string | null;
  againstTitle: string | null;
  matches: SimilarityMatch[];
  tooSimilar: boolean;
  status: SimilarityStatus;
  explanation: string;
  dimensions: SimilarityDimension[];
  closestMatches: SimilarityHit[];
}

export interface OriginalityDimension {
  key: string;
  label: string;
  score: number;
  max: number;
  reason: string;
}

export interface OriginalityScore {
  storyUniqueness: number;
  characterDevelopment: number;
  entertainmentValue: number;
  visualVariation: number;
  emotionalVariation: number;
  culturalSpecificity: number;
  humanEditorial: number;
  total: number;
  threshold: number;
  meetsThreshold: boolean;
  dimensions: OriginalityDimension[];
}

/** Normalized structure. Wording and proper nouns are folded out. */
export interface StoryFingerprint {
  hash: string;
  premise: string;
  conflict: string;
  characters: string;
  characterRoles: string;
  setting: string;
  emotionalArc: string;
  learningObjective: string;
  resolution: string;
  storyStructure: string;
  playMechanism: string;
  culturalElement: string;
  visualMotif: string;
}

export type StoryDecision = "BLOCKED" | "REQUIRES_REVISION" | "HUMAN_REVIEW" | "NOT_EVALUATED";

export type CanonGateResult = "PASS" | "WARN" | "FAIL" | "BLOCKED" | "NOT_EVALUATED";

/** System recommendation. Never a human approval. */
export interface StoryRecommendation {
  decision: StoryDecision;
  reasons: string[];
  canonResult: CanonGateResult;
}

export interface StoryBody {
  title: string;
  titleHi: string;
  logline: string;
  targetAge: AgeBand;
  characterIds: string[];
  settingId: string | null;
  settingLabel: string;
  theme: string;
  mainConflict: string;
  emotionalObjective: string;
  learningObjective: string;
  value: string;
  beginning: string;
  middle: string;
  resolution: string;
  culturalElements: string[];
  culturalSpecificity: "specific" | "generic" | "none";
  dna: StoryDna;
  fingerprint: StoryFingerprint;
  originality: OriginalityScore;
  similarity: SimilarityReport;
  recommendation: StoryRecommendation;
  developmentHook: string | null;
  thin: boolean;
  blueprintKey: string;
  editorialNote: string;
  providerId: string;
  providerDisclosure: string;
  canonVersionUsed?: string;
  canonSnapshotHash?: string;
  generationRunId?: string;
}

export interface ScriptLine {
  characterId: string | null;
  speaker: string;
  hi: string;
  en: string;
}

/** Plot facts copied from the approved story. Production must not replace them. */
export interface StoryAnchors {
  premise: string;
  mainConflict: string;
  emotionalObjective: string;
  learningObjective: string;
  resolution: string;
  characterIds: string[];
}

export interface ScriptScene {
  sceneNo: number;
  locationKey: string;
  locationId: string | null;
  characterIds: string[];
  action: string;
  lines: ScriptLine[];
  sceneId?: string;
  purpose?: string;
  emotionalBeat?: string;
  visualDirection?: string;
  soundDirection?: string;
  transition?: string;
  estimatedDuration?: string;
}

export interface ScriptBody {
  storyId: string;
  storyVersion: number;
  language: "hi";
  titleHi: string;
  titleEn: string;
  ageBand: AgeBand;
  vocabulary: Array<{ word: string; meaning: string; pronunciation: string }>;
  pronunciationNotes: string[];
  scenes: ScriptScene[];
  languageReview: "pending" | "pass" | "warn" | "fail";
  languageNotes: string[];
  canonRefs: string[];
  providerId: string;
  providerDisclosure: string;
  canonVersionUsed?: string;
  canonSnapshotHash?: string;
  generationRunId?: string;
  /** Development provider label. Never means human-approved. */
  draftLabel?: "DEVELOPMENT DRAFT";
  storyAnchors?: StoryAnchors;
  parentVersion?: number;
  revisionReason?: string;
  lineage?: "AI_GENERATED" | "HUMAN_REVISED";
  acceptedFindingIds?: string[];
}

export interface ShotBody {
  id: string;
  shotNo: number;
  description: string;
  characterIds: string[];
  locationId: string | null;
  locationKey: string;
  camera: string;
  framing?: string;
  expression?: string;
  dialogueReference?: string;
  continuityNotes?: string;
  estimatedDuration?: string;
  /** Set only when a proposal intentionally breaks the approved script. */
  contradictsScript?: boolean;
}

export interface BoardScene {
  sceneNo: number;
  heading: string;
  locationId: string | null;
  locationKey: string;
  shots: ShotBody[];
}

export interface StoryboardBody {
  storyId: string;
  storyVersion: number;
  scriptId: string;
  scriptVersion: number;
  scenes: BoardScene[];
  providerId: string;
  providerDisclosure: string;
  canonVersionUsed?: string;
  canonSnapshotHash?: string;
  generationRunId?: string;
}

export type AssetWorkflow =
  | "REQUESTED"
  | "GENERATING"
  | "GENERATED"
  | "VALIDATING"
  | "APPROVED"
  | "REJECTED"
  | "REQUIRES_REVISION";

export interface AssetRequest {
  id: string;
  assetType: string;
  sceneNo: number;
  shotId: string | null;
  characterId: string | null;
  locationId: string | null;
  requiredAttributes: string[];
  canonVersion: string;
  status: AssetWorkflow;
}

export interface MusicCue {
  id: string;
  type: "theme" | "bed" | "stinger";
  purpose: string;
  sceneNo: number | null;
  episodeId: string;
  style: string;
  durationSeconds: number;
  source: "not-connected";
  rightsStatus: "not-cleared" | "cleared" | "not-applicable";
}

export interface SoundCue {
  id: string;
  type: string;
  sceneNo: number;
  source: "not-connected";
  rightsStatus: "not-cleared" | "cleared" | "not-applicable";
}

export interface VoiceRequest {
  characterId: string;
  characterName: string;
  voiceId: string;
  pitch: string;
  tempo: string;
  commercialRights: "not-cleared" | "cleared" | "not-applicable";
}

export interface ProductionPlanBody {
  episodeId: string;
  storyId: string;
  runtimeMinutes: number;
  shots: number;
  voicePlan: string[];
  musicStatus: string;
  visualAssetsNeeded: string[];
  disclosure: string;
  canonVersionUsed?: string;
  canonSnapshotHash?: string;
  generationRunId?: string;
  providerStatus?: "NOT CONNECTED" | "PRODUCTION MOCK";
  assetRequests?: AssetRequest[];
  musicCues?: MusicCue[];
  soundCues?: SoundCue[];
  voices?: VoiceRequest[];
}

export interface VisualClaims {
  age?: string;
  species?: string;
  hair?: string;
  face?: string;
  eyes?: string;
  body?: string;
  clothing?: string;
  accessories?: string;
  voicePitch?: string;
  personality?: string;
}

export interface AssetBody {
  assetType: string;
  source: string;
  creator: string;
  model: string;
  provider: string;
  prompt: string;
  referenceAssets: string[];
  licenseStatus: string;
  commercialUseStatus: "not-cleared" | "cleared" | "not-applicable";
  rightsNotes: string;
  modificationHistory: string[];
  linkedEntityType: string;
  linkedEntityId: string;
  characterId?: string | null;
  characterVersion?: number | null;
  worldId?: string | null;
  locationId?: string | null;
  canonVersion?: string | null;
  visualClaims?: VisualClaims | null;
  canonVersionUsed?: string;
  canonSnapshotHash?: string;
  generationRunId?: string;
  episodeId?: string | null;
  sceneId?: string | null;
  shotId?: string | null;
  assetStatus?: AssetWorkflow;
  createdAt?: string;
  promptKey?: string;
  promptVersion?: number;
  modelVersion?: string;
  externalReference?: string | null;
  imageRole?: "INITIAL_DESIGN" | "FOLLOW_UP";
  storageDurability?: "BLOCKED" | "DURABLE";
  storageNote?: string;
  referenceAssetId?: string | null;
  referenceAssetVersion?: number | null;
  lineage?: "AI_GENERATED" | "HUMAN_APPROVED";
}

export interface EpisodeBody {
  storyId: string;
  storyVersion: number;
  title: string;
  targetAge: AgeBand;
  stage: EpisodeStage;
  audience: "made-for-kids";
  scriptId: string | null;
  scriptVersion: number | null;
  storyboardId: string | null;
  planId: string | null;
  draftApproved: boolean;
  holdReason: string | null;
  runtimeMinutes: number;
  lastError: string | null;
  canonVersionUsed?: string;
  canonSnapshotHash?: string;
  generationRunId?: string;
  episodeNumber?: number;
  /** A package of references. Not a rendered episode. */
  draftAssembled?: boolean;
}

export interface Relationship {
  id: string;
  fromId: string;
  toId: string;
  kind: string;
  note: string;
}

export interface AgentRun {
  id: string;
  at: string;
  agentId: string;
  action: string;
  status: "completed" | "denied" | "error";
  entityType: string;
  entityId: string;
  fingerprint: string;
  providerId: string;
  model: string;
  note: string;
}

export interface ApprovalRecord {
  id: string;
  at: string;
  actorId: string;
  actorName: string;
  entityType: string;
  entityId: string;
  version: number;
  decision: "approved" | "rejected" | "revision_requested";
  note: string;
}

export type EditorialOutcome = "PASS" | "WARNINGS" | "REVISION_REQUIRED" | "HUMAN_REVIEW";

export interface EditorialFinding {
  id: string;
  severity: "info" | "low" | "medium" | "high";
  explanation: string;
  suggestion: string;
  passage: string;
  confidence: "low" | "medium" | "high" | null;
}

/** Advisory review of one exact script version. Not an approval and not a rights clearance. */
export interface EditorialReview {
  id: string;
  at: string;
  kind: "hindi" | "culture";
  outcome: EditorialOutcome;
  scriptId: string;
  scriptVersion: number;
  storyId: string;
  storyVersion: number;
  canonSnapshotHash: string;
  canonVersion: string;
  agentId: string;
  templateKey: string;
  templateVersion: number;
  findings: EditorialFinding[];
  disclaimer: string;
  executionId: string;
  promptKey: string;
  promptVersion: number;
}

export interface GateCheck {
  name: string;
  result: GateResult;
  detail: string;
}

export interface QualityReview {
  id: string;
  at: string;
  gate: "story" | "hindi" | "canon" | "rights" | "policy" | "culture";
  result: GateResult;
  redFlag: boolean;
  entityType: string;
  entityId: string;
  version: number;
  checks: GateCheck[];
  agentId: string;
}

export interface StudioSettings {
  originalityThreshold: number;
  similarityBlock: number;
  textProviderId: string;
}

export interface CanonFieldView {
  field: string;
  label: string;
  value: string;
  strength: CanonStrength;
  rule: CanonRuleKind;
}

export interface CanonRule {
  id: string;
  kind: CanonRuleKind;
  strength: CanonStrength;
  entityType: string;
  entityId: string;
  field: string;
  expected: string;
  description: string;
  status: CanonLifecycle;
  version: number;
}

export interface CanonCharacterSlice {
  id: string;
  version: number;
  name: string;
  nameHi: string;
  hard: Record<string, string>;
  soft: Record<string, string>;
  forbidden: string[];
  voice: Record<string, string>;
}

export interface CanonLocationSlice {
  id: string;
  version: number;
  key: string;
  name: string;
  nameHi: string;
}

export interface CanonRelationshipSlice {
  id: string;
  fromId: string;
  toId: string;
  kind: string;
  note: string;
}

/** Authoritative slice for one generation. Not the whole studio database. */
export interface CanonSnapshot {
  id: string;
  createdAt: string;
  purpose: string;
  canonVersion: string;
  hash: string;
  targetAge: AgeBand | null;
  studioId: string | null;
  brandId: string | null;
  brandVersion: number | null;
  universeId: string | null;
  universeVersion: number | null;
  worldId: string | null;
  worldVersion: number | null;
  storyRulesId: string | null;
  storyRulesVersion: number | null;
  characters: CanonCharacterSlice[];
  locations: CanonLocationSlice[];
  relationships: CanonRelationshipSlice[];
  rules: CanonRule[];
}

export type CanonSnapshotDraft = Omit<CanonSnapshot, "id" | "createdAt">;

export interface CanonViolation {
  entityType: string;
  entityId: string;
  entityName: string;
  field: string;
  proposed: string;
  canonical: string;
  ruleId: string;
  rule: string;
  severity: "FAIL" | "WARN";
  strength: CanonStrength;
}

export interface CanonValidation {
  result: "PASS" | "WARN" | "FAIL" | "BLOCKED";
  violations: CanonViolation[];
  warnings: CanonViolation[];
  evidence: string[];
  canonicalReferences: string[];
  snapshotId: string;
  canonVersion: string;
  snapshotHash: string;
  drift: "CLEAN" | "DRIFT_FOUND";
}

export interface CanonValidationRecord {
  id: string;
  at: string;
  entityType: string;
  entityId: string;
  version: number;
  validation: CanonValidation;
}

export interface CanonImpact {
  stories: Array<{ id: string; title: string }>;
  scripts: Array<{ id: string; title: string }>;
  storyboards: string[];
  episodes: Array<{ id: string; title: string }>;
  assets: string[];
  summary: string;
}

export interface CanonChange {
  id: string;
  at: string;
  entityType: "character";
  entityId: string;
  entityName: string;
  field: string;
  strength: CanonStrength;
  currentValue: string;
  proposedValue: string;
  reason: string;
  proposedByType: ActorType;
  proposedById: string;
  proposedByName: string;
  status: "PROPOSED" | "IN_REVIEW" | "APPROVED" | "REJECTED";
  impact: CanonImpact;
  decidedAt?: string;
  decidedById?: string;
  decidedByName?: string;
  decisionNote?: string;
  resultingVersion?: number;
}

export interface ProductionRevision {
  id: string;
  at: string;
  episodeId: string;
  storyId: string;
  scriptId: string | null;
  sceneNo: number | null;
  shotId: string | null;
  problem: string;
  reason: string;
  recommendedChange: string;
  impact: string;
  status: "OPEN" | "ACCEPTED" | "REJECTED";
  decidedAt?: string;
  decidedById?: string;
  decidedByName?: string;
}

export interface LocationProposal {
  id: string;
  at: string;
  episodeId: string | null;
  key: string;
  name: string;
  nameHi: string;
  description: string;
  reason: string;
  status: "PROPOSED" | "APPROVED" | "REJECTED";
  resultingLocationId?: string;
}

export interface GenerationRun {
  id: string;
  at: string;
  purpose: string;
  entityType: string;
  entityId: string;
  snapshotId: string;
  canonVersion: string;
  snapshotHash: string;
  providerId: string;
  validationId?: string;
}

export type AgentTaskStatus =
  | "QUEUED"
  | "READY"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "BLOCKED"
  | "CANCELLED"
  | "REQUIRES_HUMAN_REVIEW";

export type AgentTaskPriority = "LOW" | "NORMAL" | "HIGH" | "BLOCKING";

export interface TaskArtifactRef {
  type: string;
  id: string;
  version: number | null;
  label: string;
}

export interface TaskValidation {
  name: string;
  result: string;
  detail: string;
}

/** Explicit context handed to one task. Not the studio database. */
export interface AgentTaskContext {
  studio: string;
  brand: string;
  universe: string;
  world: string;
  targetAge: string;
  canonVersion: string;
  canonSnapshotHash: string;
  episodeId: string | null;
  storyId: string | null;
  storyVersion: number | null;
}

export interface AgentTask {
  id: string;
  agentId: string;
  taskType: string;
  episodeId: string | null;
  storyId: string | null;
  inputArtifacts: TaskArtifactRef[];
  inputVersions: string[];
  context: AgentTaskContext;
  canonVersion: string;
  canonSnapshotHash: string;
  instructions: string;
  status: AgentTaskStatus;
  priority: AgentTaskPriority;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
  outputArtifacts: TaskArtifactRef[];
  validationResults: TaskValidation[];
  error: string | null;
  errorCode: string | null;
  blockedReason: string | null;
  createdBy: string;
}

export interface OrchestrationRun {
  id: string;
  taskId: string;
  agentId: string;
  agentVersion: number;
  modelProvider: string;
  model: string;
  modelParameters: string;
  inputHash: string;
  outputHash: string;
  startedAt: string;
  completedAt: string | null;
  status: "completed" | "failed" | "blocked";
  error: string | null;
}

export interface AgentRevisionRequest {
  id: string;
  at: string;
  originalTaskId: string;
  failedArtifactType: string;
  failedArtifactId: string;
  failedVersion: number | null;
  failureReason: string;
  validationResult: string;
  requiredChange: string;
  affectedStage: string;
  followUpTaskId: string;
  status: "OPEN";
}

export interface StoryRevisionRequest {
  id: string;
  at: string;
  storyId: string;
  storyVersion: number;
  reason: string;
  affected: string;
  proposedChange: string;
  impact: string;
  taskId: string;
  status: "OPEN" | "ACCEPTED" | "REJECTED";
  decidedAt?: string;
  decidedById?: string;
}

export type ReleaseCheckKind = "canon" | "story" | "hindi" | "culture" | "asset" | "rights" | "policy" | "production";

export type ReleaseCheckResult = "PASS" | "FAIL" | "RED_FLAG" | "WARNING" | "HUMAN_REVIEW" | "NOT_EVALUATED";

export type ReleaseSeverity = "GREEN" | "YELLOW" | "RED" | "HUMAN_REVIEW";

export type ReleaseStatus = "RELEASE_READY" | "RELEASE_BLOCKED" | "HUMAN_REVIEW_REQUIRED";

export interface ReleaseFinding {
  code: string;
  what: string;
  where: string;
  why: string;
  correction: string;
  role: string;
  artifactType: string;
  artifactId: string;
  artifactVersion: number | null;
}

/** Versions the release gate actually read. A later change makes the report stale. */
export interface ReleaseStamp {
  canonVersion: string;
  canonSnapshotHash: string;
  latestCanonHash: string;
  storyId: string;
  storyVersion: number;
  storyCurrentVersion: number;
  storyKey: string;
  scriptId: string | null;
  scriptVersion: number | null;
  scriptCanonicalVersion: number | null;
  scriptKey: string;
  storyboardId: string | null;
  storyboardVersion: number | null;
  planId: string | null;
  planVersion: number | null;
  planKey: string;
  assetKey: string;
}

export interface ReleaseCheckRecord {
  id: string;
  checkId: ReleaseCheckKind;
  label: string;
  engineVersion: number;
  episodeId: string;
  result: ReleaseCheckResult;
  severity: ReleaseSeverity;
  findings: ReleaseFinding[];
  evidence: string[];
  versionsLabel: string;
  canonVersion: string;
  reviewerId: string;
  reviewerName: string;
  at: string;
}

export interface ReleaseReport {
  id: string;
  episodeId: string;
  at: string;
  status: ReleaseStatus;
  checkIds: string[];
  blocking: ReleaseFinding[];
  warnings: string[];
  humanQuestions: string[];
  nextAction: string;
  stamp: ReleaseStamp;
  canonVersion: string;
  versionsLabel: string;
  actorId: string;
  actorName: string;
}

export interface ReleaseRepair {
  id: string;
  at: string;
  episodeId: string;
  reportId: string;
  checkId: ReleaseCheckKind;
  problem: string;
  artifactType: string;
  artifactId: string;
  artifactVersion: number | null;
  reason: string;
  requiredChange: string;
  responsibleRole: string;
  status: "OPEN";
}

/** 0 observe, 1 recommend, 2 plan, 3 start permitted tasks. 4 is off. 5 can never be set. */
export type BrainAutonomy = 0 | 1 | 2 | 3;

export type BrainCategory = "PRODUCE" | "DO_NOT_PRODUCE" | "DEVELOP" | "PAUSE" | "INVESTIGATE" | "REPAIR" | "EXPERIMENT";

export type BrainConfidence = "HIGH" | "MEDIUM" | "LOW";

export type BrainCall = "ACCEPT" | "REJECT" | "MODIFY" | "DEFER";

export type BrainRecommendationStatus = "OPEN" | "ACCEPTED" | "REJECTED" | "MODIFIED" | "DEFERRED";

export type LocationLaneStatus = "PROPOSED" | "APPROVED" | "LOCKED" | "RETIRED";

export type PlaceLayer = "canon" | "story-setting" | "production-asset" | "proposal";

export interface BrainHumanDecision {
  decision: BrainCall;
  at: string;
  actorId: string;
  actorName: string;
  note: string;
  /** Stored apart from the original recommendation text. */
  modifiedText: string | null;
}

export interface BrainRecommendation {
  id: string;
  at: string;
  category: BrainCategory;
  title: string;
  rationale: string;
  evidence: string[];
  confidence: BrainConfidence;
  hypothesis: boolean;
  targetAge: string;
  characterIds: string[];
  locationKey: string | null;
  risks: string[];
  recommendedAction: string;
  fingerprint: string;
  status: BrainRecommendationStatus;
  humanDecision: BrainHumanDecision | null;
  outcomes: string[];
}

export interface BrainOpportunity {
  id: string;
  at: string;
  title: string;
  category: string;
  rationale: string;
  evidence: string[];
  targetAge: string;
  characterNames: string[];
  locationKey: string | null;
  expectedValue: string;
  risks: string[];
  recommendedAction: string;
  confidence: BrainConfidence;
  status: "PROPOSED" | "ACCEPTED" | "REJECTED" | "DEFERRED";
  recommendationId: string | null;
}

export interface BrainDecisionLog {
  id: string;
  at: string;
  recommendationId: string;
  recommendation: string;
  evidence: string[];
  reasoning: string;
  confidence: BrainConfidence;
  humanDecision: string | null;
  resultingAction: string;
  outcome: string | null;
}

export interface BrainMemory {
  rejected: string[];
  accepted: string[];
  outcomes: Array<{ fingerprint: string; at: string; outcome: string }>;
}

export interface PerformanceSignal {
  id: string;
  at: string;
  label: string;
  storyStructure: string | null;
  metric: "views" | "watch_time" | "retention" | "completion" | "ctr" | "subscribers" | "shorts" | "song" | "character" | "topic" | "location";
  value: number;
  sampleSize: number;
  note: string;
  hypothetical: boolean;
}

export type AnalyticsFormat = "long-form" | "short" | "song" | "compilation" | "trailer" | "other";

export type AnalyticsSource = "manual" | "import" | "hypothetical" | "platform";

export type AnalyticsProvider = "none" | "youtube-analytics" | "manual";

export type AnalyticsMetric =
  | "views"
  | "impressions"
  | "ctr"
  | "average_view_duration"
  | "average_percentage_viewed"
  | "retention"
  | "completion"
  | "unique_viewers"
  | "returning_viewers"
  | "subscribers_gained"
  | "likes"
  | "comments"
  | "shares"
  | "playlist_adds"
  | "watch_time"
  | "repeat_viewing";

export type AnalyticsConfidence = "HIGH" | "MEDIUM" | "LOW" | "INSUFFICIENT";

export type EvidenceSignal = "INSUFFICIENT_DATA" | "EARLY_SIGNAL" | "REPEATED_SIGNAL" | "STRONG_SIGNAL";

export type AnalyticsDataState = "NOT_AVAILABLE" | "INSUFFICIENT_DATA" | "OBSERVED" | "COMPARED" | "INTERPRETED" | "RECOMMENDATION";

export type SongUsage = "song" | "recurring-song" | "original-music" | "musical-segment" | "none" | "unknown";

export type RetentionShape = "early-drop" | "strong-opening" | "mid-drop" | "strong-ending" | "rewatch" | "unknown";

/** Aggregated content intelligence only. No child profiles, names, or private messages. */
export interface AnalyticsLengthBucket {
  key: string;
  label: string;
  minSeconds: number;
  maxSeconds: number | null;
}

export interface AnalyticsConfig {
  baselineDefinitionVersion: number;
  baselineMethod: "median" | "mean";
  lengthBuckets: AnalyticsLengthBucket[];
  privacy: "aggregated-platform-only";
  liveYouTube: false;
}

export interface AnalyticsObservation {
  id: string;
  at: string;
  episodeId: string;
  title: string;
  storyId: string | null;
  storyVersion: number | null;
  scriptVersion: number | null;
  episodeVersion: number | null;
  planVersion: number | null;
  storyStructure: string | null;
  targetAge: string | null;
  characterIds: string[];
  characterNames: string[];
  locationKey: string | null;
  worldKey: string | null;
  runtimeSeconds: number | null;
  lengthBucket: string | null;
  format: AnalyticsFormat;
  language: string;
  publishedAt: string | null;
  source: AnalyticsSource;
  provider: AnalyticsProvider;
  hypothetical: boolean;
  linkedToStudioEpisode: boolean;
  rankable: boolean;
  metrics: Partial<Record<AnalyticsMetric, number | null>>;
  trafficSources: string[];
  audienceGeography: string[];
  songUsage: SongUsage;
  retentionShape: RetentionShape | null;
  productionCost: number | null;
  productionMinutes: number | null;
  note: string;
  privacy: "aggregated-platform-only";
}

export interface AnalyticsBaseline {
  id: string;
  at: string;
  key: string;
  version: number;
  definitionVersion: number;
  label: string;
  metric: AnalyticsMetric;
  method: "median" | "mean";
  scope: string;
  value: number | null;
  sampleSize: number;
  episodeIds: string[];
  observationIds: string[];
  format: AnalyticsFormat | null;
  status: "ACTIVE" | "RETIRED";
}

export interface AnalyticsComparison {
  id: string;
  at: string;
  observationId: string;
  episodeId: string;
  baselineId: string;
  baselineVersion: number;
  definitionVersion: number;
  metric: AnalyticsMetric;
  observed: number;
  baselineValue: number;
  delta: number;
  statement: string;
  compatible: boolean;
  dataState: "COMPARED" | "DATA_QUALITY_ISSUE";
}

export type InterpretationStatus = "OPEN" | "CORRECT" | "INCORRECT" | "NEEDS_MORE_DATA" | "MISLEADING" | "OUTDATED" | "NEEDS_REVIEW";

export interface AnalyticsInterpretation {
  id: string;
  at: string;
  fingerprint: string;
  kind: "episode" | "pattern" | "character" | "story" | "location" | "format" | "length" | "song" | "anomaly";
  title: string;
  observed: string;
  compared: string | null;
  interpretation: string;
  recommendation: string;
  confidence: AnalyticsConfidence;
  evidenceState: EvidenceSignal;
  sampleSize: number;
  baselineId: string | null;
  baselineVersion: number | null;
  definitionVersion: number;
  observationIds: string[];
  episodeIds: string[];
  limitations: string;
  status: InterpretationStatus;
}

export interface AnalyticsCorrection {
  id: string;
  at: string;
  actorId: string;
  actorName: string;
  targetType: "interpretation" | "observation";
  targetId: string;
  verdict: "CORRECT" | "INCORRECT" | "NEEDS_MORE_DATA" | "MISLEADING" | "EXCLUDE_OUTLIER" | "ANNOTATE";
  note: string;
}

export type ExperimentStatus = "PROPOSED" | "RUNNING" | "COMPLETED" | "INCONCLUSIVE";

export type ExperimentConclusion = "supported" | "not_supported" | "inconclusive" | null;

export interface AnalyticsExperiment {
  id: string;
  at: string;
  hypothesis: string;
  objective: string;
  variables: string[];
  controlGroup: string;
  testGroup: string;
  targetAge: string;
  metric: AnalyticsMetric;
  baselineNote: string;
  result: string | null;
  interpretation: string | null;
  confidence: AnalyticsConfidence;
  conclusion: ExperimentConclusion;
  nextRecommendation: string | null;
  status: ExperimentStatus;
}

export interface AnalyticsAnomaly {
  id: string;
  at: string;
  fingerprint: string;
  episodeId: string;
  observationId: string;
  kind: "spike" | "drop" | "retention" | "engagement" | "cost" | "time" | "views-retention-mismatch";
  summary: string;
  action: "INVESTIGATE";
  detail: string;
  confidence: AnalyticsConfidence;
  sampleSize: number;
}

export type LessonStatus = "NEW" | "INVESTIGATING" | "CONFIRMED" | "DISPROVEN" | "INCONCLUSIVE" | "RETIRED";

export interface AnalyticsLesson {
  id: string;
  at: string;
  fingerprint: string;
  observation: string;
  evidence: string;
  sampleSize: number;
  confidence: AnalyticsConfidence;
  affected: string;
  interpretation: string;
  recommendation: string;
  status: LessonStatus;
  negative: boolean;
  interpretationId: string | null;
  reviewNote: string;
}

export type AnalyticsQualityCode =
  | "missing_metrics"
  | "impossible_value"
  | "duplicate"
  | "incompatible_format"
  | "bad_episode_id"
  | "missing_timestamp"
  | "inconsistent_version"
  | "missing_age"
  | "missing_dna"
  | "missing_characters"
  | "proposed_location"
  | "privacy";

export interface AnalyticsQualityFlag {
  id: string;
  at: string;
  observationId: string | null;
  episodeId: string | null;
  code: AnalyticsQualityCode;
  detail: string;
  status: "DATA_QUALITY_ISSUE";
  repaired: false;
}

export interface AnalyticsEvidencePacket {
  id: string;
  at: string;
  interpretationId: string | null;
  finding: string;
  baseline: string;
  sampleSize: number;
  confidence: AnalyticsConfidence;
  limitations: string;
  suggestedConsideration: "INVESTIGATE" | "EXPERIMENT" | "DO_NOT_TREAT_AS_FACT";
  handedToBrain: boolean;
  brainRecommendationId: string | null;
  stale: boolean;
}

export interface LocationStrategy {
  id: string;
  key: string;
  name: string;
  nameHi: string;
  role: "PRIMARY_WORLD" | "CANON_LOCATION" | "EXPANSION";
  status: LocationLaneStatus;
  layer: PlaceLayer;
  canonLocationId: string | null;
  worldId: string | null;
  rationale: string;
  ageSuitability: string;
  storyOpportunities: string;
  culturalNotes: string;
  visualIdentity: string;
  productionNotes: string;
  recurrence: "recurring" | "one-off" | "undecided";
  realWorld: "real" | "fictional" | "unspecified";
  createdAt: string;
  updatedAt: string;
}

/** A new version points at the version it replaced. The old snapshot stays readable. */
export interface VersionLink {
  id: string;
  at: string;
  entityType: "story" | "script" | "storyboard" | "plan" | "asset" | "canon";
  entityId: string;
  version: number;
  supersedesVersion: number | null;
  status: "DRAFT" | "UNDER_REVIEW" | "APPROVED" | "REJECTED" | "SUPERSEDED";
  createdBy: string;
  reason: string;
}

export type RightsStanding = "UNKNOWN" | "PENDING" | "CLEARED" | "RESTRICTED" | "BLOCKED" | "EXPIRED";

export interface RightsRecord {
  id: string;
  at: string;
  subjectType: string;
  subjectId: string;
  assetId: string | null;
  assetVersion: number | null;
  licenseType: string;
  commercialUse: RightsStanding;
  territory: string;
  restrictions: string;
  evidenceReference: string;
  status: RightsStanding;
  reviewedBy: string | null;
  reviewedAt: string | null;
  notes: string;
}

export interface ProvenanceRecord {
  id: string;
  at: string;
  assetId: string;
  assetVersion: number;
  source: string;
  creator: string;
  tool: string;
  model: string;
  promptReference: string;
  sourceLicense: string;
  modificationHistory: string[];
  notes: string;
}

export interface ArtifactPin {
  type: string;
  id: string;
  version: number | null;
}

export interface QARun {
  id: string;
  at: string;
  episodeId: string | null;
  storyId: string | null;
  canonVersionId: string | null;
  storyVersion: number | null;
  scriptId: string | null;
  scriptVersion: number | null;
  storyboardId: string | null;
  storyboardVersion: number | null;
  planId: string | null;
  planVersion: number | null;
  assetVersions: ArtifactPin[];
  checkResults: string[];
  /** Result at the time of the run. Not rewritten when the run goes stale. */
  evaluatedStatus: "READY" | "BLOCKED" | "HUMAN_REVIEW_REQUIRED";
  overallStatus: "READY" | "BLOCKED" | "HUMAN_REVIEW_REQUIRED" | "OUTDATED";
  createdBy: string;
}

export interface HumanApprovalRecord {
  id: string;
  at: string;
  episodeId: string | null;
  subjectType: string;
  subjectId: string;
  approvedArtifactVersions: ArtifactPin[];
  decision: "APPROVED" | "REJECTED" | "CHANGES_REQUESTED";
  reviewerId: string;
  reviewerName: string;
  notes: string;
  qaRunId: string | null;
}

export interface PublicationRecord {
  id: string;
  at: string;
  episodeId: string;
  platform: string;
  channel: string;
  language: string;
  title: string;
  description: string;
  thumbnailAssetVersionId: string | null;
  publishedAt: string | null;
  externalReference: string | null;
  status: "NOT_PUBLISHED" | "READY" | "PUBLISHED" | "UNPUBLISHED" | "REMOVED";
  contentVersionReference: string;
}

export interface PerformanceRecord {
  id: string;
  at: string;
  publicationId: string;
  episodeId: string;
  contentVersionReference: string;
  metric: string;
  /** Null means unknown. Unknown is not zero. */
  value: number | null;
  measurementPeriod: string;
  source: string;
  dataQualityStatus: "UNKNOWN" | "OBSERVED" | "ESTIMATED" | "INCOMPLETE";
}

export interface AnalyticsPatternRecord {
  id: string;
  at: string;
  updatedAt: string;
  description: string;
  evidence: string[];
  sampleSize: number;
  baseline: string;
  confidence: "HIGH" | "MEDIUM" | "LOW" | "INSUFFICIENT";
  status: "HYPOTHESIS" | "EARLY_SIGNAL" | "REPEATED_SIGNAL" | "CONFIRMED" | "DISPROVEN" | "INCONCLUSIVE" | "RETIRED";
}

export interface SourceSnapshot {
  id: string;
  at: string;
  kind: "STORY_APPROVAL" | "PRODUCTION" | "QA" | "HUMAN_APPROVAL" | "PUBLICATION";
  episodeId: string | null;
  storyId: string | null;
  pins: ArtifactPin[];
  note: string;
}

export interface SourceAudit {
  id: string;
  at: string;
  eventType: string;
  entityType: string;
  entityId: string;
  actorType: ActorType;
  actorId: string;
  previousState: string;
  newState: string;
  reason: string;
  relatedEntityIds: string[];
}

export type ProviderCapability = "LLM" | "IMAGE" | "VIDEO" | "VOICE" | "MUSIC" | "EMBEDDING" | "MODERATION";

export interface ProviderBindings {
  LLM: string;
  IMAGE: string;
  VIDEO: string;
  VOICE: string;
  MUSIC: string;
  EMBEDDING: string;
  MODERATION: string;
}

export interface ProviderHold {
  providerId: string;
  availability: "UNAVAILABLE";
  at: string;
  reason: string;
}

export interface AiExecution {
  id: string;
  at: string;
  actorType: ActorType;
  actorId: string;
  taskId: string | null;
  jobId: string | null;
  providerId: string;
  model: string;
  modelVersion: string;
  capability: ProviderCapability;
  inputArtifactIds: string[];
  promptKey: string;
  promptVersion: number;
  parameters: Record<string, string | number | boolean>;
  outputArtifactIds: string[];
  durationMs: number | null;
  status: "COMPLETED" | "FAILED" | "RETRYABLE";
  error: string | null;
  estimatedCost: number | null;
  currency: string | null;
  inputUnits: number | null;
  outputUnits: number | null;
  idempotencyKey: string;
}

export type JobState = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface StudioJob {
  id: string;
  at: string;
  updatedAt: string;
  kind: string;
  capability: ProviderCapability;
  state: JobState;
  failureClass: "TECHNICAL" | "CREATIVE" | null;
  attempts: number;
  maxTechnicalRetries: number;
  idempotencyKey: string;
  providerId: string;
  model: string;
  modelVersion: string;
  promptKey: string;
  promptVersion: number;
  inputArtifactIds: string[];
  outputArtifactIds: string[];
  executionIds: string[];
  error: string | null;
  taskId: string | null;
}

export interface IdempotencyRecord {
  key: string;
  operation: string;
  resultId: string;
  at: string;
}

/** Metadata only. File bytes live in object storage, never on this row. */
export interface ObjectRecord {
  id: string;
  assetKey: string;
  version: number;
  name: string;
  checksum: string;
  byteLength: number;
  mediaType: string;
  storageRef: string;
  rightsStatus: RightsStanding;
  provenanceExecutionId: string | null;
  createdAt: string;
  /** Present when file storage is not connected and the draft text must still be kept. */
  bodyText?: string;
}

export interface PromptVersion {
  id: string;
  key: string;
  version: number;
  purpose: string;
  input: string;
  output: string;
  body: string;
  status: "ACTIVE" | "SUPERSEDED";
  name?: string;
  agentId?: string;
  ageBand?: string;
  language?: string;
  createdBy?: string;
  createdAt?: string;
  changeNote?: string;
}

export type StudioRole = "ADMIN" | "CREATIVE" | "PRODUCER" | "RIGHTS" | "ANALYTICS" | "VIEWER";

export interface RoleBinding {
  actorId: string;
  role: StudioRole;
  at: string;
}

export interface FeatureFlags {
  publishing: boolean;
  youtube: boolean;
  autonomousExecution: boolean;
  experimentalWorkflow: boolean;
}

export interface DomainEvent {
  id: string;
  at: string;
  name: string;
  entityId: string;
  detail: string;
}

export interface OpsLog {
  id: string;
  at: string;
  requestId: string;
  actorId: string;
  operation: string;
  entityType: string;
  entityId: string;
  providerId: string | null;
  error: string | null;
  durationMs: number | null;
}

export interface StudioDb {
  schemaVersion: number;
  seq: number;
  studio: Studio | null;
  brand: VersionedEntity<BrandBody> | null;
  universe: VersionedEntity<UniverseBody> | null;
  world: VersionedEntity<WorldBody> | null;
  locations: VersionedEntity<LocationBody>[];
  characters: VersionedEntity<CharacterBody>[];
  relationships: Relationship[];
  storyRules: VersionedEntity<StoryRulesBody> | null;
  stories: VersionedEntity<StoryBody>[];
  episodes: VersionedEntity<EpisodeBody>[];
  scripts: VersionedEntity<ScriptBody>[];
  storyboards: VersionedEntity<StoryboardBody>[];
  plans: VersionedEntity<ProductionPlanBody>[];
  assets: VersionedEntity<AssetBody>[];
  agentRuns: AgentRun[];
  approvals: ApprovalRecord[];
  qualityReviews: QualityReview[];
  audit: AuditEvent[];
  settings: StudioSettings;
  canonSnapshots: CanonSnapshot[];
  canonValidations: CanonValidationRecord[];
  canonChanges: CanonChange[];
  generationRuns: GenerationRun[];
  productionRevisions: ProductionRevision[];
  locationProposals: LocationProposal[];
  agentTasks: AgentTask[];
  orchestrationRuns: OrchestrationRun[];
  agentRevisions: AgentRevisionRequest[];
  storyRevisionRequests: StoryRevisionRequest[];
  releaseChecks: ReleaseCheckRecord[];
  releaseReports: ReleaseReport[];
  releaseRepairs: ReleaseRepair[];
  brainAutonomy: BrainAutonomy;
  locationLibrary: LocationStrategy[];
  brainRecommendations: BrainRecommendation[];
  brainOpportunities: BrainOpportunity[];
  brainDecisions: BrainDecisionLog[];
  brainMemory: BrainMemory;
  performanceSignals: PerformanceSignal[];
  analyticsConfig: AnalyticsConfig;
  analyticsObservations: AnalyticsObservation[];
  analyticsBaselines: AnalyticsBaseline[];
  analyticsComparisons: AnalyticsComparison[];
  analyticsInterpretations: AnalyticsInterpretation[];
  analyticsCorrections: AnalyticsCorrection[];
  analyticsExperiments: AnalyticsExperiment[];
  analyticsAnomalies: AnalyticsAnomaly[];
  analyticsLessons: AnalyticsLesson[];
  analyticsQuality: AnalyticsQualityFlag[];
  analyticsPackets: AnalyticsEvidencePacket[];
  /** Markets the model can hold. India is current, not the only possible value. */
  sourceMarkets: string[];
  sourceLanguages: string[];
  versionLinks: VersionLink[];
  rightsRecords: RightsRecord[];
  provenanceRecords: ProvenanceRecord[];
  qaRuns: QARun[];
  humanApprovals: HumanApprovalRecord[];
  publications: PublicationRecord[];
  performanceRecords: PerformanceRecord[];
  analyticsPatterns: AnalyticsPatternRecord[];
  sourceSnapshots: SourceSnapshot[];
  sourceAudits: SourceAudit[];
  providerBindings: ProviderBindings;
  providerHolds: ProviderHold[];
  aiExecutions: AiExecution[];
  jobs: StudioJob[];
  idempotencyKeys: IdempotencyRecord[];
  objectRecords: ObjectRecord[];
  promptVersions: PromptVersion[];
  roleBindings: RoleBinding[];
  featureFlags: FeatureFlags;
  domainEvents: DomainEvent[];
  opsLogs: OpsLog[];
  /** Step 12. Absent on older records until migration. */
  editorialReviews?: EditorialReview[];
}

export type OpOk<T> = { ok: true; db: StudioDb; data: T; error?: undefined };
export type OpErr = { ok: false; db: StudioDb; error: string; code: string; data?: undefined };
export type Op<T> = OpOk<T> | OpErr;

export const LANGUAGE_SLOTS = [
  { code: "hi", label: "Hindi", role: "Primary. Canon scripts are written here." },
  { code: "en", label: "English", role: "Later localization. Not a second IP." },
  { code: "bn", label: "Bengali", role: "Later localization." },
  { code: "mr", label: "Marathi", role: "Later localization." },
  { code: "ta", label: "Tamil", role: "Later localization." },
  { code: "te", label: "Telugu", role: "Later localization." },
  { code: "gu", label: "Gujarati", role: "Later localization." },
  { code: "kn", label: "Kannada", role: "Later localization." },
  { code: "ml", label: "Malayalam", role: "Later localization." },
  { code: "pa", label: "Punjabi", role: "Later localization." },
] as const;
