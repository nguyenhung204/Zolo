"use client";

import { MessageSquare, Users, Settings } from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/authStore";
import { UserAvatar } from "@/components/presence/UserAvatar";

const navItems = [
  { href: "/conversations", icon: MessageSquare, label: "Chats" },
  { href: "/friends", icon: Users, label: "Friends" },
  { href: "/settings", icon: Settings, label: "Settings" },
];

export function NavRail() {
  const pathname = usePathname();
  const user = useAuthStore((s) => s.user);

  return (
    <nav className="flex flex-col items-center gap-1 w-14 h-full bg-[#0F172A] dark:bg-[#0a1120] py-4 shrink-0">
      {/* Brand mark */}
      <div className="mb-4">
        <Image src="/zolo.png" alt="Zolo" width={32} height={32} style={{ width: 32, height: 32 }} className="rounded-xl object-cover" />
      </div>

      <div className="flex-1 flex flex-col items-center gap-1">
        {navItems.map(({ href, icon: Icon, label }) => {
          const active = pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              title={label}
              className={cn(
                "w-10 h-10 rounded-lg flex items-center justify-center transition-colors duration-150 cursor-pointer",
                active
                  ? "bg-white/15 text-white"
                  : "text-white/50 hover:bg-white/10 hover:text-white/80"
              )}
            >
              <Icon className="w-5 h-5" />
            </Link>
          );
        })}
      </div>

      {/* User avatar at bottom */}
      {user && (
        <div className="mt-2">
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
