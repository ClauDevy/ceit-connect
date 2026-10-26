import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));

import { GET } from "./route";

type UserFixture = {
  id: string;
  email?: string | null;
  email_confirmed_at?: string | null;
  app_metadata?: Record<string, unknown>;
};

function callbackClient(options?: {
  exchangeError?: { message: string } | null;
  profile?: { email: string; is_active: boolean } | null;
  profileError?: { message: string } | null;
  signOutError?: { message: string } | null;
  user?: UserFixture | null;
}) {
  const user =
    options && "user" in options
      ? options.user
      : {
          id: "user-1",
          email: "member@example.edu",
          email_confirmed_at: "2026-10-26T00:00:00Z",
          app_metadata: { provider: "anything" },
        };
  const exchangeCodeForSession = vi.fn().mockResolvedValue({
    data: { user },
    error: options?.exchangeError ?? null,
  });
  const signOut = vi.fn().mockResolvedValue({
    error: options?.signOutError ?? null,
  });
  const maybeSingle = vi.fn().mockResolvedValue({
    data:
      options && "profile" in options
        ? options.profile
        : { email: "member@example.edu", is_active: true },
    error: options?.profileError ?? null,
  });
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));

  return {
    client: {
      auth: { exchangeCodeForSession, signOut },
      from,
    },
    eq,
    exchangeCodeForSession,
    from,
    maybeSingle,
    select,
    signOut,
  };
}

function request(query = "code=oauth-code") {
  return new Request(`http://localhost/auth/callback?${query}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ALLOWED_EMAIL_DOMAINS = "example.edu";
});

describe("GET /auth/callback", () => {
  it("uses the generic error when no code was exchanged", async () => {
    const response = await GET(request("next=/home"));
    expect(response.headers.get("location")).toBe(
      "http://localhost/login?error=auth",
    );
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  const rejectionCases: Array<{
    name: string;
    options: Parameters<typeof callbackClient>[0];
    domains?: string | undefined;
  }> = [
    {
      name: "uninvited exchange failure",
      options: { exchangeError: { message: "signup disabled" }, user: null },
    },
    { name: "exchange success without a user", options: { user: null } },
    {
      name: "missing email",
      options: {
        user: {
          id: "user-1",
          email: null,
          email_confirmed_at: "2026-10-26T00:00:00Z",
        },
      },
    },
    {
      name: "empty email",
      options: {
        user: {
          id: "user-1",
          email: "   ",
          email_confirmed_at: "2026-10-26T00:00:00Z",
        },
      },
    },
    {
      name: "unverified email",
      options: {
        user: {
          id: "user-1",
          email: "member@example.edu",
          email_confirmed_at: null,
        },
      },
    },
    { name: "profile read error", options: { profileError: { message: "db" } } },
    { name: "profile-less user", options: { profile: null } },
    {
      name: "deactivated profile",
      options: { profile: { email: "member@example.edu", is_active: false } },
    },
    {
      name: "true email mismatch",
      options: { profile: { email: "other@example.edu", is_active: true } },
    },
    {
      name: "wrong domain",
      options: {
        user: {
          id: "user-1",
          email: "member@wrong.example",
          email_confirmed_at: "2026-10-26T00:00:00Z",
        },
        profile: { email: "member@wrong.example", is_active: true },
      },
    },
    { name: "missing allowlist", options: {}, domains: undefined },
    { name: "empty allowlist", options: {}, domains: " , " },
    {
      name: "more than one at-sign",
      options: {
        user: {
          id: "user-1",
          email: "member@other@example.edu",
          email_confirmed_at: "2026-10-26T00:00:00Z",
        },
        profile: {
          email: "member@other@example.edu",
          is_active: true,
        },
      },
    },
  ];

  for (const testCase of rejectionCases) {
    it(`signs out, checks the sign-out error, and stays generic for ${testCase.name}`, async () => {
      if ("domains" in testCase) {
        if (testCase.domains === undefined) {
          delete process.env.ALLOWED_EMAIL_DOMAINS;
        } else {
          process.env.ALLOWED_EMAIL_DOMAINS = testCase.domains;
        }
      }
      const mock = callbackClient({
        ...testCase.options,
        signOutError: { message: "private sign-out detail" },
      });
      mocks.createClient.mockResolvedValue(mock.client);
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);

      const response = await GET(request());

      expect(response.headers.get("location")).toBe(
        "http://localhost/login?error=auth",
      );
      expect(mock.signOut).toHaveBeenCalledTimes(1);
      expect(consoleError).toHaveBeenCalledWith(
        "Failed to clear a rejected callback session",
      );
      expect(consoleError).not.toHaveBeenCalledWith(
        expect.stringContaining("private sign-out detail"),
      );
      consoleError.mockRestore();
    });
  }

  it("reads only the profile fields used for admission", async () => {
    const mock = callbackClient();
    mocks.createClient.mockResolvedValue(mock.client);

    await GET(request());

    expect(mock.select).toHaveBeenCalledWith("email, is_active");
    expect(mock.eq).toHaveBeenCalledWith("id", "user-1");
  });

  it("accepts case and surrounding-space differences without provider or password gates", async () => {
    process.env.ALLOWED_EMAIL_DOMAINS = " EXAMPLE.EDU, gmail.com ";
    const mock = callbackClient({
      user: {
        id: "user-1",
        email: " Member@Example.EDU ",
        email_confirmed_at: "2026-10-26T00:00:00Z",
        app_metadata: { provider: "not-google", password_set: false },
      },
      profile: { email: "member@example.edu", is_active: true },
    });
    mocks.createClient.mockResolvedValue(mock.client);

    const response = await GET(request("code=oauth-code&next=/workspace"));

    expect(response.headers.get("location")).toBe(
      "http://localhost/workspace",
    );
    expect(mock.signOut).not.toHaveBeenCalled();
  });

  it("keeps unsafe next values from becoming open redirects", async () => {
    const mock = callbackClient();
    mocks.createClient.mockResolvedValue(mock.client);
    const response = await GET(
      request("code=oauth-code&next=https://attacker.example"),
    );
    expect(response.headers.get("location")).toBe("http://localhost/home");
  });
});
