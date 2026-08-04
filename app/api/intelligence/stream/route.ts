import { intelligenceStore } from "@/lib/intelligence/store";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const encoder = new TextEncoder();
  let unsubscribe = () => {};
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(`event: connected\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`));
      unsubscribe = intelligenceStore.subscribe((message) => controller.enqueue(encoder.encode(`event: ${message.type}\ndata: ${JSON.stringify(message.payload)}\n\n`)));
      const heartbeat = setInterval(() => controller.enqueue(encoder.encode(`: heartbeat ${Date.now()}\n\n`)), 15000);
      request.signal.addEventListener("abort", () => { clearInterval(heartbeat); unsubscribe(); try { controller.close(); } catch {} });
    },
    cancel() { unsubscribe(); },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" } });
}
