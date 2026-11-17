// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { CurrentUser } from "@/lib/types"

const mocks = vi.hoisted(() => ({
  bestEffortPushSignOut: vi.fn(),
}))

vi.mock("@/components/navigation/navigation-provider", () => ({
  useNavigation: () => ({ pathname: "/home" }),
  useNavClick: (_href: string, afterNavigate?: () => void) => (event: MouseEvent) => {
    event.preventDefault()
    afterNavigate?.()
  },
}))

vi.mock("@/lib/push/push-sign-out", () => ({
  bestEffortPushSignOut: mocks.bestEffortPushSignOut,
}))

import { MobileNav } from "@/components/layout/mobile-nav"

const user: CurrentUser = {
  id: "user-a",
  name: "Council Member",
  role: "Member",
  committeeId: "committee-a",
  avatarUrl: null,
  passwordSet: true,
}

afterEach(() => {
  cleanup()
  document.querySelectorAll("[data-push-sign-out-submission]").forEach((form) => form.remove())
  vi.restoreAllMocks()
  mocks.bestEffortPushSignOut.mockReset()
})

describe("MobileNav More sheet", () => {
  it("keeps the real push-aware sign-out form mounted below Help until native POST begins", async () => {
    let finishCleanup: (() => void) | undefined
    mocks.bestEffortPushSignOut.mockReturnValue(new Promise<void>((resolve) => {
      finishCleanup = resolve
    }))
    const nativeSubmit = vi.spyOn(HTMLFormElement.prototype, "submit").mockImplementation(() => undefined)

    render(<MobileNav user={user} />)
    fireEvent.click(screen.getByRole("button", { name: "More" }))

    const sheet = await screen.findByRole("dialog")
    const help = screen.getByRole("link", { name: "Help" })
    const signOut = screen.getByRole("button", { name: "Sign out" })
    const form = signOut.closest("form")

    expect(help.compareDocumentPosition(signOut) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(signOut.className).toContain("min-h-11")
    expect(form?.getAttribute("action")).toBe("/auth/signout")
    expect(form?.getAttribute("method")).toBe("post")

    fireEvent.click(signOut)

    expect(mocks.bestEffortPushSignOut).toHaveBeenCalledWith("user-a")
    expect(form?.getAttribute("aria-busy")).toBe("true")
    expect(sheet.isConnected).toBe(true)
    expect(screen.getByRole("dialog")).toBe(sheet)
    expect(nativeSubmit).not.toHaveBeenCalled()

    finishCleanup?.()
    await waitFor(() => expect(nativeSubmit).toHaveBeenCalledOnce())
  })
})
