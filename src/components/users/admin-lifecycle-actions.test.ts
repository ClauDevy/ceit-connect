import { describe, expect, it } from "vitest";
import type { Member } from "@/lib/types";
import { getPeerAdminBlockedReason } from "./users-table";

const admin: Member = {
  id: "admin-1",
  full_name: "Ari Santos",
  email: "ari@example.edu",
  role: "Admin",
  committee_id: null,
  avatar_url: null,
  is_active: true,
  anonymized_at: null,
};

describe("Admin lifecycle action safeguards", () => {
  it("fails closed after a lifecycle read failure", () => {
    expect(getPeerAdminBlockedReason(admin, "Admin", null, true)).toBe(
      "Could not check Admin safeguards. Refresh the page to try again.",
    );
  });

  it("allows Admin actions when a successful read finds two confirmed active Admins", () => {
    expect(
      getPeerAdminBlockedReason(
        admin,
        "Admin",
        {
          confirmed_active_admin_count: 2,
          caps_enabled: false,
          active_admin_count: 2,
          preparing_admin_count: 0,
        },
        false,
      ),
    ).toBeNull();
  });
});
