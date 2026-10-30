import { allocId, latestSnapshot, publishEpisode } from "./engine.ts";
import { LIVE_TEXT_PROVIDER_ID } from "./text.ts";
import type {
  Actor,
  AuditEvent,
  EditorialFinding,
  EditorialOutcome,
  EditorialReview,
  HumanApprovalRecord,
  Op,
  QARun,
  ScriptBody,
  StudioDb,
  VersionLink,
} from "./types.ts";

export const HINDI_REVIEW_TEMPLATE = { key: "HINDI_EDITORIAL", version: 1 } as const;
export const CULTURE_REVIEW_TEMPLATE = { key: "CULTURE_EDITORIAL", version: 1 } as const;

const HINDI_AGENT = "agent_hindi_editor";
const CULTURE_AGENT = "agent_cultural_reviewer";

export interface RealDraft {
  scriptId: string;
  title: string;
  storyId: string;
  storyTitle: string;
  storyVersion: number;
  canonSnapshotHash: string;
  canonVersion: string;
  executionId: string;
  promptKey: string;
  promptVersion: number;
  currentVersion: number;
}

export interface LineEdit {
  sceneNo: number;
  lineIndex: number;
  hi: string;
  en: string;
}

function stamp(now?: string): string {
  return now ?? new Date().toISOString();
}

function fail<T>(db: StudioDb, code: string, error: string): Op<T> {
  return { ok: false, db, code, error };
}

function audit(db: StudioDb, at: string, actor: Actor, action: string, entityType: string, entityId: string, detail: string, version?: number): StudioDb {
  const ided = allocId(db, "aud");
  const event: AuditEvent = { id: ided.id, at, actorType: actor.type, actorId: actor.id, action, entityType, entityId, version, detail };
  return { ...ided.db, audit: [...ided.db.audit, event] };
}

function reviewsOf(db: StudioDb): EditorialReview[] {
  return db.editorialReviews ?? [];
}

function outcomeOf(findings: EditorialFinding[]): EditorialOutcome {
  if (findings.some((item) => item.severity === "high")) return "REVISION_REQUIRED";
  if (findings.some((item) => item.severity === "medium")) return "WARNINGS";
  if (findings.some((item) => item.severity === "low")) return "HUMAN_REVIEW";
  return "PASS";
}

function finding(id: string, severity: EditorialFinding["severity"], explanation: string, suggestion: string, passage: string): EditorialFinding {
  return { id, severity, explanation, suggestion, passage, confidence: null };
}

function storyDrift(db: StudioDb, snap: ScriptBody): string | null {
  const story = db.stories.find((item) => item.id === snap.storyId);
  const storySnap = story?.versions.find((item) => item.version === snap.storyVersion)?.snapshot;
  const anchors = snap.storyAnchors;
  if (!storySnap || !anchors) return "The approved story version is not anchored on this script.";
  if (anchors.premise !== storySnap.logline) return "The premise left the approved logline.";
  if (anchors.mainConflict !== storySnap.mainConflict) return "The conflict left the approved story.";
  if (anchors.emotionalObjective !== storySnap.emotionalObjective) return "The emotional objective left the approved story.";
  if (anchors.learningObjective !== storySnap.learningObjective) return "The learning objective left the approved story.";
  if (anchors.resolution !== storySnap.resolution) return "The ending left the approved story.";
  if ([...anchors.characterIds].sort().join(",") !== [...storySnap.characterIds].sort().join(",")) return "The cast left the approved story.";
  return null;
}

