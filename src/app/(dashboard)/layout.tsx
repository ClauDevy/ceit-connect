import { Sidebar } from "@/components/layout/sidebar";
import type { CurrentUser } from "@/lib/types";

// TODO: replace with a real fetch of the logged-in user once auth is
// wired (Phase 2). For now every page under (dashboard) renders with
// this fake Admin so the layout/nav is visible and testable.
const MOCK_USER: CurrentUser = {
  id: "mock-1",
  name: "Juan Dela Cruz",
  role: "Admin",
  committeeId: null,
  avatarUrl: null,
};

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar user={MOCK_USER} />
      <main className="flex-1 overflow-y-auto overflow-x-hidden bg-slate-50 p-6">
        {children}
      </main>
    </div>
  );
}
