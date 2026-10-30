import { validateSubject } from "./canon.ts";
import {
  allocId,
  evaluateHindiGate,
  evaluateStoryGate,
  fingerprint,
  latestSnapshot,
  publishEpisode,
} from "./engine.ts";
import { canTransition } from "./machine.ts";
import { validateAgeSuitability, validateBoardConsistency, validateStoryConsistency } from "./production.ts";
import type {
  Actor,
  AssetBody,
  CanonSnapshot,
  EpisodeBody,
  EpisodeStage,
  Op,
  ReleaseCheckKind,
  ReleaseCheckRecord,
  ReleaseCheckResult,
  ReleaseFinding,
  ReleaseRepair,
  ReleaseReport,
  ReleaseSeverity,
  ReleaseStamp,
  ReleaseStatus,
  StudioDb,
  VersionedEntity,
} from "./types.ts";

const ENGINE_VERSION = 1;
const REVIEWER_ID = "system_release";

interface DraftCheck {
  checkId: ReleaseCheckKind;
  label: string;
  result: ReleaseCheckResult;
  severity: ReleaseSeverity;
  findings: ReleaseFinding[];
  evidence: string[];
  reviewerName: string;
}

export interface ReleasePreview {
  status: ReleaseStatus;
  checks: DraftCheck[];
  blocking: ReleaseFinding[];
  warnings: string[];
  humanQuestions: string[];
  nextAction: string;
  stamp: ReleaseStamp;
  canonVersion: string;
  versionsLabel: string;
}

export interface RecordedRelease {
  report: ReleaseReport;
  checks: ReleaseCheckRecord[];
  repairs: ReleaseRepair[];
  stale: boolean;
  staleReason: string | null;
}

function fail<T>(db: StudioDb, code: string, error: string): Op<T> {
  return { ok: false, db, code, error };
}

function stamp(now?: string): string {
  return now ?? new Date().toISOString();
}

function latestBody<T>(entity: VersionedEntity<T> | undefined): T | null {
  return entity ? latestSnapshot(entity).snapshot : null;
}

export function resultLabel(result: ReleaseCheckResult): string {
  if (result === "RED_FLAG") return "RED FLAG";
  if (result === "HUMAN_REVIEW") return "HUMAN REVIEW REQUIRED";
  if (result === "WARNING") return "WARNING";
  if (result === "NOT_EVALUATED") return "NOT EVALUATED";
  return result;
}

export function statusLabel(status: ReleaseStatus): string {
  if (status === "RELEASE_READY") return "RELEASE READY";
  if (status === "HUMAN_REVIEW_REQUIRED") return "HUMAN REVIEW REQUIRED";
  return "RELEASE BLOCKED";
}

function finding(input: ReleaseFinding): ReleaseFinding {
  return input;
}

function rankSeverity(severity: ReleaseSeverity): number {
  if (severity === "RED") return 3;
  if (severity === "HUMAN_REVIEW") return 2;
  if (severity === "YELLOW") return 1;
  return 0;
}

function settle(notes: Array<{ severity: ReleaseSeverity; result: ReleaseCheckResult }>, pass: ReleaseCheckResult = "PASS"): {
  result: ReleaseCheckResult;
  severity: ReleaseSeverity;
} {
  if (notes.length === 0) return { result: pass, severity: "GREEN" };
  const worst = notes.reduce((best, item) => (rankSeverity(item.severity) > rankSeverity(best.severity) ? item : best));
  return { result: worst.result, severity: worst.severity };
}

function episodeOf(db: StudioDb, episodeId: string) {
  const episode = db.episodes.find((item) => item.id === episodeId);
  if (!episode) return null;
  const snap = latestSnapshot(episode).snapshot;
  const story = db.stories.find((item) => item.id === snap.storyId);
  const storyVersion = story?.versions.find((item) => item.version === snap.storyVersion) ?? null;
  const script = snap.scriptId ? db.scripts.find((item) => item.id === snap.scriptId) : undefined;
  const board = snap.storyboardId ? db.storyboards.find((item) => item.id === snap.storyboardId) : undefined;
  const plan = snap.planId ? db.plans.find((item) => item.id === snap.planId) : undefined;
  const assets = db.assets.filter((asset) => {
    const body = latestSnapshot(asset).snapshot;
    return body.episodeId === episodeId || body.linkedEntityId === snap.scriptId || body.linkedEntityId === snap.storyboardId || body.linkedEntityId === snap.planId;
  });
  const canon =
    db.canonSnapshots.find((item) => item.hash === snap.canonSnapshotHash) ??
    db.canonSnapshots[db.canonSnapshots.length - 1] ??
    null;
  return { episode, snap, story, storyVersion, script, board, plan, assets, canon };
}

function blankStamp(): ReleaseStamp {
  return {
    canonVersion: "",
    canonSnapshotHash: "",
    latestCanonHash: "",
    storyId: "",
    storyVersion: 0,
    storyCurrentVersion: 0,
    storyKey: "",
    scriptId: null,
    scriptVersion: null,
    scriptCanonicalVersion: null,
    scriptKey: "",
    storyboardId: null,
    storyboardVersion: null,
    planId: null,
    planVersion: null,
    planKey: "",
    assetKey: "",
  };
}

export function stampOf(db: StudioDb, episodeId: string): ReleaseStamp {
  const pack = episodeOf(db, episodeId);
  if (!pack) return blankStamp();
  const storySnap = pack.storyVersion?.snapshot ?? null;
  const scriptBody = pack.script ? latestSnapshot(pack.script).snapshot : null;
  const planBody = pack.plan ? latestSnapshot(pack.plan).snapshot : null;
  const latestCanon = db.canonSnapshots[db.canonSnapshots.length - 1];
  return {
    canonVersion: pack.canon?.canonVersion ?? pack.snap.canonVersionUsed ?? "",
    canonSnapshotHash: pack.canon?.hash ?? pack.snap.canonSnapshotHash ?? "",
    latestCanonHash: latestCanon?.hash ?? "",
    storyId: pack.snap.storyId,
    storyVersion: pack.snap.storyVersion,
    storyCurrentVersion: pack.story?.currentVersion ?? 0,
    storyKey: fingerprint({
      current: pack.story?.currentVersion ?? 0,
      pinned: pack.snap.storyVersion,
      status: pack.storyVersion?.status ?? "missing",
      resolution: storySnap?.resolution ?? "",
      conflict: storySnap?.mainConflict ?? "",
      originality: storySnap?.originality.total ?? null,
      similar: storySnap?.similarity.score ?? null,
      tooSimilar: storySnap?.similarity.tooSimilar ?? null,
    }),
    scriptId: pack.script?.id ?? null,
    scriptVersion: pack.script?.currentVersion ?? null,
    scriptCanonicalVersion: pack.script?.canonicalVersion ?? null,
    scriptKey: fingerprint({
      version: pack.script?.currentVersion ?? null,
      canonical: pack.script?.canonicalVersion ?? null,
      review: scriptBody?.languageReview ?? null,
      hi: scriptBody?.scenes.map((scene) => scene.lines.map((line) => line.hi).join("|")).join("||") ?? "",
    }),
    storyboardId: pack.board?.id ?? null,
    storyboardVersion: pack.board?.currentVersion ?? null,
    planId: pack.plan?.id ?? null,
    planVersion: pack.plan?.currentVersion ?? null,
    planKey: fingerprint({
      version: pack.plan?.currentVersion ?? null,
      music: planBody?.musicStatus ?? "",
      cues: (planBody?.musicCues ?? []).map((cue) => cue.rightsStatus),
      sound: (planBody?.soundCues ?? []).map((cue) => cue.rightsStatus),
      voices: (planBody?.voices ?? []).map((voice) => voice.commercialRights),
    }),
    assetKey: fingerprint(
      pack.assets.map((asset) => {
        const body = latestSnapshot(asset).snapshot;
        return {
          id: asset.id,
          version: asset.currentVersion,
          commercial: body.commercialUseStatus,
          source: body.source,
          creator: body.creator,
          model: body.model,
          license: body.licenseStatus,
          rights: body.rightsNotes,
          claims: body.visualClaims ?? null,
        };
      }),
    ),
  };
}

