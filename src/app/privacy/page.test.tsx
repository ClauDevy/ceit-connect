import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ getUser: vi.fn() }))
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: { getUser: mocks.getUser } })),
}))

import PrivacyPage from "./page"

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getUser.mockResolvedValue({ data: { user: null }, error: null })
})

describe("public Privacy Policy page", () => {
  it("renders without a session with the key policy sections", async () => {
    const html = renderToStaticMarkup(await PrivacyPage())

    expect(html).toContain("Privacy Policy")
    expect(html).toContain("Data Privacy Act of 2012")
    expect(html).toContain("What we collect")
    expect(html).toContain("How long we keep it")
    expect(html).toContain("Your rights")
    expect(html).toContain("National Privacy Commission")
    expect(html).toContain("cvsu.ceitsc@gmail.com")
    expect(html).toContain('href="/terms"')
    expect(html).toContain('href="/login"')
    expect(html).toContain("Back to sign in")
  })

  it("shows a home link for a signed-in user and falls back to sign-in on auth errors", async () => {
    mocks.getUser.mockResolvedValueOnce({ data: { user: { id: "user-a" } }, error: null })
    expect(renderToStaticMarkup(await PrivacyPage())).toContain("Back to home")

    mocks.getUser.mockRejectedValueOnce(new Error("unavailable"))
    const html = renderToStaticMarkup(await PrivacyPage())
    expect(html).toContain("Back to sign in")
    expect(html).not.toContain("Back to home")
  })

  it("does not require a session and has no placeholders", () => {
    const source = readFileSync(resolve(process.cwd(), "src/app/privacy/page.tsx"), "utf8")

    expect(source).not.toContain("requireUser")
    expect(source).not.toMatch(/to be confirmed|TODO|lorem/i)
  })
})
