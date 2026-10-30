import { BLUEPRINTS, THIN_BLUEPRINT } from "./blueprints.ts";
import { draftCanonSnapshot } from "./canon.ts";
import type {
  CanonGateResult,
  OriginalityDimension,
  OriginalityScore,
  SimilarityDimension,
  SimilarityHit,
  SimilarityReport,
  StoryBody,
  StoryDecision,
  StoryDna,
  StoryFingerprint,
  StoryRecommendation,
  StudioDb,
} from "./types.ts";

export const DEFAULT_SIMILARITY_BLOCK = 55;
export const DEFAULT_ORIGINALITY_THRESHOLD = 75;

const CORE_KEYS = new Set(["premise", "conflict", "learning", "resolution", "structure"]);
const LOOKALIKE_FLOOR = 80;

interface DimensionSpec {
  key: string;
  label: string;
  max: number;
  raw: (dna: StoryDna) => string;
  fold: boolean;
}

const DIMENSIONS: DimensionSpec[] = [
  { key: "premise", label: "Premise", max: 14, raw: (dna) => dna.premise, fold: true },
  { key: "conflict", label: "Main conflict", max: 12, raw: (dna) => dna.conflict, fold: true },
  { key: "characters", label: "Character combination", max: 10, raw: (dna) => [...dna.characterCombination].sort().join("+"), fold: false },
  { key: "setting", label: "Setting", max: 8, raw: (dna) => dna.setting, fold: false },
  { key: "emotion", label: "Emotional arc", max: 8, raw: (dna) => dna.emotionalArc, fold: true },
  { key: "learning", label: "Learning objective", max: 8, raw: (dna) => dna.learningObjective, fold: true },
  { key: "resolution", label: "Resolution", max: 10, raw: (dna) => dna.resolutionType, fold: true },
  { key: "structure", label: "Story structure", max: 16, raw: (dna) => dna.storyStructure ?? "", fold: false },
  { key: "humor", label: "Humor mechanism", max: 4, raw: (dna) => dna.humorMechanism, fold: true },
  { key: "cultural", label: "Cultural element", max: 5, raw: (dna) => dna.culturalElement, fold: true },
  { key: "visual", label: "Visual motif", max: 5, raw: (dna) => dna.visualMotif, fold: true },
];

function stableHash(value: unknown): string {
  const s = JSON.stringify(value);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = Math.imul(h, 33) ^ s.charCodeAt(i);
  return (h >>> 0).toString(16);
}

/** Fold surface nouns so a kite and a ball can share a premise class. */
export function foldToken(value: string | undefined): string {
  if (!value) return "";
  let s = value.toLowerCase();
  const swaps: Array<[RegExp, string]> = [
    [/\b(red|blue|green|pink|yellow|orange|teal|mustard|steel|white|grey|gray|brown)\b/g, " "],
    [/\b(meethi|golu|kamla|dadi)\b/g, "child"],
    [/\b(thunder|lightning|barking|barks|bark|storm|noise|fear)\b/g, "fear-sound"],
    [/\b(ball|kite|bangle|scarf|balloon|marble|toy|doll|cloth|blossom|flower|gulmohar)\b/g, "object"],
  ];
  for (const [pattern, next] of swaps) s = s.replace(pattern, next);
  s = s.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (!s || s === "none" || s === "empty") return "";
  return s;
}

/** Swap nouns that fold back to the same structural token. */
export function disguiseToken(value: string): string {
  return value
    .replace(/thunder/gi, "barking")
    .replace(/lightning/gi, "barking")
    .replace(/fear/gi, "noise")
    .replace(/gulmohar/gi, "blossom")
    .replace(/flower/gi, "blossom")
    .replace(/scarf/gi, "cloth")
    .replace(/bangle/gi, "marble")
    .replace(/balloon/gi, "kite")
    .replace(/ball/gi, "kite");
}

