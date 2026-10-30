import { FORBIDDEN_GRANTS, getAgent, type OrchestrationPermission } from "./agents.ts";
import { validateSubject } from "./canon.ts";
import {
  allocId,
  canonicalOf,
  evaluatePolicyGate,
  evaluateRightsGate,
  fingerprint,
  generateScript,
  generateStoryboard,
  generateStoryCandidates,
  latestSnapshot,
  proposeCanonChange,
  proposeScriptDrift,
  proposeStoryboardDrift,
  reviewCulture,
  reviewHindi,
  runQa,
} from "./engine.ts";
import { realDrafts } from "./editorial.ts";
import { validateAgeSuitability, validateBoardConsistency, validateStoryConsistency } from "./production.ts";
import type {
  Actor,
  AgentRevisionRequest,
  AgentTask,
  AgentTaskContext,
  AgentTaskPriority,
  AgentTaskStatus,
  Op,
  OrchestrationRun,
  QualityReview,
  StudioDb,
  TaskArtifactRef,
  TaskValidation,
} from "./types.ts";

const FORBIDDEN_TASKS = new Set([
  "script.approve",
  "story.approve",
  "storyboard.approve",
  "episode.approve",
  "canon.approve",
  "publish",
  "rights.clear",
  "threshold.lower",
]);

const TASK_RULES: Record<string, { agents: string[]; grant: OrchestrationPermission; reads: OrchestrationPermission[] }> = {
  "story.propose": { agents: ["agent_story_architect"], grant: "CREATE_STORY_PROPOSAL", reads: ["READ_CANON", "READ_STORY"] },
  "script.draft": { agents: ["agent_scriptwriter"], grant: "CREATE_SCRIPT_DRAFT", reads: ["READ_CANON", "READ_STORY"] },
  "script.revise": { agents: ["agent_scriptwriter"], grant: "CREATE_SCRIPT_DRAFT", reads: ["READ_CANON", "READ_SCRIPT"] },
  "language.review": { agents: ["agent_hindi_editor"], grant: "CREATE_REVIEW", reads: ["READ_CANON", "READ_SCRIPT"] },
  "culture.review": { agents: ["agent_cultural_reviewer"], grant: "CREATE_REVIEW", reads: ["READ_CANON", "READ_SCRIPT"] },
  "storyboard.draft": { agents: ["agent_storyboard_director"], grant: "CREATE_STORYBOARD_DRAFT", reads: ["READ_CANON", "READ_SCRIPT"] },
  "storyboard.revise": { agents: ["agent_storyboard_director"], grant: "CREATE_STORYBOARD_DRAFT", reads: ["READ_CANON", "READ_STORYBOARD"] },
  "animation.package": { agents: ["agent_animation_producer"], grant: "CREATE_ASSET_REQUEST", reads: ["READ_CANON", "READ_STORYBOARD"] },
  "qa.review": { agents: ["agent_qa"], grant: "RUN_VALIDATION", reads: ["READ_CANON", "READ_SCRIPT", "READ_STORYBOARD"] },
  "rights.review": { agents: ["agent_rights"], grant: "CREATE_REVIEW", reads: ["READ_CANON"] },
  "policy.review": { agents: ["agent_policy"], grant: "CREATE_REVIEW", reads: ["READ_CANON", "READ_SCRIPT"] },
  "canon.propose": { agents: ["agent_character_director"], grant: "PROPOSE_CANON_CHANGE", reads: ["READ_CANON"] },
  "story.change": { agents: ["agent_story_architect", "agent_scriptwriter"], grant: "PROPOSE_STORY_CHANGE", reads: ["READ_CANON", "READ_STORY"] },
};

export interface TaskRequest {
  taskType: string;
  agentId: string;
  episodeId?: string | null;
  storyId?: string | null;
  scriptId?: string | null;
  storyboardId?: string | null;
  characterId?: string | null;
  priority?: AgentTaskPriority;
  instructions?: string;
}

function fail<T>(db: StudioDb, code: string, error: string): Op<T> {
  return { ok: false, db, code, error };
}

function stamp(now?: string): string {
  return now ?? new Date().toISOString();
}

function putTask(db: StudioDb, task: AgentTask): StudioDb {
  const exists = db.agentTasks.some((item) => item.id === task.id);
  return {
    ...db,
    agentTasks: exists ? db.agentTasks.map((item) => (item.id === task.id ? task : item)) : [...db.agentTasks, task],
  };
}

function addRun(db: StudioDb, run: OrchestrationRun): StudioDb {
  return { ...db, orchestrationRuns: [...db.orchestrationRuns, run] };
}

function addAudit(db: StudioDb, at: string, actor: Actor, action: string, entityId: string, detail: string): StudioDb {
  const ided = allocId(db, "aud");
  return {
    ...ided.db,
    audit: [
      ...ided.db.audit,
      {
        id: ided.id,
        at,
        actorType: actor.type,
        actorId: actor.id,
        action,
        entityType: "agent_task",
        entityId,
        detail,
      },
    ],
  };
}

function contextFor(db: StudioDb, episodeId: string | null, storyId: string | null, storyVersion: number | null): AgentTaskContext {
  const snap = db.canonSnapshots[db.canonSnapshots.length - 1];
  return {
    studio: db.studio?.name ?? "",
    brand: db.brand?.name ?? "",
    universe: db.universe?.name ?? "",
    world: db.world?.name ?? "",
    targetAge: db.studio?.ageBand ?? "",
    canonVersion: snap?.canonVersion ?? "",
    canonSnapshotHash: snap?.hash ?? "",
    episodeId,
    storyId,
    storyVersion,
  };
}

function artifactsOf(input: TaskRequest): TaskArtifactRef[] {
  const refs: TaskArtifactRef[] = [];
  if (input.storyId) refs.push({ type: "story", id: input.storyId, version: null, label: "story" });
  if (input.scriptId) refs.push({ type: "script", id: input.scriptId, version: null, label: "script" });
  if (input.storyboardId) refs.push({ type: "storyboard", id: input.storyboardId, version: null, label: "storyboard" });
  if (input.characterId) refs.push({ type: "character", id: input.characterId, version: null, label: "character" });
  if (input.episodeId) refs.push({ type: "episode", id: input.episodeId, version: null, label: "episode" });
  return refs;
}

