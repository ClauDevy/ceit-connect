import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { LoginTermsLink } from "@/components/auth/login-terms-link"

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8")

describe("login Terms link", () => {
  it("is a plain normal-flow link wired only into the sign-in panel", () => {
    const html = renderToStaticMarkup(<LoginTermsLink />)
    const component = read("src/components/auth/login-terms-link.tsx")
    const panel = read("src/components/auth/sign-in-panel.tsx")
    const footer = read("src/components/auth/login-footer.tsx")

    expect(html).toContain('href="/terms"')
    expect(html).toContain("Terms of Service")
    expect(component).not.toMatch(/\b(?:fixed|sticky|overflow|min-h|h-svh|h-dvh|h-lvh)\b/)
    expect(panel).toContain("<LoginTermsLink />")
    expect(panel.indexOf("<LoginTermsLink />")).toBeGreaterThan(panel.indexOf("<GoogleButton"))
    expect(footer).not.toContain("LoginTermsLink")
    expect(footer).not.toContain('href="/terms"')
  })
})