export function disguiseDna(dna: StoryDna): StoryDna {
  return {
    ...dna,
    premise: disguiseToken(dna.premise),
    theme: disguiseToken(dna.theme),
    conflict: disguiseToken(dna.conflict),
    emotionalArc: disguiseToken(dna.emotionalArc),
    learningObjective: disguiseToken(dna.learningObjective),
    resolutionType: disguiseToken(dna.resolutionType),
    humorMechanism: disguiseToken(dna.humorMechanism),
    adventureMechanism: disguiseToken(dna.adventureMechanism),
    mysteryMechanism: disguiseToken(dna.mysteryMechanism),
    culturalElement: disguiseToken(dna.culturalElement),
    visualMotif: disguiseToken(dna.visualMotif),
    storyStructure: dna.storyStructure,
  };
}

function normalized(spec: DimensionSpec, dna: StoryDna): string {
  const raw = spec.raw(dna) ?? "";
  if (!spec.fold) return raw.trim();
  return foldToken(raw);
}

export function makeFingerprint(dna: StoryDna): StoryFingerprint {
  const play = [dna.humorMechanism, dna.adventureMechanism, dna.mysteryMechanism]
    .map((item) => foldToken(item))
    .filter(Boolean)
    .join("+");
  const core = {
    premise: foldToken(dna.premise),
    conflict: foldToken(dna.conflict),
    characters: [...(dna.characterCombination ?? [])].sort().join("+"),
    characterRoles: `cast-${dna.characterCombination?.length ?? 0}`,
    setting: (dna.setting ?? "").trim(),
    emotionalArc: foldToken(dna.emotionalArc),
    learningObjective: foldToken(dna.learningObjective),
    resolution: foldToken(dna.resolutionType),
    storyStructure: dna.storyStructure || "unclassified",
    playMechanism: play || "none",
    culturalElement: foldToken(dna.culturalElement),
    visualMotif: foldToken(dna.visualMotif),
  };
  return { ...core, hash: stableHash(core) };
}

export interface CorpusEntry {
  id: string;
  title: string;
  dna: StoryDna;
}

export function compareDna(dna: StoryDna, other: StoryDna): {
  score: number;
  matches: SimilarityReport["matches"];
  dimensions: SimilarityDimension[];
  structuralCore: boolean;
  structuralTriplet: boolean;
} {
  const dimensions: SimilarityDimension[] = [];
  let score = 0;
  for (const spec of DIMENSIONS) {
    const left = normalized(spec, dna);
    const right = normalized(spec, other);
    const matched = Boolean(left) && left === right;
    const points = matched ? spec.max : 0;
    score += points;
    const surface = spec.fold ? `${spec.raw(dna) || "—"} → ${left || "—"}` : left || "—";
    dimensions.push({
      key: spec.key,
      label: spec.label,
      score: points,
      max: spec.max,
      matched,
      detail: matched ? `same ${spec.label.toLowerCase()} (${surface})` : `${spec.label} differs`,
    });
  }
  const structuralCore = dimensions.filter((item) => CORE_KEYS.has(item.key)).every((item) => item.matched);
  const structuralTriplet =
    Boolean(dna.premise) &&
    dna.premise === other.premise &&
    dna.conflict === other.conflict &&
    dna.resolutionType === other.resolutionType;
  if (structuralCore) score = Math.max(score, LOOKALIKE_FLOOR);
  return {
    score: Math.min(100, score),
    matches: dimensions.filter((item) => item.matched).map((item) => ({ field: item.key, detail: item.detail })),
    dimensions,
    structuralCore,
    structuralTriplet,
  };
}

function explainSimilarity(
  score: number,
  dimensions: SimilarityDimension[],
  title: string | null,
  id: string | null,
  structuralCore: boolean,
): string {
  if (!id || score === 0) return "Similarity: 0\nNo structural neighbor in the library.";
  const lines = dimensions.filter((item) => item.matched).map((item) => `- ${item.detail}`);
  const nounNote =
    structuralCore
      ? "The premise, conflict, learning objective, resolution, and story structure match. Different character names, objects, or places do not make this a different story."
      : "";
  return [
    `Similarity: ${score}`,
    lines.length ? `Main similarities:\n${lines.join("\n")}` : "No structural field matched.",
    `Closest match:\n${title ?? "Untitled"} (${id})`,
    nounNote,
  ]
    .filter(Boolean)
    .join("\n");
}

