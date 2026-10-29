import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getActiveProfileForRoles: vi.fn(),
  getAuthUser: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getActiveProfileForRoles: mocks.getActiveProfileForRoles,
  getAuthUser: mocks.getAuthUser,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));

import { PATCH, POST } from "./route";

const eventId = "10000000-0000-4000-8000-000000000001";
const taskId = "20000000-0000-4000-8000-000000000001";
const committeeId = "30000000-0000-4000-8000-000000000001";
const eventIdV7 = "01900000-0000-7000-8000-000000000001";
const taskIdV7 = "01900000-0000-7000-8000-000000000002";
const committeeIdV7 = "01900000-0000-7000-8000-000000000003";
const personIdV7 = "01900000-0000-7000-8000-000000000004";
const viewerIdV7 = "01900000-0000-7000-8000-000000000005";

const task = {
  title: "Prepare venue",
  description: "",
  phase: "Preparation",
  committeeId,
  priority: "Medium",
  taskType: "Deliverable",
  dueDate: "2026-10-30",
  dutyDate: "",
  callTime: "",
  endTime: "",
  primaryAssigneeIds: [],
  isConfidential: false,
  allowedViewerIds: [],
};

function request(method: "POST" | "PATCH", body: unknown) {
  return new Request("http://localhost/api/active-task", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthUser.mockResolvedValue({ id: "user" });
  mocks.getActiveProfileForRoles.mockResolvedValue({
    role: "Admin",
    committee_id: null,
    is_active: true,
  });
  mocks.createClient.mockResolvedValue({
    rpc: vi.fn().mockResolvedValue({ data: [{ out_task_id: taskId }], error: null }),
  });
});

describe("/api/active-task", () => {
  it.each([
    ["POST", POST, { eventId, ...task }],
    [
      "PATCH",
      PATCH,
      {
        taskId,
        expectedUpdatedAt: "2026-10-28T12:34:56.123456+00:00",
        ...task,
      },
    ],
  ] as const)("accepts a strictly valid %s request", async (_, handler, body) => {
    const response = await handler(request(body === null ? "POST" : _ as "POST" | "PATCH", body));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it.each([
    ["event", { eventId: eventIdV7 }],
    ["committee", { committeeId: committeeIdV7 }],
    ["primary assignee", { primaryAssigneeIds: [personIdV7] }],
    [
      "additional viewer",
      { isConfidential: true, allowedViewerIds: [viewerIdV7] },
    ],
  ] as const)("accepts a canonical UUIDv7 %s in POST", async (_, change) => {
    const response = await POST(
      request("POST", { eventId, ...task, ...change }),
    );
    expect(response.status).toBe(200);
  });

  it.each([
    ["task", { taskId: taskIdV7 }],
    ["committee", { committeeId: committeeIdV7 }],
    ["primary assignee", { primaryAssigneeIds: [personIdV7] }],
    [
      "additional viewer",
      { isConfidential: true, allowedViewerIds: [viewerIdV7] },
    ],
  ] as const)("accepts a canonical UUIDv7 %s in PATCH", async (_, change) => {
    const response = await PATCH(
      request("PATCH", {
        taskId,
        expectedUpdatedAt: "2026-10-28T12:34:56.123456+00:00",
        ...task,
        ...change,
      }),
    );
    expect(response.status).toBe(200);
  });

  it.each([
    ["POST", POST, { eventId, ...task, status: "To Do" }],
    ["PATCH", PATCH, { taskId, expectedUpdatedAt: "bad", ...task }],
  ] as const)("rejects invalid %s fields before creating a data client", async (method, handler, body) => {
    const response = await handler(request(method, body));
    expect(response.status).toBe(400);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("returns clean session and role failures", async () => {
    mocks.getAuthUser.mockResolvedValueOnce(null);
    expect((await POST(request("POST", { eventId, ...task }))).status).toBe(401);
    mocks.getActiveProfileForRoles.mockResolvedValueOnce(null);
    expect((await POST(request("POST", { eventId, ...task }))).status).toBe(403);
  });

  it("prechecks a Co-Admin's proposed committee", async () => {
    mocks.getActiveProfileForRoles.mockResolvedValue({
      role: "Co-Admin",
      committee_id: "50000000-0000-4000-8000-000000000001",
      is_active: true,
    });
    const response = await POST(request("POST", { eventId, ...task }));
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "The task is unavailable." });
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
});