export function realDrafts(db: StudioDb): RealDraft[] {
  const drafts: RealDraft[] = [];
  for (const script of db.scripts) {
    const original = script.versions.find((item) => item.version === 1);
    if (!original) continue;
    const snap = original.snapshot;
    if (snap.draftLabel !== "DEVELOPMENT DRAFT") continue;
    const execution = (db.aiExecutions ?? []).find((item) => item.id === snap.generationRunId);
    if (!execution || execution.providerId !== LIVE_TEXT_PROVIDER_ID) continue;
    if (execution.parameters.validation !== "PASS" || execution.promptVersion == null) continue;
    const story = db.stories.find((item) => item.id === snap.storyId);
    const storyVersion = story?.versions.find((item) => item.version === snap.storyVersion);
    if (!story || story.canonicalVersion == null || !storyVersion || storyVersion.status !== "approved") continue;
    if (storyVersion.snapshot.title === "Count the Thunder") continue;
    if (!snap.canonSnapshotHash || !snap.canonVersionUsed) continue;
    drafts.push({
      scriptId: script.id,
      title: snap.titleEn,
      storyId: story.id,
      storyTitle: storyVersion.snapshot.title,
      storyVersion: snap.storyVersion,
      canonSnapshotHash: snap.canonSnapshotHash,
      canonVersion: snap.canonVersionUsed,
      executionId: execution.id,
      promptKey: execution.promptKey,
      promptVersion: execution.promptVersion,
      currentVersion: script.currentVersion,
    });
  }
  return drafts;
}

function requireReal(db: StudioDb, scriptId: string): { ok: true; draft: RealDraft; script: StudioDb["scripts"][number] } | { ok: false; error: string; code: string } {
  const draft = realDrafts(db).find((item) => item.scriptId === scriptId);
  const script = db.scripts.find((item) => item.id === scriptId);
  if (!draft || !script) return { ok: false, code: "not-real", error: "No eligible real Hindi development draft. A template script is not a substitute, and Count the Thunder stays out." };
  return { ok: true, draft, script };
}

function hindiFindings(db: StudioDb, script: StudioDb["scripts"][number], version: number): EditorialFinding[] {
  const snap = script.versions.find((item) => item.version === version)?.snapshot;
  if (!snap) return [finding("missing", "high", "That script version is not on record.", "Review the version that exists.", "")];
  const findings: EditorialFinding[] = [];
  const drift = storyDrift(db, snap);
  if (drift) findings.push(finding("story", "high", drift, "Return to the approved premise, conflict, and ending.", snap.titleEn));
  for (const scene of snap.scenes) {
    for (const [index, line] of scene.lines.entries()) {
      const passage = `Scene ${scene.sceneNo}, line ${index + 1}: ${line.hi}`;
      if ((line.hi.match(/[\u0900-\u097F]/g) ?? []).length < 4) findings.push(finding(`devanagari-${scene.sceneNo}-${index}`, "high", "This spoken line does not have enough Hindi.", "Rewrite the line in simple spoken Hindi.", passage));
      if (/[A-Za-z]{2,}/.test(line.hi)) findings.push(finding(`english-${scene.sceneNo}-${index}`, "medium", "The Hindi line still contains English words.", "Replace the English with a word a three-to-five-year-old hears at home.", passage));
      if (/अतः|तथापि|अवलोकन|सादर|कृपया ध्यान/.test(line.hi) || line.hi.length > 48) findings.push(finding(`register-${scene.sceneNo}-${index}`, "medium", "The wording is long or more formal than speech for ages 3–5.", "Use one short spoken sentence.", passage));
      if (/बेवकूफ|मूर्ख|stupid/i.test(line.hi)) findings.push(finding(`voice-${scene.sceneNo}-${index}`, "high", "This line makes a character the joke.", "Keep Dadi kind and Meethi direct. Do not mock.", passage));
      if (/वह\s*।?$/.test(line.hi.trim())) findings.push(finding(`ambiguity-${scene.sceneNo}-${index}`, "low", "A bare pronoun is easy to mishear.", "Name the person or the thing.", passage));
    }
    if (/princess|magic wand|cape/i.test(scene.action)) findings.push(finding(`canon-${scene.sceneNo}`, "high", "The action uses a forbidden character variation.", "Stay with the locked clothes and the locked world.", scene.action));
  }
  findings.push(finding("limit", "info", "No rule in this review proves the Hindi is correct. A person still has to read it.", "Treat every finding as advice.", snap.titleHi));
  return findings;
}