export function bestSimilarity(
  dna: StoryDna,
  corpus: CorpusEntry[],
  excludeId: string | undefined,
  blockAt: number,
): SimilarityReport {
  let bestScore = 0;
  let bestId: string | null = null;
  let bestTitle: string | null = null;
  let bestDimensions: SimilarityDimension[] = DIMENSIONS.map((spec) => ({
    key: spec.key,
    label: spec.label,
    score: 0,
    max: spec.max,
    matched: false,
    detail: "No comparison",
  }));
  let bestCore = false;
  let bestTriplet = false;
  const hits: SimilarityHit[] = [];
  const seen = new Set<string>();
  for (const entry of corpus) {
    if (entry.id === excludeId) continue;
    const found = compareDna(dna, entry.dna);
    const reasons = found.matches.map((item) => item.detail);
    if (found.score > 0 && !seen.has(entry.id)) {
      seen.add(entry.id);
      hits.push({ storyId: entry.id, title: entry.title, score: found.score, reasons });
    } else if (found.score > 0 && seen.has(entry.id)) {
      const existing = hits.find((hit) => hit.storyId === entry.id);
      if (existing && found.score > existing.score) {
        existing.score = found.score;
        existing.title = entry.title;
        existing.reasons = reasons;
      }
    }
    const too = found.score >= blockAt || found.structuralCore || found.structuralTriplet;
    const bestToo = bestScore >= blockAt || bestCore || bestTriplet;
    if (found.score > bestScore || (too && !bestToo)) {
      bestScore = found.score;
      bestId = entry.id;
      bestTitle = entry.title;
      bestDimensions = found.dimensions;
      bestCore = found.structuralCore;
      bestTriplet = found.structuralTriplet;
    }
  }
  hits.sort((a, b) => b.score - a.score);
  const tooSimilar = bestScore >= blockAt || bestCore || bestTriplet;
  const score = tooSimilar ? Math.max(bestScore, bestCore ? LOOKALIKE_FLOOR : bestScore) : bestScore;
  const status: SimilarityReport["status"] = tooSimilar ? "LOOKALIKE" : score >= 35 ? "WATCH" : "CLEAR";
  return {
    score: Math.min(100, score),
    againstStoryId: bestId,
    againstTitle: bestTitle,
    matches: bestDimensions.filter((item) => item.matched).map((item) => ({ field: item.key, detail: item.detail })),
    tooSimilar,
    status,
    explanation: explainSimilarity(Math.min(100, score), bestDimensions, bestTitle, bestId, bestCore),
    dimensions: bestDimensions,
    closestMatches: hits.slice(0, 3),
  };
}

export function emptySimilarity(): SimilarityReport {
  return {
    score: 0,
    againstStoryId: null,
    againstTitle: null,
    matches: [],
    tooSimilar: false,
    status: "CLEAR",
    explanation: "Similarity: 0\nNo structural neighbor in the library.",
    dimensions: [],
    closestMatches: [],
  };
}

export interface OriginalityInput {
  premise: string;
  storyStructure: string;
  theme: string;
  developmentHit: boolean;
  characterPresent: boolean;
  thin: boolean;
  hasBeginning: boolean;
  hasMiddle: boolean;
  hasResolution: boolean;
  hasConflict: boolean;
  hasPlayEngine: boolean;
  visualMotif: string;
  visualMotifUsed: boolean;
  emotionalArc: string;
  emotionalArcUsed: boolean;
  culturalSpecificity: "specific" | "generic" | "none";
  editorialNote: string;
  threshold: number;
}

function dimension(
  key: string,
  label: string,
  score: number,
  max: number,
  reason: string,
): OriginalityDimension {
  return { key, label, score, max, reason };
}

