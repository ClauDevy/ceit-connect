"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { CurrentUser, Role } from "@/lib/types";

const NAV_ITEMS = [
  { href: "/home", label: "Home", roles: ["Admin", "Co-Admin", "Member"] },
  { href: "/workspace", label: "My Tasks", roles: ["Admin", "Co-Admin", "Member"] },
  { href: "/archives", label: "Event Archives", roles: ["Admin", "Co-Admin", "Member"] },
  { href: "/dashboard", label: "Executive Dashboard", roles: ["Admin", "Co-Admin"] },
  { href: "/activity-log", label: "Activity Log", roles: ["Admin"] },
  { href: "/users", label: "User Management", roles: ["Admin", "Co-Admin"] },
] as const;

export function Sidebar({ user }: { user: CurrentUser }) {
  const pathname = usePathname();

  return (
    <nav className="flex h-full w-60 flex-col gap-1 border-r border-slate-200 bg-white p-4">
      <div className="mb-4 px-2 text-lg font-bold text-orange-600">
        CEIT Connect
      </div>

      {NAV_ITEMS.filter((item) =>
        (item.roles as readonly Role[]).includes(user.role)
      ).map(
        (item) => {
          const active = pathname?.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                active
                  ? "bg-orange-50 text-orange-600"
                  : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              {item.label}
            </Link>
          );
        }
      )}

      <div className="mt-auto px-2 pt-4 text-xs text-slate-400">
        {user.name} · {user.role}
      </div>
    </nav>
  );
}
