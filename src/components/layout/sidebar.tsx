"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { CurrentUser, Role } from "@/lib/types";
import { TigerLogo } from "@/components/ui/tiger-logo";

const NAV_ITEMS = [
  { href: "/home", label: "Home", roles: ["Admin", "Co-Admin", "Member"] },
  { href: "/workspace", label: "My Tasks", roles: ["Admin", "Co-Admin", "Member"] },
  { href: "/archives", label: "Event Archives", roles: ["Admin", "Co-Admin", "Member"] },
  { href: "/dashboard", label: "Executive Dashboard", roles: ["Admin", "Co-Admin"] },
  { href: "/activity-log", label: "Activity Log", roles: ["Admin"] },
  { href: "/users", label: "User Management", roles: ["Admin"] },
  { href: "/settings", label: "Settings", roles: ["Admin", "Co-Admin", "Member"] },
] as const;

export function Sidebar({ user }: { user: CurrentUser }) {
  const pathname = usePathname();

  const initials = (user.name ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <nav className="flex h-full w-60 lg:w-64 shrink-0 flex-col justify-between border-r bg-card px-5 lg:px-6 py-7">
      <div>
        <div className="mb-9 flex items-center gap-2.5">
          <TigerLogo size={34} />
          <div className="leading-tight">
            <p className="font-display text-[15px] font-semibold tracking-tight">
              CEIT Connect
            </p>
            <p className="-mt-0.5 text-[11px] text-muted-foreground">
              Student Council
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-1">
          {NAV_ITEMS.filter((item) =>
            (item.roles as readonly Role[]).includes(user.role)
          ).map((item) => {
            const active = pathname?.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors ${
                  active
                    ? "bg-muted text-primary before:absolute before:-left-5 before:top-1/2 before:h-[22px] before:w-1 before:-translate-y-1/2 before:rounded-r-full before:bg-primary"
                    : "text-secondary-foreground hover:bg-secondary"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col gap-3 border-t pt-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary font-display text-xs font-semibold text-primary-foreground">
            {user.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={user.avatarUrl}
                alt={user.name}
                className="h-full w-full object-cover"
              />
            ) : (
              initials
            )}
          </div>
          <div className="leading-tight">
            <p className="text-sm font-semibold">{user.name}</p>
            <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-accent-foreground">
              {user.role}
            </span>
          </div>
        </div>
        <form action="/auth/signout" method="post">
          <button
            type="submit"
            className="text-xs font-medium text-muted-foreground underline hover:text-primary"
          >
            Sign out
          </button>
        </form>
      </div>
    </nav>
  );
}