export function scoreOriginality(input: OriginalityInput): OriginalityScore {
  const generic = input.thin || input.theme === "generic" || !input.premise.trim() || !input.hasConflict;
  const structured = Boolean(input.storyStructure) && input.storyStructure !== "no-structure" && input.storyStructure !== "unclassified";
  let storyUniqueness = 10;
  let uniquenessReason = "A premise is present, but the story structure is unclassified.";
  if (generic) {
    storyUniqueness = 6;
    uniquenessReason = "The premise is generic or the conflict is missing. This is a specificity score, not a similarity score.";
  } else if (structured && input.hasPlayEngine && input.culturalSpecificity === "specific") {
    storyUniqueness = 20;
    uniquenessReason = "Specific premise, a named story structure, a play mechanism, and a concrete cultural detail.";
  } else if (structured) {
    storyUniqueness = 16;
    uniquenessReason = "Specific premise and story structure. A play mechanism or cultural detail is thin.";
  }

  const characterDevelopment = input.developmentHit ? 15 : input.characterPresent ? 5 : 0;
  const developmentReason = input.developmentHit
    ? "The story exercises a development token from locked canon."
    : input.characterPresent
      ? "A canonical character is present, but no development token is exercised."
      : "No canonical character is present.";

  let entertainmentValue = 0;
  let entertainmentReason = "The story is thin or missing beats.";
  if (input.hasBeginning && input.hasMiddle && input.hasResolution && input.hasConflict && !input.thin) {
    entertainmentValue += 12;
    entertainmentReason = "Beginning, middle, resolution, and a conflict are present.";
  } else if (input.hasBeginning && input.hasConflict && !input.thin) {
    entertainmentValue += 6;
    entertainmentReason = "A beginning and a conflict exist. The middle or resolution is thin.";
  } else if (input.hasBeginning && input.hasMiddle && input.hasResolution && !input.thin) {
    entertainmentValue += 8;
    entertainmentReason = "The beats exist, but the conflict is not distinct.";
  }
  if (input.hasPlayEngine && !input.thin) {
    entertainmentValue += 8;
    entertainmentReason = `${entertainmentReason} A humor, adventure, or mystery mechanism is named.`;
  }
  entertainmentValue = Math.min(20, entertainmentValue);

  const visualVariation = !input.visualMotif ? 0 : input.visualMotifUsed ? 8 : 15;
  const visualReason = !input.visualMotif
    ? "No visual motif."
    : input.visualMotifUsed
      ? "A visual motif exists, but the same structural motif is already in the library."
      : "The visual motif is not yet used in this IP.";

  const emotionalVariation =
    !input.emotionalArc || input.emotionalArc === "none" ? 0 : input.emotionalArcUsed ? 9 : 15;
  const emotionalReason =
    !input.emotionalArc || input.emotionalArc === "none"
      ? "No emotional arc."
      : input.emotionalArcUsed
        ? "The emotional arc matches one already in the library."
        : "The emotional arc is not yet used in this IP.";

  const culturalSpecificity = input.culturalSpecificity === "specific" ? 10 : input.culturalSpecificity === "generic" ? 4 : 0;
  const culturalReason =
    input.culturalSpecificity === "specific"
      ? "The cultural detail is specific to this lane, not a generic moral."
      : input.culturalSpecificity === "generic"
        ? "Culture is named only in a generic way."
        : "No cultural specificity.";

  const humanEditorial = input.editorialNote.trim().length >= 24 ? 5 : 0;
  const editorialReason =
    humanEditorial === 5
      ? "A human wrote an editorial note on this version."
      : "No human editorial note on this version yet. Agents cannot supply this point.";

  const dimensions = [
    dimension("storyUniqueness", "Story uniqueness", storyUniqueness, 20, uniquenessReason),
    dimension("characterDevelopment", "Character development", characterDevelopment, 15, developmentReason),
    dimension("entertainmentValue", "Educational / entertainment value", entertainmentValue, 20, entertainmentReason),
    dimension("visualVariation", "Visual variation", visualVariation, 15, visualReason),
    dimension("emotionalVariation", "Emotional / narrative variation", emotionalVariation, 15, emotionalReason),
    dimension("culturalSpecificity", "Cultural specificity", culturalSpecificity, 10, culturalReason),
    dimension("humanEditorial", "Human editorial contribution", humanEditorial, 5, editorialReason),
  ];
  const total = dimensions.reduce((sum, item) => sum + item.score, 0);
  return {
    storyUniqueness,
    characterDevelopment,
    entertainmentValue,
    visualVariation,
    emotionalVariation,
    culturalSpecificity,
    humanEditorial,
    total,
    threshold: input.threshold,
    meetsThreshold: total >= input.threshold,
    dimensions,
  };
}

