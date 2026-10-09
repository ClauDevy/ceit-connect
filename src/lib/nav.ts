import {
  Archive,
  ChartColumn,
  History,
  House,
  ListTodo,
  Settings,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { Role } from "@/lib/types";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  roles: readonly Role[];
  /** Pinned to the mobile bottom bar; everything else goes under "More". */
  pinnedOnMobile?: boolean;
}

const EVERYONE: readonly Role[] = ["Admin", "Co-Admin", "Member"];
const LEADERSHIP: readonly Role[] = ["Admin", "Co-Admin"];

// Visibility here is UX polish only. Every route behind these links is
// still guarded server-side (see ARCHITECTURE §4F: hide the door, lock the door).
export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/home", label: "Home", icon: House, roles: EVERYONE, pinnedOnMobile: true },
  { href: "/workspace", label: "My Tasks", icon: ListTodo, roles: EVERYONE, pinnedOnMobile: true },
  { href: "/archives", label: "Event Archives", icon: Archive, roles: EVERYONE },
  { href: "/dashboard", label: "Executive Dashboard", icon: ChartColumn, roles: LEADERSHIP, pinnedOnMobile: true },
  { href: "/activity-log", label: "Activity Log", icon: History, roles: ["Admin"] },
  { href: "/users", label: "User Management", icon: Users, roles: ["Admin"] },
  { href: "/settings", label: "Settings", icon: Settings, roles: EVERYONE, pinnedOnMobile: true },
];

export function navForRole(role: Role) {
  const items = NAV_ITEMS.filter((item) => item.roles.includes(role));
  return {
    all: items,
    pinned: items.filter((item) => item.pinnedOnMobile),
    more: items.filter((item) => !item.pinnedOnMobile),
  };
}

export function isNavActive(pathname: string | null, href: string) {
  if (!pathname) return false;
  return pathname === href || pathname.startsWith(`${href}/`);
}
