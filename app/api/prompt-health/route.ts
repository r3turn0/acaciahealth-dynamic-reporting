import { NextRequest, NextResponse } from "next/server";
import { getPromptHealth } from "@/lib/services/promptHealthService";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const force = req.nextUrl.searchParams.get("refresh") === "true";
  const prompts = await getPromptHealth(force);
  const summary = prompts.reduce((counts, prompt) => ({ ...counts, [prompt.status]: counts[prompt.status] + 1 }), { valid: 0, degraded: 0, broken: 0 });
  return NextResponse.json({ prompts, summary, scope: "process-cache", authoritative: false });
}