export function decideStory(input: {
  canonResult: CanonGateResult;
  originality: number;
  threshold: number;
  meetsThreshold: boolean;
  tooSimilar: boolean;
  similarity: number;
  closestTitle: string | null;
  thin: boolean;
  similarityBlock: number;
}): StoryRecommendation {
  const reasons: string[] = [];
  let decision: StoryDecision = "HUMAN_REVIEW";
  if (input.canonResult === "NOT_EVALUATED") {
    return {
      decision: "NOT_EVALUATED",
      canonResult: "NOT_EVALUATED",
      reasons: ["Canon was not evaluated. Story Intelligence will not invent a pass."],
    };
  }
  if (input.canonResult === "FAIL" || input.canonResult === "BLOCKED") {
    decision = "BLOCKED";
    reasons.push(`Canon ${input.canonResult}. The Canon Engine blocked this story. Story Intelligence does not override it.`);
  }
  if (input.tooSimilar) {
    decision = "BLOCKED";
    reasons.push(
      `Similarity ${input.similarity} is a lookalike${input.closestTitle ? ` of “${input.closestTitle}”` : ""}. Writing quality does not clear this. Block threshold ${input.similarityBlock}.`,
    );
  }
  if (!input.meetsThreshold || input.thin) {
    if (decision !== "BLOCKED") decision = "REQUIRES_REVISION";
    reasons.push(
      `Originality ${input.originality} is under the internal Neem bar ${input.threshold}. This is not a YouTube rule.${input.thin ? " The story is also thin." : ""}`,
    );
  }
  if (decision === "HUMAN_REVIEW") {
    reasons.push(
      `Originality ${input.originality} clears the internal bar ${input.threshold}. Similarity ${input.similarity} is acceptable. Canon ${input.canonResult}. A human still has to approve. Nothing here is an approval.`,
    );
  }
  return { decision, reasons, canonResult: input.canonResult };
}

export function recommendationFor(body: StoryBody, canonResult: CanonGateResult, similarityBlock = DEFAULT_SIMILARITY_BLOCK): StoryRecommendation {
  return decideStory({
    canonResult,
    originality: body.originality.total,
    threshold: body.originality.threshold,
    meetsThreshold: body.originality.meetsThreshold,
    tooSimilar: body.similarity.tooSimilar,
    similarity: body.similarity.score,
    closestTitle: body.similarity.againstTitle,
    thin: body.thin,
    similarityBlock,
  });
}

export interface VariationBucket {
  dimension: string;
  value: string;
  count: number;
  share: number;
}

export interface VariationGap {
  dimension: string;
  value: string;
  note: string;
}

export interface VariationReport {
  librarySize: number;
  frequencies: VariationBucket[];
  overused: VariationBucket[];
  gaps: VariationGap[];
  recommendations: string[];
}

export interface VariationInput {
  title: string;
  dna: StoryDna;
  settingLabel: string;
  castLabel: string;
}