function versionsLabel(stampValue: ReleaseStamp): string {
  return [
    `Canon ${stampValue.canonVersion || "—"}`,
    `Story v${stampValue.storyVersion || "—"}`,
    `Script v${stampValue.scriptVersion ?? "—"}`,
    `Storyboard v${stampValue.storyboardVersion ?? "—"}`,
    `Plan v${stampValue.planVersion ?? "—"}`,
  ].join(" · ");
}

function audit(db: StudioDb, at: string, actor: Actor, action: string, entityId: string, detail: string): StudioDb {
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
        entityType: "episode",
        entityId,
        detail,
      },
    ],
  };
}

function canonSnapshotFor(pack: NonNullable<ReturnType<typeof episodeOf>>): CanonSnapshot | undefined {
  return pack.canon ?? undefined;
}

function checkCanon(db: StudioDb, pack: NonNullable<ReturnType<typeof episodeOf>>): DraftCheck {
  const findings: ReleaseFinding[] = [];
  const evidence: string[] = [];
  const snapshot = canonSnapshotFor(pack);
  const subjects: Array<Parameters<typeof validateSubject>[1]> = [];
  if (pack.script) subjects.push({ kind: "script", id: pack.script.id, version: pack.script.currentVersion, body: latestSnapshot(pack.script).snapshot });
  if (pack.board) subjects.push({ kind: "storyboard", id: pack.board.id, version: pack.board.currentVersion, body: latestSnapshot(pack.board).snapshot });
  if (pack.plan) subjects.push({ kind: "plan", id: pack.plan.id, version: pack.plan.currentVersion, body: latestSnapshot(pack.plan).snapshot });
  for (const asset of pack.assets) subjects.push({ kind: "asset", id: asset.id, version: asset.currentVersion, body: latestSnapshot(asset).snapshot });
  let hard = 0;
  let soft = 0;
  for (const subject of subjects) {
    const validation = validateSubject(db, subject, snapshot);
    evidence.push(`${subject.kind} ${subject.id} v${subject.version}: ${validation.result} against ${validation.canonVersion}.`);
    for (const violation of validation.violations) {
      hard += 1;
      findings.push(
        finding({
          code: "CANON_FAIL",
          what: `CANON FAIL — ${violation.entityName} ${violation.field} does not match locked canon.`,
          where: `${subject.kind} ${subject.id} v${subject.version}`,
          why: `Proposed ${violation.proposed}. Canon ${violation.canonical}. ${violation.rule}.`,
          correction: `Revise the artifact against canon ${validation.canonVersion}. Do not change the locked character.`,
          role: "Character Director",
          artifactType: subject.kind,
          artifactId: subject.id,
          artifactVersion: subject.version,
        }),
      );
    }
    for (const warning of validation.warnings) {
      soft += 1;
      findings.push(
        finding({
          code: "CANON_WARN",
          what: `${warning.entityName} ${warning.field} is a soft variation.`,
          where: `${subject.kind} ${subject.id} v${subject.version}`,
          why: `Proposed ${warning.proposed}. Canon ${warning.canonical}.`,
          correction: "A human can accept the soft variation. It does not rewrite canon.",
          role: "Character Director",
          artifactType: subject.kind,
          artifactId: subject.id,
          artifactVersion: subject.version,
        }),
      );
    }
  }
  if (!pack.script && !pack.board) {
    findings.push(
      finding({
        code: "CANON_MISSING",
        what: "CANON FAIL — no script or storyboard to check.",
        where: pack.episode.id,
        why: "Canon QA cannot pass an empty production package.",
        correction: "Produce the script and storyboard from the approved story.",
        role: "Scriptwriter",
        artifactType: "episode",
        artifactId: pack.episode.id,
        artifactVersion: pack.episode.currentVersion,
      }),
    );
    hard += 1;
  }
  const settled = settle(
    findings.map((item) => ({ severity: item.code === "CANON_WARN" ? "YELLOW" as const : "RED" as const, result: item.code === "CANON_WARN" ? "WARNING" as const : "FAIL" as const })),
  );
  if (hard === 0 && soft === 0) evidence.push(`Checked against canon ${snapshot?.canonVersion ?? "current"}. No hard contradiction.`);
  return {
    checkId: "canon",
    label: "Canon QA",
    result: hard > 0 ? "FAIL" : settled.result,
    severity: hard > 0 ? "RED" : settled.severity,
    findings,
    evidence,
    reviewerName: "Canon Enforcement Engine",
  };
}

