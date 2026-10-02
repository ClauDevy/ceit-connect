"use client";

import { useState } from "react";

type Member = {
  id: string;
  full_name: string;
  email: string;
  role: string;
  committee_id: string | null;
  is_active: boolean;
};

type Committee = { id: string; name: string };

export function UsersTable({
  members,
  committees,
  currentUserId,
}: {
  members: Member[];
  committees: Committee[];
  currentUserId: string;
}) {
  const [rows, setRows] = useState(members);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const committeeName = (id: string | null) =>
    committees.find((c) => c.id === id)?.name ?? "—";

  async function toggleActive(member: Member) {
    const nextActive = !member.is_active;
    const confirmMsg = nextActive
      ? `Reactivate ${member.full_name}?`
      : `Deactivate ${member.full_name}? This removes their access and deletes their profile photo.`;

    if (!window.confirm(confirmMsg)) return;

    setLoadingId(member.id);
    setError("");

    try {
      const res = await fetch("/api/toggle-user-active", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: member.id, isActive: nextActive }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data.error ?? "Something went wrong");
        return;
      }

      setRows((prev) =>
        prev.map((m) =>
          m.id === member.id ? { ...m, is_active: nextActive } : m,
        ),
      );
    } catch {
      setError("Network error, please try again");
    } finally {
      setLoadingId(null);
    }
  }

  return (
    <div className="overflow-x-auto rounded-2xl border bg-card">
      {error && <p className="p-3 text-sm text-destructive">{error}</p>}
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted text-left text-xs font-semibold uppercase text-muted-foreground">
            <th className="px-4 py-3">Name</th>
            <th className="px-4 py-3">Email</th>
            <th className="px-4 py-3">Role</th>
            <th className="px-4 py-3">Committee</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((member) => (
            <tr key={member.id} className="border-b last:border-0">
              <td className="px-4 py-3 font-medium">{member.full_name}</td>
              <td className="px-4 py-3 text-muted-foreground">
                {member.email}
              </td>
              <td className="px-4 py-3">{member.role}</td>
              <td className="px-4 py-3">
                {committeeName(member.committee_id)}
              </td>
              <td className="px-4 py-3">
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
                    member.is_active
                      ? "bg-muted text-accent-foreground"
                      : "bg-secondary text-muted-foreground"
                  }`}
                >
                  {member.is_active ? "Active" : "Deactivated"}
                </span>
              </td>
              <td className="px-4 py-3 text-right">
                {member.id === currentUserId ? (
                  <span className="text-xs text-muted-foreground">You</span>
                ) : (
                  <button
                    onClick={() => toggleActive(member)}
                    disabled={loadingId === member.id}
                    className={`text-xs font-semibold underline disabled:opacity-50 ${
                      member.is_active
                        ? "text-destructive"
                        : "text-primary hover:text-accent-foreground"
                    }`}
                  >
                    {loadingId === member.id
                      ? "..."
                      : member.is_active
                        ? "Deactivate"
                        : "Reactivate"}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
