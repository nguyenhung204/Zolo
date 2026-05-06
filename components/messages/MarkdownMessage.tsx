"use client";

import React, { memo, useMemo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import { cn } from "@/lib/utils";
import { MentionHighlight } from "./MentionHighlight";

interface Props {
  content: string;
  isMine?: boolean;
  mentions?: string[];
  mentionLabels?: string[];
  mentionAll?: boolean;
}

// Defined at module level — stable reference, never recreated.
const remarkPlugins = [remarkGfm];

function buildComponents(
  isMine: boolean,
  mentions: string[] = [],
  mentionLabels: string[] = [],
  mentionAll = false
): Components {
  return {
    // ── Paragraph ─────────────────────────────────────────────────────────
    p({ children }) {
      return (
        <p className="mb-1.5 last:mb-0 whitespace-pre-wrap break-all [overflow-wrap:anywhere] leading-relaxed">
          {mentions.length > 0 || mentionAll ? (
            <MentionHighlight
              content={typeof children === "string" ? children : String(children)}
              isMine={isMine}
              mentions={mentions}
              mentionLabels={mentionLabels}
              mentionAll={mentionAll}
            />
          ) : (
            children
          )}
        </p>
      );
    },

    // ── Links — always open in new tab with security attrs ────────────────
    a({ href, children }) {
      return (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            "hover:underline break-all [overflow-wrap:anywhere]",
            isMine ? "text-white/90 underline decoration-white/50" : "text-blue-500 hover:text-blue-400"
          )}
        >
          {children}
        </a>
      );
    },

    // ── Images — responsive, lazy, rounded ───────────────────────────────
    img({ src, alt }) {
      return (
        <img
          src={src ?? ""}
          alt={alt ?? ""}
          className="max-w-full h-auto rounded-xl my-1.5"
          loading="lazy"
        />
      );
    },

    // ── Strip the <pre> wrapper — SyntaxHighlighter brings its own ────────
    pre({ children }) {
      return <>{children}</>;
    },

    // ── Code: inline vs block ─────────────────────────────────────────────
    code({ className, children }) {
      const langMatch = /language-(\w+)/.exec(className ?? "");
      const codeString = String(children).replace(/\n$/, "");

      if (langMatch) {
        // ── Block code with language ──────────────────────────────────────
        return (
          <div className="rounded-xl overflow-hidden my-1.5 text-[0.8rem]">
            <SyntaxHighlighter
              style={vscDarkPlus}
              language={langMatch[1]}
              PreTag="div"
              customStyle={{ margin: 0, borderRadius: 0, fontSize: "inherit" }}
            >
              {codeString}
            </SyntaxHighlighter>
          </div>
        );
      }

      // ── Inline code ───────────────────────────────────────────────────
      return (
        <code
          className={cn(
            "font-mono text-[0.85em] px-1 py-0.5 rounded break-all [overflow-wrap:anywhere]",
            isMine ? "bg-white/15 text-white/90" : "bg-black/8 text-pink-500"
          )}
        >
          {codeString}
        </code>
      );
    },

    // ── Blockquote ────────────────────────────────────────────────────────
    blockquote({ children }) {
      return (
        <blockquote
          className={cn(
            "border-l-[3px] pl-3 my-1.5 italic",
            isMine ? "border-white/40 text-white/70" : "border-border text-muted"
          )}
        >
          {children}
        </blockquote>
      );
    },

    // ── Lists ──────────────────────────────────────────────────────────────
    ul({ children }) {
      return <ul className="list-disc pl-5 my-1 space-y-0.5">{children}</ul>;
    },
    ol({ children }) {
      return <ol className="list-decimal pl-5 my-1 space-y-0.5">{children}</ol>;
    },

    // ── Headings (sized down to fit inside a bubble) ──────────────────────
    h1({ children }) {
      return <h1 className="text-base font-bold my-1.5 leading-snug">{children}</h1>;
    },
    h2({ children }) {
      return <h2 className="text-[0.95em] font-bold my-1 leading-snug">{children}</h2>;
    },
    h3({ children }) {
      return <h3 className="text-[0.9em] font-semibold my-1 leading-snug">{children}</h3>;
    },

    // ── Inline formatting ─────────────────────────────────────────────────
    strong({ children }) {
      return <strong className="font-semibold">{children}</strong>;
    },
    em({ children }) {
      return <em className="italic">{children}</em>;
    },
    del({ children }) {
      return <del className="line-through opacity-70">{children}</del>;
    },

    // ── GFM Tables ────────────────────────────────────────────────────────
    table({ children }) {
      return (
        <div className="overflow-x-auto max-w-full my-1.5 rounded-lg">
          <table className="text-xs border-collapse w-full">{children}</table>
        </div>
      );
    },
    th({ children }) {
      return (
        <th
          className={cn(
            "border px-2 py-1 text-left font-semibold",
            isMine ? "border-white/20 bg-white/10" : "border-border bg-surface"
          )}
        >
          {children}
        </th>
      );
    },
    td({ children }) {
      return (
        <td
          className={cn(
            "border px-2 py-1",
            isMine ? "border-white/20" : "border-border"
          )}
        >
          {children}
        </td>
      );
    },

    // ── GFM Horizontal rule ───────────────────────────────────────────────
    hr() {
      return (
        <hr
          className={cn(
            "my-2 border-0 border-t",
            isMine ? "border-white/20" : "border-border"
          )}
        />
      );
    },
  };
}

// ─── Component ────────────────────────────────────────────────────────────────
// Wrapped in React.memo — AST parsing is expensive; skip re-renders when
// neither `content` nor `isMine` changes (critical for react-window scroll).
/**
 * Preserve consecutive blank lines that standard Markdown would collapse.
 * Each extra `\n` beyond the first `\n\n` pair becomes a U+00A0 (NBSP) placeholder
 * paragraph, which ReactMarkdown renders as a visible empty line.
 *
 * e.g. "a\n\n\n\nb"  (4 newlines = 3 blank lines)
 *   →  "a\n\n\u00A0\n\n\u00A0\n\nb"  → <p>a</p><p> </p><p> </p><p>b</p>
 */
function preserveBlankLines(raw: string): string {
  return raw.replace(/\n{3,}/g, (match) => {
    const extra = match.length - 2; // number of blank lines beyond the standard paragraph break
    return "\n\n" + "\u00A0\n\n".repeat(extra);
  });
}

function MarkdownMessageBase({
  content,
  isMine = false,
  mentions = [],
  mentionLabels = [],
  mentionAll = false,
}: Props) {
  // buildComponents is cheap object creation; useMemo keyed on isMine (stable
  // per message) so the object reference is reused across the memo'd renders.
  const components = useMemo(
    () => buildComponents(isMine, mentions, mentionLabels, mentionAll),
    [isMine, mentions, mentionLabels, mentionAll]
  );

  const processedContent = useMemo(() => preserveBlankLines(content), [content]);

  return (
    <ReactMarkdown remarkPlugins={remarkPlugins} components={components}>
      {processedContent}
    </ReactMarkdown>
  );
}

export const MarkdownMessage = memo(MarkdownMessageBase);