function checkStory(db: StudioDb, pack: NonNullable<ReturnType<typeof episodeOf>>): DraftCheck {
  const findings: ReleaseFinding[] = [];
  const evidence: string[] = [];
  const story = pack.story;
  const version = pack.storyVersion;
  const snap = version?.snapshot ?? null;
  if (!story || !snap || !version) {
    findings.push(
      finding({
        code: "STORY_MISSING",
        what: "Story QA failed. The approved story version is missing.",
        where: pack.snap.storyId,
        why: "Release requires the story version the episode was opened on.",
        correction: "Open the episode from an approved story version.",
        role: "Story Architect",
        artifactType: "story",
        artifactId: pack.snap.storyId,
        artifactVersion: pack.snap.storyVersion,
      }),
    );
  } else {
    const gate = evaluateStoryGate(db, story.id);
    evidence.push(...gate.checks.map((check) => `${check.name}: ${check.detail}`));
    evidence.push(`Internal originality bar ${snap.originality.threshold}/100. This is not a YouTube rule.`);
    if (version.status !== "approved") {
      findings.push(
        finding({
          code: "STORY_UNAPPROVED",
          what: "Story QA failed. This version is not an approved story.",
          where: `${story.name} v${version.version}`,
          why: `Status is ${version.status}.`,
          correction: "A human approves the story. An agent cannot.",
          role: "Story Architect",
          artifactType: "story",
          artifactId: story.id,
          artifactVersion: version.version,
        }),
      );
    }
    if (!snap.beginning.trim() || !snap.middle.trim() || !snap.resolution.trim() || !snap.mainConflict.trim()) {
      findings.push(
        finding({
          code: "STORY_STRUCTURE",
          what: "Story QA failed. Beginning, middle, ending, or conflict is missing.",
          where: `${snap.title} v${version.version}`,
          why: "The story structure is not coherent enough to release.",
          correction: "Revise the story. Do not overwrite the approved version in place.",
          role: "Story Architect",
          artifactType: "story",
          artifactId: story.id,
          artifactVersion: version.version,
        }),
      );
    }
    if (!snap.targetAge) {
      findings.push(
        finding({
          code: "STORY_AGE",
          what: "Story QA failed. Target age is not explicit.",
          where: snap.title,
          why: "Age must be stated before a children's episode can move.",
          correction: "Set the studio age and regenerate only as a new version.",
          role: "Story Architect",
          artifactType: "story",
          artifactId: story.id,
          artifactVersion: version.version,
        }),
      );
    }
    const bar = db.settings.originalityThreshold || snap.originality.threshold || 75;
    if (!snap.originality.meetsThreshold || snap.originality.total < bar) {
      findings.push(
        finding({
          code: "STORY_ORIGINALITY",
          what: `Story QA failed. Originality ${snap.originality.total} is under the internal bar ${bar}.`,
          where: `${snap.title} v${version.version}`,
          why: "The existing Story Intelligence score does not clear Neem Studio's internal gate. This is not a YouTube requirement.",
          correction: "Revise for originality. Do not lower the threshold.",
          role: "Story Architect",
          artifactType: "story",
          artifactId: story.id,
          artifactVersion: version.version,
        }),
      );
    }
    if (snap.similarity.tooSimilar || snap.recommendation.decision === "BLOCKED" || snap.recommendation.canonResult === "FAIL" || snap.recommendation.canonResult === "BLOCKED") {
      findings.push(
        finding({
          code: "STORY_RED_FLAG",
          what: snap.similarity.tooSimilar
            ? `STORY RED FLAG — too similar${snap.similarity.againstTitle ? ` to ${snap.similarity.againstTitle}` : ""} (${snap.similarity.score}).`
            : `STORY RED FLAG — story intelligence is ${snap.recommendation.decision}.`,
          where: `${snap.title} v${version.version}`,
          why: snap.recommendation.reasons[0] ?? snap.similarity.explanation,
          correction: "This is a creative red flag. A passing Hindi review does not clear it.",
          role: "Story Architect",
          artifactType: "story",
          artifactId: story.id,
          artifactVersion: version.version,
        }),
      );
    }
  }
  const red = findings.some((item) => item.code === "STORY_RED_FLAG");
  const failed = findings.length > 0;
  return {
    checkId: "story",
    label: "Story QA",
    result: red ? "RED_FLAG" : failed ? "FAIL" : "PASS",
    severity: failed ? "RED" : "GREEN",
    findings,
    evidence,
    reviewerName: "Story Intelligence Engine",
  };
}

function checkHindi(pack: NonNullable<ReturnType<typeof episodeOf>>): DraftCheck {
  const findings: ReleaseFinding[] = [];
  const evidence: string[] = [];
  const script = pack.script;
  const body = script ? latestSnapshot(script).snapshot : null;
  const gate = evaluateHindiGate(body);
  evidence.push(...gate.checks.map((check) => `${check.name}: ${check.detail}`));
  if (!script || !body) {
    findings.push(
      finding({
        code: "HINDI_MISSING",
        what: "Hindi QA failed. No script.",
        where: pack.episode.id,
        why: "A Hindi production package is required.",
        correction: "Write a new Hindi script version. Do not invent one inside this gate.",
        role: "Hindi Editor",
        artifactType: "script",
        artifactId: pack.snap.scriptId ?? pack.episode.id,
        artifactVersion: null,
      }),
    );
  } else {
    const story = pack.storyVersion?.snapshot ?? null;
    const consistency = validateStoryConsistency(story, body);
    if (consistency.result === "FAIL") {
      findings.push(
        finding({
          code: "HINDI_MEANING",
          what: "Hindi QA failed. The script meaning does not match the approved story.",
          where: `${script.id} v${script.currentVersion}`,
          why: consistency.failures[0]?.detail ?? "Story consistency failed.",
          correction: "Create a new script version that follows the approved story. Do not overwrite the approved version.",
          role: "Hindi Editor",
          artifactType: "script",
          artifactId: script.id,
          artifactVersion: script.currentVersion,
        }),
      );
    }
    if (body.storyVersion !== pack.snap.storyVersion) {
      findings.push(
        finding({
          code: "HINDI_VERSION",
          what: "Hindi QA failed. The script does not match the episode's story version.",
          where: `${script.id} v${script.currentVersion}`,
          why: `Script cites story v${body.storyVersion}. Episode cites v${pack.snap.storyVersion}.`,
          correction: "Point the script at the approved story version, as a new script version.",
          role: "Hindi Editor",
          artifactType: "script",
          artifactId: script.id,
          artifactVersion: script.currentVersion,
        }),
      );
    }
    const age = validateAgeSuitability(body, pack.snap.targetAge);
    evidence.push(age.detail);
    if (age.result === "FAIL") {
      findings.push(
        finding({
          code: "HINDI_AGE",
          what: "Hindi QA failed. Dialogue is not age appropriate.",
          where: `${script.id} v${script.currentVersion}`,
          why: age.detail,
          correction: "Shorten the lines in a new version.",
          role: "Hindi Editor",
          artifactType: "script",
          artifactId: script.id,
          artifactVersion: script.currentVersion,
        }),
      );
    }
    for (const scene of body.scenes) {
      for (const line of scene.lines) {
        const hi = line.hi.trim();
        const devanagari = (hi.match(/[\u0900-\u097F]/g) ?? []).length;
        const latin = (hi.match(/[A-Za-z]/g) ?? []).length;
        if (hi && devanagari < 2 && latin > 2) {
          findings.push(
            finding({
              code: "HINDI_ENGLISH",
              what: "Hindi QA failed. A dialogue line is English or untranslated.",
              where: `Scene ${scene.sceneNo}`,
              why: hi.slice(0, 80),
              correction: "Replace it with natural Hindi in a new script version.",
              role: "Hindi Editor",
              artifactType: "script",
              artifactId: script.id,
              artifactVersion: script.currentVersion,
            }),
          );
        }
      }
    }
    const blob = body.scenes.map((scene) => scene.lines.map((line) => `${line.hi} ${line.en}`).join(" ")).join(" ");
    if (/the the|\[untranslated\]|TODO translate|lorem ipsum|machine translation/i.test(blob) || body.languageReview === "fail") {
      findings.push(
        finding({
          code: "HINDI_FAIL",
          what: "Hindi QA failed. Grammar, review, or a machine-translation artifact failed.",
          where: `${script.id} v${script.currentVersion}`,
          why: body.languageNotes.join(" ") || gate.checks.find((check) => check.result === "FAIL")?.detail || "Language review failed.",
          correction: "The Hindi editor requests a new version. This gate will not rewrite the line.",
          role: "Hindi Editor",
          artifactType: "script",
          artifactId: script.id,
          artifactVersion: script.currentVersion,
        }),
      );
    } else if (gate.result === "FAIL") {
      findings.push(
        finding({
          code: "HINDI_FAIL",
          what: "Hindi QA failed.",
          where: `${script.id} v${script.currentVersion}`,
          why: gate.checks.find((check) => check.result === "FAIL")?.detail ?? "Hindi gate failed.",
          correction: "Create a new reviewed Hindi version.",
          role: "Hindi Editor",
          artifactType: "script",
          artifactId: script.id,
          artifactVersion: script.currentVersion,
        }),
      );
    } else if (gate.result === "WARN" || age.result === "WARN") {
      findings.push(
        finding({
          code: "HINDI_WARN",
          what: "Hindi warning. Non-blocking.",
          where: `${script.id} v${script.currentVersion}`,
          why: gate.checks.find((check) => check.result === "WARN")?.detail ?? age.detail,
          correction: "A human should see this before approval. It does not block by itself.",
          role: "Hindi Editor",
          artifactType: "script",
          artifactId: script.id,
          artifactVersion: script.currentVersion,
        }),
      );
    }
  }
  const hard = findings.some((item) => item.code !== "HINDI_WARN");
  const warn = findings.some((item) => item.code === "HINDI_WARN");
  return {
    checkId: "hindi",
    label: "Hindi QA",
    result: hard ? "FAIL" : warn ? "WARNING" : "PASS",
    severity: hard ? "RED" : warn ? "YELLOW" : "GREEN",
    findings: hard ? findings.filter((item) => item.code !== "HINDI_WARN") : findings,
    evidence,
    reviewerName: "Hindi Editor",
  };
}