function authorize(task: AgentTask): string | null {
  if (FORBIDDEN_TASKS.has(task.taskType) || FORBIDDEN_GRANTS.some((grant) => task.taskType.includes(grant.toLowerCase()))) {
    return "Agents cannot approve, publish, clear rights, or lower a threshold. The task was not executed.";
  }
  const rule = TASK_RULES[task.taskType];
  if (!rule) return `No orchestrated task “${task.taskType}”. Nothing was executed.`;
  const agent = getAgent(task.agentId);
  if (!agent) return "Unknown agent. Nothing was executed.";
  if (agent.status !== "IMPLEMENTED") return `${agent.name} is ${agent.status}. The orchestrator will not pretend this agent ran.`;
  if (!rule.agents.includes(agent.id)) return `${agent.name} cannot be assigned ${task.taskType}.`;
  if (!agent.grants.includes(rule.grant) || rule.reads.some((needed) => !agent.grants.includes(needed))) {
    return `${agent.name} lacks ${rule.grant}. The task was not executed.`;
  }
  if (agent.grants.some((grant) => FORBIDDEN_GRANTS.includes(grant))) {
    return `${agent.name} holds a forbidden grant. The task was not executed.`;
  }
  if (!task.canonVersion || !task.canonSnapshotHash) return "No canon snapshot is available. The task was not executed.";
  return null;
}

function finish(
  db: StudioDb,
  task: AgentTask,
  actor: Actor,
  at: string,
  status: AgentTaskStatus,
  error: string | null,
  errorCode: string | null,
  blockedReason: string | null,
  outputs: TaskArtifactRef[],
  validations: TaskValidation[],
  runStatus: OrchestrationRun["status"],
): StudioDb {
  const agent = getAgent(task.agentId);
  const completed = status === "COMPLETED" || status === "BLOCKED" || status === "FAILED" || status === "REQUIRES_HUMAN_REVIEW";
  const nextTask: AgentTask = {
    ...task,
    status,
    error,
    errorCode,
    blockedReason,
    outputArtifacts: outputs.length ? outputs : task.outputArtifacts,
    validationResults: validations.length ? validations : task.validationResults,
    startedAt: task.startedAt ?? at,
    completedAt: completed ? at : task.completedAt,
    updatedAt: at,
  };
  const ided = allocId(putTask(db, nextTask), "orun");
  const run: OrchestrationRun = {
    id: ided.id,
    taskId: task.id,
    agentId: task.agentId,
    agentVersion: agent?.version ?? 0,
    modelProvider: agent?.modelConfig.provider ?? "development",
    model: agent?.modelConfig.model ?? "dev-template-v1",
    modelParameters: agent ? `temperature=${agent.modelConfig.temperature};structured=${agent.modelConfig.structuredOutput}` : "none",
    inputHash: fingerprint({ context: task.context, instructions: task.instructions, input: task.inputArtifacts }),
    outputHash: fingerprint({ outputs: nextTask.outputArtifacts, validations: nextTask.validationResults }),
    startedAt: at,
    completedAt: at,
    status: runStatus,
    error,
  };
  return addAudit(addRun(ided.db, run), at, actor, `orchestrator.${status.toLowerCase()}`, task.id, error ?? task.instructions);
}

function queueRevision(
  db: StudioDb,
  task: AgentTask,
  actor: Actor,
  at: string,
  failed: { type: string; id: string; version: number | null },
  reason: string,
  validation: string,
  requiredChange: string,
  stage: string,
  followUpType: string,
): StudioDb {
  const followId = allocId(db, "task");
  const follow: AgentTask = {
    ...task,
    id: followId.id,
    taskType: followUpType,
    instructions: "REPAIR",
    status: "QUEUED",
    priority: "HIGH",
    createdAt: at,
    startedAt: null,
    completedAt: null,
    updatedAt: at,
    outputArtifacts: [],
    validationResults: [],
    error: null,
    errorCode: null,
    blockedReason: null,
    createdBy: actor.id,
  };
  const revId = allocId(putTask(followId.db, follow), "arev");
  const revision: AgentRevisionRequest = {
    id: revId.id,
    at,
    originalTaskId: task.id,
    failedArtifactType: failed.type,
    failedArtifactId: failed.id,
    failedVersion: failed.version,
    failureReason: reason,
    validationResult: validation,
    requiredChange,
    affectedStage: stage,
    followUpTaskId: follow.id,
    status: "OPEN",
  };
  return addAudit(
    { ...revId.db, agentRevisions: [...revId.db.agentRevisions, revision] },
    at,
    actor,
    "orchestrator.revision_requested",
    task.id,
    `${reason} Previous version kept. Follow-up ${follow.id} is queued and was not auto-run.`,
  );
}

function scriptOf(db: StudioDb, episodeId: string | null, explicit?: string | null) {
  if (explicit) return db.scripts.find((item) => item.id === explicit);
  const episode = episodeId ? db.episodes.find((item) => item.id === episodeId) : undefined;
  const scriptId = episode ? latestSnapshot(episode).snapshot.scriptId : null;
  return scriptId ? db.scripts.find((item) => item.id === scriptId) : undefined;
}

