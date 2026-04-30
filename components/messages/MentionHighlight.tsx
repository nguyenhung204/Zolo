"use client";

import React, { useMemo } from "react";
import { cn } from "@/lib/utils";

interface Props {
  content: string;
  isMine?: boolean;
  mentions?: string[];
  mentionLabels?: string[];
  mentionAll?: boolean;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeAllMention(value: string) {
  return value.toLowerCase() === "@all" ? "@All" : value;
}

export function MentionHighlight({ content, isMine = false, mentions = [], mentionLabels = [], mentionAll = false }: Props) {
  const elements = useMemo(() => {
    if (!mentions.length && !mentionAll) {
      return content;
    }

    const labels = Array.from(new Set([
      ...mentionLabels.map((label) => label.trim()).filter(Boolean),
      ...(mentionAll ? ["@All", "@all"] : []),
    ])).sort((a, b) => b.length - a.length);
    const mentionRegex = labels.length > 0
      ? new RegExp(labels.map(escapeRegExp).join("|"), "gi")
      : /@[\p{L}\p{N}_-]+/gu;
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;

    let match: RegExpExecArray | null;
    while ((match = mentionRegex.exec(content)) !== null) {
      if (match.index > lastIndex) {
        parts.push(content.slice(lastIndex, match.index));
      }

      parts.push(
        <span
          key={`mention-${match.index}`}
          className={cn(
            "font-semibold rounded px-0.5 py-px",
            isMine
              ? "bg-white/20 text-white"
              : "bg-cta/15 text-cta"
          )}
        >
          {normalizeAllMention(match[0])}
        </span>
      );

      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < content.length) {
      parts.push(content.slice(lastIndex));
    }

    return parts;
  }, [content, mentions, mentionLabels, mentionAll, isMine]);

  return <>{elements}</>;
}