function checkCulture(pack: NonNullable<ReturnType<typeof episodeOf>>): DraftCheck {
  const findings: ReleaseFinding[] = [];
  const evidence: string[] = [];
  const story = pack.storyVersion?.snapshot ?? null;
  const script = pack.script ? latestSnapshot(pack.script).snapshot : null;
  const text = script ? script.scenes.map((scene) => `${scene.action}\n${scene.lines.map((line) => `${line.hi} ${line.en}`).join("\n")}`).join("\n") : "";
  if (!story) {
    findings.push(
      finding({
        code: "CULTURE_MISSING",
        what: "Cultural QA failed. No story to review.",
        where: pack.snap.storyId,
        why: "Cultural context is checked on the approved story and the script.",
        correction: "Attach the approved story.",
        role: "Cultural Reviewer",
        artifactType: "story",
        artifactId: pack.snap.storyId,
        artifactVersion: pack.snap.storyVersion,
      }),
    );
  } else if (story.culturalSpecificity === "none" || story.culturalElements.length === 0) {
    findings.push(
      finding({
        code: "CULTURE_RED",
        what: "CULTURAL RED FLAG — the story has no specific Indian context.",
        where: `${story.title} v${pack.storyVersion?.version ?? pack.snap.storyVersion}`,
        why: "Names, food, clothing, or a courtyard detail are missing.",
        correction: "Request a cultural revision. An agent cannot clear this.",
        role: "Cultural Reviewer",
        artifactType: "story",
        artifactId: pack.snap.storyId,
        artifactVersion: pack.snap.storyVersion,
      }),
    );
  } else if (story.culturalSpecificity === "generic") {
    findings.push(
      finding({
        code: "CULTURE_WARN",
        what: "Cultural warning. The detail is generic.",
        where: story.title,
        why: story.culturalElements[0] ?? "Generic cultural note.",
        correction: "A human should notice this. It does not block by itself.",
        role: "Cultural Reviewer",
        artifactType: "story",
        artifactId: pack.snap.storyId,
        artifactVersion: pack.snap.storyVersion,
      }),
    );
    evidence.push(story.culturalElements[0] ?? "Generic.");
  } else {
    evidence.push(story.culturalElements[0] ?? "Specific.");
  }
  if (/generic cartoon india|exotic india|festival lecture|costume india|all indians look the same/i.test(text)) {
    findings.push(
      finding({
        code: "CULTURE_RED",
        what: "CULTURAL RED FLAG — careless or stereotyped stand-in.",
        where: pack.script?.id ?? pack.episode.id,
        why: "The script uses a generic substitute for the lane.",
        correction: "Revise the specific scene. Do not let an agent mark this resolved.",
        role: "Cultural Reviewer",
        artifactType: "script",
        artifactId: pack.script?.id ?? pack.episode.id,
        artifactVersion: pack.script?.currentVersion ?? null,
      }),
    );
  } else if (text) {
    evidence.push("No careless cultural shorthand.");
  }
  if (/cultural ambiguity|unsure about this tradition|is this festival accurate/i.test(text)) {
    findings.push(
      finding({
        code: "CULTURE_HUMAN",
        what: "Cultural QA needs a human. The reference is ambiguous.",
        where: pack.script?.id ?? pack.episode.id,
        why: "The gate will not decide a high-risk cultural question.",
        correction: "A human reviewer judges the reference. An agent cannot close it.",
        role: "Cultural Reviewer",
        artifactType: "script",
        artifactId: pack.script?.id ?? pack.episode.id,
        artifactVersion: pack.script?.currentVersion ?? null,
      }),
    );
  }
  const red = findings.some((item) => item.code === "CULTURE_RED" || item.code === "CULTURE_MISSING");
  const human = findings.some((item) => item.code === "CULTURE_HUMAN");
  const warn = findings.some((item) => item.code === "CULTURE_WARN");
  return {
    checkId: "culture",
    label: "Cultural QA",
    result: red ? "RED_FLAG" : human ? "HUMAN_REVIEW" : warn ? "WARNING" : "PASS",
    severity: red ? "RED" : human ? "HUMAN_REVIEW" : warn ? "YELLOW" : "GREEN",
    findings,
    evidence,
    reviewerName: "Cultural Reviewer",
  };
}

function provenanceGaps(body: AssetBody): string[] {
  const gaps: string[] = [];
  if (!body.source.trim()) gaps.push("source");
  if (!body.creator.trim()) gaps.push("creator");
  if (!body.model.trim() && !body.provider.trim()) gaps.push("model/tool");
  if (!body.prompt.trim() && body.referenceAssets.length === 0) gaps.push("prompt or reference");
  if (!body.licenseStatus.trim()) gaps.push("license");
  if (!Array.isArray(body.modificationHistory)) gaps.push("modification history");
  return gaps;
}

function checkAssets(pack: NonNullable<ReturnType<typeof episodeOf>>): DraftCheck {
  const findings: ReleaseFinding[] = [];
  const evidence: string[] = [];
  if (pack.assets.length === 0) {
    findings.push(
      finding({
        code: "ASSET_RED",
        what: "ASSET RED FLAG — no provenance records for this episode.",
        where: pack.episode.id,
        why: "A required release asset has no traceable record. The gate will not assume it is safe.",
        correction: "Add a provenance record with source, creator, tool, and license. Do not mark it cleared here.",
        role: "Visual Director",
        artifactType: "episode",
        artifactId: pack.episode.id,
        artifactVersion: pack.episode.currentVersion,
      }),
    );
  }
  for (const asset of pack.assets) {
    const body = latestSnapshot(asset).snapshot;
    const gaps = provenanceGaps(body);
    if (!body.createdAt && !latestSnapshot(asset).createdAt) gaps.push("creation date");
    if (gaps.length) {
      findings.push(
        finding({
          code: "ASSET_RED",
          what: `ASSET RED FLAG — ${body.assetType} ${asset.id} is missing ${gaps.join(", ")}.`,
          where: `${asset.id} v${asset.currentVersion}`,
          why: "Missing provenance is not treated as cleared.",
          correction: "Identify the exact asset and attach the missing provenance. Do not silently assume it is safe.",
          role: "Visual Director",
          artifactType: "asset",
          artifactId: asset.id,
          artifactVersion: asset.currentVersion,
        }),
      );
    } else {
      evidence.push(`${asset.id} ${body.assetType}: source ${body.source}, ${body.creator}, ${body.model || body.provider}.`);
    }
  }
  return {
    checkId: "asset",
    label: "Asset QA",
    result: findings.length ? "RED_FLAG" : "PASS",
    severity: findings.length ? "RED" : "GREEN",
    findings,
    evidence,
    reviewerName: "Provenance check",
  };
}