function runHandler(db: StudioDb, task: AgentTask, at: string): {
  db: StudioDb;
  status: AgentTaskStatus;
  error: string | null;
  errorCode: string | null;
  blockedReason: string | null;
  outputs: TaskArtifactRef[];
  validations: TaskValidation[];
  revise: { type: string; id: string; version: number | null; reason: string; validation: string; change: string; stage: string; followUp: string } | null;
} {
  const empty = { outputs: [] as TaskArtifactRef[], validations: [] as TaskValidation[], revise: null };
  if (task.taskType === "script.draft") {
    const episode = task.episodeId ? db.episodes.find((item) => item.id === task.episodeId) : undefined;
    if (!episode) return { ...empty, db, status: "BLOCKED", error: "Episode missing.", errorCode: "STATE", blockedReason: "Episode missing." };
    const snap = latestSnapshot(episode).snapshot;
    if (snap.stage !== "STORY_APPROVED" && snap.stage !== "SCRIPT_DRAFT") {
      return { ...empty, db, status: "BLOCKED", error: "Script drafting is closed for this episode. It was not regenerated.", errorCode: "STATE", blockedReason: "Wrong stage." };
    }
    if (snap.scriptId) {
      return {
        ...empty,
        db,
        status: "COMPLETED",
        error: null,
        errorCode: null,
        blockedReason: null,
        outputs: [{ type: "script", id: snap.scriptId, version: snap.scriptVersion, label: "DEVELOPMENT DRAFT" }],
        validations: [{ name: "idempotent", result: "PASS", detail: "Existing script kept. No second draft was created." }],
      };
    }
    const drafted = generateScript(db, snap.storyId, task.agentId, at);
    if (!drafted.ok) {
      return { ...empty, db: drafted.db, status: "BLOCKED", error: drafted.error, errorCode: "VALIDATION", blockedReason: drafted.error };
    }
    const script = drafted.db.scripts.find((item) => item.id === drafted.data.scriptId);
    const body = script ? latestSnapshot(script).snapshot : null;
    const story = drafted.db.stories.find((item) => item.id === snap.storyId);
    const storySnap = story?.versions.find((item) => item.version === body?.storyVersion)?.snapshot ?? null;
    const canon = body && script ? validateSubject(drafted.db, { kind: "script", id: script.id, version: script.currentVersion, body }) : null;
    const consistency = body && storySnap ? validateStoryConsistency(storySnap, body) : { result: "FAIL" as const, failures: [] };
    const age = body ? validateAgeSuitability(body, body.ageBand) : { result: "FAIL" as const, detail: "No script." };
    const validations: TaskValidation[] = [
      { name: "canon", result: canon?.result ?? "FAIL", detail: canon?.violations[0]?.rule ?? "Canon check." },
      { name: "story-consistency", result: consistency.result, detail: consistency.result === "FAIL" ? (consistency.failures[0]?.detail ?? "Drift.") : "Matches the approved story." },
      { name: "age", result: age.result, detail: age.detail },
      { name: "label", result: "PASS", detail: "DEVELOPMENT DRAFT. Not approved." },
    ];
    const bad = canon?.result === "FAIL" || canon?.result === "BLOCKED" || consistency.result === "FAIL" || age.result === "FAIL";
    return {
      db: drafted.db,
      status: bad ? "BLOCKED" : "COMPLETED",
      error: bad ? validations.find((item) => item.result === "FAIL" || item.result === "BLOCKED")?.detail ?? "Validation failed." : null,
      errorCode: bad ? "VALIDATION" : null,
      blockedReason: bad ? "Script validation failed. The draft was not approved and the story was not rewritten." : null,
      outputs: [{ type: "script", id: drafted.data.scriptId, version: script?.currentVersion ?? 1, label: "DEVELOPMENT DRAFT" }],
      validations,
      revise: bad
        ? {
            type: "script",
            id: drafted.data.scriptId,
            version: script?.currentVersion ?? 1,
            reason: "Script validation failed.",
            validation: validations.map((item) => `${item.name} ${item.result}`).join("; "),
            change: "Repair the draft in a new version. Do not overwrite this one.",
            stage: "SCRIPT_DRAFT",
            followUp: "script.revise",
          }
        : null,
    };
  }

  if (task.taskType === "script.revise") {
    const script = scriptOf(db, task.episodeId, task.inputArtifacts.find((item) => item.type === "script")?.id);
    if (!script) return { ...empty, db, status: "BLOCKED", error: "Script missing.", errorCode: "STATE", blockedReason: "Script missing." };
    if (task.instructions === "REPAIR") {
      return {
        ...empty,
        db,
        status: "BLOCKED",
        error: "No revised script was supplied. The failed version was not overwritten.",
        errorCode: "VALIDATION",
        blockedReason: "Repair is not automatic.",
      };
    }
    if (task.instructions !== "CANON_AGE_PROBE") {
      return { ...empty, db, status: "BLOCKED", error: "A script revision needs a recorded failure. Nothing was rewritten.", errorCode: "STATE", blockedReason: "No failure context." };
    }
    const before = canonicalOf(script)?.snapshot ?? latestSnapshot(script).snapshot;
    const drifted = proposeScriptDrift(db, script.id, task.agentId, at);
    if (!drifted.ok) return { ...empty, db: drifted.db, status: "BLOCKED", error: drifted.error, errorCode: "VALIDATION", blockedReason: drifted.error };
    const after = drifted.db.scripts.find((item) => item.id === script.id);
    const canonicalSame = JSON.stringify(canonicalOf(after ?? script)?.snapshot.scenes ?? before.scenes) === JSON.stringify(before.scenes);
    return {
      db: drifted.db,
      status: "BLOCKED",
      error: "CANON FAIL. The contradictory line was not approved.",
      errorCode: "VALIDATION",
      blockedReason: "Canon validation failed. Workflow stopped.",
      outputs: [{ type: "script", id: script.id, version: after?.currentVersion ?? null, label: "DEVELOPMENT DRAFT" }],
      validations: [{ name: "canon", result: "FAIL", detail: canonicalSame ? "Canonical script text unchanged." : "Canonical text moved. This should not happen." }],
      revise: {
        type: "script",
        id: script.id,
        version: after?.currentVersion ?? null,
        reason: "Hard canon contradiction.",
        validation: "CANON FAIL",
        change: "Remove the contradicting line in a new version.",
        stage: "SCRIPT_DRAFT",
        followUp: "script.revise",
      },
    };
  }

  if (task.taskType === "language.review") {
    const script = scriptOf(db, task.episodeId, task.inputArtifacts.find((item) => item.type === "script")?.id);
    if (!script) return { ...empty, db, status: "BLOCKED", error: "Script missing.", errorCode: "STATE", blockedReason: "Script missing." };
    const reviewed = reviewHindi(db, script.id, task.agentId, at);
    if (!reviewed.ok) return { ...empty, db: reviewed.db, status: "FAILED", error: reviewed.error, errorCode: "TECHNICAL", blockedReason: null };
    const result = reviewed.data.review.toUpperCase();
    return {
      db: reviewed.db,
      status: "COMPLETED",
      error: null,
      errorCode: null,
      blockedReason: result === "FAIL" ? "Hindi review failed. Not approved." : null,
      outputs: [{ type: "script", id: script.id, version: reviewed.data.version, label: "LANGUAGE REVIEW" }],
      validations: [{ name: "hindi", result, detail: "Language review is not script approval." }],
      revise: null,
    };
  }

  if (task.taskType === "culture.review") {
    const script = scriptOf(db, task.episodeId, task.inputArtifacts.find((item) => item.type === "script")?.id);
    if (!script) return { ...empty, db, status: "BLOCKED", error: "Script missing.", errorCode: "STATE", blockedReason: "Script missing." };
    const reviewed = reviewCulture(db, script.id, task.agentId, at);
    if (!reviewed.ok) return { ...empty, db: reviewed.db, status: "FAILED", error: reviewed.error, errorCode: "TECHNICAL", blockedReason: null };
    return {
      db: reviewed.db,
      status: "COMPLETED",
      error: null,
      errorCode: null,
      blockedReason: reviewed.data.result === "FAIL" ? "Cultural review failed. It does not override the Hindi review." : null,
      outputs: [{ type: "script", id: script.id, version: reviewed.data.version, label: "CULTURAL REVIEW" }],
      validations: [{ name: "culture", result: reviewed.data.result, detail: "Cultural review is an opinion. It does not approve the script." }],
      revise: null,
    };
  }

  if (task.taskType === "storyboard.draft") {
    const script = scriptOf(db, task.episodeId, task.inputArtifacts.find((item) => item.type === "script")?.id);
    if (!script?.canonicalVersion) {
      return { ...empty, db, status: "BLOCKED", error: "Storyboard waits for a human-approved script.", errorCode: "STATE", blockedReason: "Script is not approved." };
    }
    const episode = task.episodeId ? db.episodes.find((item) => item.id === task.episodeId) : undefined;
    const stage = episode ? latestSnapshot(episode).snapshot.stage : null;
    if (stage !== "SCRIPT_APPROVED") {
      return { ...empty, db, status: "BLOCKED", error: "Storyboard is not started from this stage. Nothing was regenerated.", errorCode: "STATE", blockedReason: "Wrong stage." };
    }
    const existing = episode ? latestSnapshot(episode).snapshot.storyboardId : null;
    if (existing) {
      return {
        ...empty,
        db,
        status: "COMPLETED",
        error: null,
        errorCode: null,
        blockedReason: null,
        outputs: [{ type: "storyboard", id: existing, version: null, label: "STORYBOARD DRAFT" }],
        validations: [{ name: "idempotent", result: "PASS", detail: "Existing storyboard kept." }],
      };
    }
    const boarded = generateStoryboard(db, script.id, task.agentId, at);
    if (!boarded.ok) return { ...empty, db: boarded.db, status: "BLOCKED", error: boarded.error, errorCode: "VALIDATION", blockedReason: boarded.error };
    const board = boarded.db.storyboards.find((item) => item.id === boarded.data.storyboardId);
    const boardSnap = board ? latestSnapshot(board).snapshot : null;
    const scriptSnap = canonicalOf(script)?.snapshot ?? latestSnapshot(script).snapshot;
    const consistency = boardSnap ? validateBoardConsistency(scriptSnap, boardSnap) : { result: "FAIL" as const, failures: [] };
    const canon = board && boardSnap ? validateSubject(boarded.db, { kind: "storyboard", id: board.id, version: board.currentVersion, body: boardSnap }) : null;
    const validations: TaskValidation[] = [
      { name: "canon", result: canon?.result ?? "FAIL", detail: "Storyboard canon check." },
      { name: "script-consistency", result: consistency.result, detail: consistency.result === "FAIL" ? (consistency.failures[0]?.detail ?? "Drift.") : "Matches the approved script." },
      { name: "label", result: "PASS", detail: "STORYBOARD DRAFT. Not approved." },
    ];
    const bad = canon?.result === "FAIL" || canon?.result === "BLOCKED" || consistency.result === "FAIL";
    return {
      db: boarded.db,
      status: bad ? "BLOCKED" : "COMPLETED",
      error: bad ? "Storyboard validation failed." : null,
      errorCode: bad ? "VALIDATION" : null,
      blockedReason: bad ? "Storyboard validation failed. It was not approved." : null,
      outputs: [{ type: "storyboard", id: boarded.data.storyboardId, version: board?.currentVersion ?? 1, label: "STORYBOARD DRAFT" }],
      validations,
      revise: bad
        ? {
            type: "storyboard",
            id: boarded.data.storyboardId,
            version: board?.currentVersion ?? 1,
            reason: "Storyboard validation failed.",
            validation: validations.map((item) => `${item.name} ${item.result}`).join("; "),
            change: "Revise in a new version.",
            stage: "STORYBOARD",
            followUp: "storyboard.revise",
          }
        : null,
    };
  }

  if (task.taskType === "storyboard.revise") {
    const boardId = task.inputArtifacts.find((item) => item.type === "storyboard")?.id;
    const episode = task.episodeId ? db.episodes.find((item) => item.id === task.episodeId) : undefined;
    const id = boardId ?? (episode ? latestSnapshot(episode).snapshot.storyboardId : null);
    const board = id ? db.storyboards.find((item) => item.id === id) : undefined;
    if (!board) return { ...empty, db, status: "BLOCKED", error: "Storyboard missing.", errorCode: "STATE", blockedReason: "Storyboard missing." };
    if (task.instructions === "REPAIR") {
      return { ...empty, db, status: "BLOCKED", error: "No revised storyboard was supplied. The failed version was not overwritten.", errorCode: "VALIDATION", blockedReason: "Repair is not automatic." };
    }
    if (task.instructions !== "STORY_DRIFT_PROBE") {
      return { ...empty, db, status: "BLOCKED", error: "A storyboard revision needs a recorded failure.", errorCode: "STATE", blockedReason: "No failure context." };
    }
    const previous = latestSnapshot(board).snapshot;
    const drifted = proposeStoryboardDrift(db, board.id, task.agentId, at);
    if (!drifted.ok) return { ...empty, db: drifted.db, status: "BLOCKED", error: drifted.error, errorCode: "VALIDATION", blockedReason: drifted.error };
    const after = drifted.db.storyboards.find((item) => item.id === board.id);
    const kept = after?.versions[0]?.snapshot.scenes.flatMap((scene) => scene.shots.map((shot) => shot.description)).join(" ") === previous.scenes.flatMap((scene) => scene.shots.map((shot) => shot.description)).join(" ");
    return {
      db: drifted.db,
      status: "BLOCKED",
      error: "Storyboard contradicts the approved script.",
      errorCode: "VALIDATION",
      blockedReason: "STORY CONSISTENCY FAIL. Workflow stopped.",
      outputs: [{ type: "storyboard", id: board.id, version: after?.currentVersion ?? null, label: "STORYBOARD DRAFT" }],
      validations: [{ name: "script-consistency", result: "FAIL", detail: kept ? "Version 1 kept." : "Version 1 changed." }],
      revise: {
        type: "storyboard",
        id: board.id,
        version: after?.currentVersion ?? null,
        reason: "Shot contradicts the approved script.",
        validation: "STORY CONSISTENCY FAIL",
        change: "Replace the contradicting shot in a new version.",
        stage: "STORYBOARD",
        followUp: "storyboard.revise",
      },
    };
  }

  if (task.taskType === "animation.package") {
    const episode = task.episodeId ? db.episodes.find((item) => item.id === task.episodeId) : undefined;
    const planId = episode ? latestSnapshot(episode).snapshot.planId : null;
    const plan = planId ? db.plans.find((item) => item.id === planId) : undefined;
    if (!plan) {
      return { ...empty, db, status: "BLOCKED", error: "No production plan. No render was invented.", errorCode: "STATE", blockedReason: "Plan missing." };
    }
    const body = latestSnapshot(plan).snapshot;
    const count = body.assetRequests?.length ?? 0;
    return {
      db,
      status: "COMPLETED",
      error: null,
      errorCode: null,
      blockedReason: null,
      outputs: [{ type: "production_plan", id: plan.id, version: plan.currentVersion, label: "ASSET REQUESTS" }],
      validations: [{ name: "provider", result: "NOT CONNECTED", detail: `${count} requests. No picture, voice, or music was rendered.` }],
      revise: null,
    };
  }

  if (task.taskType === "qa.review") {
    if (!task.episodeId) return { ...empty, db, status: "BLOCKED", error: "Episode missing.", errorCode: "STATE", blockedReason: "Episode missing." };
    const ran = runQa(db, task.episodeId, task.agentId, at);
    if (!ran.ok) return { ...empty, db: ran.db, status: "BLOCKED", error: ran.error, errorCode: "STATE", blockedReason: ran.error };
    return {
      db: ran.db,
      status: ran.data.failed ? "BLOCKED" : "COMPLETED",
      error: ran.data.failed ? "A quality gate failed." : null,
      errorCode: ran.data.failed ? "VALIDATION" : null,
      blockedReason: ran.data.failed ? "Quality review failed. Not approved." : null,
      outputs: [{ type: "episode", id: task.episodeId, version: null, label: "QUALITY REVIEW" }],
      validations: [{ name: "qa", result: ran.data.failed ? "FAIL" : "PASS", detail: "QA does not approve the episode." }],
      revise: null,
    };
  }

  if (task.taskType === "rights.review") {
    if (!task.episodeId) return { ...empty, db, status: "BLOCKED", error: "Episode missing.", errorCode: "STATE", blockedReason: "Episode missing." };
    const rights = evaluateRightsGate(db, task.episodeId);
    const ided = allocId(db, "qa");
    const review: QualityReview = {
      id: ided.id,
      at,
      gate: "rights",
      result: rights.result,
      redFlag: rights.redFlag,
      entityType: "episode",
      entityId: task.episodeId,
      version: 1,
      checks: rights.checks,
      agentId: task.agentId,
    };
    const next = { ...ided.db, qualityReviews: [...ided.db.qualityReviews, review] };
    return {
      db: next,
      status: "COMPLETED",
      error: null,
      errorCode: null,
      blockedReason: rights.redFlag ? "Commercial rights RED FLAG" : null,
      outputs: [{ type: "episode", id: task.episodeId, version: null, label: "RIGHTS REVIEW" }],
      validations: [{ name: "rights", result: rights.redFlag ? "RED FLAG" : rights.result, detail: rights.checks.map((check) => check.detail).join(" ") }],
      revise: null,
    };
  }

  if (task.taskType === "policy.review") {
    if (!task.episodeId) return { ...empty, db, status: "BLOCKED", error: "Episode missing.", errorCode: "STATE", blockedReason: "Episode missing." };
    const policy = evaluatePolicyGate(db, task.episodeId);
    const rightsRed = db.qualityReviews.some((review) => review.entityId === task.episodeId && review.redFlag);
    const ided = allocId(db, "qa");
    const review: QualityReview = {
      id: ided.id,
      at,
      gate: "policy",
      result: policy.result,
      redFlag: policy.redFlag,
      entityType: "episode",
      entityId: task.episodeId,
      version: 1,
      checks: policy.checks,
      agentId: task.agentId,
    };
    const next = { ...ided.db, qualityReviews: [...ided.db.qualityReviews, review] };
    return {
      db: next,
      status: policy.result === "FAIL" ? "BLOCKED" : "COMPLETED",
      error: policy.result === "FAIL" ? "Policy review failed." : null,
      errorCode: policy.result === "FAIL" ? "VALIDATION" : null,
      blockedReason: rightsRed ? "Rights red flag remains. Policy review does not clear it." : policy.result === "FAIL" ? "Policy block." : null,
      outputs: [{ type: "episode", id: task.episodeId, version: null, label: "POLICY REVIEW" }],
      validations: [{ name: "policy", result: policy.result, detail: rightsRed ? "Did not override rights and did not publish." : "Did not approve publication." }],
      revise: null,
    };
  }

  if (task.taskType === "canon.propose") {
    const characterId = task.inputArtifacts.find((item) => item.type === "character")?.id;
    if (!characterId) return { ...empty, db, status: "BLOCKED", error: "Canon proposal needs a character.", errorCode: "STATE", blockedReason: "Character missing." };
    const proposed = proposeCanonChange(
      db,
      { entityId: characterId, field: "age", proposedValue: "6", reason: "Orchestrated proposal only. Not a canon edit." },
      { type: "agent", id: task.agentId, name: getAgent(task.agentId)?.name ?? task.agentId },
      at,
    );
    if (!proposed.ok) return { ...empty, db: proposed.db, status: "BLOCKED", error: proposed.error, errorCode: "STATE", blockedReason: proposed.error };
    return {
      db: proposed.db,
      status: "REQUIRES_HUMAN_REVIEW",
      error: null,
      errorCode: null,
      blockedReason: "Canon change is proposed. The character was not edited.",
      outputs: [{ type: "canon_change", id: proposed.data.id, version: null, label: "CANON CHANGE REQUEST" }],
      validations: [{ name: "canon", result: "HUMAN", detail: "Agent cannot lock canon." }],
      revise: null,
    };
  }

  if (task.taskType === "story.change") {
    const storyId = task.storyId ?? task.inputArtifacts.find((item) => item.type === "story")?.id;
    const story = storyId ? db.stories.find((item) => item.id === storyId) : undefined;
    if (!story) return { ...empty, db, status: "BLOCKED", error: "Story missing.", errorCode: "STATE", blockedReason: "Story missing." };
    const version = story.canonicalVersion ?? latestSnapshot(story).version;
    const ided = allocId(db, "srev");
    const next: StudioDb = {
      ...ided.db,
      storyRevisionRequests: [
        ...ided.db.storyRevisionRequests,
        {
          id: ided.id,
          at,
          storyId: story.id,
          storyVersion: version,
          reason: task.instructions || "The approved story may need a creative change.",
          affected: "logline",
          proposedChange: "Human review only. The approved text stays.",
          impact: "Scripts and episodes that cite this version stay on it until a human revises.",
          taskId: task.id,
          status: "OPEN",
        },
      ],
    };
    return {
      db: next,
      status: "REQUIRES_HUMAN_REVIEW",
      error: null,
      errorCode: null,
      blockedReason: "Story revision requested. The approved story was not modified.",
      outputs: [{ type: "story_revision", id: ided.id, version, label: "STORY REVISION REQUEST" }],
      validations: [{ name: "story", result: "UNCHANGED", detail: `Version ${version} was not rewritten.` }],
      revise: null,
    };
  }

  if (task.taskType === "story.propose") {
    const before = new Set(db.stories.map((item) => item.id));
    const made = generateStoryCandidates(db, 1, task.agentId, at);
    if (!made.ok) return { ...empty, db: made.db, status: "BLOCKED", error: made.error, errorCode: "STATE", blockedReason: made.error };
    const created = made.db.stories.filter((item) => !before.has(item.id));
    return {
      db: made.db,
      status: "COMPLETED",
      error: null,
      errorCode: null,
      blockedReason: null,
      outputs: created.map((item) => ({ type: "story", id: item.id, version: item.currentVersion, label: "STORY PROPOSAL" })),
      validations: [{ name: "approval", result: "NONE", detail: "Proposal only. Not approved." }],
      revise: null,
    };
  }

  return { ...empty, db, status: "BLOCKED", error: "Unhandled task.", errorCode: "STATE", blockedReason: "Unhandled task." };
}

