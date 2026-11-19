import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import {
  buildImportantEmail,
  prepareImportantEmailSender,
  type ClaimedEmailDelivery,
} from "@/lib/email/important-email-worker";
import { classifyResendStatus, sendResendEmail } from "@/lib/email/resend-sender";

const config = {
  anonKey: "anon",
  apiKey: "secret",
  capability: "capability",
  from: "CEIT Connect <no-reply@ceitconnect.site>",
  siteUrl: "https://app.ceitconnect.site",
  supabaseUrl: "https://project.supabase.co",
};
const base: ClaimedEmailDelivery = {
  out_attempt: 1,
  out_delivery_id: "11111111-1111-4111-8111-111111111111",
  out_is_confidential: false,
  out_lease_expires_at: "2026-11-19T12:00:00Z",
  out_lease_token: "22222222-2222-4222-8222-222222222222",
  out_notification_type: "assignment",
  out_recipient_email: "member@example.edu",
  out_run_id: "33333333-3333-4333-8333-333333333333",
  out_run_token: "44444444-4444-4444-8444-444444444444",
  out_target_path: "/tasks/55555555-5555-4555-8555-555555555555",
  out_task_title: "Prepare <forms>",
};

beforeEach(() => {
  vi.unstubAllEnvs();
});

describe("important email content", () => {
  it("uses title, direct link, escaped HTML, footer, and the queue idempotency key", () => {
    const message = buildImportantEmail(config, base);
    expect(message.subject).toContain("Prepare <forms>");
    expect(message.text).toContain("/tasks/55555555-5555-4555-8555-555555555555");
    expect(message.html).toContain("Prepare &lt;forms&gt;");
    expect(message.text).toContain("Replies to this email are not monitored.");
    expect(message.text).toContain("turn these emails off in Settings");
    expect(message.text).toContain("https://app.ceitconnect.site/settings");
    expect(message.idempotencyKey).toBe(base.out_delivery_id);
    expect(message.attachments).toBeUndefined();
  });

  it("never exposes confidential title or task-specific target", () => {
    const message = buildImportantEmail(config, {
      ...base,
      out_is_confidential: true,
      out_target_path: "/tasks/secret-id",
      out_task_title: "Secret launch plan",
    });
    expect(JSON.stringify(message)).not.toContain("Secret launch plan");
    expect(JSON.stringify(message)).not.toContain("secret-id");
    expect(message.text).toContain("https://app.ceitconnect.site/workspace");
  });
});

describe("Resend transport", () => {
  it("classifies retryable and terminal provider responses", () => {
    expect(classifyResendStatus(202).outcome).toBe("success");
    expect(classifyResendStatus(429).outcome).toBe("transient");
    expect(classifyResendStatus(503).outcome).toBe("transient");
    expect(classifyResendStatus(400).outcome).toBe("permanent");
  });

  it("sends the queue id as Resend Idempotency-Key and omits attachments", async () => {
    const fetchMock = vi.fn(async () => new Response("provider body", { status: 202 }));
    await sendResendEmail(config.apiKey, buildImportantEmail(config, base), fetchMock);
    const calls = fetchMock.mock.calls as unknown as [RequestInfo | URL, RequestInit][];
    const init = calls[0][1];
    expect((init.headers as Record<string, string>)["Idempotency-Key"]).toBe(base.out_delivery_id);
    expect(JSON.parse(String(init.body))).not.toHaveProperty("attachments");
  });
});

describe("email environment validation", () => {
  it("requires https in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("EMAIL_FROM", config.from);
    vi.stubEnv("EMAIL_SITE_URL", "http://example.com");
    vi.stubEnv("RESEND_API_KEY", "secret");
    vi.stubEnv("EMAIL_DB_CAPABILITY", "capability");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", config.supabaseUrl);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
    expect(() => prepareImportantEmailSender()).toThrow("configuration is unavailable");
  });

  it("allows localhost http outside production", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("EMAIL_FROM", config.from);
    vi.stubEnv("EMAIL_SITE_URL", "http://localhost:3000");
    vi.stubEnv("RESEND_API_KEY", "secret");
    vi.stubEnv("EMAIL_DB_CAPABILITY", "capability");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", config.supabaseUrl);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
    expect(prepareImportantEmailSender().siteUrl).toBe("http://localhost:3000");
  });
});