function checkRights(pack: NonNullable<ReturnType<typeof episodeOf>>): DraftCheck {
  const findings: ReleaseFinding[] = [];
  const evidence: string[] = ["UNKNOWN = NOT CLEARED. This is not a legal opinion and not a license."];
  for (const asset of pack.assets) {
    const body = latestSnapshot(asset).snapshot;
    if (body.commercialUseStatus === "cleared" || body.commercialUseStatus === "not-applicable") {
      evidence.push(`${asset.id} commercial use ${body.commercialUseStatus}.`);
      continue;
    }
    const missing = !body.rightsNotes.trim() || !body.licenseStatus.trim();
    findings.push(
      finding({
        code: "RIGHTS_RED",
        what: missing
          ? `RIGHTS RED FLAG — ${body.assetType} ${asset.id} has missing commercial-rights information.`
          : `RIGHTS RED FLAG — commercial use is not cleared for ${body.assetType} ${asset.id}.`,
        where: `${asset.id} v${asset.currentVersion}`,
        why: missing ? "UNKNOWN = NOT CLEARED. Rights notes or license information are missing." : body.rightsNotes || "Commercial use status is not cleared.",
        correction: "A human supplies rights evidence, then the release check is run again. An agent cannot clear this flag.",
        role: "Human rights reviewer",
        artifactType: "asset",
        artifactId: asset.id,
        artifactVersion: asset.currentVersion,
      }),
    );
  }
  const plan = pack.plan ? latestSnapshot(pack.plan).snapshot : null;
  if (!plan) {
    findings.push(
      finding({
        code: "RIGHTS_RED",
        what: "RIGHTS RED FLAG — no production plan, so music, voice, and sound rights are unknown.",
        where: pack.episode.id,
        why: "UNKNOWN = NOT CLEARED.",
        correction: "Attach a plan and clear each cue with a human note.",
        role: "Human rights reviewer",
        artifactType: "episode",
        artifactId: pack.episode.id,
        artifactVersion: pack.episode.currentVersion,
      }),
    );
  } else {
    const musicOpen = (plan.musicCues ?? []).filter((cue) => cue.rightsStatus !== "cleared" && cue.rightsStatus !== "not-applicable");
    const noCue = (plan.musicCues ?? []).length === 0;
    const musicText = noCue && /not composed|not-cleared|not cleared/i.test(plan.musicStatus);
    if (musicOpen.length || musicText) {
      findings.push(
        finding({
          code: "RIGHTS_RED",
          what: "RIGHTS RED FLAG — music rights are not cleared.",
          where: pack.plan?.id ?? pack.episode.id,
          why: plan.musicStatus,
          correction: "Compose or license an original motif and record a human clearance. Do not attach a library track.",
          role: "Human rights reviewer",
          artifactType: "production_plan",
          artifactId: pack.plan?.id ?? pack.episode.id,
          artifactVersion: pack.plan?.currentVersion ?? null,
        }),
      );
    }
    for (const cue of plan.soundCues ?? []) {
      if (cue.rightsStatus === "cleared" || cue.rightsStatus === "not-applicable") continue;
      findings.push(
        finding({
          code: "RIGHTS_RED",
          what: `RIGHTS RED FLAG — sound cue ${cue.id} is not cleared.`,
          where: `Scene ${cue.sceneNo}`,
          why: "UNKNOWN = NOT CLEARED.",
          correction: "A human clears the sound cue or marks it not applicable.",
          role: "Human rights reviewer",
          artifactType: "production_plan",
          artifactId: pack.plan?.id ?? pack.episode.id,
          artifactVersion: pack.plan?.currentVersion ?? null,
        }),
      );
    }
    for (const voice of plan.voices ?? []) {
      if (voice.commercialRights === "cleared" || voice.commercialRights === "not-applicable") continue;
      findings.push(
        finding({
          code: "RIGHTS_RED",
          what: `RIGHTS RED FLAG — voice rights for ${voice.characterName} are not cleared.`,
          where: voice.voiceId,
          why: "UNKNOWN = NOT CLEARED.",
          correction: "A human clears the voice. The rights agent cannot grant it.",
          role: "Human rights reviewer",
          artifactType: "production_plan",
          artifactId: pack.plan?.id ?? pack.episode.id,
          artifactVersion: pack.plan?.currentVersion ?? null,
        }),
      );
    }
  }
  return {
    checkId: "rights",
    label: "Rights QA",
    result: findings.length ? "RED_FLAG" : "PASS",
    severity: findings.length ? "RED" : "GREEN",
    findings,
    evidence,
    reviewerName: "Rights gate",
  };
}

function checkPolicy(pack: NonNullable<ReturnType<typeof episodeOf>>): DraftCheck {
  const findings: ReleaseFinding[] = [];
  const evidence: string[] = [];
  const script = pack.script ? latestSnapshot(pack.script).snapshot : null;
  const text = script ? script.scenes.flatMap((scene) => [scene.action, ...scene.lines.map((line) => `${line.hi} ${line.en}`)]).join(" ") : "";
  if (pack.snap.audience !== "made-for-kids") {
    findings.push(
      finding({
        code: "POLICY_FAIL",
        what: "Policy QA failed. The episode is not classified made-for-kids.",
        where: pack.episode.id,
        why: "This studio's first channel is child-directed.",
        correction: "Set the audience. This does not guarantee monetization.",
        role: "YouTube Policy reviewer",
        artifactType: "episode",
        artifactId: pack.episode.id,
        artifactVersion: pack.episode.currentVersion,
      }),
    );
  } else evidence.push("Classified made-for-kids. Not a monetization guarantee.");
  const rules: Array<{ pattern: RegExp; code: string; what: string; why: string }> = [
    { pattern: /matchstick|knife|chase onto the road|rooftop edge|drink the cleaner|swallow the/i, code: "POLICY_FAIL", what: "Policy QA failed. Dangerous behavior is presented.", why: "A child could imitate the beat." },
    { pattern: /scientifically proven|guaranteed to teach/i, code: "POLICY_FAIL", what: "Policy QA failed. Misleading educational claim.", why: "The line overclaims what the episode teaches." },
    { pattern: /buy now|shop this|use code/i, code: "POLICY_FAIL", what: "Policy QA failed. The episode has a sales beat.", why: "Excessive or direct advertising does not belong in this made-for-kids draft." },
    { pattern: /sexual|nude/i, code: "POLICY_FAIL", what: "Policy QA failed. Sexual content.", why: "Not appropriate for ages 3–5." },
    { pattern: /stab|blood everywhere/i, code: "POLICY_FAIL", what: "Policy QA failed. Inappropriate violence.", why: "The beat is not suitable for the target age." },
    { pattern: /try this at home|dangerous challenge/i, code: "POLICY_FAIL", what: "Policy QA failed. Harmful challenge or call to action.", why: "Children should not be told to imitate a risky act." },
    { pattern: /share your home address|what is your phone number/i, code: "POLICY_FAIL", what: "Policy QA failed. Privacy concern.", why: "The episode asks a child for personal information." },
  ];
  for (const rule of rules) {
    if (!rule.pattern.test(text)) continue;
    findings.push(
      finding({
        code: rule.code,
        what: rule.what,
        where: pack.script?.id ?? pack.episode.id,
        why: rule.why,
        correction: "Remove the beat in a new version. Policy does not override a rights red flag, and it cannot publish.",
        role: "YouTube Policy reviewer",
        artifactType: "script",
        artifactId: pack.script?.id ?? pack.episode.id,
        artifactVersion: pack.script?.currentVersion ?? null,
      }),
    );
  }
  if (/might be too scary|safety is unclear|unsure if children should/i.test(text)) {
    findings.push(
      finding({
        code: "POLICY_HUMAN",
        what: "Policy QA needs a human. Child-safety is uncertain.",
        where: pack.script?.id ?? pack.episode.id,
        why: "Uncertain safety is not an automatic pass.",
        correction: "A human judges the beat. The policy agent cannot approve it.",
        role: "YouTube Policy reviewer",
        artifactType: "script",
        artifactId: pack.script?.id ?? pack.episode.id,
        artifactVersion: pack.script?.currentVersion ?? null,
      }),
    );
  }
  if (findings.length === 0) evidence.push("No dangerous-behavior phrase, deceptive claim, or sales beat.");
  const hard = findings.some((item) => item.code === "POLICY_FAIL");
  const human = findings.some((item) => item.code === "POLICY_HUMAN");
  return {
    checkId: "policy",
    label: "Policy QA",
    result: hard ? "FAIL" : human ? "HUMAN_REVIEW" : "PASS",
    severity: hard ? "RED" : human ? "HUMAN_REVIEW" : "GREEN",
    findings,
    evidence,
    reviewerName: "Policy gate",
  };
}

