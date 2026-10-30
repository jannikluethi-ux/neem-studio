import type {
  AssetBody,
  CanonChange,
  CanonCharacterSlice,
  CanonFieldView,
  CanonImpact,
  CanonRule,
  CanonSnapshot,
  CanonSnapshotDraft,
  CanonValidation,
  CanonViolation,
  CharacterBody,
  ProductionPlanBody,
  ScriptBody,
  StoryBody,
  StoryboardBody,
  StudioDb,
  VisualClaims,
} from "./types.ts";

export const HARD_FIELDS = [
  "name",
  "nameHi",
  "age",
  "species",
  "personality",
  "appearance",
  "hair",
  "face",
  "eyes",
  "body",
  "storyFunction",
  "speechStyle",
] as const;

export const SOFT_FIELDS = ["clothing", "accessories", "likes", "dislikes", "strengths", "weaknesses"] as const;

const FIELD_LABEL: Record<string, string> = {
  name: "Name",
  nameHi: "Hindi name",
  age: "Age",
  species: "Species",
  personality: "Personality",
  appearance: "Appearance",
  hair: "Hair",
  face: "Face",
  eyes: "Eyes",
  body: "Body",
  storyFunction: "Story function",
  speechStyle: "Speech style",
  clothing: "Clothing",
  accessories: "Accessories",
  likes: "Likes",
  dislikes: "Dislikes",
  strengths: "Strengths",
  weaknesses: "Weaknesses",
  voicePitch: "Voice pitch",
  forbiddenVariations: "Forbidden variation",
};

const ALIEN_LOOKS = ["blonde", "blue eyes", "green eyes", "red eyes", "pink hair", "purple hair"];

function hash(value: unknown): string {
  const s = JSON.stringify(value);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = Math.imul(h, 33) ^ s.charCodeAt(i);
  return (h >>> 0).toString(16);
}

function readField(body: CharacterBody, field: string): string {
  if (field === "likes" || field === "dislikes" || field === "strengths" || field === "weaknesses") {
    const list = body[field];
    return Array.isArray(list) ? list.join(", ") : "";
  }
  const value = (body as unknown as Record<string, unknown>)[field];
  if (typeof value === "string") return value;
  return "";
}

function canonicalVersionOf<T>(entity: { canonicalVersion: number | null; versions: Array<{ version: number; snapshot: T; status: string }> } | null | undefined) {
  if (!entity || entity.canonicalVersion == null) return null;
  return entity.versions.find((v) => v.version === entity.canonicalVersion) ?? null;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
}

function rule(partial: Omit<CanonRule, "status" | "version"> & { version?: number }): CanonRule {
  return { status: "LOCKED", version: partial.version ?? 1, ...partial };
}

export function characterCanonProfile(body: CharacterBody): { hard: CanonFieldView[]; soft: CanonFieldView[]; forbidden: string[] } {
  const hard: CanonFieldView[] = [];
  const soft: CanonFieldView[] = [];
  for (const field of HARD_FIELDS) {
    const value = readField(body, field).trim();
    if (!value) continue;
    hard.push({
      field,
      label: FIELD_LABEL[field] ?? field,
      value,
      strength: "HARD",
      rule: field === "speechStyle" ? "VOICE_RULE" : field === "appearance" || field === "hair" || field === "eyes" || field === "face" || field === "body" ? "VISUAL_RULE" : "MUST",
    });
  }
  for (const field of SOFT_FIELDS) {
    const value = readField(body, field).trim();
    if (!value) continue;
    soft.push({
      field,
      label: FIELD_LABEL[field] ?? field,
      value,
      strength: "SOFT",
      rule: "ALLOWED_VARIATION",
    });
  }
  return { hard, soft, forbidden: [...body.forbiddenVariations] };
}

export function changedCanonFields(before: CharacterBody, after: CharacterBody): string[] {
  const fields = [...HARD_FIELDS, ...SOFT_FIELDS];
  return fields.filter((field) => readField(before, field) !== readField(after, field));
}

