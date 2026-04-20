"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Download, X as XIcon } from "lucide-react";
import { blobDownload } from "./shared";
import { toast } from "sonner";

function canPreviewFile(filename: string): "pdf" | "office" | null {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pdf") return "pdf";
  if (["doc", "docx", "xls", "xlsx", "ppt", "pptx"].includes(ext)) return "office";
  return null;
}

interface Props {
  url: string;
  filename: string;
  onClose: () => void;
}

export function FilePreviewModal({ url, filename, onClose }: Props) {
  const [mounted, setMounted] = useState(false);
  const previewType = canPreviewFile(filename);

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleDownload = async () => {
    try {
      await blobDownload(url, filename);
    } catch {
      toast.error("Không thể tải file");
    }
  };

  if (!mounted) return null;

  const modal = (
    <div
      className="fixed inset-0 z-[9999] bg-black/80 flex flex-col"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="flex items-center justify-between px-4 py-3 bg-surface border-b border-border shrink-0">
        <p className="text-sm font-medium text-text truncate max-w-[60%]">{filename}</p>
        <div className="flex items-center gap-2">
          <button
            onClick={handleDownload}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cta/10 text-cta text-sm hover:bg-cta/20 transition-colors cursor-pointer"
          >
            <Download className="w-4 h-4" />
            <span>Tải xuống</span>
          </button>
          <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center text-muted hover:text-text hover:bg-border/60 cursor-pointer">
            <XIcon className="w-4 h-4" />
          </button>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        {previewType === "pdf" && (
          <iframe
            src={url}
            className="w-full h-full border-0"
            title={filename}
          />
        )}
        {previewType === "office" && (
          <iframe
            src={`https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(url)}`}
            className="w-full h-full border-0"
            title={filename}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          />
        )}
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}

export { canPreviewFile };
