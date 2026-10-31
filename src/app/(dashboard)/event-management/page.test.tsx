import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((path: string): never => { throw new Error(`REDIRECT:${path}`); }),
  requireUser: vi.fn(),
  getActiveProfileForRoles: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/auth", () => ({
  requireUser: mocks.requireUser,
  getActiveProfileForRoles: mocks.getActiveProfileForRoles,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/components/events/event-management", () => ({
  EventManagement: ({ events }: { events: unknown[] }) => <div data-event-count={events.length} />,
}));

import EventManagementPage from "./page";

function dataClient(result: { data: unknown[] | null; error: unknown } = { data: [{ id: "event" }], error: null }) {
  const secondOrder = vi.fn().mockResolvedValue(result);
  const firstOrder = vi.fn(() => ({ order: secondOrder }));
  const inFilter = vi.fn(() => ({ order: firstOrder }));
  const select = vi.fn(() => ({ in: inFilter }));
  const from = vi.fn(() => ({ select }));
  mocks.createClient.mockResolvedValue({ from });
  return { from, select, inFilter, firstOrder, secondOrder };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue({ id: "admin" });
  mocks.getActiveProfileForRoles.mockResolvedValue({ role: "Admin", is_active: true, committee_id: null });
  dataClient();
});

describe("Event Management page", () => {
  it("guards itself before loading data", async () => {
    mocks.requireUser.mockRejectedValueOnce(new Error("REDIRECT:/login"));
    await expect(EventManagementPage()).rejects.toThrow("REDIRECT:/login");
    expect(mocks.createClient).not.toHaveBeenCalled();

    mocks.requireUser.mockResolvedValue({ id: "caller" });
    mocks.getActiveProfileForRoles.mockResolvedValueOnce(null);
    await expect(EventManagementPage()).rejects.toThrow("REDIRECT:/home");
    expect(mocks.getActiveProfileForRoles).toHaveBeenLastCalledWith(["Admin"]);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("loads only Draft and Archived event fields for an Admin", async () => {
    const query = dataClient();
    const html = renderToStaticMarkup(await EventManagementPage());
    expect(query.from).toHaveBeenCalledWith("events");
    expect(query.select).toHaveBeenCalledWith("id, name, start_date, status, updated_at");
    expect(query.inFilter).toHaveBeenCalledWith("status", ["Draft", "Archived"]);
    expect(html).toContain('data-event-count="1"');
  });

  it("shows fixed safe load text without rendering an empty management surface", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    dataClient({ data: null, error: { code: "private", message: "secret" } });
    const html = renderToStaticMarkup(await EventManagementPage());
    expect(html).toContain("Event Management could not be loaded");
    expect(html).not.toContain("secret");
    expect(html).not.toContain("data-event-count");
  });
});
