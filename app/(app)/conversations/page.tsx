import { MessageSquare } from "lucide-react";

export default function ConversationsPage() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center select-none">
      <div className="w-16 h-16 rounded-2xl bg-border/60 flex items-center justify-center">
        <MessageSquare className="w-8 h-8 text-muted" />
      </div>
      <div>
        <p className="text-base font-semibold text-secondary">Select a conversation</p>
        <p className="text-sm text-muted mt-1">
          Choose a conversation from the list to start messaging
        </p>
      </div>
    </div>
  );
}
