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
    process.env.AI_GATEWAY_API_KEY ||
    process.env.AZURE_OPENAI_API_KEY
  );
}
