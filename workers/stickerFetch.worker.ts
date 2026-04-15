// Runs entirely off the main thread.
// Receives fetch requests from the main thread, fetches & parses JSON,
// posts the raw result back — keeps JSON parsing off the main thread.

type InMessage = {
  id: string;
  url: string;
  token: string;
  params: Record<string, string>;
};

type OutMessage = {
  id: string;
  data?: unknown;
  error?: string;
};

self.addEventListener("message", async (e: MessageEvent<InMessage>) => {
  const { id, url, token, params } = e.data;
  try {
    const qs = new URLSearchParams(params).toString();
    const fullUrl = qs ? `${url}?${qs}` : url;

    const res = await fetch(fullUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Client-Platform": "web",
      },
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data: unknown = await res.json();
    (self as unknown as Worker).postMessage({ id, data } satisfies OutMessage);
  } catch (err) {
    (self as unknown as Worker).postMessage({
      id,
      error: err instanceof Error ? err.message : String(err),
    } satisfies OutMessage);
  }
});