export function analyzeVariation(stories: VariationInput[]): VariationReport {
  const librarySize = stories.length;
  const tally = new Map<string, Map<string, number>>();
  const add = (dimension: string, value: string) => {
    const key = value.trim();
    if (!key || key === "none" || key === "empty") return;
    const bucket = tally.get(dimension) ?? new Map<string, number>();
    bucket.set(key, (bucket.get(key) ?? 0) + 1);
    tally.set(dimension, bucket);
  };
  for (const story of stories) {
    const dna = story.dna;
    add("premise", foldToken(dna.premise));
    add("conflict", foldToken(dna.conflict));
    add("character combination", story.castLabel);
    add("setting", story.settingLabel);
    add("emotional arc", foldToken(dna.emotionalArc));
    add("learning objective", foldToken(dna.learningObjective));
    add("resolution", foldToken(dna.resolutionType));
    add("humor mechanism", dna.humorMechanism === "none" ? "" : dna.humorMechanism);
    add("adventure mechanism", dna.adventureMechanism === "none" ? "" : dna.adventureMechanism);
    add("mystery mechanism", dna.mysteryMechanism === "none" ? "" : dna.mysteryMechanism);
    add("cultural element", foldToken(dna.culturalElement));
    add("visual motif", foldToken(dna.visualMotif));
    add("song usage", dna.songUsage === "none" ? "" : dna.songUsage);
    add("story structure", dna.storyStructure || "");
  }
  const frequencies: VariationBucket[] = [];
  for (const [dimension, bucket] of tally) {
    for (const [value, count] of bucket) {
      frequencies.push({ dimension, value, count, share: librarySize ? count / librarySize : 0 });
    }
  }
  frequencies.sort((a, b) => b.count - a.count || a.dimension.localeCompare(b.dimension));
  const overused = frequencies.filter((item) => item.count >= 3 && item.share >= 0.25);
  const usedStructures = new Set(
    stories.map((story) => story.dna.storyStructure).filter((item) => item && item !== "no-structure"),
  );
  const gaps: VariationGap[] = [];
  for (const blueprint of [...BLUEPRINTS, THIN_BLUEPRINT]) {
    if (!blueprint.storyStructure || blueprint.storyStructure === "no-structure") continue;
    if (usedStructures.has(blueprint.storyStructure)) continue;
    gaps.push({
      dimension: "story structure",
      value: blueprint.storyStructure,
      note: `${blueprint.title} is in the development catalog and not in the library.`,
    });
  }
  const recommendations: string[] = [];
  if (librarySize === 0) {
    recommendations.push("The library is empty. There is no repetition to measure yet.");
  }
  for (const item of overused.slice(0, 4)) {
    recommendations.push(
      `${item.dimension} “${item.value}” is used in ${item.count} of ${librarySize} stories. This is a signal for a human, not an automatic ban.`,
    );
  }
  if (gaps.length) {
    const sample = gaps.slice(0, 3).map((gap) => gap.value).join(", ");
    recommendations.push(`Creative gaps in the catalog, not a quota: ${sample}.`);
  }
  if (!recommendations.length) {
    recommendations.push("No mechanism is over the repetition line, and the catalog structures in use cover the current library.");
  }
  return { librarySize, frequencies, overused, gaps, recommendations };
}

export interface StoryGenerationContext {
  canonVersion: string;
  canonSnapshotHash: string;
  targetAge: string | null;
  characterCount: number;
  storyRuleTone: string;
  existingStories: number;
  approvedStories: number;
  similarityBlock: number;
  originalityThreshold: number;
  overused: string[];
  gaps: string[];
}

function approvedSnapshot<T>(entity: { canonicalVersion: number | null; versions: Array<{ version: number; snapshot: T }> } | null): T | null {
  if (!entity || entity.canonicalVersion == null) return null;
  return entity.versions.find((item) => item.version === entity.canonicalVersion)?.snapshot ?? null;
}

export function loadStoryGenerationContext(db: StudioDb): StoryGenerationContext {
  const draft = draftCanonSnapshot(db, "story-intelligence");
  const rules = approvedSnapshot(db.storyRules);
  const variation = analyzeVariation(
    db.stories.map((story) => {
      const version = story.versions.find((item) => item.version === story.canonicalVersion) ?? story.versions[story.versions.length - 1];
      const snap = version?.snapshot;
      return {
        title: snap?.title ?? story.name,
        dna: snap?.dna ?? emptyDna(),
        settingLabel: snap?.settingLabel ?? "",
        castLabel: (snap?.characterIds ?? []).join("+"),
      };
    }),
  );
  return {
    canonVersion: draft.canonVersion,
    canonSnapshotHash: draft.hash,
    targetAge: draft.targetAge,
    characterCount: draft.characters.length,
    storyRuleTone: rules?.tone ?? "",
    existingStories: db.stories.length,
    approvedStories: db.stories.filter((story) => story.canonicalVersion != null).length,
    similarityBlock: db.settings.similarityBlock,
    originalityThreshold: db.settings.originalityThreshold,
    overused: variation.overused.slice(0, 4).map((item) => `${item.dimension}: ${item.value} (${item.count})`),
    gaps: variation.gaps.slice(0, 4).map((item) => item.value),
  };
}