export function enqueueTask(db: StudioDb, input: TaskRequest, actor: Actor, now?: string): Op<{ taskId: string }> {
  const at = stamp(now);
  if (actor.type === "agent") return fail(db, "permission", "Agents cannot start or reroute a workflow.");
  const episode = input.episodeId ? db.episodes.find((item) => item.id === input.episodeId) : undefined;
  const episodeSnap = episode ? latestSnapshot(episode).snapshot : null;
  const storyId = input.storyId ?? episodeSnap?.storyId ?? null;
  const story = storyId ? db.stories.find((item) => item.id === storyId) : undefined;
  const storyVersion = story?.canonicalVersion ?? (story ? latestSnapshot(story).version : episodeSnap?.storyVersion ?? null);
  const context = contextFor(db, input.episodeId ?? null, storyId, storyVersion);
  const ided = allocId(db, "task");
  const task: AgentTask = {
    id: ided.id,
    agentId: input.agentId,
    taskType: input.taskType,
    episodeId: input.episodeId ?? null,
    storyId,
    inputArtifacts: artifactsOf({ ...input, storyId }),
    inputVersions: [`story:${storyVersion ?? "none"}`, `canon:${context.canonVersion}`],
    context,
    canonVersion: context.canonVersion,
    canonSnapshotHash: context.canonSnapshotHash,
    instructions: input.instructions?.trim() || input.taskType,
    status: "QUEUED",
    priority: input.priority ?? "NORMAL",
    createdAt: at,
    startedAt: null,
    completedAt: null,
    updatedAt: at,
    outputArtifacts: [],
    validationResults: [],
    error: null,
    errorCode: null,
    blockedReason: null,
    createdBy: actor.id,
  };
  const next = addAudit(putTask(ided.db, task), at, actor, "orchestrator.queued", task.id, task.instructions);
  return { ok: true, db: next, data: { taskId: task.id } };
}

