"use client";

import { MessageSquare, Users, Settings, type LucideIcon } from "lucide-react";
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
        // Desktop: vertical left rail · Mobile: horizontal bottom bar
        "shrink-0 bg-[#0F172A] dark:bg-[#0a1120]",
        "md:flex md:flex-col md:items-center md:gap-1 md:w-14 md:h-full md:py-4",
        "order-last md:order-none",
        "flex flex-row items-center justify-around w-full h-14 px-2 pb-safe border-t md:border-t-0 border-black/30",
      )}
    >
      {/* Brand mark — desktop only */}
      <div className="hidden md:block mb-4">
        <Image
          src="/zolo.png"
          alt="Zolo"
          width={32}
          height={32}
          style={{ width: 32, height: 32 }}
          className="rounded-xl object-cover"
        />
      </div>

      <div className="flex md:flex-col flex-row items-center justify-around md:justify-start gap-1 flex-1 md:flex-1 w-full md:w-auto">
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
                "flex flex-col md:block items-center justify-center transition-colors duration-150 cursor-pointer rounded-lg",
                "h-12 md:h-10 md:w-10 flex-1 md:flex-initial gap-0.5 md:gap-0",
                active
                  ? "bg-white/15 text-white"
                  : "text-white/60 hover:bg-white/10 hover:text-white/90",
              )}
            >
              <Icon className="w-5 h-5 mx-auto" />
              <span className="md:hidden text-[10px] leading-none font-medium">
                {label}
              </span>
            </Link>
          );
        })}
      </div>

      {/* User avatar — desktop only */}
      {user && (
        <div className="hidden md:block mt-2">
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
