export class RequestTimeoutError extends Error {
  readonly code = "REQUEST_TIMEOUT";

  constructor(readonly timeoutMs: number) {
    super(`Request timed out after ${timeoutMs}ms`);
    this.name = "RequestTimeoutError";
  }
}

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit & { timeoutMs: number }
): Promise<Response> {
  const { timeoutMs, signal: parentSignal, ...requestInit } = init;
  if (parentSignal?.aborted) {
    throw parentSignal.reason ?? new DOMException("Aborted", "AbortError");
  }

  const controller = new AbortController();
  let timedOut = false;
  const abortFromParent = () => controller.abort(parentSignal?.reason);
  parentSignal?.addEventListener("abort", abortFromParent, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new RequestTimeoutError(timeoutMs));
  }, timeoutMs);

  try {
    return await fetch(input, { ...requestInit, signal: controller.signal });
  } catch (error) {
    if (timedOut) throw new RequestTimeoutError(timeoutMs);
    throw error;
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener("abort", abortFromParent);
  }
}

export function requestErrorMessage(
  error: unknown,
  timeoutMessage: string,
  fallbackMessage = "Network request failed. Please retry."
): string {
  if (error instanceof RequestTimeoutError) return timeoutMessage;
  if (error instanceof DOMException && error.name === "AbortError") return "Request cancelled.";
  return error instanceof Error && error.message ? error.message : fallbackMessage;
}
