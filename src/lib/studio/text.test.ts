import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { enqueueJob, memoryObjectStore, registerPromptVersion, runJob, switchProvider } from "./architecture.ts";
import { approveScript, approveStory, latestSnapshot, openEpisode, publishEpisode } from "./engine.ts";
import { buildSeedDb } from "./seed.ts";
import { acceptNormalizedDraft, appendScriptVersion, assembleScriptContext, modelPayload, promptByVersion, promptHistory, SCRIPT_TEMPLATE_KEY, type NormalizedTextResult } from "./text.ts";
import { completeText } from "./text-call.ts";
import type { Actor, StudioDb } from "./types.ts";

const human: Actor = { type: "human", id: "human_asha", name: "Asha Menon" };
const agent: Actor = { type: "agent", id: "agent_scriptwriter", name: "Scriptwriter" };
const NOW = "2026-10-07T21:30:00.000Z";

function must<T>(result: { ok: boolean; db: StudioDb; error?: string; data?: T }): StudioDb {
  assert.equal(result.ok, true, result.ok ? "" : result.error);
  return result.db;
}

function thunder(db: StudioDb) {
  const episode = db.episodes.find((item) => latestSnapshot(item).snapshot.title === "Count the Thunder");
  assert.ok(episode);
  return episode;
}

function otherStory(db: StudioDb) {
  return db.stories.find((story) => {
    const snap = latestSnapshot(story).snapshot;
    return story.canonicalVersion == null && snap.title !== "Count the Thunder" && snap.originality.total >= 75 && !snap.similarity.tooSimilar && snap.recommendation.canonResult === "PASS";
  });
}

function result(partial: Partial<NormalizedTextResult>): NormalizedTextResult {
  return {
    status: "SUCCESS",
    providerId: "llm.xai",
    model: "grok-4.5",
    modelVersion: null,
    text: null,
    inputTokens: null,
    outputTokens: null,
    durationMs: 25,
    cost: null,
    error: null,
    externalReference: null,
    templateKey: SCRIPT_TEMPLATE_KEY,
    templateVersion: 1,
    retryOf: null,
    ...partial,
  };
}

function draftText(context: Exclude<ReturnType<typeof assembleScriptContext>, string>, locationKey: string, action = "Meethi watches the courtyard tree.") {
  const lead = context.characters[0];
  const elder = context.characters.find((item) => item.name !== lead?.name) ?? lead;
  assert.ok(lead && elder);
  return JSON.stringify({
    scenes: [{
      sceneNo: 1,
      locationKey,
      action,
      lines: [
        { speaker: lead.name, hi: "देखो ना! फूल गिर रहा है।", en: "Look, a flower is falling." },
        { speaker: elder.name, hi: "धीरे, बेटा।", en: "Slowly, child." },
      ],
    }],
    vocabulary: [{ word: "फूल", meaning: "flower", pronunciation: "phool" }],
  });
}

