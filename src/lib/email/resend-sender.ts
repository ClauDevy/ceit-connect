import "server-only";

export const RESEND_ENDPOINT = "https://api.resend.com/emails";
export const RESEND_TIMEOUT_MS = 8_000;

export type EmailAttachment = {
  filename: string;
  content: Uint8Array;
  contentType?: string;
};

export type EmailMessage = {
  attachments?: EmailAttachment[];
  from: string;
  html: string;
  idempotencyKey: string;
  subject: string;
  text: string;
  to: string;
};

export type EmailSendOutcome = {
  httpStatus: number | null;
  outcome: "success" | "transient" | "permanent";
};

function hasHeaderBreak(value: string) {
  return value.includes("\r") || value.includes("\n");
}

export function isValidMailbox(value: string) {
  return !hasHeaderBreak(value) && /^[^\s@]+@[^\s@]+$/.test(value);
}

export function isValidFrom(value: string) {
  if (hasHeaderBreak(value)) return false;
  const match = value.match(/^([^<>]+)\s+<([^<>]+)>$/);
  return Boolean(match?.[1].trim() && match?.[2] && isValidMailbox(match[2]));
}

export function classifyResendStatus(status: number): EmailSendOutcome {
  if (status >= 200 && status < 300) return { outcome: "success", httpStatus: status };
  if (status === 429 || status >= 500) return { outcome: "transient", httpStatus: status };
  return { outcome: "permanent", httpStatus: status };
}

function attachmentPayload(attachment: EmailAttachment) {
  return {
    filename: attachment.filename,
    content: Buffer.from(attachment.content).toString("base64"),
    ...(attachment.contentType ? { content_type: attachment.contentType } : {}),
  };
}

export async function sendResendEmail(
  apiKey: string,
  message: EmailMessage,
  fetchImpl: typeof fetch = fetch,
): Promise<EmailSendOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RESEND_TIMEOUT_MS);
  try {
    const response = await fetchImpl(RESEND_ENDPOINT, {
      method: "POST",
      redirect: "error",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": message.idempotencyKey,
      },
      body: JSON.stringify({
        from: message.from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        html: message.html,
        ...(message.attachments?.length
          ? { attachments: message.attachments.map(attachmentPayload) }
          : {}),
      }),
    });
    await response.arrayBuffer().catch(() => new ArrayBuffer(0));
    return classifyResendStatus(response.status);
  } catch {
    return { outcome: "transient", httpStatus: null };
  } finally {
    clearTimeout(timer);
  }
}
