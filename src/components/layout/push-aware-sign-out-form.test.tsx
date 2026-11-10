// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react"

const mocks = vi.hoisted(() => ({ bestEffortPushSignOut: vi.fn() }))
vi.mock("@/lib/push/push-sign-out", () => ({
  bestEffortPushSignOut: mocks.bestEffortPushSignOut,
}))

import { PushAwareSignOutForm } from "@/components/layout/push-aware-sign-out-form"

afterEach(() => {
  cleanup()
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
