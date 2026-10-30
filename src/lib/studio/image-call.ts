import { createServerFn } from "@tanstack/react-start";
import { activePrompt, sessionObjectStore } from "./architecture.ts";
import { CHARACTER_IMAGE_KEY, IMAGE_MODEL, IMAGE_PROVIDER_ID, type ImageCallResult, type ImageCallStatus } from "./image.ts";

const ENDPOINT = "https://api.x.ai/v1/images/generations";

export interface ImageCall {
  templateKey: string;
  templateVersion: number;
  templateBody: string;
  prompt: string;
  characterId: string;
}

interface ImageEnv {
  apiKey: string;
  fetch: typeof fetch;
}

function scrub(message: string, apiKey: string): string {
  const clean = apiKey ? message.split(apiKey).join("[redacted]") : message;
  return clean.slice(0, 180);
}

function empty(status: ImageCallStatus, error: string, input: ImageCall, started: number): ImageCallResult {
  return {
    status,
    providerId: IMAGE_PROVIDER_ID,
    model: IMAGE_MODEL,
    modelVersion: null,
    mediaType: null,
    byteLength: null,
    checksum: null,
    storageRef: null,
    storageDurability: "BLOCKED",
    durationMs: Date.now() - started,
    cost: null,
    costNote: "UNKNOWN",
    error,
    externalReference: null,
    prompt: input.prompt,
    templateKey: input.templateKey,
    templateVersion: input.templateVersion,
  };
}

function costNote(usage: { cost?: unknown; cost_in_usd_ticks?: unknown } | undefined): { cost: number | null; note: string } {
  if (!usage) return { cost: null, note: "UNKNOWN. The provider did not report a cost." };
  if (typeof usage.cost === "number" && Number.isFinite(usage.cost)) return { cost: usage.cost, note: "Provider reported cost." };
  if (typeof usage.cost_in_usd_ticks === "number") return { cost: null, note: `UNKNOWN USD. Provider reported cost_in_usd_ticks ${usage.cost_in_usd_ticks}. It was not converted.` };
  return { cost: null, note: "UNKNOWN. The provider did not report a dollar cost." };
}

export async function completeImage(input: ImageCall, env: ImageEnv = { apiKey: process.env.XAI_API_KEY ?? "", fetch }): Promise<ImageCallResult> {
  const started = Date.now();
  const known = activePrompt({ promptVersions: [] } as never, input.templateKey);
  if (!known || known.version !== input.templateVersion || known.body !== input.templateBody) {
    return empty("VALIDATION_ERROR", "The image template does not match the recorded version. The model was not called.", input, started);
  }
  if (!input.prompt.includes(known.body) || input.prompt.length > 6000) {
    return empty("VALIDATION_ERROR", "The prompt is not this template. The model was not called.", input, started);
  }
  if (!env.apiKey) return empty("AUTH_ERROR", "The image model is not configured on the server.", input, started);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  try {
    const response = await env.fetch(ENDPOINT, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.apiKey}` },
      body: JSON.stringify({
        model: IMAGE_MODEL,
        prompt: input.prompt,
        n: 1,
        quality: "low",
        aspect_ratio: "1:1",
        response_format: "b64_json",
      }),
    });
    if (response.status === 401 || response.status === 403) return empty("AUTH_ERROR", "The image model refused the server credential.", input, started);
    if (response.status === 408) return empty("TIMEOUT", "The image model timed out.", input, started);
    if (response.status === 429) return empty("RATE_LIMITED", "The image model asked the studio to wait. No second picture was requested.", input, started);
    if (!response.ok) return empty("PROVIDER_ERROR", scrub(`The image model returned status ${response.status}. ${await response.text().catch(() => "")}`, env.apiKey), input, started);
    const body = (await response.json()) as {
      id?: string;
      model?: string;
      data?: Array<{ b64_json?: string | null; url?: string | null; mime_type?: string }>;
      usage?: { cost?: unknown; cost_in_usd_ticks?: unknown };
    };
    const first = body.data?.[0];
    const mediaType = first?.mime_type || "image/jpeg";
    let bytes: Uint8Array | null = null;
    if (first?.b64_json) bytes = Uint8Array.from(Buffer.from(first.b64_json, "base64"));
    else if (first?.url) {
      const fetched = await env.fetch(first.url, { signal: controller.signal });
      if (!fetched.ok) return empty("PROVIDER_ERROR", "The provider URL could not be saved. It was not kept as the asset.", input, started);
      bytes = new Uint8Array(await fetched.arrayBuffer());
    }
    if (!bytes || bytes.byteLength < 32) return empty("PROVIDER_ERROR", "The image model returned no file. No asset was invented.", input, started);
    const storageRef = `session/character-image/${input.characterId}/${Date.now()}`;
    const stored = sessionObjectStore().put({ storageRef, mediaType, bytes });
    const priced = costNote(body.usage);
    return {
      status: "SUCCESS",
      providerId: IMAGE_PROVIDER_ID,
      model: typeof body.model === "string" && body.model.trim() ? body.model : IMAGE_MODEL,
      modelVersion: null,
      mediaType,
      byteLength: stored.byteLength,
      checksum: stored.checksum,
      storageRef,
      storageDurability: "BLOCKED",
      durationMs: Date.now() - started,
      cost: priced.cost,
      costNote: priced.note,
      error: null,
      externalReference: typeof body.id === "string" ? body.id : null,
      prompt: input.prompt,
      templateKey: input.templateKey,
      templateVersion: input.templateVersion,
    };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return empty(aborted ? "TIMEOUT" : "INTERNAL_ERROR", aborted ? "The image model timed out." : scrub(error instanceof Error ? error.message : "The image call failed.", env.apiKey), input, started);
  } finally {
    clearTimeout(timer);
  }
}

export const readImageAdapterStatus = createServerFn({ method: "POST" }).handler(async () => {
  return { configured: Boolean(process.env.XAI_API_KEY), providerId: IMAGE_PROVIDER_ID, provider: "xAI", model: IMAGE_MODEL, modelVersion: "UNKNOWN", cost: "UNKNOWN", storage: "BLOCKED" };
});

export const generateCharacterImage = createServerFn({ method: "POST" })
  .validator((data: ImageCall) => data)
  .handler(async ({ data }) => {
    const result = await completeImage(data);
    const file = result.storageRef ? sessionObjectStore().get(result.storageRef) : null;
    const dataUrl = file ? `data:${file.mediaType};base64,${Buffer.from(file.bytes).toString("base64")}` : null;
    return { ...result, dataUrl };
  });

export const readStoredImage = createServerFn({ method: "POST" })
  .validator((data: { storageRef: string }) => data)
  .handler(async ({ data }) => {
    let file = sessionObjectStore().get(data.storageRef);
    if (!file) {
      const { ensureRecordedImage } = await import("./image-record.server.ts");
      file = await ensureRecordedImage(data.storageRef);
    }
    if (!file) return { found: false as const, storage: "BLOCKED" as const };
    return { found: true as const, storage: "BLOCKED" as const, dataUrl: `data:${file.mediaType};base64,${Buffer.from(file.bytes).toString("base64")}` };
  });

export const readRecordedCharacterImage = createServerFn({ method: "POST" })
  .validator((data: { characterId: string }) => data)
  .handler(async ({ data }) => {
    const { readRecordedCandidate } = await import("./image-record.server.ts");
    return readRecordedCandidate(data.characterId);
  });
