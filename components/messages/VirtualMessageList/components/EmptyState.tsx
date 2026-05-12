import { MessageSquare } from "lucide-react";

export function EmptyState() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center select-none">
      <div className="w-12 h-12 rounded-2xl bg-border/60 flex items-center justify-center">
        <MessageSquare className="w-6 h-6 text-muted" />
      </div>
      <div>
        <p className="text-sm font-medium text-secondary">No messages yet</p>
        <p className="text-xs text-muted mt-0.5">Be the first to say something!</p>
      </div>
    </div>
  );
}
