/**
 * lib/ai/gateway.ts
 *
 * Single source of truth for AI model resolution in this project.
 * Uses the Vercel AI Gateway (ai@6 built-in) with AI_GATEWAY_API_KEY.
 * Falls back to an Azure OpenAI deployment when AZURE_OPENAI_* vars are set.
 *
 * Usage:
 *   import { getModel, MODEL_ID } from "@/lib/ai/gateway";
 *   const result = await generateText({ model: getModel(), ... });
 */

import { gateway, createGateway } from "ai";

// ── Model selection ───────────────────────────────────────────────────────────

/**
 * Current recommended model IDs via the Vercel AI Gateway.
 * Keep these in sync with: curl https://ai-gateway.vercel.sh/v1/models
 */
export const MODELS = {
  default: "openai/gpt-4o-mini",   // Fast, cost-effective — used for query planning & KPI insights
  capable: "openai/gpt-4o",        // Higher capability — reserved for complex schema tasks
} as const;

/**
 * Returns the resolved model ID string for logging / response metadata.
 * Prefers Azure if AZURE_OPENAI_DEPLOYMENT is set; otherwise Gateway default.
 */
export function getModelId(tier: keyof typeof MODELS = "default"): string {
  if (process.env.AZURE_OPENAI_DEPLOYMENT) {
    return `azure/${process.env.AZURE_OPENAI_DEPLOYMENT}`;
  }
  return MODELS[tier];
}

/**
 * Returns a fully configured LanguageModel for use in generateText / streamText.
 *
 * - If AZURE_OPENAI_API_KEY + AZURE_OPENAI_DEPLOYMENT are set, creates an
 *   Azure-scoped gateway provider pointing at the Azure endpoint.
 * - Otherwise uses the built-in Vercel AI Gateway, which auto-reads
 *   AI_GATEWAY_API_KEY from process.env.
 */
export function getModel(tier: keyof typeof MODELS = "default") {
  if (
    process.env.AZURE_OPENAI_API_KEY &&
    process.env.AZURE_OPENAI_DEPLOYMENT &&
    process.env.AZURE_OPENAI_ENDPOINT
  ) {
    // Azure OpenAI via a custom gateway endpoint
    const azureGateway = createGateway({
      baseURL: `${process.env.AZURE_OPENAI_ENDPOINT}/openai/deployments`,
      apiKey: process.env.AZURE_OPENAI_API_KEY,
    });
    return azureGateway(`azure/${process.env.AZURE_OPENAI_DEPLOYMENT}`);
  }

  // Vercel AI Gateway — reads AI_GATEWAY_API_KEY from process.env automatically
  return gateway(MODELS[tier]);
}

/** True when at least one AI provider is configured. */
export function isAiConfigured(): boolean {
  return !!(
    process.env.OPENAI_API_KEY ||
    process.env.AI_GATEWAY_API_KEY ||
    process.env.AZURE_OPENAI_API_KEY
  );
}

// ── Direct OpenAI JSON completion ─────────────────────────────────────────────

/**
 * Call the OpenAI Chat Completions API directly using OPENAI_API_KEY.
 * Returns the parsed JSON object from the model response.
 *
 * Prefers OPENAI_API_KEY; falls back to the AI SDK getModel() path so
 * routes continue to work without modification when only AI_GATEWAY_API_KEY
 * is set.
 */
export async function chatJSON<T = unknown>(
  systemPrompt: string,
  userPrompt: string,
  model = "gpt-4o"
): Promise<T> {
  if (process.env.OPENAI_API_KEY) {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
        temperature: 0.05,
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`OpenAI chat error ${res.status}: ${err}`);
    }
    const json = (await res.json()) as { choices: { message: { content: string } }[] };
    return JSON.parse(json.choices[0].message.content) as T;
  }

  // Fallback to AI SDK (AI Gateway or Azure) — use plain text + JSON.parse
  const { generateText } = await import("ai");
  const result = await generateText({
    model: getModel("capable"),
    system: systemPrompt + "\n\nRespond with valid JSON only. No markdown, no explanation.",
    prompt: userPrompt,
    temperature: 0.05,
  });
  return JSON.parse(result.text) as T;
}