function checkProduction(db: StudioDb, pack: NonNullable<ReturnType<typeof episodeOf>>): DraftCheck {
  const findings: ReleaseFinding[] = [];
  const evidence: string[] = [];
  const storyOk = pack.storyVersion?.status === "approved";
  if (!storyOk) {
    findings.push(
      finding({
        code: "PRODUCTION_FAIL",
        what: "Production QA failed. No approved story.",
        where: pack.snap.storyId,
        why: "The episode is not tied to an approved story version.",
        correction: "Approve the story before production.",
        role: "Animation Producer",
        artifactType: "story",
        artifactId: pack.snap.storyId,
        artifactVersion: pack.snap.storyVersion,
      }),
    );
  }
  const script = pack.script;
  const scriptBody = script ? latestSnapshot(script).snapshot : null;
  if (!script || script.canonicalVersion == null) {
    findings.push(
      finding({
        code: "PRODUCTION_FAIL",
        what: "Production QA failed. No approved script.",
        where: script?.id ?? pack.episode.id,
        why: "A storyboard cannot stand in for an approved Hindi script.",
        correction: "Approve the script, then rebuild downstream references as new versions.",
        role: "Scriptwriter",
        artifactType: "script",
        artifactId: script?.id ?? pack.episode.id,
        artifactVersion: script?.currentVersion ?? null,
      }),
    );
  }
  const board = pack.board;
  const boardBody = board ? latestSnapshot(board).snapshot : null;
  if (!board || !boardBody) {
    findings.push(
      finding({
        code: "PRODUCTION_FAIL",
        what: "Production QA failed. No storyboard.",
        where: pack.episode.id,
        why: "The scene sequence is missing.",
        correction: "Create a storyboard from the approved script.",
        role: "Storyboard Director",
        artifactType: "storyboard",
        artifactId: pack.snap.storyboardId ?? pack.episode.id,
        artifactVersion: null,
      }),
    );
  }
  if (!pack.plan) {
    findings.push(
      finding({
        code: "PRODUCTION_FAIL",
        what: "Production QA failed. No production plan.",
        where: pack.episode.id,
        why: "Music, voice, and asset requests have nowhere to live.",
        correction: "Attach a production plan. Do not pretend a render exists.",
        role: "Animation Producer",
        artifactType: "production_plan",
        artifactId: pack.episode.id,
        artifactVersion: pack.episode.currentVersion,
      }),
    );
  }
  if (scriptBody && boardBody) {
    const scriptNos = new Set(scriptBody.scenes.map((scene) => scene.sceneNo));
    for (const scene of boardBody.scenes) {
      if (!scriptNos.has(scene.sceneNo)) {
        findings.push(
          finding({
            code: "PRODUCTION_FAIL",
            what: `Production QA failed. Storyboard references Scene ${scene.sceneNo} but the episode contains ${scriptBody.scenes.length} scenes.`,
            where: board?.id ?? "",
            why: "The scene reference does not resolve.",
            correction: "Fix the storyboard reference in a new version. Do not delete the script scene from here.",
            role: "Storyboard Director",
            artifactType: "storyboard",
            artifactId: board?.id ?? pack.episode.id,
            artifactVersion: board?.currentVersion ?? null,
          }),
        );
      }
    }
    const boardCheck = validateBoardConsistency(scriptBody, boardBody);
    if (boardCheck.result === "FAIL") {
      findings.push(
        finding({
          code: "PRODUCTION_FAIL",
          what: "Production QA failed. The storyboard contradicts the script.",
          where: board?.id ?? pack.episode.id,
          why: boardCheck.failures[0]?.detail ?? "Board consistency failed.",
          correction: "Open a storyboard revision. The approved script stays.",
          role: "Storyboard Director",
          artifactType: "storyboard",
          artifactId: board?.id ?? pack.episode.id,
          artifactVersion: board?.currentVersion ?? null,
        }),
      );
    }
    if (board && script && boardBody.scriptVersion !== script.canonicalVersion) {
      findings.push(
        finding({
          code: "PRODUCTION_FAIL",
          what: `Production QA failed. Storyboard uses script v${boardBody.scriptVersion} while the approved script is v${script.canonicalVersion}.`,
          where: board.id,
          why: "Contradictory versions.",
          correction: "Rebuild the storyboard against the approved script version.",
          role: "Storyboard Director",
          artifactType: "storyboard",
          artifactId: board.id,
          artifactVersion: board.currentVersion,
        }),
      );
    }
    const known = new Set(db.characters.filter((character) => character.canonicalVersion != null).map((character) => character.id));
    for (const scene of boardBody.scenes) {
      for (const shot of scene.shots) {
        for (const id of shot.characterIds) {
          if (id && !known.has(id)) {
            findings.push(
              finding({
                code: "PRODUCTION_FAIL",
                what: `Production QA failed. Shot ${shot.id} cites a character that does not resolve.`,
                where: shot.id,
                why: id,
                correction: "Use a locked character id.",
                role: "Storyboard Director",
                artifactType: "storyboard",
                artifactId: board?.id ?? pack.episode.id,
                artifactVersion: board?.currentVersion ?? null,
              }),
            );
          }
        }
      }
    }
  }
  for (const asset of pack.assets) {
    const body = latestSnapshot(asset).snapshot;
    if (!body.characterId || body.characterVersion == null) continue;
    const character = db.characters.find((item) => item.id === body.characterId);
    const locked = character?.canonicalVersion ?? null;
    if (locked != null && body.characterVersion !== locked) {
      findings.push(
        finding({
          code: "PRODUCTION_FAIL",
          what: `Production QA failed. Asset ${asset.id} uses character v${body.characterVersion} while the episode is locked to character v${locked}.`,
          where: asset.id,
          why: `${character?.name ?? body.characterId} version mismatch.`,
          correction: "Regenerate the reference against the locked character version. Canon stays as it is.",
          role: "Visual Director",
          artifactType: "asset",
          artifactId: asset.id,
          artifactVersion: asset.currentVersion,
        }),
      );
    }
  }
  if (pack.snap.scriptId && !script) {
    findings.push(
      finding({
        code: "PRODUCTION_FAIL",
        what: "Production QA failed. The episode points at a missing script.",
        where: pack.snap.scriptId,
        why: "Broken workflow link.",
        correction: "Restore the link. Do not invent a script.",
        role: "Animation Producer",
        artifactType: "episode",
        artifactId: pack.episode.id,
        artifactVersion: pack.episode.currentVersion,
      }),
    );
  }
  if (findings.length === 0) evidence.push("Story, script, storyboard, and plan resolve. Provider may still be not connected.");
  return {
    checkId: "production",
    label: "Production QA",
    result: findings.length ? "FAIL" : "PASS",
    severity: findings.length ? "RED" : "GREEN",
    findings,
    evidence,
    reviewerName: "Production check",
  };
}

