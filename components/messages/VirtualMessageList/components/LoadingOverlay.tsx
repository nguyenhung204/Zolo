import { Loader2 } from "lucide-react";

/** Full-page loading spinner shown while the first page of messages is fetching. */
export function LoadingState() {
  return (
    <div className="flex-1 flex items-center justify-center">
      <Loader2 className="w-6 h-6 animate-spin text-muted" />
    </div>
  );
}

/** Absolute overlay indicator for history/after fetching. */
export function FetchingOverlay({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <div className="flex justify-center py-2 absolute top-0 left-0 right-0 z-10 pointer-events-none">
      <Loader2 className="w-4 h-4 animate-spin text-muted" />
    </div>
  );
}