export function executeTask(db: StudioDb, taskId: string, actor: Actor, now?: string): Op<{ taskId: string; status: AgentTaskStatus }> {
  const at = stamp(now);
  const task = db.agentTasks.find((item) => item.id === taskId);
  if (!task) return fail(db, "missing", "Task not found.");
  if (actor.type === "agent" && actor.id !== task.agentId) {
    const blocked = finish(db, task, actor, at, "BLOCKED", "An agent cannot invoke another agent.", "PERMISSION", "Cross-agent call blocked.", [], [], "blocked");
    return fail(blocked, "permission", "An agent cannot invoke another agent.");
  }
  if (task.status === "COMPLETED" && task.outputArtifacts.length > 0) {
    const kept = finish(db, task, actor, at, "COMPLETED", null, null, null, task.outputArtifacts, [{ name: "idempotent", result: "PASS", detail: "Same task. Existing output kept. No duplicate artifact." }], "completed");
    return { ok: true, db: kept, data: { taskId, status: "COMPLETED" } };
  }
  if (task.status === "BLOCKED" || task.status === "REQUIRES_HUMAN_REVIEW" || task.status === "CANCELLED") {
    return fail(db, "state", "This task already stopped. It was not run again.");
  }
  if (task.status === "FAILED" && task.errorCode !== "TECHNICAL") {
    return fail(db, "revision", "Validation failures need a revision task, not a retry.");
  }
  const denied = authorize(task);
  if (denied) {
    const blocked = finish(db, { ...task, startedAt: at }, actor, at, "BLOCKED", denied, "PERMISSION", denied, [], [{ name: "permission", result: "BLOCKED", detail: denied }], "blocked");
    return fail(blocked, "permission", denied);
  }
  const running: AgentTask = { ...task, status: "RUNNING", startedAt: at, updatedAt: at };
  const handled = runHandler(putTask(db, running), running, at);
  let next = finish(
    handled.db,
    running,
    actor,
    at,
    handled.status,
    handled.error,
    handled.errorCode,
    handled.blockedReason,
    handled.outputs,
    handled.validations,
    handled.status === "COMPLETED" || handled.status === "REQUIRES_HUMAN_REVIEW" ? "completed" : handled.status === "FAILED" ? "failed" : "blocked",
  );
  if (handled.revise) {
    next = queueRevision(next, { ...running, id: task.id }, actor, at, handled.revise, handled.revise.reason, handled.revise.validation, handled.revise.change, handled.revise.stage, handled.revise.followUp);
  }
  if (handled.status === "FAILED") return fail(next, "technical", handled.error ?? "Agent execution failed.");
  if (handled.status === "BLOCKED" && handled.errorCode === "PERMISSION") return fail(next, "permission", handled.error ?? "Blocked.");
  return { ok: true, db: next, data: { taskId, status: handled.status } };
}

