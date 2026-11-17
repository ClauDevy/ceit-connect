import { describe, expect, it } from "vitest";
import type { Member } from "@/lib/types";
import {
  getPeerAdminBlockedReason,
  isCurrentAdminLifecycleRequest,
} from "./users-table";

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
  it("hides Admin actions while a refresh is in flight", () => {
    expect(getPeerAdminBlockedReason(admin, "Admin", null, false)).toBe(
      "Checking Admin safeguards…",
    );
  });

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

  it("ignores a response that is older than the latest refresh", () => {
    expect(isCurrentAdminLifecycleRequest(1, 2)).toBe(false);
    expect(isCurrentAdminLifecycleRequest(2, 2)).toBe(true);
  });

  it("never makes Member or Co-Admin actions wait for Admin safeguards", () => {
    expect(getPeerAdminBlockedReason({ ...admin, role: "Member" }, "Admin", null, false)).toBeNull();
    expect(getPeerAdminBlockedReason({ ...admin, role: "Co-Admin" }, "Admin", null, false)).toBeNull();
  });
});