function cultureFindings(db: StudioDb, script: StudioDb["scripts"][number], version: number): EditorialFinding[] {
  const snap = script.versions.find((item) => item.version === version)?.snapshot;
  if (!snap) return [finding("missing", "high", "That script version is not on record.", "Review the version that exists.", "")];
  const story = db.stories.find((item) => item.id === snap.storyId);
  const storySnap = story?.versions.find((item) => item.version === snap.storyVersion)?.snapshot ?? null;
  const text = snap.scenes.map((scene) => `${scene.action} ${scene.locationKey} ${scene.lines.map((line) => line.hi).join(" ")}`).join("\n");
  const findings: EditorialFinding[] = [];
  if (!storySnap) findings.push(finding("story", "high", "The approved story version is missing.", "Do not review a script that has lost its story.", snap.storyId));
  else if (storySnap.culturalSpecificity === "none" || storySnap.culturalElements.length === 0) findings.push(finding("element", "high", "The approved story has no specific cultural element.", "Do not invent a generic India to fill the gap.", storySnap.title));
  else if (storySnap.culturalSpecificity === "generic") findings.push(finding("element", "medium", "The cultural detail on the approved story is generic.", "A person should decide whether this episode is specific enough.", storySnap.culturalElements[0] ?? storySnap.title));
  if (/generic cartoon india|exotic india|festival lecture|costume india/i.test(text)) findings.push(finding("shorthand", "high", "The script uses a generic or careless stand-in for India.", "Use the lane, the people, and the object already in the story.", text.slice(0, 180)));
  if (/alpine/i.test(text)) findings.push(finding("alpine", "high", "The Alpine range is still a proposal. Naming it does not approve it.", "Keep the scene in an approved Gulmohar Gali location.", "alpine"));
  findings.push(finding("limit", "info", "This review does not prove the cultural reading is correct, and it does not clear rights.", "Keep both reviews. A person resolves a disagreement.", snap.titleEn));
  return findings;
}

function fileReview(db: StudioDb, draft: RealDraft, scriptVersion: number, kind: EditorialReview["kind"], agentId: string, findings: EditorialFinding[], at: string): { db: StudioDb; review: EditorialReview } {
  const ided = allocId(db, "ed");
  const review: EditorialReview = {
    id: ided.id,
    at,
    kind,
    outcome: outcomeOf(findings),
    scriptId: draft.scriptId,
    scriptVersion,
    storyId: draft.storyId,
    storyVersion: draft.storyVersion,
    canonSnapshotHash: draft.canonSnapshotHash,
    canonVersion: draft.canonVersion,
    agentId,
    templateKey: kind === "hindi" ? HINDI_REVIEW_TEMPLATE.key : CULTURE_REVIEW_TEMPLATE.key,
    templateVersion: kind === "hindi" ? HINDI_REVIEW_TEMPLATE.version : CULTURE_REVIEW_TEMPLATE.version,
    findings,
    disclaimer: kind === "hindi" ? "Hindi review is advice. It is not proof the Hindi is correct, and it is not approval." : "Cultural review is advice. It is not proof of cultural correctness, and it does not clear rights.",
    executionId: draft.executionId,
    promptKey: draft.promptKey,
    promptVersion: draft.promptVersion,
  };
  return { db: { ...ided.db, editorialReviews: [...reviewsOf(ided.db), review] }, review };
}

export function reviewHindiEditorial(db: StudioDb, scriptId: string, agentId: string, now?: string): Op<{ reviewId: string; outcome: EditorialOutcome; version: number }> {
  const at = stamp(now);
  const gate = requireReal(db, scriptId);
  if (!gate.ok) return fail(db, gate.code, gate.error);
  if (agentId !== HINDI_AGENT) return fail(db, "agent", "Only the Hindi language editor runs this review.");
  const version = gate.script.currentVersion;
  const before = JSON.stringify(gate.script.versions);
  const filed = fileReview(db, gate.draft, version, "hindi", agentId, hindiFindings(db, gate.script, version), at);
  const kept = filed.db.scripts.find((item) => item.id === scriptId);
  if (!kept || JSON.stringify(kept.versions) !== before) return fail(db, "history", "The Hindi review would have rewritten the script. Stopped.");
  const next = audit(filed.db, at, { type: "agent", id: agentId, name: "Hindi Language Editor" }, "editorial.hindi", "script", scriptId, `${filed.review.outcome}. Advisory only. v${version} was not rewritten.`, version);
  return { ok: true, db: next, data: { reviewId: filed.review.id, outcome: filed.review.outcome, version } };
}

