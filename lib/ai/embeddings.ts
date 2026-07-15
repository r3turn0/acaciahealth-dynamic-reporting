/**
 * lib/ai/embeddings.ts
 *
 * Text embedding via OpenAI text-embedding-3-large (1536 dimensions).
 * Uses OPENAI_API_KEY directly — no Vercel AI Gateway dependency.
 * Falls back to the AI Gateway (embed from "ai") when OPENAI_API_KEY is absent.
 */

import { embed as aiEmbed, embedMany as aiEmbedMany } from "ai";
import { gateway } from "ai";

// Dimension count matches the vector column type in Postgres
export const EMBEDDING_DIM = 1536;
const OPENAI_EMBEDDING_MODEL = "text-embedding-3-large";
const GATEWAY_EMBEDDING_MODEL = "openai/text-embedding-3-small";

// ── Direct OpenAI path ────────────────────────────────────────────────────────

async function embedViaOpenAI(text: string): Promise<number[]> {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_EMBEDDING_MODEL,
      input: text,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI embeddings error ${res.status}: ${err}`);
  }
  const json = (await res.json()) as { data: { embedding: number[] }[] };
  return json.data[0].embedding;
}

async function embedManyViaOpenAI(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_EMBEDDING_MODEL,
      input: texts,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI embeddings error ${res.status}: ${err}`);
  }
  const json = (await res.json()) as { data: { index: number; embedding: number[] }[] };
  // Sort by index to preserve order
  return json.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

// ── AI Gateway fallback ───────────────────────────────────────────────────────

async function embedViaGateway(text: string): Promise<number[]> {
  const result = await aiEmbed({
    model: gateway(GATEWAY_EMBEDDING_MODEL),
    value: text,
  });
  return result.embedding;
}

async function embedManyViaGateway(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const result = await aiEmbedMany({
    model: gateway(GATEWAY_EMBEDDING_MODEL),
    values: texts,
  });
  return result.embeddings;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Embed a single text string.
 * Prefers OPENAI_API_KEY; falls back to AI Gateway (AI_GATEWAY_API_KEY).
 * Returns an empty array when neither is configured.
 */
export async function embedText(text: string): Promise<number[]> {
  try {
    if (process.env.OPENAI_API_KEY) {
      return await embedViaOpenAI(text);
    }
    if (process.env.AI_GATEWAY_API_KEY) {
      return await embedViaGateway(text);
    }
    console.warn("[embeddings] No API key configured — returning empty embedding.");
    return [];
  } catch (err) {
    console.error("[embeddings] embed failed:", err);
    return [];
  }
}

/**
 * Embed multiple texts in a single batch request.
 */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  try {
    if (process.env.OPENAI_API_KEY) {
      return await embedManyViaOpenAI(texts);
    }
    if (process.env.AI_GATEWAY_API_KEY) {
      return await embedManyViaGateway(texts);
    }
    return texts.map(() => []);
  } catch (err) {
    console.error("[embeddings] embedMany failed:", err);
    return texts.map(() => []);
  }
}

/**
 * Formats a number[] embedding as a Postgres vector literal string.
 * e.g. [0.1, 0.2, ...] → '[0.1,0.2,...]'
 */
export function pgVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}
