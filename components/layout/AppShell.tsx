"use client";

import { NavRail } from "./NavRail";
import { ConversationList } from "@/components/conversations/ConversationList";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { useSocket } from "@/hooks/useSocket";
import { useCallSocket } from "@/hooks/useCallSocket";
import { useMyProfile } from "@/hooks/useUser";
import { useCallStore } from "@/stores/callStore";
import { useAuthStore } from "@/stores/authStore";
import { connectChatSocket, getChatSocket } from "@/lib/socket/socket";
import { CallBar } from "@/components/calls/CallBar";

interface AppShellProps {
  children: React.ReactNode;
}

// Only show the conversation sidebar on messaging routes
const SIDEBAR_ROUTES = ["/conversations", "/friends"];
const ACTIVE_TAB_KEY = "zolo-active-tab-id";

export function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const activeMeetingId = useCallStore((s) => s.activeMeetingId);
  const token = useAuthStore((s) => s.token);
  const isSessionRevoked = useAuthStore((s) => s.isSessionRevoked);
  const setSessionRevoked = useAuthStore((s) => s.setSessionRevoked);
  const tabIdRef = useRef<string>(Math.random().toString(36).slice(2));

  // Sync revoked state from localStorage after mount to avoid hydration mismatch
  useEffect(() => {
    if (typeof window === "undefined") return;
    const key = "zolo-session-revoked";
    if (window.localStorage.getItem(key) === "1") {
      setSessionRevoked(true, false);
    }
  }, [setSessionRevoked]);
  const channelRef = useRef<BroadcastChannel | null>(null);

  const relinquishSocket = () => {
    const socket = getChatSocket();
    socket.io.reconnection(false);
    if (socket.connected || socket.active) socket.disconnect();
  };

  const applyOwner = (ownerId?: string | null) => {
    const currentTabId = tabIdRef.current;
    if (ownerId && ownerId === currentTabId) {
      setSessionRevoked(false, false);
      return;
    }
    setSessionRevoked(true, false);
    relinquishSocket();
  };

  // Initialise socket event listeners
  useSocket();
  useCallSocket();
  // Fetch profile once on mount and keep authStore (avatar, name) in sync
  useMyProfile();

  useEffect(() => {
    if (typeof window === "undefined") return;
    const channel = new BroadcastChannel("zolo-session");
    channelRef.current = channel;

    const onMessage = (
      event: MessageEvent<{
        type?: string;
        requestedBy?: string;
        reconnectedBy?: string;
        ownerId?: string | null;
      }>
    ) => {
      if (!event.data?.type) return;
      if (event.data.type === "SESSION_REVOKED") {
        setSessionRevoked(true);
      }
      if (event.data.type === "ACTIVE_TAB_CHANGED") {
        applyOwner(event.data.ownerId);
      }
      if (event.data.type === "SESSION_RECONNECT_REQUESTED") {
        const requestedBy = event.data.requestedBy;
        if (!requestedBy || requestedBy !== tabIdRef.current) {
          applyOwner(requestedBy);
        }
      }
      if (event.data.type === "SESSION_RECONNECTED") {
        const reconnectedBy = event.data.reconnectedBy;
        applyOwner(reconnectedBy);
      }
    };

    const onStorage = (event: StorageEvent) => {
      if (event.key !== ACTIVE_TAB_KEY) return;
      applyOwner(event.newValue);
    };

    channel.addEventListener("message", onMessage);
    window.addEventListener("storage", onStorage);

    // Acquire lock if no active tab exists, else pause this tab immediately.
    const existingOwner = window.localStorage.getItem(ACTIVE_TAB_KEY);
    if (!existingOwner) {
      window.localStorage.setItem(ACTIVE_TAB_KEY, tabIdRef.current);
      setSessionRevoked(false, false);
      channel.postMessage({ type: "ACTIVE_TAB_CHANGED", ownerId: tabIdRef.current });
    } else {
      applyOwner(existingOwner);
    }

    const onBeforeUnload = () => {
      const owner = window.localStorage.getItem(ACTIVE_TAB_KEY);
      if (owner === tabIdRef.current) {
        window.localStorage.removeItem(ACTIVE_TAB_KEY);
        channel.postMessage({ type: "ACTIVE_TAB_CHANGED", ownerId: null });
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("storage", onStorage);
      channel.removeEventListener("message", onMessage);
      channel.close();
      channelRef.current = null;
    };
  }, [setSessionRevoked]);

  const showSidebar = SIDEBAR_ROUTES.some((r) => pathname.startsWith(r));

  const handleReconnect = () => {
    if (!token) return;
    window.localStorage.setItem(ACTIVE_TAB_KEY, tabIdRef.current);
    channelRef.current?.postMessage({ type: "ACTIVE_TAB_CHANGED", ownerId: tabIdRef.current });
    channelRef.current?.postMessage({ type: "SESSION_RECONNECT_REQUESTED", requestedBy: tabIdRef.current });
    const socket = connectChatSocket(token);
    socket.io.reconnection(true);
    socket.once("connect", () => {
      setSessionRevoked(false, false); // clear and do not persist
      channelRef.current?.postMessage({ type: "SESSION_RECONNECTED", reconnectedBy: tabIdRef.current });
    });
  };

  return (
    <>
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

      {isSessionRevoked ? (
        <div className="fixed inset-0 z-110 flex items-center justify-center bg-black/55 px-4 pointer-events-auto">
          <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-6 text-text shadow-2xl">
            <h2 className="text-lg font-semibold">Connection Paused</h2>
            <p className="mt-2 text-sm text-muted">
              You are using Zolo in another tab. Activate this tab to take over the active session.
            </p>
            <button
              type="button"
              onClick={handleReconnect}
              className="mt-6 inline-flex w-full items-center justify-center rounded-lg bg-cta px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
              tabIndex={0}
              autoFocus
            >
              Activate This Tab
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