export function reviewCultureEditorial(db: StudioDb, scriptId: string, agentId: string, now?: string): Op<{ reviewId: string; outcome: EditorialOutcome; version: number }> {
  const at = stamp(now);
  const gate = requireReal(db, scriptId);
  if (!gate.ok) return fail(db, gate.code, gate.error);
  if (agentId !== CULTURE_AGENT) return fail(db, "agent", "Only the cultural reviewer runs this review.");
  const version = gate.script.currentVersion;
  const before = JSON.stringify(gate.script.versions);
  const filed = fileReview(db, gate.draft, version, "culture", agentId, cultureFindings(db, gate.script, version), at);
  const kept = filed.db.scripts.find((item) => item.id === scriptId);
  if (!kept || JSON.stringify(kept.versions) !== before) return fail(db, "history", "The cultural review would have rewritten the script. Stopped.");
  const next = audit(filed.db, at, { type: "agent", id: agentId, name: "Cultural Reviewer" }, "editorial.culture", "script", scriptId, `${filed.review.outcome}. Advisory only. v${version} was not rewritten.`, version);
  return { ok: true, db: next, data: { reviewId: filed.review.id, outcome: filed.review.outcome, version } };
}

export function reviewsFor(db: StudioDb, scriptId: string, version: number, kind?: EditorialReview["kind"]): EditorialReview[] {
  return reviewsOf(db).filter((item) => item.scriptId === scriptId && item.scriptVersion === version && (kind ? item.kind === kind : true));
}

export function currentReviews(db: StudioDb, scriptId: string): { hindi: EditorialReview | null; culture: EditorialReview | null; disagreement: boolean } {
  const script = db.scripts.find((item) => item.id === scriptId);
  const version = script?.currentVersion ?? 0;
  const hindi = reviewsFor(db, scriptId, version, "hindi").at(-1) ?? null;
  const culture = reviewsFor(db, scriptId, version, "culture").at(-1) ?? null;
  return { hindi, culture, disagreement: Boolean(hindi && culture && hindi.outcome !== culture.outcome) };
}

export function reviseScript(db: StudioDb, scriptId: string, input: { reason: string; lines: LineEdit[]; acceptedFindingIds: string[] }, actor: Actor, now?: string): Op<{ version: number }> {
  const at = stamp(now);
  if (actor.type !== "human") return fail(db, "human-required", "An agent cannot revise the script into a new version.");
  const reason = input.reason.trim();
  if (reason.length < 12) return fail(db, "note", "Write why this version exists. Suggestions are not applied on their own.");
  const gate = requireReal(db, scriptId);
  if (!gate.ok) return fail(db, gate.code, gate.error);
  const current = gate.script.versions.find((item) => item.version === gate.script.currentVersion);
  if (!current) return fail(db, "missing", "Current script version is missing.");
  const snapshot: ScriptBody = structuredClone(current.snapshot);
  let changed = false;
  for (const edit of input.lines) {
    const scene = snapshot.scenes.find((item) => item.sceneNo === edit.sceneNo);
    const line = scene?.lines[edit.lineIndex];
    if (!line) return fail(db, "line", "That line is not on this script version.");
    if (line.hi !== edit.hi || line.en !== edit.en) changed = true;
    line.hi = edit.hi.trim();
    line.en = edit.en.trim();
  }
  if (!changed && input.acceptedFindingIds.length === 0 && !/reject/i.test(reason)) {
    return fail(db, "edit", "Change a line, accept a suggestion on purpose, or write that you rejected the suggestions. Nothing is applied automatically.");
  }
  snapshot.parentVersion = current.version;
  snapshot.revisionReason = reason;
  snapshot.lineage = "HUMAN_REVISED";
  snapshot.acceptedFindingIds = [...input.acceptedFindingIds];
  snapshot.generationRunId = current.snapshot.generationRunId;
  snapshot.languageReview = current.snapshot.languageReview;
  const version = gate.script.currentVersion + 1;
  const entity = {
    ...gate.script,
    currentVersion: version,
    canonicalVersion: gate.script.canonicalVersion,
    updatedAt: at,
    versions: [...gate.script.versions, { version, status: "draft" as const, snapshot, createdAt: at, createdBy: actor.id, note: reason, immutable: true }],
  };
  const parent = entity.versions.find((item) => item.version === current.version);
  if (!parent || JSON.stringify(parent.snapshot) !== JSON.stringify(current.snapshot)) return fail(db, "history", "The previous script version would have been rewritten. Stopped.");
  const linkId = allocId(db, "vlink");
  const link: VersionLink = { id: linkId.id, at, entityType: "script", entityId: scriptId, version, supersedesVersion: current.version, status: "DRAFT", createdBy: actor.id, reason };
  let next: StudioDb = {
    ...linkId.db,
    scripts: linkId.db.scripts.map((item) => (item.id === scriptId ? entity : item)),
    versionLinks: [...(linkId.db.versionLinks ?? []), link],
    qaRuns: (linkId.db.qaRuns ?? []).map((run) => (run.scriptId === scriptId && run.scriptVersion !== version && run.overallStatus !== "OUTDATED" ? { ...run, overallStatus: "OUTDATED" as const } : run)),
  };
  next = audit(next, at, actor, "script.human_revised", "script", scriptId, `v${version} from v${current.version}. The AI draft was not overwritten. Accepted findings: ${input.acceptedFindingIds.join(", ") || "none"}.`, version);
  next = audit(next, at, actor, "approval.invalidated", "script", scriptId, `Approvals of v${current.version} do not cover v${version}.`, version);
  return { ok: true, db: next, data: { version } };
}