function decide(checks: DraftCheck[]): Pick<ReleasePreview, "status" | "blocking" | "warnings" | "humanQuestions" | "nextAction"> {
  const blocking = checks.flatMap((check) => (check.severity === "RED" ? check.findings.filter((item) => item.code !== "CANON_WARN" && item.code !== "HINDI_WARN" && item.code !== "CULTURE_WARN") : []));
  const humanQuestions = checks.flatMap((check) => (check.severity === "HUMAN_REVIEW" ? check.findings.map((item) => item.what) : []));
  const warnings = checks.flatMap((check) => (check.severity === "YELLOW" ? check.findings.map((item) => item.what) : []));
  if (blocking.length) {
    const first = blocking[0];
    return {
      status: "RELEASE_BLOCKED",
      blocking,
      warnings,
      humanQuestions,
      nextAction: first ? `${first.correction} Rerun the release check after the new version exists.` : "Resolve the blocking check and rerun.",
    };
  }
  if (humanQuestions.length || checks.some((check) => check.severity === "HUMAN_REVIEW")) {
    return {
      status: "HUMAN_REVIEW_REQUIRED",
      blocking,
      warnings,
      humanQuestions,
      nextAction: "A human has to judge the open question. The episode cannot move, and it cannot publish.",
    };
  }
  return {
    status: "RELEASE_READY",
    blocking,
    warnings,
    humanQuestions,
    nextAction: "A human may move this episode to human approval. It must not be published.",
  };
}

export function previewRelease(db: StudioDb, episodeId: string): ReleasePreview {
  const pack = episodeOf(db, episodeId);
  const current = stampOf(db, episodeId);
  if (!pack) {
    const missing: DraftCheck = {
      checkId: "production",
      label: "Production QA",
      result: "NOT_EVALUATED",
      severity: "RED",
      findings: [
        finding({
          code: "MISSING",
          what: "Episode not found.",
          where: episodeId,
          why: "Nothing to evaluate.",
          correction: "Open an episode first.",
          role: "Studio lead",
          artifactType: "episode",
          artifactId: episodeId,
          artifactVersion: null,
        }),
      ],
      evidence: [],
      reviewerName: "Release gate",
    };
    const decision = decide([missing]);
    return { ...decision, checks: [missing], stamp: current, canonVersion: "", versionsLabel: versionsLabel(current) };
  }
  const checks = [
    checkCanon(db, pack),
    checkStory(db, pack),
    checkHindi(pack),
    checkCulture(pack),
    checkAssets(pack),
    checkRights(pack),
    checkPolicy(pack),
    checkProduction(db, pack),
  ];
  return { ...decide(checks), checks, stamp: current, canonVersion: current.canonVersion, versionsLabel: versionsLabel(current) };
}

export function staleReason(db: StudioDb, episodeId: string, recorded: ReleaseStamp): string | null {
  const current = stampOf(db, episodeId);
  if (!current.storyId && recorded.storyId) return "QA OUTDATED — EPISODE MISSING";
  if (current.storyKey !== recorded.storyKey || current.storyCurrentVersion !== recorded.storyCurrentVersion || current.storyVersion !== recorded.storyVersion) {
    return "QA OUTDATED — STORY VERSION CHANGED";
  }
  if (current.scriptKey !== recorded.scriptKey || current.scriptVersion !== recorded.scriptVersion) return "QA OUTDATED — SCRIPT VERSION CHANGED";
  if (current.storyboardVersion !== recorded.storyboardVersion) return "QA OUTDATED — STORYBOARD VERSION CHANGED";
  if (current.planKey !== recorded.planKey || current.planVersion !== recorded.planVersion) return "QA OUTDATED — PRODUCTION PLAN CHANGED";
  if (current.assetKey !== recorded.assetKey) return "QA OUTDATED — ASSET SET CHANGED";
  if (current.latestCanonHash !== recorded.latestCanonHash || current.canonSnapshotHash !== recorded.canonSnapshotHash) return "QA OUTDATED — CANON VERSION CHANGED";
  return null;
}

export function readRelease(db: StudioDb, episodeId: string): RecordedRelease | null {
  const reports = (db.releaseReports ?? []).filter((item) => item.episodeId === episodeId);
  const report = reports[reports.length - 1];
  if (!report) return null;
  const checks = (db.releaseChecks ?? []).filter((item) => report.checkIds.includes(item.id));
  const repairs = (db.releaseRepairs ?? []).filter((item) => item.reportId === report.id);
  const reason = staleReason(db, episodeId, report.stamp);
  return { report, checks, repairs, stale: Boolean(reason), staleReason: reason };
}

export function runReleaseGate(db: StudioDb, episodeId: string, actor: Actor, now?: string): Op<{ reportId: string; status: ReleaseStatus }> {
  const at = stamp(now);
  if (!db.episodes.some((item) => item.id === episodeId)) return fail(db, "missing", "Episode not found.");
  const preview = previewRelease(db, episodeId);
  let next = db;
  const checks: ReleaseCheckRecord[] = [];
  for (const check of preview.checks) {
    const ided = allocId(next, "rchk");
    next = ided.db;
    checks.push({
      id: ided.id,
      checkId: check.checkId,
      label: check.label,
      engineVersion: ENGINE_VERSION,
      episodeId,
      result: check.result,
      severity: check.severity,
      findings: check.findings,
      evidence: check.evidence,
      versionsLabel: preview.versionsLabel,
      canonVersion: preview.canonVersion,
      reviewerId: REVIEWER_ID,
      reviewerName: check.reviewerName,
      at,
    });
  }
  const reported = allocId(next, "rrel");
  next = reported.db;
  const report: ReleaseReport = {
    id: reported.id,
    episodeId,
    at,
    status: preview.status,
    checkIds: checks.map((item) => item.id),
    blocking: preview.blocking,
    warnings: preview.warnings,
    humanQuestions: preview.humanQuestions,
    nextAction: preview.nextAction,
    stamp: preview.stamp,
    canonVersion: preview.canonVersion,
    versionsLabel: preview.versionsLabel,
    actorId: actor.id,
    actorName: actor.name,
  };
  const repairs: ReleaseRepair[] = [];
  const interesting = preview.checks.flatMap((check) =>
    check.findings
      .filter((item) => check.severity === "RED" || check.severity === "HUMAN_REVIEW")
      .filter((item) => item.code !== "CANON_WARN")
      .map((item) => ({ check, item })),
  );
  for (const row of interesting) {
    const ided = allocId(next, "rrep");
    next = ided.db;
    repairs.push({
      id: ided.id,
      at,
      episodeId,
      reportId: report.id,
      checkId: row.check.checkId,
      problem: row.item.what,
      artifactType: row.item.artifactType,
      artifactId: row.item.artifactId,
      artifactVersion: row.item.artifactVersion,
      reason: row.item.why,
      requiredChange: row.item.correction,
      responsibleRole: row.item.role,
      status: "OPEN",
    });
  }
  next = {
    ...next,
    releaseChecks: [...(next.releaseChecks ?? []), ...checks],
    releaseReports: [...(next.releaseReports ?? []), report],
    releaseRepairs: [...(next.releaseRepairs ?? []), ...repairs],
  };
  next = audit(next, at, actor, "release.recorded", episodeId, `${statusLabel(preview.status)}. ${preview.versionsLabel}. Nothing was rewritten and nothing was published.`);
  return { ok: true, db: next, data: { reportId: report.id, status: preview.status } };
}