export function patchCharacterField(body: CharacterBody, field: string, value: string): CharacterBody | string {
  const allowed = new Set<string>([...HARD_FIELDS, ...SOFT_FIELDS]);
  if (!allowed.has(field)) return "That field is not a canon attribute.";
  const next = value.trim();
  if (!next) return "A canon value cannot be emptied from here.";
  if (field === "likes" || field === "dislikes" || field === "strengths" || field === "weaknesses") {
    return { ...body, [field]: next.split(",").map((part) => part.trim()).filter(Boolean) };
  }
  return { ...body, [field]: next };
}

function characterSlice(id: string, version: number, body: CharacterBody): CanonCharacterSlice {
  const profile = characterCanonProfile(body);
  const hard: Record<string, string> = {};
  const soft: Record<string, string> = {};
  for (const field of profile.hard) hard[field.field] = field.value;
  for (const field of profile.soft) soft[field.field] = field.value;
  if (body.colorPalette.length) hard.colorPalette = body.colorPalette.join(", ");
  if (body.catchphrases.length) hard.catchphrases = body.catchphrases.join(" | ");
  if (body.fears.length) hard.fears = body.fears.join(", ");
  return {
    id,
    version,
    name: body.name,
    nameHi: body.nameHi,
    hard,
    soft,
    forbidden: [...body.forbiddenVariations],
    voice: {
      pitch: body.voiceProfile.pitch,
      tempo: body.voiceProfile.tempo,
      accent: body.voiceProfile.accent,
      speechStyle: body.speechStyle,
    },
  };
}

export function compileCanonRules(db: StudioDb): CanonRule[] {
  const rules: CanonRule[] = [];
  for (const entity of db.characters) {
    const locked = canonicalVersionOf(entity);
    if (!locked || locked.status !== "approved") continue;
    const body = locked.snapshot;
    const slice = characterSlice(entity.id, locked.version, body);
    for (const [field, expected] of Object.entries(slice.hard)) {
      const visual = field === "appearance" || field === "hair" || field === "eyes" || field === "face" || field === "body" || field === "colorPalette";
      const voice = field === "speechStyle" || field === "catchphrases";
      rules.push(
        rule({
          id: `rule_${entity.id}_${field}_must`,
          kind: visual ? "VISUAL_RULE" : voice ? "VOICE_RULE" : "MUST",
          strength: "HARD",
          entityType: "character",
          entityId: entity.id,
          field,
          expected,
          description: `${body.name}.${field} MUST equal the locked canon.`,
          version: locked.version,
        }),
      );
    }
    for (const [field, expected] of Object.entries(slice.soft)) {
      rules.push(
        rule({
          id: `rule_${entity.id}_${field}_vary`,
          kind: "ALLOWED_VARIATION",
          strength: "SOFT",
          entityType: "character",
          entityId: entity.id,
          field,
          expected,
          description: `${body.name}.${field} may vary inside the episode. The locked default stays “${expected}”. Forbidden items still must not appear.`,
          version: locked.version,
        }),
      );
    }
    for (const phrase of body.forbiddenVariations) {
      rules.push(
        rule({
          id: `rule_${entity.id}_forbid_${slug(phrase)}`,
          kind: "MUST_NOT",
          strength: "HARD",
          entityType: "character",
          entityId: entity.id,
          field: "forbiddenVariations",
          expected: phrase,
          description: `${body.name} MUST NOT appear with “${phrase}”.`,
          version: locked.version,
        }),
      );
    }
    for (const line of body.visualRules) {
      rules.push(
        rule({
          id: `rule_${entity.id}_visual_${slug(line)}`,
          kind: "VISUAL_RULE",
          strength: "HARD",
          entityType: "character",
          entityId: entity.id,
          field: "visualRules",
          expected: line,
          description: line,
          version: locked.version,
        }),
      );
    }
    rules.push(
      rule({
        id: `rule_${entity.id}_voice_pitch`,
        kind: "VOICE_RULE",
        strength: "HARD",
        entityType: "character",
        entityId: entity.id,
        field: "voicePitch",
        expected: body.voiceProfile.pitch,
        description: `${body.name} voice pitch MUST stay ${body.voiceProfile.pitch}.`,
        version: locked.version,
      }),
    );
  }
  for (const rel of db.relationships) {
    rules.push(
      rule({
        id: `rule_${rel.id}`,
        kind: "RELATIONSHIP",
        strength: "HARD",
        entityType: "relationship",
        entityId: rel.id,
        field: "kind",
        expected: `${rel.fromId}|${rel.kind}|${rel.toId}`,
        description: rel.note || rel.kind,
      }),
    );
  }
  const world = canonicalVersionOf(db.world);
  if (world && world.status === "approved") {
    world.snapshot.rules.forEach((line, index) => {
      rules.push(
        rule({
          id: `rule_world_${index}_${slug(line)}`,
          kind: "WORLD_RULE",
          strength: "HARD",
          entityType: "world",
          entityId: db.world?.id ?? "world",
          field: "rules",
          expected: line,
          description: line,
          version: world.version,
        }),
      );
    });
  }
  const storyRules = canonicalVersionOf(db.storyRules);
  if (storyRules && storyRules.status === "approved") {
    rules.push(
      rule({
        id: "rule_story_age",
        kind: "STORY_RULE",
        strength: "HARD",
        entityType: "story_rules",
        entityId: db.storyRules?.id ?? "rules",
        field: "ageBand",
        expected: storyRules.snapshot.ageBand,
        description: `Stories MUST target age ${storyRules.snapshot.ageBand}.`,
        version: storyRules.version,
      }),
    );
    storyRules.snapshot.never.forEach((line, index) => {
      rules.push(
        rule({
          id: `rule_story_never_${index}`,
          kind: "STORY_RULE",
          strength: "HARD",
          entityType: "story_rules",
          entityId: db.storyRules?.id ?? "rules",
          field: "never",
          expected: line,
          description: line,
          version: storyRules.version,
        }),
      );
    });
  }
  return rules;
}

