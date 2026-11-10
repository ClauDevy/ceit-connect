// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"

const mocks = vi.hoisted(() => ({ bestEffortPushSignOut: vi.fn() }))
vi.mock("@/lib/push/push-sign-out", () => ({
  bestEffortPushSignOut: mocks.bestEffortPushSignOut,
}))

import { PushAwareSignOutForm } from "@/components/layout/push-aware-sign-out-form"

afterEach(() => {
  cleanup()
  document.querySelectorAll("[data-push-sign-out-submission]").forEach((form) => form.remove())
  vi.restoreAllMocks()
  mocks.bestEffortPushSignOut.mockReset()
})

describe("PushAwareSignOutForm", () => {
  it("prevents a second submit during cleanup and submits the form only once afterward", async () => {
    let finishCleanup: (() => void) | undefined
    mocks.bestEffortPushSignOut.mockReturnValue(new Promise<void>((resolve) => {
      finishCleanup = resolve
    }))
    const submit = vi.spyOn(HTMLFormElement.prototype, "submit").mockImplementation(() => undefined)
    const { container } = render(
      <PushAwareSignOutForm userId="user-a">
        <button type="submit">Sign out</button>
      </PushAwareSignOutForm>,
    )
    const form = container.querySelector("form")!

    expect(fireEvent.submit(form)).toBe(false)
    expect(fireEvent.submit(form)).toBe(false)
    expect(mocks.bestEffortPushSignOut).toHaveBeenCalledOnce()
    expect(submit).not.toHaveBeenCalled()

    finishCleanup?.()
    await waitFor(() => expect(submit).toHaveBeenCalledOnce())
    expect(mocks.bestEffortPushSignOut).toHaveBeenCalledOnce()
  })

  it("disables an icon-only submit control without replacing its content", async () => {
    let finishCleanup: (() => void) | undefined
    mocks.bestEffortPushSignOut.mockReturnValue(new Promise<void>((resolve) => {
      finishCleanup = resolve
    }))
    const submit = vi.spyOn(HTMLFormElement.prototype, "submit").mockImplementation(() => undefined)
    const { container } = render(
      <PushAwareSignOutForm userId="user-a">
        <button type="submit" aria-label="Sign out">
          <svg data-testid="sign-out-icon" />
        </button>
      </PushAwareSignOutForm>,
    )
    const form = container.querySelector("form")!

    fireEvent.submit(form)

    expect((screen.getByRole("button", { name: "Sign out" }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByTestId("sign-out-icon")).toBeTruthy()
    expect(screen.getByRole("status").textContent).toBe("Signing out…")
    finishCleanup?.()
    await waitFor(() => expect(submit).toHaveBeenCalledOnce())
  })

  it("uses a connected native POST form if the menu form unmounts during cleanup", async () => {
    let finishCleanup: (() => void) | undefined
    mocks.bestEffortPushSignOut.mockReturnValue(new Promise<void>((resolve) => {
      finishCleanup = resolve
    }))
    let submittedAction: string | null = null
    let submittedConnected = false
    let submittedMethod = ""
    const submit = vi.spyOn(HTMLFormElement.prototype, "submit").mockImplementation(function (this: HTMLFormElement) {
      submittedAction = this.getAttribute("action")
      submittedConnected = this.isConnected
      submittedMethod = this.method
    })
    const { container, unmount } = render(
      <PushAwareSignOutForm userId="user-a">
        <button type="submit">Sign out</button>
      </PushAwareSignOutForm>,
    )
    const form = container.querySelector("form")!

    fireEvent.submit(form)
    expect(form.getAttribute("aria-busy")).toBe("true")
    const status = screen.getByRole("status")
    expect(status.textContent).toBe("Signing out…")
    expect(form.contains(status)).toBe(false)
    unmount()
    finishCleanup?.()

    await waitFor(() => expect(submit).toHaveBeenCalledOnce())
    expect(submittedConnected).toBe(true)
    expect(submittedMethod).toBe("post")
    expect(submittedAction).toBe("/auth/signout")
  })

  it("submits and releases its guard even when device cleanup rejects", async () => {
    mocks.bestEffortPushSignOut.mockRejectedValue(new Error("storage unavailable"))
    const submit = vi.spyOn(HTMLFormElement.prototype, "submit").mockImplementation(() => undefined)
    const { container } = render(
      <PushAwareSignOutForm userId="user-a">
        <button type="submit">Sign out</button>
      </PushAwareSignOutForm>,
    )
    const form = container.querySelector("form")!

    fireEvent.submit(form)
    await waitFor(() => expect(submit).toHaveBeenCalledOnce())

    fireEvent.submit(form)
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(2))
    expect(mocks.bestEffortPushSignOut).toHaveBeenCalledTimes(2)
  })
})