function pushStage(episode: VersionedEntity<EpisodeBody>, to: EpisodeStage, actor: Actor, at: string, note: string): { ok: true; entity: VersionedEntity<EpisodeBody> } | { ok: false; error: string } {
  const cur = latestSnapshot(episode).snapshot;
  if (!canTransition(cur.stage, to)) return { ok: false, error: `Cannot move from ${cur.stage} to ${to}.` };
  const version = episode.currentVersion + 1;
  return {
    ok: true,
    entity: {
      ...episode,
      currentVersion: version,
      updatedAt: at,
      versions: [
        ...episode.versions,
        {
          version,
          status: "approved",
          snapshot: { ...cur, stage: to },
          createdAt: at,
          createdBy: actor.id,
          note,
          immutable: true,
        },
      ],
    },
  };
}

const GATE_PATH: EpisodeStage[] = ["STORYBOARD", "QUALITY_QA", "IP_RIGHTS_QA", "POLICY_QA", "HUMAN_APPROVAL"];

export function advanceToHumanApproval(db: StudioDb, episodeId: string, actor: Actor, now?: string): Op<{ stage: EpisodeStage }> {
  const at = stamp(now);
  if (actor.type === "agent") {
    return fail(audit(db, at, actor, "release.advance_denied", episodeId, "An agent cannot move an episode to human approval or clear a block."), "human-required", "Only a human can move a release-ready episode to human approval.");
  }
  const recorded = readRelease(db, episodeId);
  if (!recorded) return fail(db, "no-release", "Record a release check before human approval. Old gates are not reused silently.");
  if (recorded.stale) return fail(db, "stale", `${recorded.staleReason}. The episode cannot advance on outdated QA.`);
  if (recorded.report.status !== "RELEASE_READY") {
    const why = recorded.report.blocking[0]?.what ?? recorded.report.humanQuestions[0] ?? recorded.report.status;
    return fail(db, "blocked", `Release is not ready. ${why}`);
  }
  const episode = db.episodes.find((item) => item.id === episodeId);
  if (!episode) return fail(db, "missing", "Episode not found.");
  const stage = latestSnapshot(episode).snapshot.stage;
  if (stage === "PUBLISHED" || stage === "READY_TO_PUBLISH") {
    const blocked = publishEpisode(db, episodeId, actor, at);
    return fail(blocked.db, "publish-disabled", "Publishing is disabled. A release-ready episode cannot become PUBLISHED.");
  }
  if (stage === "HUMAN_APPROVAL") {
    return { ok: true, db, data: { stage: "HUMAN_APPROVAL" } };
  }
  const index = GATE_PATH.indexOf(stage);
  if (index === -1) return fail(db, "stage", `Release is ready, but ${stage} cannot move to human approval yet.`);
  let entity = episode;
  for (const nextStage of GATE_PATH.slice(index + 1)) {
    const moved = pushStage(entity, nextStage, actor, at, `Release ready. Moved to ${nextStage}. Not published.`);
    if (!moved.ok) return fail(db, "stage", moved.error);
    entity = moved.entity;
  }
  const next = audit(
    { ...db, episodes: db.episodes.map((item) => (item.id === entity.id ? entity : item)) },
    at,
    actor,
    "release.human_approval",
    episodeId,
    `Eligible for human approval. Publishing stays disabled. Episode v${entity.currentVersion}.`,
  );
  return { ok: true, db: next, data: { stage: "HUMAN_APPROVAL" } };
}

export function agentClearRedFlag(db: StudioDb, episodeId: string, actor: Actor, now?: string): Op<never> {
  const at = stamp(now);
  const next = audit(db, at, actor, "rights.clear_denied", episodeId, "An agent cannot clear a rights red flag, remove commercial uncertainty, or approve release.");
  if (actor.type === "agent") {
    return fail(next, "human-required", "An agent cannot clear a rights red flag or approve release.");
  }
  return fail(next, "rights-red-flag", "This gate does not clear rights. A human updates the asset evidence, then the release check is run again.");
}

export interface ReleaseDeskRow {
  episodeId: string;
  title: string;
  status: ReleaseStatus;
  stale: boolean;
  staleReason: string | null;
  rights: boolean;
  policy: boolean;
  canon: boolean;
  provenance: boolean;
  production: boolean;
  human: boolean;
  blocker: string | null;
}

export function releaseDesk(db: StudioDb): {
  ready: number;
  blocked: number;
  human: number;
  rights: number;
  policy: number;
  canon: number;
  stale: number;
  provenance: number;
  productionFailures: number;
  rows: ReleaseDeskRow[];
} {
  const rows = db.episodes.map((episode) => {
    const snap = latestSnapshot(episode).snapshot;
    const live = previewRelease(db, episode.id);
    const recorded = readRelease(db, episode.id);
    const by = (kind: ReleaseCheckKind) => live.checks.find((check) => check.checkId === kind);
    const rights = by("rights")?.severity === "RED";
    const policy = by("policy")?.severity === "RED" || by("policy")?.severity === "HUMAN_REVIEW";
    const canon = by("canon")?.severity === "RED";
    const provenance = by("asset")?.severity === "RED";
    const production = by("production")?.result === "FAIL";
    return {
      episodeId: episode.id,
      title: snap.title,
      status: live.status,
      stale: recorded?.stale ?? false,
      staleReason: recorded?.staleReason ?? null,
      rights,
      policy,
      canon,
      provenance,
      production,
      human: live.status === "HUMAN_REVIEW_REQUIRED",
      blocker: live.blocking[0]?.what ?? (live.status === "HUMAN_REVIEW_REQUIRED" ? live.humanQuestions[0] ?? "Human review required." : null),
    };
  });
  return {
    ready: rows.filter((row) => row.status === "RELEASE_READY" && !row.stale).length,
    blocked: rows.filter((row) => row.status === "RELEASE_BLOCKED").length,
    human: rows.filter((row) => row.human).length,
    rights: rows.filter((row) => row.rights).length,
    policy: rows.filter((row) => row.policy).length,
    canon: rows.filter((row) => row.canon).length,
    stale: rows.filter((row) => row.stale).length,
    provenance: rows.filter((row) => row.provenance).length,
    productionFailures: rows.filter((row) => row.production).length,
    rows,
  };
}
