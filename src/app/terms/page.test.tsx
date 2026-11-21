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
  it("renders without a session as a final document with the sign-in back link", async () => {
    const html = renderToStaticMarkup(await TermsPage())

    expect(html).toContain("Terms of Service")
    expect(html).toContain("Effective November 20, 2026")
    expect(html).toContain("The short version")
    expect(html).toContain('href="/login"')
    expect(html).toContain("Back to sign in")
    expect(html).toContain('href="/privacy"')
    expect(html).toContain("cvsu.ceitsc@gmail.com")
    expect(html).toContain("Department of Information Technology (DIT), 2nd floor")
  })

  it("is no longer a draft and has no placeholders", async () => {
    const html = renderToStaticMarkup(await TermsPage())
    const source = readFileSync(resolve(process.cwd(), "src/app/terms/page.tsx"), "utf8")

    expect(html).not.toContain("Draft version")
    expect(html).not.toContain("to be confirmed")
    expect(source).not.toMatch(/\[[^\]]+to be confirmed\]/)
  })

  it("uses only the back link to reflect a valid signed-in user", async () => {
    mocks.getUser.mockResolvedValueOnce({ data: { user: { id: "user-a" } }, error: null })

    const html = renderToStaticMarkup(await TermsPage())

    expect(html).toContain('href="/home"')
    expect(html).toContain("Back to home")
    expect(html).not.toContain('href="/login"')
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

  it("keeps the copy inside its factual boundary", () => {
    const source = readFileSync(resolve(process.cwd(), "src/app/terms/page.tsx"), "utf8")

    expect(source).not.toContain("requireUser")
    expect(source).toContain("invite-only workspace")
    expect(source).toContain("email link,")
    expect(source).toContain("saved as links")
    expect(source).toContain("Push")
    expect(source).toContain("deactivated instead of deleted")
    expect(source).toContain("can be anonymized")
  })
})
