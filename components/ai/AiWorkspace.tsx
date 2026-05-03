"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  CheckCircle2,
  FileText,
  Loader2,
  Paperclip,
  Send,
  Sparkles,
  Trash2,
  UploadCloud,
  WifiOff,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { MarkdownMessage } from "@/components/messages/MarkdownMessage";
import {
  checkAiHealth,
  deleteAiSession,
  getAiSessionHistory,
  ingestAiFiles,
  saveAiSessionHistory,
  streamAiChat,
  type AiChatMessage,
  type AiIntent,
} from "@/lib/api/ai";
import { cn } from "@/lib/utils";

type HealthState = "checking" | "ok" | "down";
type UiMessage = AiChatMessage & { id: string };

const SESSION_KEY = "zolo-ai-session-id";
const HISTORY_KEY = "zolo-ai-history";
const ALLOWED_EXTENSIONS = new Set(["pdf", "docx", "xlsx", "png", "jpg", "jpeg"]);
const SAMPLE_PROMPTS = [
  "Tóm tắt tài liệu này trong 5 ý chính",
  "Những rủi ro hoặc điểm cần chú ý là gì?",
  "Doanh thu quý 2 là bao nhiêu?",
];

function newMessage(role: UiMessage["role"], content: string, intent: AiIntent | null = null): UiMessage {
  return {
    id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    role,
    content,
    intent,
  };
}

function toHistory(messages: UiMessage[]): AiChatMessage[] {
  return messages
    .filter((message) => message.content.trim().length > 0)
    .map(({ role, content, intent }) => ({ role, content, intent: intent ?? null }));
}

function formatBytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function getFileExtension(file: File) {
  return file.name.split(".").pop()?.toLowerCase() ?? "";
}

function validateFiles(files: File[]) {
  if (files.length === 0) return "Vui lòng chọn ít nhất 1 file.";
  if (files.length > 2) return "Chỉ được phép tải lên tối đa 2 file trong một lần.";
  if (files.some((file) => file.size === 0)) return "File rỗng không thể được tải lên.";
  if (files.some((file) => !ALLOWED_EXTENSIONS.has(getFileExtension(file)))) {
    return "Chỉ hỗ trợ PDF, DOCX, XLSX, PNG, JPG.";
  }
  return null;
}