export function runEditorialQa(db: StudioDb, scriptId: string, agentId: string, now?: string): Op<{ id: string; status: QARun["overallStatus"] }> {
  const at = stamp(now);
  const gate = requireReal(db, scriptId);
  if (!gate.ok) return fail(db, gate.code, gate.error);
  if (agentId !== "agent_qa") return fail(db, "agent", "Only the QA agent runs this check.");
  const version = gate.script.currentVersion;
  const pair = currentReviews(db, scriptId);
  const snap = gate.script.versions.find((item) => item.version === version)?.snapshot;
  const checks: string[] = [];
  if (!pair.hindi) checks.push("Hindi review is missing for this version.");
  if (!pair.culture) checks.push("Cultural review is missing for this version.");
  if (pair.disagreement) checks.push("Hindi and cultural reviews disagree. A person must resolve it.");
  if (pair.hindi?.outcome === "REVISION_REQUIRED" || pair.culture?.outcome === "REVISION_REQUIRED") checks.push("A review still requires revision.");
  if (snap && storyDrift(db, snap)) checks.push("Story consistency failed.");
  if (snap?.scenes.some((scene) => /alpine/i.test(scene.locationKey))) checks.push("An unapproved Alpine location is in the script.");
  checks.push("Rights were not evaluated as cleared. UNKNOWN stays UNKNOWN.");
  const blocked = checks.some((item) => /missing|revision|consistency|Alpine/i.test(item));
  const evaluated: QARun["evaluatedStatus"] = blocked ? "BLOCKED" : pair.disagreement || pair.hindi?.outcome === "HUMAN_REVIEW" || pair.culture?.outcome === "HUMAN_REVIEW" ? "HUMAN_REVIEW_REQUIRED" : "READY";
  const ided = allocId(db, "qa");
  const run: QARun = {
    id: ided.id,
    at,
    episodeId: db.episodes.find((item) => latestSnapshot(item).snapshot.scriptId === scriptId)?.id ?? null,
    storyId: gate.draft.storyId,
    canonVersionId: gate.draft.canonSnapshotHash,
    storyVersion: gate.draft.storyVersion,
    scriptId,
    scriptVersion: version,
    storyboardId: null,
    storyboardVersion: null,
    planId: null,
    planVersion: null,
    assetVersions: [],
    checkResults: checks,
    evaluatedStatus: evaluated,
    overallStatus: evaluated,
    createdBy: agentId,
  };
  let next = audit({ ...ided.db, qaRuns: [...(ided.db.qaRuns ?? []), run] }, at, { type: "agent", id: agentId, name: "QA Agent" }, "editorial.qa", "script", scriptId, `${evaluated}. Pinned to script v${version}. Not an approval.`, version);
  return { ok: true, db: next, data: { id: run.id, status: evaluated } };
}