export function recordTechnicalFailure(db: StudioDb, taskId: string, error: string, actor: Actor, now?: string): Op<{ taskId: string }> {
  const at = stamp(now);
  if (actor.type !== "human") return fail(db, "human-required", "Only a human can record a provider failure.");
  const task = db.agentTasks.find((item) => item.id === taskId);
  if (!task) return fail(db, "missing", "Task not found.");
  if (task.status !== "QUEUED" && task.status !== "READY" && task.status !== "RUNNING") {
    return fail(db, "state", "A validation block is not a technical retry.");
  }
  const next = finish(db, task, actor, at, "FAILED", error, "TECHNICAL", null, [], [{ name: "provider", result: "FAILED", detail: error }], "failed");
  return { ok: true, db: next, data: { taskId } };
}

export function retryTask(db: StudioDb, taskId: string, actor: Actor, now?: string): Op<{ taskId: string; status: AgentTaskStatus }> {
  const task = db.agentTasks.find((item) => item.id === taskId);
  if (!task) return fail(db, "missing", "Task not found.");
  if (task.status !== "FAILED" || task.errorCode !== "TECHNICAL") {
    return fail(db, "revision", "Only a technical failure can be retried. A canon or story failure needs a revision task.");
  }
  return executeTask(db, taskId, actor, now);
}

