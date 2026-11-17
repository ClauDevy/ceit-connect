import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ getUser: vi.fn() }))
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: { getUser: mocks.getUser } })),
}))

import TermsPage from "./page"

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getUser.mockResolvedValue({ data: { user: null }, error: null })
})

describe("public Terms page", () => {
  it("renders without a session with the draft notice and sign-in back link", async () => {
    const html = renderToStaticMarkup(await TermsPage())

    expect(html).toContain("Draft version")
    expect(html).toContain("owner and adviser to review")
    expect(html).toContain("not legal advice")
    expect(html).toContain(">Privacy<")
    expect(html).toContain("[contact email to be confirmed]")
    expect(html).toContain('href="/login"')
    expect(html).toContain("Back to sign in")
  })

  it("uses only the back link to reflect a valid signed-in user", async () => {
    mocks.getUser.mockResolvedValueOnce({ data: { user: { id: "user-a" } }, error: null })

    const html = renderToStaticMarkup(await TermsPage())

    expect(html).toContain('href="/home"')
    expect(html).toContain("Back to home")
    expect(html).toContain("Terms of Service")
  })

  it.each([
    ["returned auth error", () => mocks.getUser.mockResolvedValueOnce({ data: { user: { id: "user-a" } }, error: new Error("expired") })],
    ["thrown auth error", () => mocks.getUser.mockRejectedValueOnce(new Error("unavailable"))],
  ])("treats a %s as signed out without redirecting", async (_label, arrange) => {
    arrange()
    const html = renderToStaticMarkup(await TermsPage())
    expect(html).toContain('href="/login"')
    expect(html).not.toContain('href="/home"')
  })

  it("keeps the copy inside its approved factual boundary", () => {
    const source = readFileSync(resolve(process.cwd(), "src/app/terms/page.tsx"), "utf8")

    expect(source).not.toContain("requireUser")
    expect(source).not.toMatch(/retention|activity log|timezone|Asia\/|Manila/i)
    expect(source.match(/\[[^\]]+to be confirmed\]/g)).toEqual(["[contact email to be confirmed]"])
    expect(source).toContain("invite-only workspace")
    expect(source).toContain("email link, Google, or a password")
    expect(source).toContain("saved as links")
    expect(source).toContain("Push notifications are optional")
    expect(source).toContain("deactivated instead of deleted")
    expect(source).toContain("can be anonymized")
  })
})
