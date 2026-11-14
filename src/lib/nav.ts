import {
  Archive,
  ChartColumn,
  History,
  House,
  CircleHelp,
  ListTodo,
  Settings,
  Trash2,
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
  /** Shows the password reminder when the current user's flag is false. */
  passwordWarning?: boolean;
}

const EVERYONE: readonly Role[] = ["Admin", "Co-Admin", "Member"];
const LEADERSHIP: readonly Role[] = ["Admin", "Co-Admin"];
const ADMIN_ONLY: readonly Role[] = ["Admin"];

// Visibility here is UX polish only. Every route behind these links is
// still guarded server-side (see ARCHITECTURE §4F: hide the door, lock the door).
export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/home", label: "Home", icon: House, roles: EVERYONE, pinnedOnMobile: true },
  { href: "/workspace", label: "Tasks", icon: ListTodo, roles: EVERYONE, pinnedOnMobile: true },
  { href: "/archives", label: "Event Archives", icon: Archive, roles: EVERYONE },
  { href: "/dashboard", label: "Executive Dashboard", icon: ChartColumn, roles: LEADERSHIP, pinnedOnMobile: true },
  { href: "/activity-log", label: "Activity Log", icon: History, roles: LEADERSHIP },
  { href: "/event-management", label: "Event Management", icon: Trash2, roles: ADMIN_ONLY },
  { href: "/users", label: "User Management", icon: Users, roles: LEADERSHIP },
  { href: "/settings", label: "Settings", icon: Settings, roles: EVERYONE, pinnedOnMobile: true, passwordWarning: true },
];

export const HELP_NAV_ITEM: NavItem = {
  href: "/help",
  label: "Help",
  icon: CircleHelp,
  roles: EVERYONE,
};

export function navForRole(role: Role) {
  const items = NAV_ITEMS.filter((item) => item.roles.includes(role));
  const pinned = items.filter((item) => item.pinnedOnMobile);
  const more = items.filter((item) => !item.pinnedOnMobile);
  // A "More" menu with a single page is pointless: show that page as a normal tab instead.
  if (more.length === 1) {
    const [only] = more;
    const settingsIndex = pinned.findIndex((item) => item.href === "/settings");
    const mobilePinned = [...pinned];
    mobilePinned.splice(settingsIndex === -1 ? mobilePinned.length : settingsIndex, 0, only);
    return { all: items, pinned: mobilePinned, more: [] as NavItem[] };
  }
  return { all: items, pinned, more };
}

export function isNavActive(pathname: string | null, href: string) {
  if (!pathname) return false;
  return pathname === href || pathname.startsWith(`${href}/`);
}