function runOne(db: StudioDb, input: TaskRequest, actor: Actor, now?: string): Op<{ taskId: string; status: AgentTaskStatus }> {
  const queued = enqueueTask(db, input, actor, now);
  if (!queued.ok) return queued;
  return executeTask(queued.db, queued.data.taskId, actor, now);
}

function humanStop(db: StudioDb, episodeId: string, storyId: string | null, actor: Actor, at: string, taskType: string, detail: string, priority: AgentTaskPriority): Op<{ taskId: string; status: AgentTaskStatus }> {
  const queued = enqueueTask(db, { taskType, agentId: "orchestrator", episodeId, storyId, priority, instructions: detail }, actor, at);
  if (!queued.ok) return queued;
  const task = queued.db.agentTasks.find((item) => item.id === queued.data.taskId);
  if (!task) return fail(queued.db, "missing", "Human gate missing.");
  const stopped: AgentTask = { ...task, status: "REQUIRES_HUMAN_REVIEW", blockedReason: detail, updatedAt: at, completedAt: at, validationResults: [{ name: "human", result: "REQUIRES_HUMAN_REVIEW", detail }] };
  return { ok: true, db: putTask(queued.db, stopped), data: { taskId: task.id, status: "REQUIRES_HUMAN_REVIEW" } };
}

export function combineOpinions(opinions: Array<{ agent: string; result: string }>): { status: "REQUIRES_HUMAN_REVIEW"; detail: string } {
  const disagree = opinions.some((item) => item.result === "FAIL") && opinions.some((item) => item.result === "PASS" || item.result === "WARN");
  const listed = opinions.map((item) => `${item.agent} ${item.result}`).join(". ");
  if (disagree) return { status: "REQUIRES_HUMAN_REVIEW", detail: `${listed}. Neither review overrides the other.` };
  if (opinions.some((item) => item.result === "FAIL")) return { status: "REQUIRES_HUMAN_REVIEW", detail: `${listed}. Workflow stopped for a human.` };
  return { status: "REQUIRES_HUMAN_REVIEW", detail: `${listed}. A human still has to approve. No agent approved this.` };
}

export function runScriptChain(db: StudioDb, episodeId: string, actor: Actor, now?: string): Op<{ taskId: string; status: AgentTaskStatus }> {
  const at = stamp(now);
  if (actor.type === "agent") return fail(db, "permission", "An agent cannot run the chain.");
  const episode = db.episodes.find((item) => item.id === episodeId);
  if (!episode) return fail(db, "missing", "Episode not found.");
  const snap = latestSnapshot(episode).snapshot;
  if (snap.stage !== "STORY_APPROVED" && snap.stage !== "SCRIPT_DRAFT") {
    return fail(db, "stage", "This episode is past script drafting. The orchestrator will not regenerate the script.");
  }
  let cursor = db;
  if (!snap.scriptId) {
    const drafted = runOne(cursor, { taskType: "script.draft", agentId: "agent_scriptwriter", episodeId, storyId: snap.storyId, priority: "NORMAL", instructions: "Hindi development draft from the approved story version." }, actor, at);
    if (!drafted.ok) return drafted;
    cursor = drafted.db;
    if (drafted.data.status !== "COMPLETED") return drafted;
  }
  const current = cursor.episodes.find((item) => item.id === episodeId);
  const scriptId = current ? latestSnapshot(current).snapshot.scriptId : null;
  const script = scriptId ? cursor.scripts.find((item) => item.id === scriptId) : undefined;
  if (!script) return fail(cursor, "missing", "Script draft missing.");
  if (realDrafts(cursor).some((item) => item.scriptId === script.id)) {
    return humanStop(cursor, episodeId, snap.storyId, actor, at, "language.review", "This is a real text draft. Review it in Hindi editorial review. The orchestrator will not rewrite it.", "HIGH");
  }
  let body = latestSnapshot(script).snapshot;
  if (body.languageReview === "pending" || body.languageReview === "fail") {
    const reviewed = runOne(cursor, { taskType: "language.review", agentId: "agent_hindi_editor", episodeId, scriptId: script.id, storyId: snap.storyId, instructions: "Review Hindi. Do not approve." }, actor, at);
    if (!reviewed.ok) return reviewed;
    cursor = reviewed.db;
  }
  const afterHindi = cursor.scripts.find((item) => item.id === script.id);
  body = afterHindi ? latestSnapshot(afterHindi).snapshot : body;
  const culture = [...cursor.qualityReviews].reverse().find((review) => review.gate === "culture" && review.entityId === script.id && review.version === (afterHindi?.currentVersion ?? script.currentVersion));
  if (!culture) {
    const reviewed = runOne(cursor, { taskType: "culture.review", agentId: "agent_cultural_reviewer", episodeId, scriptId: script.id, storyId: snap.storyId, instructions: "Review cultural specificity. Do not approve." }, actor, at);
    if (!reviewed.ok) return reviewed;
    cursor = reviewed.db;
  }
  const hindiAgent = getAgent("agent_hindi_editor");
  const cultureAgent = getAgent("agent_cultural_reviewer");
  const hindiResult = (cursor.scripts.find((item) => item.id === script.id) ? latestSnapshot(cursor.scripts.find((item) => item.id === script.id)!).snapshot.languageReview : body.languageReview).toUpperCase();
  const cultureResult = [...cursor.qualityReviews].reverse().find((review) => review.gate === "culture" && review.entityId === script.id)?.result ?? "FAIL";
  const decision = combineOpinions([
    { agent: hindiAgent?.name ?? "Hindi Language Editor", result: hindiResult },
    { agent: cultureAgent?.name ?? "Cultural Reviewer", result: cultureResult },
  ]);
  return humanStop(cursor, episodeId, snap.storyId, actor, at, "human.script_approval", decision.detail, cultureResult === "FAIL" || hindiResult === "FAIL" ? "HIGH" : "NORMAL");
}

