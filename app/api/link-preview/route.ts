import { NextRequest, NextResponse } from "next/server";

export interface LinkPreviewData {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  favicon: string | null;
  siteName: string | null;
  domain: string;
}

// Block private/internal ranges (SSRF protection)
const BLOCKED_HOSTNAMES = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[::1\])/i;

function extractMeta(html: string, property: string): string | null {
  // og:xxx / twitter:xxx / name="description" etc.
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']+)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${property}["']`, "i"),
    new RegExp(`<meta[^>]+name=["']${property}["'][^>]+content=["']([^"']+)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${property}["']`, "i"),
  ];
  for (const re of patterns) {
    const m = re.exec(html);
    if (m?.[1]) return m[1].trim();
  }
  return null;
}

function extractTitle(html: string): string | null {
  const m = /<title[^>]*>([^<]{1,300})<\/title>/i.exec(html);
  return m?.[1]?.trim() ?? null;
}

function extractFavicon(html: string, origin: string): string | null {
  // <link rel="icon" href="..."> or shortcut icon
  const m =
    /<link[^>]+rel=["'][^"']*(?:icon|shortcut icon|apple-touch-icon)[^"']*["'][^>]+href=["']([^"']+)["']/i.exec(html) ??
    /<link[^>]+href=["']([^"']+)["'][^>]+rel=["'][^"']*icon[^"']*["']/i.exec(html);
  if (!m?.[1]) return `${origin}/favicon.ico`;
  const href = m[1].trim();
  if (href.startsWith("http")) return href;
  if (href.startsWith("//")) return `https:${href}`;
  if (href.startsWith("/")) return `${origin}${href}`;
  return `${origin}/${href}`;
}

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("url");
  if (!raw) return NextResponse.json({ error: "url required" }, { status: 400 });

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return NextResponse.json({ error: "invalid url" }, { status: 400 });
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    return NextResponse.json({ error: "unsupported protocol" }, { status: 400 });
  }

  if (BLOCKED_HOSTNAMES.test(parsed.hostname)) {
    return NextResponse.json({ error: "blocked" }, { status: 403 });
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);

    const response = await fetch(parsed.href, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; ZoloBot/1.0; +https://zolo.chat)",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    clearTimeout(timeout);

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html")) {
      // Not HTML — return minimal info from headers
      const data: LinkPreviewData = {
        url: parsed.href,
        title: null,
        description: null,
        image: null,
        favicon: null,
        siteName: null,
        domain: parsed.hostname.replace(/^www\./, ""),
      };
      return NextResponse.json(data, {
        headers: { "Cache-Control": "public, max-age=3600" },
      });
    }

    // Read at most 100 KB — enough for all <head> OG tags
    const reader = response.body?.getReader();
    if (!reader) throw new Error("no body");
    let html = "";
    let bytes = 0;
    const MAX = 100_000;
    const decoder = new TextDecoder();
    while (bytes < MAX) {
      const { done, value } = await reader.read();
      if (done) break;
      html += decoder.decode(value, { stream: true });
      bytes += value.length;
    }
    reader.cancel();

    const origin = `${parsed.protocol}//${parsed.host}`;
    const ogImage = extractMeta(html, "og:image") ?? extractMeta(html, "twitter:image");
    const absoluteImage = ogImage
      ? ogImage.startsWith("http") ? ogImage
        : ogImage.startsWith("//") ? `https:${ogImage}`
        : `${origin}${ogImage.startsWith("/") ? ogImage : `/${ogImage}`}`
      : null;

    const data: LinkPreviewData = {
      url: parsed.href,
      title:
        extractMeta(html, "og:title") ??
        extractMeta(html, "twitter:title") ??
        extractTitle(html),
      description:
        extractMeta(html, "og:description") ??
        extractMeta(html, "twitter:description") ??
        extractMeta(html, "description"),
      image: absoluteImage,
      favicon: extractFavicon(html, origin),
      siteName: extractMeta(html, "og:site_name"),
      domain: parsed.hostname.replace(/^www\./, ""),
    };

    return NextResponse.json(data, {
      headers: { "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" },
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return NextResponse.json({ error: "timeout" }, { status: 504 });
    }
    return NextResponse.json({ error: "fetch_failed" }, { status: 502 });
  }
}