describe("real text adapter", () => {
  it("files a development draft through the gateway and cannot approve it", () => {
    const seeded = buildSeedDb();
    const before = JSON.stringify(latestSnapshot(thunder(seeded)).snapshot);
    const story = otherStory(seeded);
    assert.ok(story);
    const approved = must(approveStory(seeded, story.id, human, "Human approval of this story. Not a model approval.", NOW));
    const opened = must(openEpisode(approved, story.id, human, NOW));
    const context = assembleScriptContext(opened, story.id);
    assert.equal(typeof context, "object");
    if (typeof context === "string") return;
    const payload = JSON.stringify(modelPayload(context));
    assert.equal(payload.includes("XAI_API_KEY"), false);
    assert.equal(payload.includes("Bearer"), false);
    assert.ok(context.canonHash);
    assert.equal(context.storyVersion >= 1, true);
    assert.equal(context.ageBand, "3-5");
    const place = context.locations[0];
    assert.ok(place);
    const filed = acceptNormalizedDraft(opened, story.id, result({ text: draftText(context, place.key), providerId: "development" }), human, NOW);
    assert.equal(filed.ok, true, filed.ok ? "" : filed.error);
    if (!filed.ok) return;
    assert.equal(filed.data.validation, "PASS");
    const script = filed.db.scripts.find((item) => item.id === filed.data.scriptId);
    assert.ok(script);
    assert.equal(script.canonicalVersion, null);
    assert.equal(latestSnapshot(script).snapshot.draftLabel, "DEVELOPMENT DRAFT");
    assert.equal(latestSnapshot(script).snapshot.languageReview, "pending");
    assert.equal(latestSnapshot(script).snapshot.storyVersion, context.storyVersion);
    assert.equal(latestSnapshot(script).snapshot.canonSnapshotHash, context.canonHash);
    assert.equal(latestSnapshot(script).snapshot.generationRunId, filed.data.executionId);
    const execution = filed.db.aiExecutions.find((item) => item.id === filed.data.executionId);
    assert.ok(execution);
    assert.equal(execution.promptKey, SCRIPT_TEMPLATE_KEY);
    assert.equal(execution.promptVersion, 1);
    assert.equal(execution.estimatedCost, null);
    assert.equal(execution.inputUnits, null);
    const episode = filed.db.episodes.find((item) => latestSnapshot(item).snapshot.storyId === story.id);
    assert.ok(episode);
    assert.equal(latestSnapshot(episode).snapshot.stage, "SCRIPT_DRAFT");
    const agentOk = approveScript(filed.db, script.id, agent, "The model tried to approve itself.", NOW);
    assert.equal(agentOk.ok, false);
    const humanEarly = approveScript(filed.db, script.id, human, "Too soon. Hindi review has not passed.", NOW);
    assert.equal(humanEarly.ok, false);
    assert.equal(publishEpisode(filed.db, episode.id, human, NOW).ok, false);
    assert.equal(JSON.stringify(latestSnapshot(thunder(filed.db)).snapshot), before);
    const again = acceptNormalizedDraft(filed.db, story.id, result({ text: draftText(context, place.key) }), human, NOW);
    assert.equal(again.ok, true, again.ok ? "" : again.error);
    if (!again.ok) return;
    assert.equal(again.db.scripts.filter((item) => latestSnapshot(item).snapshot.storyId === story.id).length, 1);
  });

  it("keeps a canon break, a timeout, a prompt version, and a provider swap", () => {
    const seeded = buildSeedDb();
    const story = otherStory(seeded);
    assert.ok(story);
    let db = must(approveStory(seeded, story.id, human, "Human approval of this story. Not a model approval.", NOW));
    const context = assembleScriptContext(db, story.id);
    assert.equal(typeof context, "object");
    if (typeof context === "string") return;
    const place = context.locations[0];
    assert.ok(place);
    const broken = acceptNormalizedDraft(db, story.id, result({
      text: draftText(context, "alpine-inspired", "Meethi has blonde hair and blue eyes. Meethi is 8."),
    }), human, NOW);
    assert.equal(broken.ok, true, broken.ok ? "" : broken.error);
    if (!broken.ok) return;
    assert.equal(broken.data.validation, "FAIL");
    const script = broken.db.scripts.find((item) => item.id === broken.data.scriptId);
    assert.ok(script);
    assert.equal(script.canonicalVersion, null);
    const raw = broken.db.objectRecords.find((item) => item.provenanceExecutionId === broken.data.executionId);
    assert.ok(raw?.bodyText?.includes("blonde"));
    assert.equal(broken.db.locations.some((item) => latestSnapshot(item).snapshot.key === "alpine-inspired"), false);
    const second = acceptNormalizedDraft(broken.db, story.id, result({ text: draftText(context, place.key) }), human, NOW);
    assert.equal(second.ok, true);
    if (!second.ok) return;
    assert.equal(second.db.scripts.filter((item) => latestSnapshot(item).snapshot.storyId === story.id).length, 1);
    const fresh = must(approveStory(buildSeedDb(), story.id, human, "Human approval of this story. Not a model approval.", NOW));
    const freshContext = assembleScriptContext(fresh, story.id);
    assert.equal(typeof freshContext, "object");
    if (typeof freshContext === "string") return;
    const timed = acceptNormalizedDraft(fresh, story.id, result({ status: "TIMEOUT", text: null, error: "The text model timed out." }), human, NOW);
    assert.equal(timed.ok, true, timed.ok ? "" : timed.error);
    if (!timed.ok) return;
    assert.equal(timed.data.scriptId, null);
    assert.equal(timed.db.aiExecutions.find((item) => item.id === timed.data.executionId)?.status, "RETRYABLE");
    const retried = acceptNormalizedDraft(timed.db, story.id, result({
      text: draftText(freshContext, freshContext.locations[0]?.key ?? "", "Meethi watches the tree."),
      retryOf: timed.data.executionId,
    }), human, NOW);
    assert.equal(retried.ok, true, retried.ok ? "" : retried.error);
    if (!retried.ok) return;
    assert.equal(retried.db.aiExecutions.filter((item) => item.idempotencyKey.includes(story.id)).length, 2);
    const original = promptByVersion(retried.db, SCRIPT_TEMPLATE_KEY, 1);
    assert.ok(original);
    const frozen = JSON.stringify(original);
    const versioned = must(registerPromptVersion(retried.db, {
      key: SCRIPT_TEMPLATE_KEY,
      purpose: original.purpose,
      input: original.input,
      output: original.output,
      body: `${original.body} Ask for one vocabulary word.`,
    }, human, NOW));
    assert.equal(JSON.stringify(promptByVersion(versioned, SCRIPT_TEMPLATE_KEY, 1)), frozen);
    assert.equal(promptHistory(versioned, SCRIPT_TEMPLATE_KEY).length >= 2, true);
    const standby = must(switchProvider(versioned, "LLM", "llm.standby", human, NOW));
    const stories = JSON.stringify(standby.stories);
    const queued = must(enqueueJob(standby, { capability: "LLM", promptKey: "STORY_PROPOSAL", inputArtifactIds: [story.id], idempotencyKey: "swap-local" }, human, NOW));
    const ran = must(runJob(queued, memoryObjectStore(), queued.jobs.at(-1)?.id ?? "", human, undefined, NOW));
    assert.equal(JSON.stringify(ran.stories), stories);
    const live = must(switchProvider(ran, "LLM", "llm.xai", human, NOW));
    const liveJob = must(enqueueJob(live, { capability: "LLM", promptKey: SCRIPT_TEMPLATE_KEY, inputArtifactIds: [story.id], idempotencyKey: "swap-live-runner" }, human, NOW));
    const blocked = runJob(liveJob, memoryObjectStore(), liveJob.jobs.at(-1)?.id ?? "", human, undefined, NOW);
    assert.equal(blocked.ok, true, blocked.ok ? "" : blocked.error);
    if (!blocked.ok) return;
    assert.equal(blocked.data.state, "failed");
    assert.equal(blocked.data.outputIds.length, 0);
    const scriptId = retried.data.scriptId;
    assert.ok(scriptId);
    const v1 = JSON.stringify(latestSnapshot(retried.db.scripts.find((item) => item.id === scriptId)!).snapshot);
    const bumped = must(appendScriptVersion(retried.db, scriptId, "A human note on a new version.", human, NOW));
    const entity = bumped.scripts.find((item) => item.id === scriptId);
    assert.ok(entity);
    assert.equal(entity.currentVersion, 2);
    assert.equal(JSON.stringify(entity.versions[0]?.snapshot), v1);
    assert.equal(entity.canonicalVersion, null);
    const client = readFileSync(new URL("./text.ts", import.meta.url), "utf8");
    const server = readFileSync(new URL("./text-call.ts", import.meta.url), "utf8");
    assert.equal(client.includes("XAI_API_KEY"), false);
    assert.equal(client.includes("api.x.ai"), false);
    assert.equal(server.includes("api.x.ai"), true);
    assert.equal(server.includes("console."), false);
  });

  it("generates one real Hindi draft and does not publish", { timeout: 70000, skip: process.env.TEXT_LIVE !== "1" }, async () => {
    const seeded = buildSeedDb();
    const before = JSON.stringify(latestSnapshot(thunder(seeded)).snapshot);
    const story = otherStory(seeded);
    assert.ok(story);
    const approved = must(approveStory(seeded, story.id, human, "Human approval of this story. Not a model approval.", NOW));
    const context = assembleScriptContext(approved, story.id);
    assert.equal(typeof context, "object");
    if (typeof context === "string") return;
    const template = promptByVersion(approved, SCRIPT_TEMPLATE_KEY, context.templateVersion);
    assert.ok(template);
    const live = await completeText({ templateKey: template.key, templateVersion: template.version, templateBody: template.body, context });
    assert.equal(live.status, "SUCCESS", live.error ?? live.status);
    assert.equal(live.providerId, "llm.xai");
    assert.equal(live.cost, null);
    assert.equal(live.modelVersion, null);
    assert.ok(live.text && /[\u0900-\u097F]/.test(live.text));
    const filed = acceptNormalizedDraft(approved, story.id, live, human, NOW);
    assert.equal(filed.ok, true, filed.ok ? "" : filed.error);
    if (!filed.ok) return;
    assert.equal(filed.data.validation, "PASS", filed.db.scripts.find((item) => item.id === filed.data.scriptId) ? latestSnapshot(filed.db.scripts.find((item) => item.id === filed.data.scriptId)!).snapshot.languageNotes.join(" | ") : "no script");
    const script = filed.db.scripts.find((item) => item.id === filed.data.scriptId);
    assert.ok(script);
    assert.equal(script.canonicalVersion, null);
    assert.equal(latestSnapshot(script).snapshot.draftLabel, "DEVELOPMENT DRAFT");
    const execution = filed.db.aiExecutions.find((item) => item.id === filed.data.executionId);
    assert.ok(execution);
    assert.equal(execution.estimatedCost, null);
    assert.equal(execution.promptVersion, template.version);
    assert.ok(execution.inputArtifactIds.includes(story.id));
    assert.equal(execution.inputUnits === null || execution.inputUnits > 0, true);
    assert.notEqual(execution.inputUnits, 0);
    assert.equal(publishEpisode(filed.db, thunder(filed.db).id, human, NOW).ok, false);
    assert.equal(JSON.stringify(latestSnapshot(thunder(filed.db)).snapshot), before);
    assert.equal(filed.db.episodes.find((item) => item.id === thunder(filed.db).id && latestSnapshot(item).snapshot.stage === "PUBLISHED"), undefined);
  });
});
