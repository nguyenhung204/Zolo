"use client";

import { memo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Globe } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LinkPreviewData } from "@/app/api/link-preview/route";

interface Props {
  url: string;
  isMine?: boolean;
}

async function fetchLinkPreview(url: string): Promise<LinkPreviewData> {
  const res = await fetch(`/api/link-preview?url=${encodeURIComponent(url)}`);
  if (!res.ok) throw new Error("preview_failed");
  return res.json();
}

// Extract the first HTTP(S) URL from a message string.
export const URL_RE = /https?:\/\/[^\s<>"'`]+[^\s<>"'`.,;:!?)\]]/g;

export function extractFirstUrl(text: string): string | null {
  const m = URL_RE.exec(text);
  URL_RE.lastIndex = 0; // reset stateful regex
  return m?.[0] ?? null;
}

export const LinkPreview = memo(function LinkPreview({ url, isMine = false }: Props) {
  const { data, isLoading, isError } = useQuery<LinkPreviewData>({
    queryKey: ["link-preview", url],
    queryFn: () => fetchLinkPreview(url),
    staleTime: 60 * 60_000, // 1 hour
    retry: false,
  });

  if (isLoading) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(
          "mt-2 flex items-center gap-2 rounded-xl border px-3 py-2 text-xs animate-pulse",
          isMine
            ? "border-white/20 bg-white/10 text-white/60"
            : "border-border bg-surface-secondary text-muted"
        )}
      >
        <Globe className="w-3.5 h-3.5 shrink-0" />
        <span className="truncate">{url}</span>
      </a>
    );
  }

  if (isError || !data) return null;

  const hasImage = !!data.image;
  const hasTitle = !!data.title;

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "mt-2 block rounded-xl border overflow-hidden transition-opacity hover:opacity-90",
        isMine ? "border-white/20" : "border-border"
      )}
    >
      {/* OG image */}
      {hasImage && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={data.image!}
          alt={data.title ?? ""}
          className="w-full max-h-[160px] object-cover"
          loading="lazy"
          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
        />
      )}

      {/* Text content */}
      <div
        className={cn(
          "flex items-start gap-2.5 px-3 py-2.5",
          isMine ? "bg-white/10" : "bg-surface-secondary"
        )}
      >
        {/* Favicon */}
        <div className="shrink-0 mt-0.5">
          {data.favicon ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={data.favicon}
              alt=""
              width={14}
              height={14}
              className="w-3.5 h-3.5 rounded-sm"
              onError={(e) => {
                (e.target as HTMLImageElement).replaceWith(
                  Object.assign(document.createElement("span"), {
                    className: "text-muted",
                    innerHTML: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`,
                  })
                );
              }}
            />
          ) : (
            <Globe className={cn("w-3.5 h-3.5", isMine ? "text-white/50" : "text-muted")} />
          )}
        </div>

        <div className="flex-1 min-w-0">
          {/* Site name / domain */}
          <p className={cn("text-[10px] font-medium uppercase tracking-wide truncate leading-none mb-1",
            isMine ? "text-white/50" : "text-muted")}>
            {data.siteName ?? data.domain}
          </p>

          {/* Title */}
          {hasTitle && (
            <p className={cn("text-xs font-semibold line-clamp-2 leading-snug",
              isMine ? "text-white" : "text-text")}>
              {data.title}
            </p>
          )}

          {/* Description */}
          {data.description && (
            <p className={cn("text-[11px] line-clamp-2 mt-0.5 leading-relaxed",
              isMine ? "text-white/70" : "text-muted")}>
              {data.description}
            </p>
          )}

          {/* URL fallback if no title */}
          {!hasTitle && (
            <p className={cn("text-[11px] truncate mt-0.5", isMine ? "text-white/60" : "text-muted")}>
              {url}
            </p>
          )}
        </div>

        <ExternalLink className={cn("w-3 h-3 shrink-0 mt-0.5", isMine ? "text-white/40" : "text-muted")} />
      </div>
    </a>
  );
});