export function runStoryboardChain(db: StudioDb, episodeId: string, actor: Actor, now?: string): Op<{ taskId: string; status: AgentTaskStatus }> {
  const at = stamp(now);
  if (actor.type === "agent") return fail(db, "permission", "An agent cannot run the chain.");
  const episode = db.episodes.find((item) => item.id === episodeId);
  if (!episode) return fail(db, "missing", "Episode not found.");
  const snap = latestSnapshot(episode).snapshot;
  const script = snap.scriptId ? db.scripts.find((item) => item.id === snap.scriptId) : undefined;
  if (!script?.canonicalVersion) return fail(db, "script", "The orchestrator will not storyboard an unapproved script.");
  const culture = [...db.qualityReviews].reverse().find((review) => review.gate === "culture" && review.entityId === script.id);
  if (culture?.result === "FAIL") return fail(db, "human-review", "Cultural review failed. The orchestrator will not start a storyboard over that disagreement.");
  const openRevision = db.agentRevisions.some((item) => item.failedArtifactId === script.id && item.status === "OPEN");
  const latestCanon = [...db.canonValidations].reverse().find((item) => item.entityType === "script" && item.entityId === script.id);
  if (openRevision || (latestCanon && latestCanon.version === script.currentVersion && (latestCanon.validation.result === "FAIL" || latestCanon.validation.result === "BLOCKED"))) {
    return fail(db, "validation", "Script validation failed. The workflow is stopped until a human reviews the revision.");
  }
  if (snap.stage !== "SCRIPT_APPROVED") return fail(db, "stage", "Storyboard generation stays on the approved-script stage. This episode was not regenerated.");
  let cursor = db;
  if (!snap.storyboardId) {
    const boarded = runOne(cursor, { taskType: "storyboard.draft", agentId: "agent_storyboard_director", episodeId, scriptId: script.id, storyId: snap.storyId, instructions: "Storyboard draft from the approved script." }, actor, at);
    if (!boarded.ok) return boarded;
    cursor = boarded.db;
    if (boarded.data.status !== "COMPLETED") return boarded;
  }
  const planned = cursor.episodes.find((item) => item.id === episodeId);
  if (planned && latestSnapshot(planned).snapshot.planId) {
    const packed = runOne(cursor, { taskType: "animation.package", agentId: "agent_animation_producer", episodeId, storyId: snap.storyId, instructions: "Record asset requests. Do not render." }, actor, at);
    if (!packed.ok) return packed;
    cursor = packed.db;
  }
  return humanStop(cursor, episodeId, snap.storyId, actor, at, "human.storyboard_approval", "Storyboard draft is ready. A human has to approve it. No agent can.", "NORMAL");
}

export function holdWorkflow(db: StudioDb, episodeId: string, actor: Actor, now?: string): Op<{ taskId: string; status: AgentTaskStatus }> {
  const at = stamp(now);
  if (actor.type === "agent") return fail(db, "permission", "An agent cannot clear a hold.");
  const episode = db.episodes.find((item) => item.id === episodeId);
  if (!episode) return fail(db, "missing", "Episode not found.");
  const snap = latestSnapshot(episode).snapshot;
  const red = db.qualityReviews.some((review) => review.entityId === episodeId && review.redFlag);
  const reason = red ? "Commercial rights RED FLAG" : snap.holdReason || "Publishing is disabled.";
  const queued = enqueueTask(db, {
    taskType: "workflow.hold",
    agentId: red ? "agent_rights" : "orchestrator",
    episodeId,
    storyId: snap.storyId,
    priority: "BLOCKING",
    instructions: `${reason} Existing script, storyboard, and plan were not regenerated.`,
  }, actor, at);
  if (!queued.ok) return queued;
  const task = queued.db.agentTasks.find((item) => item.id === queued.data.taskId);
  if (!task) return fail(queued.db, "missing", "Hold missing.");
  const held: AgentTask = {
    ...task,
    status: "BLOCKED",
    priority: "BLOCKING",
    blockedReason: reason,
    error: "Workflow cannot advance through this gate.",
    errorCode: red ? "RIGHTS" : "PUBLISH",
    updatedAt: at,
    completedAt: at,
    validationResults: [{ name: red ? "rights" : "publish", result: red ? "RED FLAG" : "BLOCKED", detail: reason }],
  };
  const next = finish(putTask(queued.db, held), held, actor, at, "BLOCKED", held.error, held.errorCode, reason, [], held.validationResults, "blocked");
  return { ok: true, db: next, data: { taskId: task.id, status: "BLOCKED" } };
}

export function nextOrchestratedStep(db: StudioDb, episodeId: string, actor: Actor, now?: string): Op<{ taskId: string; status: AgentTaskStatus }> {
  const episode = db.episodes.find((item) => item.id === episodeId);
  if (!episode) return fail(db, "missing", "Episode not found.");
  const stage = latestSnapshot(episode).snapshot.stage;
  if (stage === "STORY_APPROVED" || stage === "SCRIPT_DRAFT") return runScriptChain(db, episodeId, actor, now);
  if (stage === "SCRIPT_APPROVED") return runStoryboardChain(db, episodeId, actor, now);
  return holdWorkflow(db, episodeId, actor, now);
}

export function decideStoryRevision(
  db: StudioDb,
  requestId: string,
  decision: "ACCEPTED" | "REJECTED",
  actor: Actor,
  note: string,
  now?: string,
): Op<{ id: string }> {
  const at = stamp(now);
  if (actor.type !== "human") return fail(db, "human-required", "Only a human can decide a story revision request.");
  if (note.trim().length < 8) return fail(db, "note", "Write the decision.");
  const request = db.storyRevisionRequests.find((item) => item.id === requestId);
  if (!request || request.status !== "OPEN") return fail(db, "missing", "No open story revision request.");
  const story = db.stories.find((item) => item.id === request.storyId);
  const before = story ? JSON.stringify(story.versions) : "";
  const next: StudioDb = {
    ...db,
    storyRevisionRequests: db.storyRevisionRequests.map((item) =>
      item.id === requestId ? { ...item, status: decision, decidedAt: at, decidedById: actor.id } : item,
    ),
  };
  const after = next.stories.find((item) => item.id === request.storyId);
  if (story && after && JSON.stringify(after.versions) !== before) return fail(db, "story", "Deciding a request must not rewrite the story.");
  return { ok: true, db: addAudit(next, at, actor, "story.revision_decided", request.storyId, `${decision}. The approved story was not rewritten.`), data: { id: requestId } };
}