export function currentQa(db: StudioDb, scriptId: string): QARun | null {
  const script = db.scripts.find((item) => item.id === scriptId);
  if (!script) return null;
  return (db.qaRuns ?? []).filter((run) => run.scriptId === scriptId && run.scriptVersion === script.currentVersion && run.overallStatus !== "OUTDATED").at(-1) ?? null;
}

export function approveEditorialScript(db: StudioDb, scriptId: string, actor: Actor, note: string, now?: string): Op<{ version: number }> {
  const at = stamp(now);
  if (actor.type !== "human") return fail(audit(db, at, actor, "permission.denied", "script", scriptId, "A reviewer tried to approve the script."), "human-required", "A review, a model, or an agent cannot approve the script.");
  const written = note.trim();
  if (written.length < 12) return fail(db, "note", "Write an editorial note. A passing review is not this note.");
  const gate = requireReal(db, scriptId);
  if (!gate.ok) return fail(db, gate.code, gate.error);
  const version = gate.script.currentVersion;
  const pair = currentReviews(db, scriptId);
  if (!pair.hindi || !pair.culture) return fail(db, "review", "Hindi and cultural reviews of this exact version are both required.");
  if (pair.hindi.outcome === "REVISION_REQUIRED" || pair.culture.outcome === "REVISION_REQUIRED") return fail(db, "revision", "A review still requires revision. Approval does not erase it.");
  if (pair.disagreement && written.length < 24) return fail(db, "disagreement", "The reviewers disagree. Write how you resolved it. Approval does not hide either opinion.");
  const qa = currentQa(db, scriptId);
  if (!qa || qa.overallStatus === "OUTDATED") return fail(db, "qa", "This version has no current QA run.");
  if (qa.overallStatus === "BLOCKED" || qa.evaluatedStatus === "BLOCKED") return fail(db, "qa", "QA for this version is blocked.");
  const rightsBefore = JSON.stringify(db.rightsRecords ?? []);
  const assetsBefore = JSON.stringify((db.assets ?? []).map((item) => latestSnapshot(item).snapshot.commercialUseStatus));
  const boardsBefore = db.storyboards.length;
  const versions = gate.script.versions.map((item) => {
    if (item.version === version) return { ...item, status: "approved" as const };
    if (gate.script.canonicalVersion != null && item.version === gate.script.canonicalVersion) return { ...item, status: "superseded" as const };
    return item;
  });
  let next: StudioDb = { ...db, scripts: db.scripts.map((item) => (item.id === scriptId ? { ...gate.script, versions, canonicalVersion: version, updatedAt: at } : item)) };
  const episode = next.episodes.find((item) => latestSnapshot(item).snapshot.scriptId === scriptId);
  if (episode && latestSnapshot(episode).snapshot.stage === "SCRIPT_DRAFT") {
    const current = latestSnapshot(episode).snapshot;
    const bumped = episode.currentVersion + 1;
    next = {
      ...next,
      episodes: next.episodes.map((item) => item.id === episode.id ? { ...item, currentVersion: bumped, updatedAt: at, versions: [...item.versions, { version: bumped, status: "approved" as const, snapshot: { ...current, stage: "SCRIPT_APPROVED" as const, scriptVersion: version, lastError: null }, createdAt: at, createdBy: actor.id, note: "Script approved. Storyboard was not started.", immutable: true }] } : item),
    };
  }
  const ided = allocId(next, "hap");
  const record: HumanApprovalRecord = {
    id: ided.id,
    at,
    episodeId: episode?.id ?? null,
    subjectType: "script",
    subjectId: scriptId,
    approvedArtifactVersions: [
      { type: "script", id: scriptId, version },
      { type: "story", id: gate.draft.storyId, version: gate.draft.storyVersion },
      { type: "canon", id: gate.draft.canonSnapshotHash, version: null },
      { type: "hindi_review", id: pair.hindi.id, version },
      { type: "culture_review", id: pair.culture.id, version },
      { type: "qa", id: qa.id, version },
    ],
    decision: "APPROVED",
    reviewerId: actor.id,
    reviewerName: actor.name,
    notes: written,
    qaRunId: qa.id,
  };
  next = { ...ided.db, humanApprovals: [...(ided.db.humanApprovals ?? []), record] };
  next = audit(next, at, actor, "script.editorial_approved", "script", scriptId, `Human approved v${version}. Rights were not cleared. Storyboard was not started.`, version);
  if (JSON.stringify(next.rightsRecords ?? []) !== rightsBefore) return fail(db, "rights", "Approval would have changed a rights record. Stopped.");
  if (JSON.stringify((next.assets ?? []).map((item) => latestSnapshot(item).snapshot.commercialUseStatus)) !== assetsBefore) return fail(db, "rights", "Approval would have cleared commercial use. Stopped.");
  if (next.storyboards.length !== boardsBefore) return fail(db, "stage", "Approval would have started a storyboard. Stopped.");
  const published = publishEpisode(next, episode?.id ?? scriptId, actor, at);
  if (published.ok) return fail(db, "publish-disabled", "Approval must not publish.");
  return { ok: true, db: published.db, data: { version } };
}

