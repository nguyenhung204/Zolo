"use client";

import { NavRail } from "./NavRail";
import { ConversationList } from "@/components/conversations/ConversationList";
import { usePathname } from "next/navigation";
import { useSocket } from "@/hooks/useSocket";
import { useCallSocket } from "@/hooks/useCallSocket";
import { useCallStore } from "@/stores/callStore";
import { CallBar } from "@/components/calls/CallBar";

interface AppShellProps {
  children: React.ReactNode;
}

// Only show the conversation sidebar on messaging routes
const SIDEBAR_ROUTES = ["/conversations", "/friends"];

export function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const activeMeetingId = useCallStore((s) => s.activeMeetingId);

  // Initialise socket event listeners
  useSocket();
  useCallSocket();

  const showSidebar = SIDEBAR_ROUTES.some((r) => pathname.startsWith(r));

  return (
    <div className="flex h-screen overflow-hidden bg-bg">
      {/* Left: icon rail */}
      <NavRail />

      {/* Middle: conversation list (conditional) */}
      {showSidebar && <ConversationList />}

      {/* Right: main content area */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {activeMeetingId && <CallBar />}
        {children}
      </main>
    </div>
  );
}
