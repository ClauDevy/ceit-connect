import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("sign-in alert settlement", () => {
  it("permanently suppresses the initial alert when it is dismissed or a new attempt starts", () => {
    const panel = read("src/components/auth/sign-in-panel.tsx");

    expect(panel).toContain("const [initialErrorVisible, setInitialErrorVisible]");
    expect(panel).toContain("setInitialErrorVisible(false)");
    expect(panel).toContain("<AuthAlert onDismiss={suppressInitialError}>");
    expect(panel.match(/onAttempt=\{suppressInitialError\}/g)).toHaveLength(3);
  });

  it("notifies the panel before each current sign-in request begins", () => {
    for (const path of [
      "src/components/auth/password-sign-in-form.tsx",
      "src/components/auth/magic-link-form.tsx",
      "src/components/auth/google-button.tsx",
    ]) {
      const source = read(path);
      expect(source.indexOf("onAttempt?.()")).toBeGreaterThan(-1);
      expect(source.indexOf("onAttempt?.()")).toBeLessThan(source.indexOf("createClient()"));
    }
  });

  it("always settles the magic-link button with the existing safe error copy", () => {
    const form = read("src/components/auth/magic-link-form.tsx");
    const safeError =
      "That email isn't recognized. If you're a council member, ask an Admin to invite you first.";

    expect(form).toContain("try {");
    expect(form).toContain("} catch {");
    expect(form).toContain("} finally {");
    expect(form).toContain("setSending(false)");
    expect(form.match(new RegExp(safeError.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"))).toHaveLength(2);
  });
});