export function editorialView(db: StudioDb, scriptId: string) {
  const script = db.scripts.find((item) => item.id === scriptId);
  const draft = realDrafts(db).find((item) => item.scriptId === scriptId) ?? null;
  const current = script?.versions.find((item) => item.version === script.currentVersion) ?? null;
  const original = script?.versions.find((item) => item.version === 1) ?? null;
  const pair = currentReviews(db, scriptId);
  const qa = script ? currentQa(db, scriptId) : null;
  const outdated = (db.qaRuns ?? []).filter((run) => run.scriptId === scriptId && run.overallStatus === "OUTDATED");
  const approval = [...(db.humanApprovals ?? [])].reverse().find((item) => item.subjectType === "script" && item.subjectId === scriptId) ?? null;
  const approvalCoversCurrent = Boolean(approval?.approvedArtifactVersions.some((pin) => pin.type === "script" && pin.version === script?.currentVersion) && script?.canonicalVersion === script?.currentVersion);
  const blockers: string[] = [];
  if (!draft) blockers.push("This is not an eligible real Hindi draft.");
  if (draft && !pair.hindi) blockers.push("Hindi review of the current version is missing.");
  if (draft && !pair.culture) blockers.push("Cultural review of the current version is missing.");
  if (pair.disagreement) blockers.push("Reviewers disagree. Both opinions stay. A person has to resolve them in the approval note.");
  if (pair.hindi?.outcome === "REVISION_REQUIRED" || pair.culture?.outcome === "REVISION_REQUIRED") blockers.push("A review requires revision before approval.");
  if (draft && !qa) blockers.push("Version-specific QA has not been run on the current script.");
  if (qa?.overallStatus === "BLOCKED") blockers.push("QA for this version is blocked.");
  if (script && script.canonicalVersion !== script.currentVersion) blockers.push("No human approval covers the current script version.");
  blockers.push("Commercial rights remain unknown. Editorial approval does not clear them.");
  blockers.push("Publishing is disabled.");
  return {
    script,
    draft,
    current,
    original,
    pair,
    qa,
    outdated,
    approval,
    approvalCoversCurrent,
    blockers,
    labels: {
      aiGenerated: Boolean(original?.snapshot.draftLabel === "DEVELOPMENT DRAFT" && original.snapshot.generationRunId),
      aiReviewed: Boolean(pair.hindi || pair.culture),
      humanRevised: current?.snapshot.lineage === "HUMAN_REVISED",
      humanApproved: approvalCoversCurrent,
    },
  };
}

export function rightsStanding(db: StudioDb, scriptId: string): "UNKNOWN" | "CLEARED" | "PENDING" | "RESTRICTED" | "BLOCKED" | "EXPIRED" {
  const script = db.scripts.find((item) => item.id === scriptId);
  const executionId = script?.versions.find((item) => item.version === 1)?.snapshot.generationRunId;
  const status = (db.objectRecords ?? []).find((item) => item.provenanceExecutionId === executionId)?.rightsStatus;
  if (status === "CLEARED" || status === "PENDING" || status === "RESTRICTED" || status === "BLOCKED" || status === "EXPIRED") return status;
  return "UNKNOWN";
}