export function draftCanonSnapshot(db: StudioDb, purpose: string): CanonSnapshotDraft {
  const characters: CanonCharacterSlice[] = [];
  for (const entity of db.characters) {
    const locked = canonicalVersionOf(entity);
    if (!locked || locked.status !== "approved") continue;
    characters.push(characterSlice(entity.id, locked.version, locked.snapshot));
  }
  characters.sort((a, b) => a.id.localeCompare(b.id));
  const locations = db.locations
    .map((loc) => {
      const locked = canonicalVersionOf(loc);
      if (!locked) return null;
      return {
        id: loc.id,
        version: locked.version,
        key: locked.snapshot.key,
        name: locked.snapshot.name,
        nameHi: locked.snapshot.nameHi,
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row))
    .sort((a, b) => a.id.localeCompare(b.id));
  const brand = canonicalVersionOf(db.brand);
  const universe = canonicalVersionOf(db.universe);
  const world = canonicalVersionOf(db.world);
  const storyRules = canonicalVersionOf(db.storyRules);
  const rules = compileCanonRules(db);
  const canonVersion = [
    characters.map((c) => `${c.id}@${c.version}`).join("+") || "no-cast",
    `w${world?.version ?? 0}`,
    `r${storyRules?.version ?? 0}`,
  ].join("|");
  const relationships = [...db.relationships]
    .map((rel) => ({ id: rel.id, fromId: rel.fromId, toId: rel.toId, kind: rel.kind, note: rel.note }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const payload = {
    canonVersion,
    targetAge: db.studio?.ageBand ?? null,
    characters,
    locations,
    relationships,
    rules: rules.map((item) => ({ id: item.id, expected: item.expected, kind: item.kind })),
    worldVersion: world?.version ?? null,
    storyRulesVersion: storyRules?.version ?? null,
  };
  return {
    purpose,
    canonVersion,
    hash: hash(payload),
    targetAge: db.studio?.ageBand ?? null,
    studioId: db.studio?.id ?? null,
    brandId: db.brand?.id ?? null,
    brandVersion: brand?.version ?? null,
    universeId: db.universe?.id ?? null,
    universeVersion: universe?.version ?? null,
    worldId: db.world?.id ?? null,
    worldVersion: world?.version ?? null,
    storyRulesId: db.storyRules?.id ?? null,
    storyRulesVersion: storyRules?.version ?? null,
    characters,
    locations,
    relationships,
    rules,
  };
}

export function activeCanonVersion(db: StudioDb): { version: string; hash: string; label: string } {
  const draft = draftCanonSnapshot(db, "active");
  const names = draft.characters.map((c) => `${c.name} v${c.version}`);
  const label = names.length ? names.join(" · ") : "No locked characters";
  return { version: draft.canonVersion, hash: draft.hash, label };
}

export type CanonSubject =
  | { kind: "story"; id: string; version: number; body: StoryBody }
  | { kind: "script"; id: string; version: number; body: ScriptBody }
  | { kind: "storyboard"; id: string; version: number; body: StoryboardBody }
  | { kind: "plan"; id: string; version: number; body: ProductionPlanBody }
  | { kind: "asset"; id: string; version: number; body: AssetBody }
  | { kind: "character_claim"; id: string; version: number; characterId: string; field: string; proposed: string };

function blankValidation(snapshot: { id?: string; canonVersion: string; hash: string }): CanonValidation {
  return {
    result: "PASS",
    violations: [],
    warnings: [],
    evidence: [],
    canonicalReferences: [],
    snapshotId: snapshot.id ?? "",
    canonVersion: snapshot.canonVersion,
    snapshotHash: snapshot.hash,
    drift: "CLEAN",
  };
}

function finish(validation: CanonValidation): CanonValidation {
  const hardFail = validation.violations.some((item) => item.severity === "FAIL");
  const blocked = validation.violations.some((item) => item.rule === "BLOCKED" || item.ruleId === "rule_cast_approved");
  if (blocked && validation.violations.every((item) => item.ruleId === "rule_cast_approved" || item.canonical === "APPROVED")) {
    validation.result = "BLOCKED";
  } else if (hardFail) validation.result = "FAIL";
  else if (validation.warnings.length) validation.result = "WARN";
  else validation.result = "PASS";
  validation.drift = validation.violations.some((item) => item.severity === "FAIL") ? "DRIFT_FOUND" : "CLEAN";
  return validation;
}

function add(
  validation: CanonValidation,
  violation: CanonViolation,
) {
  if (violation.severity === "WARN") validation.warnings.push(violation);
  else validation.violations.push(violation);
  validation.evidence.push(`${violation.entityName}.${violation.field}: proposed “${violation.proposed}”, canon “${violation.canonical}”.`);
  if (!validation.canonicalReferences.includes(violation.ruleId)) validation.canonicalReferences.push(violation.ruleId);
}

function castBlock(validation: CanonValidation, id: string, name: string) {
  add(validation, {
    entityType: "character",
    entityId: id,
    entityName: name || id,
    field: "status",
    proposed: "not approved",
    canonical: "APPROVED",
    ruleId: "rule_cast_approved",
    rule: "MUST",
    severity: "FAIL",
    strength: "HARD",
  });
}

function textOfStory(body: StoryBody): string {
  return [body.title, body.titleHi, body.logline, body.beginning, body.middle, body.resolution, body.settingLabel].join("\n");
}

function textOfScript(body: ScriptBody): string {
  return body.scenes.flatMap((scene) => [scene.action, ...scene.lines.flatMap((line) => [line.hi, line.en, line.speaker])]).join("\n");
}

function textOfBoard(body: StoryboardBody): string {
  return body.scenes.flatMap((scene) => [scene.heading, ...scene.shots.map((shot) => shot.description)]).join("\n");
}

function windows(text: string, name: string): string[] {
  if (!name.trim()) return [];
  const lower = text.toLowerCase();
  const needle = name.toLowerCase();
  const found: string[] = [];
  let index = 0;
  while ((index = lower.indexOf(needle, index)) !== -1) {
    found.push(text.slice(Math.max(0, index - 12), Math.min(text.length, index + needle.length + 80)));
    index += needle.length;
  }
  return found;
}

function ageHits(window: string): string[] {
  const hits: string[] = [];
  const patterns = [
    /\b(?:age|उम्र)\s*(?:is|=|:)?\s*(\d{1,3})\b/gi,
    /\bis\s+(\d{1,3})\s+years?\s+old\b/gi,
    /\b(\d{1,3})\s*-?\s*years?\s+old\b/gi,
    /\b(\d{1,3})\s*साल/gi,
  ];
  for (const pattern of patterns) {
    for (const match of window.matchAll(pattern)) {
      if (match[1]) hits.push(match[1]);
    }
  }
  return hits;
}

function containsPhrase(text: string, phrase: string): boolean {
  const needle = phrase.trim().toLowerCase();
  if (!needle) return false;
  if (needle.split(/\s+/).length === 1) {
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\\b${escaped}\\b`, "i").test(text);
  }
  return text.toLowerCase().includes(needle);
}

function claimMismatch(canonical: string, proposed: string): boolean {
  const left = canonical.trim().toLowerCase();
  const right = proposed.trim().toLowerCase();
  if (!right) return false;
  if (!left) return true;
  return !left.includes(right) && !right.includes(left);
}

function checkText(validation: CanonValidation, snapshot: CanonSnapshotDraft, text: string, entityType: string, entityId: string) {
  for (const character of snapshot.characters) {
    const around = [...windows(text, character.name), ...windows(text, character.nameHi)];
    const ages = around.flatMap(ageHits);
    const canonAge = character.hard.age ?? "";
    for (const proposed of ages) {
      if (proposed !== canonAge) {
        const ageRule = snapshot.rules.find((item) => item.entityId === character.id && item.field === "age");
        add(validation, {
          entityType: "character",
          entityId: character.id,
          entityName: character.name,
          field: "age",
          proposed,
          canonical: canonAge,
          ruleId: ageRule?.id ?? `rule_${character.id}_age_must`,
          rule: "HARD_CANON",
          severity: "FAIL",
          strength: "HARD",
        });
      }
    }
    for (const look of ALIEN_LOOKS) {
      if (!containsPhrase(around.join(" "), look)) continue;
      const canonLook = `${character.hard.appearance ?? ""} ${character.hard.hair ?? ""} ${character.hard.eyes ?? ""}`.toLowerCase();
      if (canonLook.includes(look)) continue;
      add(validation, {
        entityType: "character",
        entityId: character.id,
        entityName: character.name,
        field: look.includes("eyes") ? "eyes" : "hair",
        proposed: look,
        canonical: character.hard.hair || character.hard.eyes || character.hard.appearance || "",
        ruleId: `rule_${character.id}_appearance_must`,
        rule: "HARD_CANON",
        severity: "FAIL",
        strength: "HARD",
      });
    }
    for (const phrase of character.forbidden) {
      if (!containsPhrase(text, phrase)) continue;
      const forbid = snapshot.rules.find((item) => item.entityId === character.id && item.expected === phrase && item.kind === "MUST_NOT");
      add(validation, {
        entityType,
        entityId,
        entityName: character.name,
        field: "forbiddenVariations",
        proposed: phrase,
        canonical: "absent",
        ruleId: forbid?.id ?? `rule_${character.id}_forbid`,
        rule: "MUST_NOT",
        severity: "FAIL",
        strength: "HARD",
      });
    }
  }
  if (/the tree (says|said|talks|speaks)/i.test(text)) {
    const worldRule = snapshot.rules.find((item) => item.kind === "WORLD_RULE" && /does not talk/i.test(item.expected));
    add(validation, {
      entityType: "world",
      entityId: snapshot.worldId ?? "world",
      entityName: "World",
      field: "rules",
      proposed: "the tree talks",
      canonical: worldRule?.expected ?? "The tree does not talk.",
      ruleId: worldRule?.id ?? "rule_world_tree",
      rule: "WORLD_RULE",
      severity: "FAIL",
      strength: "HARD",
    });
  }
  for (const rel of snapshot.relationships) {
    const from = snapshot.characters.find((c) => c.id === rel.fromId);
    const to = snapshot.characters.find((c) => c.id === rel.toId);
    if (!from || !to) continue;
    const kin = /\bis\s+[\w\s]{0,24}'s\s+(mother|father|brother|sister|grandmother|grandfather)\b/i;
    const blob = text;
    if (!blob.toLowerCase().includes(from.name.toLowerCase()) || !blob.toLowerCase().includes(to.name.toLowerCase())) continue;
    const match = blob.match(kin);
    if (!match) continue;
    const claimed = match[1]?.toLowerCase() ?? "";
    if (claimed && claimed !== rel.kind.toLowerCase() && !rel.kind.toLowerCase().includes(claimed)) {
      add(validation, {
        entityType: "relationship",
        entityId: rel.id,
        entityName: from.name,
        field: "kind",
        proposed: claimed,
        canonical: rel.kind,
        ruleId: `rule_${rel.id}`,
        rule: "RELATIONSHIP",
        severity: "FAIL",
        strength: "HARD",
      });
    }
  }
}

function checkClaims(validation: CanonValidation, snapshot: CanonSnapshotDraft, characterId: string, claims: VisualClaims) {
  const character = snapshot.characters.find((item) => item.id === characterId);
  if (!character) {
    castBlock(validation, characterId, characterId);
    return;
  }
  const pairs: Array<{ field: string; proposed?: string; canonical: string; strength: "HARD" | "SOFT"; rule: string }> = [
    { field: "age", proposed: claims.age, canonical: character.hard.age ?? "", strength: "HARD", rule: "HARD_CANON" },
    { field: "species", proposed: claims.species, canonical: character.hard.species ?? "", strength: "HARD", rule: "HARD_CANON" },
    { field: "hair", proposed: claims.hair, canonical: character.hard.hair || character.hard.appearance || "", strength: "HARD", rule: "HARD_CANON" },
    { field: "face", proposed: claims.face, canonical: character.hard.face || character.hard.appearance || "", strength: "HARD", rule: "HARD_CANON" },
    { field: "eyes", proposed: claims.eyes, canonical: character.hard.eyes || character.hard.appearance || "", strength: "HARD", rule: "HARD_CANON" },
    { field: "body", proposed: claims.body, canonical: character.hard.body || character.hard.appearance || "", strength: "HARD", rule: "HARD_CANON" },
    { field: "clothing", proposed: claims.clothing, canonical: character.soft.clothing ?? "", strength: "SOFT", rule: "ALLOWED_VARIATION" },
    { field: "accessories", proposed: claims.accessories, canonical: character.soft.accessories ?? "", strength: "SOFT", rule: "ALLOWED_VARIATION" },
    { field: "voicePitch", proposed: claims.voicePitch, canonical: character.voice.pitch ?? "", strength: "HARD", rule: "VOICE_RULE" },
    { field: "personality", proposed: claims.personality, canonical: character.hard.personality ?? "", strength: "HARD", rule: "HARD_CANON" },
  ];
  for (const pair of pairs) {
    if (!pair.proposed) continue;
    if (character.forbidden.some((phrase) => containsPhrase(pair.proposed ?? "", phrase))) {
      add(validation, {
        entityType: "character",
        entityId: character.id,
        entityName: character.name,
        field: pair.field,
        proposed: pair.proposed,
        canonical: "absent",
        ruleId: `rule_${character.id}_forbid_${slug(pair.proposed)}`,
        rule: "MUST_NOT",
        severity: "FAIL",
        strength: "HARD",
      });
      continue;
    }
    if (!claimMismatch(pair.canonical, pair.proposed)) continue;
    add(validation, {
      entityType: "character",
      entityId: character.id,
      entityName: character.name,
      field: pair.field,
      proposed: pair.proposed,
      canonical: pair.canonical,
      ruleId: `rule_${character.id}_${pair.field}`,
      rule: pair.rule,
      severity: pair.strength === "HARD" ? "FAIL" : "WARN",
      strength: pair.strength,
    });
  }
}

function referencedIds(subject: CanonSubject): string[] {
  if (subject.kind === "story") return subject.body.characterIds;
  if (subject.kind === "script") return subject.body.scenes.flatMap((scene) => scene.characterIds);
  if (subject.kind === "storyboard") return subject.body.scenes.flatMap((scene) => scene.shots.flatMap((shot) => shot.characterIds));
  if (subject.kind === "asset") return subject.body.characterId ? [subject.body.characterId] : [];
  if (subject.kind === "character_claim") return [subject.characterId];
  return [];
}

export function validateSubject(db: StudioDb, subject: CanonSubject, snapshotInput?: CanonSnapshot | CanonSnapshotDraft): CanonValidation {
  const snapshot = snapshotInput ?? draftCanonSnapshot(db, subject.kind);
  const validation = blankValidation(snapshot);
  const approved = new Set(snapshot.characters.map((c) => c.id));
  for (const id of referencedIds(subject)) {
    if (!id) continue;
    if (approved.has(id)) continue;
    const known = db.characters.find((c) => c.id === id);
    castBlock(validation, id, known?.name ?? id);
  }
  if (subject.kind === "story") {
    checkText(validation, snapshot, textOfStory(subject.body), "story", subject.id);
    if (snapshot.targetAge && subject.body.targetAge !== snapshot.targetAge) {
      add(validation, {
        entityType: "story",
        entityId: subject.id,
        entityName: subject.body.title,
        field: "targetAge",
        proposed: subject.body.targetAge,
        canonical: snapshot.targetAge,
        ruleId: "rule_story_age",
        rule: "STORY_RULE",
        severity: "FAIL",
        strength: "HARD",
      });
    }
  }
  if (subject.kind === "script") {
    checkText(validation, snapshot, textOfScript(subject.body), "script", subject.id);
    for (const scene of subject.body.scenes) {
      if (scene.locationId && !snapshot.locations.some((loc) => loc.id === scene.locationId)) {
        add(validation, {
          entityType: "location",
          entityId: scene.locationId,
          entityName: scene.locationKey,
          field: "locationId",
          proposed: scene.locationKey,
          canonical: "known location",
          ruleId: "rule_location_known",
          rule: "WORLD_RULE",
          severity: "FAIL",
          strength: "HARD",
        });
      }
    }
  }
  if (subject.kind === "storyboard") {
    checkText(validation, snapshot, textOfBoard(subject.body), "storyboard", subject.id);
    for (const scene of subject.body.scenes) {
      for (const shot of scene.shots) {
        const loc = shot.locationId;
        if (loc && !snapshot.locations.some((item) => item.id === loc)) {
          add(validation, {
            entityType: "location",
            entityId: loc,
            entityName: shot.locationKey,
            field: "locationId",
            proposed: shot.locationKey,
            canonical: "known location",
            ruleId: "rule_location_known",
            rule: "WORLD_RULE",
            severity: "FAIL",
            strength: "HARD",
          });
        }
      }
    }
  }
  if (subject.kind === "plan") {
    checkText(validation, snapshot, [...subject.body.voicePlan, ...subject.body.visualAssetsNeeded, subject.body.musicStatus].join("\n"), "production_plan", subject.id);
  }
  if (subject.kind === "asset") {
    if (subject.body.assetType === "character_visual" && !subject.body.characterId) {
      add(validation, {
        entityType: "asset",
        entityId: subject.id,
        entityName: "Visual asset",
        field: "characterId",
        proposed: "missing",
        canonical: "character_id + character_version",
        ruleId: "rule_asset_reference",
        rule: "MUST",
        severity: "FAIL",
        strength: "HARD",
      });
    }
    if (subject.body.characterId && subject.body.visualClaims) {
      checkClaims(validation, snapshot, subject.body.characterId, subject.body.visualClaims);
    }
    checkText(validation, snapshot, `${subject.body.prompt}\n${subject.body.rightsNotes}`, "asset", subject.id);
    const character = subject.body.characterId ? snapshot.characters.find((item) => item.id === subject.body.characterId) : undefined;
    if (character && subject.body.characterVersion != null && subject.body.characterVersion !== character.version) {
      validation.evidence.push(`Asset cites ${character.name} v${subject.body.characterVersion}. Current locked version is v${character.version}.`);
    }
  }
  if (subject.kind === "character_claim") {
    const character = snapshot.characters.find((item) => item.id === subject.characterId);
    if (!character) {
      castBlock(validation, subject.characterId, subject.characterId);
    } else {
      const canonical = character.hard[subject.field] ?? character.soft[subject.field] ?? character.voice[subject.field] ?? "";
      const strength = subject.field in character.hard || subject.field === "voicePitch" ? "HARD" : "SOFT";
      if (canonical && subject.proposed.trim() !== canonical) {
        const matched = snapshot.rules.find((item) => item.entityId === character.id && item.field === subject.field);
        add(validation, {
          entityType: "character",
          entityId: character.id,
          entityName: character.name,
          field: subject.field,
          proposed: subject.proposed,
          canonical,
          ruleId: matched?.id ?? `rule_${character.id}_${subject.field}`,
          rule: strength === "HARD" ? "HARD_CANON" : "ALLOWED_VARIATION",
          severity: strength === "HARD" ? "FAIL" : "WARN",
          strength,
        });
      }
    }
  }
  if (validation.violations.length === 0 && validation.warnings.length === 0) {
    validation.evidence.push("Checked against the canon snapshot. No hard contradiction.");
    validation.canonicalReferences.push(snapshot.canonVersion);
  }
  const done = finish(validation);
  if (done.violations.some((item) => item.ruleId === "rule_cast_approved") && done.violations.every((item) => item.ruleId === "rule_cast_approved")) {
    done.result = "BLOCKED";
  }
  return done;
}

export function impactOfCharacter(db: StudioDb, characterId: string): CanonImpact {
  const stories = db.stories
    .filter((story) => story.versions.some((v) => v.snapshot.characterIds.includes(characterId)))
    .map((story) => ({ id: story.id, title: story.versions[story.versions.length - 1]?.snapshot.title ?? story.name }));
  const storyIds = new Set(stories.map((s) => s.id));
  const scripts = db.scripts
    .filter((script) => script.versions.some((v) => v.snapshot.scenes.some((scene) => scene.characterIds.includes(characterId)) || storyIds.has(v.snapshot.storyId)))
    .map((script) => ({ id: script.id, title: script.versions[script.versions.length - 1]?.snapshot.titleEn ?? script.name }));
  const scriptIds = new Set(scripts.map((s) => s.id));
  const storyboards = db.storyboards
    .filter((board) => board.versions.some((v) => scriptIds.has(v.snapshot.scriptId) || v.snapshot.scenes.some((scene) => scene.shots.some((shot) => shot.characterIds.includes(characterId)))))
    .map((board) => board.id);
  const episodes = db.episodes
    .filter((episode) => episode.versions.some((v) => storyIds.has(v.snapshot.storyId)))
    .map((episode) => ({ id: episode.id, title: episode.versions[episode.versions.length - 1]?.snapshot.title ?? episode.name }));
  const assets = db.assets
    .filter((asset) => asset.versions.some((v) => v.snapshot.characterId === characterId || scriptIds.has(v.snapshot.linkedEntityId) || storyboards.includes(v.snapshot.linkedEntityId)))
    .map((asset) => asset.id);
  const summary = `${stories.length} stories, ${scripts.length} scripts, ${storyboards.length} storyboards, ${episodes.length} episodes, ${assets.length} assets cite this character. None are rewritten.`;
  return { stories, scripts, storyboards, episodes, assets, summary };
}

export function violationLine(violation: CanonViolation): string {
  return `${violation.rule} · ${violation.entityName} · ${violation.field} · proposed ${violation.proposed} · canon ${violation.canonical}`;
}

export function isOpenChange(change: CanonChange): boolean {
  return change.status === "PROPOSED" || change.status === "IN_REVIEW";
}
