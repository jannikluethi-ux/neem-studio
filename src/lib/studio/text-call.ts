import { createServerFn } from "@tanstack/react-start";
import { PROMPT_LIBRARY } from "./architecture.ts";
import { LIVE_TEXT_MODEL, LIVE_TEXT_PROVIDER_ID, modelPayload, type NormalizedTextResult, type ProviderCallStatus, type ScriptContext } from "./text.ts";

const ENDPOINT = "https://api.x.ai/v1/chat/completions";

export interface TextCall {
  templateKey: string;
  templateVersion: number;
  templateBody: string;
  context: ScriptContext;
  retryOf?: string | null;
}

function scrub(message: string): string {
  const key = process.env.XAI_API_KEY ?? "";
  const clean = key ? message.split(key).join("[redacted]") : message;
  return clean.slice(0, 180);
}

function empty(status: ProviderCallStatus, error: string, input: TextCall, started: number): NormalizedTextResult {
  return {
    status,
    providerId: LIVE_TEXT_PROVIDER_ID,
    model: LIVE_TEXT_MODEL,
    modelVersion: null,
    text: null,
    inputTokens: null,
    outputTokens: null,
    durationMs: Date.now() - started,
    cost: null,
    error,
    externalReference: null,
    templateKey: input.templateKey,
    templateVersion: input.templateVersion,
    retryOf: input.retryOf ?? null,
  };
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export async function completeText(input: TextCall): Promise<NormalizedTextResult> {
  const started = Date.now();
  const known = PROMPT_LIBRARY.find((item) => item.key === input.templateKey && item.version === input.templateVersion);
  if (known && known.body !== input.templateBody) {
    return empty("VALIDATION_ERROR", "The template body does not match the recorded version. The model was not called.", input, started);
  }
  if (!input.templateBody || input.templateBody.trim().length < 8 || input.templateBody.length > 4000) {
    return empty("VALIDATION_ERROR", "The template is missing or too large. The model was not called.", input, started);
  }
  const payload = modelPayload(input.context);
  const serialized = JSON.stringify(payload);
  if (serialized.length > 12000) {
    return empty("VALIDATION_ERROR", "The context is larger than this task allows. The model was not called.", input, started);
  }
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) return empty("AUTH_ERROR", "The text model is not configured on the server.", input, started);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 50000);
  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: LIVE_TEXT_MODEL,
        temperature: 0.4,
        max_tokens: 900,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: input.templateBody },
          { role: "user", content: serialized },
        ],
      }),
    });
    if (response.status === 401 || response.status === 403) return empty("AUTH_ERROR", "The text model refused the server credential.", input, started);
    if (response.status === 408) return empty("TIMEOUT", "The text model timed out.", input, started);
    if (response.status === 429) return empty("RATE_LIMITED", "The text model asked the studio to wait.", input, started);
    if (!response.ok) return empty("PROVIDER_ERROR", `The text model returned status ${response.status}.`, input, started);
    const body = (await response.json()) as {
      id?: string;
      model?: string;
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: unknown; completion_tokens?: unknown; cost?: unknown };
    };
    const text = body.choices?.[0]?.message?.content ?? "";
    if (!text.trim()) return empty("PROVIDER_ERROR", "The text model returned an empty draft.", input, started);
    return {
      status: "SUCCESS",
      providerId: LIVE_TEXT_PROVIDER_ID,
      model: typeof body.model === "string" && body.model.trim() ? body.model : LIVE_TEXT_MODEL,
      modelVersion: null,
      text,
      inputTokens: numberOrNull(body.usage?.prompt_tokens),
      outputTokens: numberOrNull(body.usage?.completion_tokens),
      durationMs: Date.now() - started,
      cost: numberOrNull(body.usage && "cost" in body.usage ? (body.usage as { cost?: unknown }).cost : null),
      error: null,
      externalReference: typeof body.id === "string" ? body.id : null,
      templateKey: input.templateKey,
      templateVersion: input.templateVersion,
      retryOf: input.retryOf ?? null,
    };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return empty(aborted ? "TIMEOUT" : "INTERNAL_ERROR", aborted ? "The text model timed out." : scrub(error instanceof Error ? error.message : "The text call failed."), input, started);
  } finally {
    clearTimeout(timer);
  }
}

export const readTextAdapterStatus = createServerFn({ method: "POST" }).handler(async () => {
  return {
    configured: Boolean(process.env.XAI_API_KEY),
    providerId: LIVE_TEXT_PROVIDER_ID,
    provider: "xAI",
    model: LIVE_TEXT_MODEL,
    modelVersion: "UNKNOWN",
    cost: "UNKNOWN",
  };
});

export const generateTextDraft = createServerFn({ method: "POST" })
  .validator((data: TextCall) => data)
  .handler(async ({ data }) => completeText(data));
