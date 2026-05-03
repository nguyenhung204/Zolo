"use client";

import { MessageSquare, Sparkles, Users, Settings, type LucideIcon } from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/authStore";
import { UserAvatar } from "@/components/presence/UserAvatar";

interface NavItem {
  href: string;
  icon: LucideIcon;
  label: string;
}

const navItems: NavItem[] = [
  { href: "/conversations", icon: MessageSquare, label: "Chats" },
  { href: "/ai", icon: Sparkles, label: "AI" },
  { href: "/friends", icon: Users, label: "Friends" },
  { href: "/settings", icon: Settings, label: "Settings" },
];

export function NavRail() {
  const pathname = usePathname();
  const user = useAuthStore((s) => s.user);

  return (
    <nav
      aria-label="Primary"
      className={cn(
        "shrink-0 bg-[#0F172A] dark:bg-[#0a1120] order-last md:order-none",
        // Mobile: full-width horizontal bottom bar
        "flex flex-row items-center justify-around w-full h-14 px-2 pb-safe border-t border-black/30",
        // Desktop: 56px vertical rail with brand on top, items centered, avatar at bottom
        "md:flex-col md:items-center md:justify-start md:w-14 md:h-full md:py-4 md:px-0 md:border-t-0",
      )}
    >
      {/* Brand mark — desktop only */}
      <div className="hidden md:flex md:items-center md:justify-center md:mb-4">
        <Image
          src="/zolo.png"
          alt="Zolo"
          width={32}
          height={32}
          style={{ width: 32, height: 32 }}
          className="rounded-xl object-cover"
        />
      </div>

      {/* Items: row on mobile (fills bottom bar), column on desktop (centered) */}
      <div
        className={cn(
          "flex flex-row md:flex-col items-center w-full md:w-auto",
          "justify-around md:justify-start gap-1 md:gap-2 flex-1 md:flex-none",
        )}
      >
        {navItems.map(({ href, icon: Icon, label }) => {
          const active = pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              title={label}
              aria-label={label}
              aria-current={active ? "page" : undefined}
              className={cn(
                // Mobile: tall column (icon + label), full flex 1; Desktop: 40x40 square
                "flex flex-col items-center justify-center transition-colors duration-150 cursor-pointer rounded-xl gap-0.5 md:gap-0",
                "h-12 md:h-10 flex-1 md:flex-none md:w-10",
                active
                  ? "bg-white/15 text-white"
                  : "text-white/60 hover:bg-white/10 hover:text-white/90",
              )}
            >
              <Icon className="w-5 h-5 shrink-0" />
              <span className="md:hidden text-[10px] leading-none font-medium">
                {label}
              </span>
            </Link>
          );
        })}
      </div>

      {/* User avatar — desktop only, pinned to bottom */}
      {user && (
        <div className="hidden md:flex md:items-center md:justify-center md:mt-auto">
          <UserAvatar
            userId={user.id}
            name={user.name}
            avatarUrl={user.avatarUrl}
            size="sm"
          />
        </div>
      )}
    </nav>
  );
}