function emptyDna(): StoryDna {
  return {
    premise: "",
    theme: "",
    conflict: "",
    characterCombination: [],
    setting: "",
    emotionalArc: "",
    learningObjective: "",
    resolutionType: "",
    humorMechanism: "none",
    adventureMechanism: "none",
    mysteryMechanism: "none",
    culturalElement: "",
    songUsage: "none",
    visualMotif: "",
    storyStructure: "unclassified",
  };
}

export function canonResultFor(db: StudioDb, entityType: string, entityId: string, version: number): CanonGateResult {
  const rows = db.canonValidations.filter((item) => item.entityType === entityType && item.entityId === entityId && item.version === version);
  return rows[rows.length - 1]?.validation.result ?? "NOT_EVALUATED";
}

export function backfillStoryBody(body: StoryBody, canonResult: CanonGateResult): StoryBody {
  const dna: StoryDna = { ...body.dna, storyStructure: body.dna?.storyStructure || "unclassified" };
  const fingerprint = body.fingerprint ?? makeFingerprint(dna);
  const similarity: SimilarityReport = {
    score: body.similarity?.score ?? 0,
    againstStoryId: body.similarity?.againstStoryId ?? null,
    againstTitle: body.similarity?.againstTitle ?? null,
    matches: body.similarity?.matches ?? [],
    tooSimilar: Boolean(body.similarity?.tooSimilar),
    status: body.similarity?.status ?? (body.similarity?.tooSimilar ? "LOOKALIKE" : "CLEAR"),
    explanation:
      body.similarity?.explanation ||
      (body.similarity?.matches?.length
        ? body.similarity.matches.map((item) => `${item.field}: ${item.detail}`).join("\n")
        : "NOT EVALUATED"),
    dimensions: body.similarity?.dimensions ?? [],
    closestMatches: body.similarity?.closestMatches ?? [],
  };
  const originality: OriginalityScore = {
    storyUniqueness: body.originality?.storyUniqueness ?? 0,
    characterDevelopment: body.originality?.characterDevelopment ?? 0,
    entertainmentValue: body.originality?.entertainmentValue ?? 0,
    visualVariation: body.originality?.visualVariation ?? 0,
    emotionalVariation: body.originality?.emotionalVariation ?? 0,
    culturalSpecificity: body.originality?.culturalSpecificity ?? 0,
    humanEditorial: body.originality?.humanEditorial ?? 0,
    total: body.originality?.total ?? 0,
    threshold: body.originality?.threshold ?? DEFAULT_ORIGINALITY_THRESHOLD,
    meetsThreshold: Boolean(body.originality?.meetsThreshold),
    dimensions: body.originality?.dimensions ?? [],
  };
  const recommendation =
    body.recommendation ??
    (canonResult === "NOT_EVALUATED"
      ? {
          decision: "NOT_EVALUATED" as const,
          canonResult,
          reasons: ["This version was stored before Story Intelligence. Scores were not recomputed and canon was not invented."],
        }
      : recommendationFor({ ...body, dna, fingerprint, similarity, originality, recommendation: undefined as unknown as StoryRecommendation }, canonResult));
  return { ...body, dna, fingerprint, similarity, originality, recommendation };
}

export function foldedMotifUsed(stories: Array<{ id: string; motif: string }>, motif: string, excludeId?: string): boolean {
  const folded = foldToken(motif);
  if (!folded) return false;
  return stories.some((story) => story.id !== excludeId && foldToken(story.motif) === folded);
}

export function foldedArcUsed(stories: Array<{ id: string; arc: string }>, arc: string, excludeId?: string): boolean {
  const folded = foldToken(arc);
  if (!folded) return false;
  return stories.some((story) => story.id !== excludeId && foldToken(story.arc) === folded);
}
