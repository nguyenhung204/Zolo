export type AiIntent = "general_inquiry" | "enterprise" | "out_of_scope";

export interface AiChatMessage {
  role: "user" | "assistant";
  content: string;
  intent?: AiIntent | null;
}

export interface AiIngestResponse {
  session_id: string;
  message: string;
}

export interface AiHistoryResponse {
  history: AiChatMessage[];
}

export interface AiSessionDeleteResponse {
  ok: boolean;
  message: string;
}

export interface AiChatStreamPayload {
  session_id: string | null;
  message: string;
  history?: AiChatMessage[];
}

export interface AiChatStreamDelta {
  content: string;
  intent: AiIntent;
}

const AI_API_BASE_URL = (process.env.NEXT_PUBLIC_AI_API_URL ?? "http://localhost:8000").replace(/\/+$/, "");

function aiUrl(path: string) {
  return `${AI_API_BASE_URL}${path}`;
}

async function readErrorMessage(res: Response, fallback: string) {
  try {
    const data = (await res.json()) as { detail?: string; message?: string };
    return data.detail ?? data.message ?? fallback;
  } catch {
    return fallback;
  }
}

async function ensureOk(res: Response, fallback: string) {
  if (res.ok) return;
  throw new Error(await readErrorMessage(res, fallback));
}

export async function checkAiHealth(signal?: AbortSignal) {
  const res = await fetch(aiUrl("/health"), { method: "GET", signal });
  await ensureOk(res, "AI service is unavailable.");
  return (await res.json()) as { status: "ok" };
}

export async function ingestAiFiles(files: File[], signal?: AbortSignal) {
  const form = new FormData();
  files.forEach((file) => form.append("files", file));

  const res = await fetch(aiUrl("/v1/ingest"), {
    method: "POST",
    body: form,
    signal,
  });

  await ensureOk(res, "Could not upload documents.");
  return (await res.json()) as AiIngestResponse;
}

export async function getAiSessionHistory(sessionId: string, signal?: AbortSignal) {
  const res = await fetch(aiUrl(`/v1/sessions/${encodeURIComponent(sessionId)}/history`), {
    method: "GET",
    signal,
  });

  await ensureOk(res, "Could not load AI history.");
  return (await res.json()) as AiHistoryResponse;
}

export async function saveAiSessionHistory(sessionId: string, history: AiChatMessage[], signal?: AbortSignal) {
  const res = await fetch(aiUrl(`/v1/sessions/${encodeURIComponent(sessionId)}/history`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ history }),
    signal,
  });

  await ensureOk(res, "Could not save AI history.");
  return (await res.json()) as { ok: true };
}

export async function deleteAiSession(sessionId: string, options?: { keepalive?: boolean; signal?: AbortSignal }) {
  const res = await fetch(aiUrl(`/v1/sessions/${encodeURIComponent(sessionId)}`), {
    method: "DELETE",
    keepalive: options?.keepalive,
    signal: options?.signal,
  });

  await ensureOk(res, "Could not delete AI session.");
  return (await res.json()) as AiSessionDeleteResponse;
}

export async function streamAiChat(
  payload: AiChatStreamPayload,
  onDelta: (delta: AiChatStreamDelta) => void,
  signal?: AbortSignal
) {
  const res = await fetch(aiUrl("/v1/chat/stream"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });

  await ensureOk(res, "Could not get AI response.");

  if (!res.body) {
    throw new Error("AI response stream is empty.");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split(/\r?\n\r?\n/);
    buffer = events.pop() ?? "";

    for (const event of events) {
      const data = event
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data: "))
        .map((line) => line.slice(6))
        .join("\n")
        .trim();

      if (!data) continue;
      if (data === "[DONE]") return;
      onDelta(JSON.parse(data) as AiChatStreamDelta);
    }
  }
}

export { AI_API_BASE_URL };