export function AiWorkspace() {
  const [health, setHealth] = useState<HealthState>("checking");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState("");
  const [isIngesting, setIsIngesting] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [activeIntent, setActiveIntent] = useState<AiIntent | null>(null);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const selectedFileNames = useMemo(() => files.map((file) => file.name).join(", "), [files]);
  const canUpload = files.length > 0 && !isIngesting && !isStreaming;
  const canSend = input.trim().length > 0 && !isStreaming && !isIngesting;

  useEffect(() => {
    const controller = new AbortController();

    checkAiHealth(controller.signal)
      .then(() => setHealth("ok"))
      .catch(() => setHealth("down"));

    const storedSession = window.localStorage.getItem(SESSION_KEY);
    const storedHistory = window.localStorage.getItem(HISTORY_KEY);

    if (storedHistory) {
      try {
        const parsed = JSON.parse(storedHistory) as AiChatMessage[];
        setMessages(parsed.map((message) => newMessage(message.role, message.content, message.intent ?? null)));
      } catch {
        window.localStorage.removeItem(HISTORY_KEY);
      }
    }

    if (storedSession) {
      setSessionId(storedSession);
      setIsLoadingHistory(true);
      getAiSessionHistory(storedSession, controller.signal)
        .then((res) => {
          if (res.history.length > 0) {
            setMessages(res.history.map((message) => newMessage(message.role, message.content, message.intent ?? null)));
          }
        })
        .catch(() => {
          toast.warning("Không thể tải lịch sử AI, có thể session đã hết hạn.");
        })
        .finally(() => setIsLoadingHistory(false));
    }

    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (sessionId) {
      window.localStorage.setItem(SESSION_KEY, sessionId);
    } else {
      window.localStorage.removeItem(SESSION_KEY);
    }
  }, [sessionId]);

  useEffect(() => {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(toHistory(messages)));
    scrollRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  useEffect(() => {
    if (!sessionId) return;

    const handleBeforeUnload = () => {
      window.localStorage.removeItem(SESSION_KEY);
      window.localStorage.removeItem(HISTORY_KEY);
      void deleteAiSession(sessionId, { keepalive: true }).catch(() => undefined);
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [sessionId]);

  const handleFilesChange = (nextFiles: File[]) => {
    const validationError = validateFiles(nextFiles);
    if (validationError) {
      toast.error(validationError);
      return;
    }
    setFiles(nextFiles);
  };

  const handleIngest = async () => {
    const validationError = validateFiles(files);
    if (validationError) {
      toast.error(validationError);
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setIsIngesting(true);

    try {
      if (sessionId) {
        await deleteAiSession(sessionId).catch(() => undefined);
      }

      const res = await ingestAiFiles(files, controller.signal);
      setSessionId(res.session_id);
      setMessages([]);
      setActiveIntent(null);
      toast.success(res.message || "Đã nạp tài liệu cho AI.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không thể tải tài liệu.");
    } finally {
      setIsIngesting(false);
      abortRef.current = null;
    }
  };

  const handleEndSession = async () => {
    abortRef.current?.abort();
    const currentSession = sessionId;
    setSessionId(null);
    setFiles([]);
    setMessages([]);
    setActiveIntent(null);
    window.localStorage.removeItem(HISTORY_KEY);

    if (!currentSession) return;

    try {
      await deleteAiSession(currentSession);
      toast.success("Đã xoá session AI.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không thể xoá session.");
    }
  };

  const sendMessage = async (content: string) => {
    const text = content.trim();
    if (!text || isStreaming) return;

    const previousMessages = messages;
    const userMessage = newMessage("user", text);
    const assistantMessage = newMessage("assistant", "", null);
    const nextMessages = [...previousMessages, userMessage, assistantMessage];
    let assistantContent = "";
    let assistantIntent: AiIntent | null = null;

    setMessages(nextMessages);
    setInput("");
    setIsStreaming(true);
    setActiveIntent(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await streamAiChat(
        {
          session_id: sessionId,
          message: text,
          history: toHistory(previousMessages),
        },
        (delta) => {
          assistantContent += delta.content;
          assistantIntent = delta.intent;
          setActiveIntent(delta.intent);
          setMessages((current) =>
            current.map((message) =>
              message.id === assistantMessage.id
                ? { ...message, content: assistantContent, intent: assistantIntent }
                : message
            )
          );
        },
        controller.signal
      );

      const finalMessages = [
        ...previousMessages,
        userMessage,
        { ...assistantMessage, content: assistantContent, intent: assistantIntent },
      ];
      setMessages(finalMessages);

      if (sessionId) {
        await saveAiSessionHistory(sessionId, toHistory(finalMessages)).catch(() => {
          toast.warning("AI đã trả lời nhưng chưa đồng bộ được lịch sử.");
        });
      }
    } catch (error) {
      if (controller.signal.aborted) {
        setMessages((current) =>
          current.map((item) =>
            item.id === assistantMessage.id
              ? { ...item, content: "Đã dừng phản hồi.", intent: assistantIntent }
              : item
          )
        );
        return;
      }
      const message = error instanceof Error ? error.message : "Không thể nhận phản hồi từ AI.";
      setMessages((current) =>
        current.map((item) =>
          item.id === assistantMessage.id
            ? { ...item, content: `Không thể trả lời lúc này: ${message}`, intent: "out_of_scope" }
            : item
        )
      );
      toast.error(message);
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void sendMessage(input);
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg">
      <header className="shrink-0 border-b border-border bg-surface/95 px-4 py-3 backdrop-blur md:px-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-cta text-white shadow-md">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-text">Zolo AI Enterprise</h1>
              <p className="text-sm text-muted">Chat thường hoặc hỏi đáp theo tài liệu nội bộ.</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 font-medium",
                health === "ok" && "border-success/25 bg-success/10 text-success",
                health === "down" && "border-error/25 bg-error/10 text-error",
                health === "checking" && "border-border bg-surface-secondary text-muted"
              )}
            >
              {health === "ok" ? <CheckCircle2 className="h-3.5 w-3.5" /> : null}
              {health === "down" ? <WifiOff className="h-3.5 w-3.5" /> : null}
              {health === "checking" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {health === "ok" ? "AI online" : health === "down" ? "AI offline" : "Đang kiểm tra"}
            </span>

          </div>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="border-b border-border bg-surface p-4 md:border-b-0 md:border-r md:p-5">
          <div className="rounded-3xl border border-border bg-surface-secondary p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-text">Tài liệu nội bộ</p>
                <p className="mt-1 text-xs leading-5 text-muted">Tối đa 2 file: PDF, DOCX, XLSX, PNG, JPG.</p>
              </div>
              <UploadCloud className="h-5 w-5 text-cta" />
            </div>

            <label className="mt-4 flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-surface px-4 py-6 text-center transition hover:border-cta/60 hover:bg-bg">
              <Paperclip className="h-6 w-6 text-muted" />
              <span className="mt-2 text-sm font-medium text-text">Chọn file để nạp RAG</span>
              <span className="mt-1 text-xs text-muted">Có thể hỏi general mà không cần file.</span>
              <input
                type="file"
                multiple
                accept=".pdf,.docx,.xlsx,.png,.jpg,.jpeg"
                className="sr-only"
                onChange={(event) => handleFilesChange(Array.from(event.target.files ?? []))}
              />
            </label>

            {files.length > 0 ? (
              <div className="mt-3 space-y-2">
                {files.map((file) => (
                  <div key={`${file.name}-${file.size}`} className="flex items-center gap-2 rounded-xl bg-surface px-3 py-2">
                    <FileText className="h-4 w-4 shrink-0 text-cta" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-text">{file.name}</p>
                      <p className="text-xs text-muted">{formatBytes(file.size)}</p>
                    </div>
                    <button
                      type="button"
                      className="rounded-lg p-1 text-muted transition hover:bg-surface-secondary hover:text-error"
                      onClick={() => setFiles((current) => current.filter((item) => item !== file))}
                      aria-label={`Remove ${file.name}`}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            ) : null}

            <button
              type="button"
              disabled={!canUpload}
              onClick={handleIngest}
              className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-cta px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-cta-hover disabled:cursor-not-allowed disabled:opacity-50"
              title={selectedFileNames}
            >
              {isIngesting ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
              {isIngesting ? "Đang nạp tài liệu..." : sessionId ? "Nạp phiên tài liệu mới" : "Nạp tài liệu"}
            </button>
          </div>

          <div className="mt-4 rounded-3xl border border-border bg-surface p-4">
            <p className="text-sm font-semibold text-text">Phiên AI</p>
            <div className="mt-3 rounded-2xl bg-surface-secondary p-3">
              <p className="text-xs uppercase tracking-wide text-muted">Session ID</p>
              <p className="mt-1 break-all font-mono text-xs text-secondary">{sessionId ?? "Chưa có tài liệu"}</p>
            </div>
            <button
              type="button"
              disabled={!sessionId && messages.length === 0}
              onClick={handleEndSession}
              className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-border px-4 py-2 text-sm font-semibold text-secondary transition hover:border-error/50 hover:bg-error/10 hover:text-error disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" />
              Kết thúc phiên
            </button>
          </div>
        </aside>

        <section className="flex min-h-0 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 md:px-8">
            {isLoadingHistory ? (
              <div className="flex h-full items-center justify-center text-sm text-muted">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Đang tải lịch sử...
              </div>
            ) : messages.length === 0 ? (
              <div className="mx-auto flex h-full max-w-3xl flex-col items-center justify-center text-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-surface-secondary text-cta">
                  <Bot className="h-8 w-8" />
                </div>
                <h2 className="mt-5 text-2xl font-semibold text-text">Hỏi nhanh, trả lời theo ngữ cảnh</h2>
                <p className="mt-2 max-w-xl text-sm leading-6 text-muted">
                  Upload tài liệu để hỏi dữ liệu enterprise, hoặc nhập câu hỏi thông thường để AI trả lời ngay.
                </p>
                <div className="mt-6 grid w-full gap-2 md:grid-cols-3">
                  {SAMPLE_PROMPTS.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      className="rounded-2xl border border-border bg-surface px-4 py-3 text-left text-sm text-secondary transition hover:border-cta/50 hover:text-cta"
                      onClick={() => setInput(prompt)}
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="mx-auto max-w-4xl space-y-5">
                {messages.map((message) => {
                  const isUser = message.role === "user";
                  return (
                    <div key={message.id} className={cn("flex", isUser ? "justify-end" : "justify-start")}>
                      <div
                        className={cn(
                          "max-w-[88%] rounded-3xl px-4 py-3 text-sm shadow-sm md:max-w-[74%]",
                          isUser
                            ? "bg-cta text-white"
                            : "border border-border bg-surface text-text"
                        )}
                      >
                        {!isUser ? (
                          <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-cta">
                            <Bot className="h-3.5 w-3.5" />
                            Zolo AI
                            {message.intent ? (
                              <span className="rounded-full bg-surface-secondary px-2 py-0.5 text-[11px] text-muted">
                                {message.intent}
                              </span>
                            ) : null}
                          </div>
                        ) : null}
                        {message.content ? (
                          <MarkdownMessage content={message.content} isMine={isUser} />
                        ) : (
                          <span className="inline-flex items-center gap-2 text-muted">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            AI đang suy nghĩ...
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
                <div ref={scrollRef} />
              </div>
            )}
          </div>

          <form onSubmit={handleSubmit} className="shrink-0 border-t border-border bg-surface p-3 md:p-4">
            <div className="mx-auto flex max-w-4xl items-end gap-2 rounded-3xl border border-border bg-bg p-2">
              <textarea
                value={input}
                rows={1}
                placeholder={sessionId ? "Hỏi về tài liệu hoặc trò chuyện với AI..." : "Hỏi câu general, hoặc upload file để hỏi tài liệu..."}
                className="max-h-32 min-h-11 flex-1 resize-none bg-transparent px-3 py-3 text-sm text-text outline-none placeholder:text-muted"
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void sendMessage(input);
                  }
                }}
              />
              {isStreaming ? (
                <button
                  type="button"
                  onClick={() => abortRef.current?.abort()}
                  className="mb-0.5 inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-border text-muted transition hover:text-error"
                  aria-label="Stop AI response"
                >
                  <X className="h-4 w-4" />
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!canSend}
                  className="mb-0.5 inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-cta text-white transition hover:bg-cta-hover disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label="Send message"
                >
                  <Send className="h-4 w-4" />
                </button>
              )}
            </div>
            <div className="mx-auto mt-2 flex max-w-4xl items-center justify-between gap-2 px-2 text-xs text-muted">
              <span>{activeIntent ? `Intent: ${activeIntent}` : "Enter để gửi, Shift+Enter để xuống dòng."}</span>
              <span>{sessionId ? "Enterprise RAG sẵn sàng" : "General chat mode"}</span>
            </div>
          </form>
        </section>
      </div>
    </div>
  );
}
