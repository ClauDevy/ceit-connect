// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import * as React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog"
import { closeModalAndWait } from "@/hooks/use-modal-history"

afterEach(async () => {
  cleanup()
  await Promise.resolve()
  vi.restoreAllMocks()
})

describe("modal history integration", () => {
  it("uses Base UI change details and keeps a canceled uncontrolled close open", async () => {
    const changes: Array<{ open: boolean; reason: string }> = []

    render(
      <Dialog
        defaultOpen
        onOpenChange={(open, details) => {
          changes.push({ open, reason: details.reason })
          if (!open) details.cancel()
        }}
      >
        <DialogContent>
          <DialogTitle>History test</DialogTitle>
        </DialogContent>
      </Dialog>,
    )

    await screen.findByRole("dialog")
    window.dispatchEvent(new PopStateEvent("popstate"))

    await waitFor(() => {
      expect(changes).toContainEqual({
        open: false,
        reason: "imperative-action",
      })
    })
    expect(screen.getByRole("dialog")).toBeTruthy()
  })

  it("registers a direct controlled close before a navigation handoff waits", async () => {
    const navigated = vi.fn()
    const back = vi.spyOn(window.history, "back").mockImplementation(() => undefined)

    function Harness() {
      const [open, setOpen] = React.useState(true)
      return (
        <>
          {open ? (
            <Dialog open onOpenChange={setOpen}>
              <DialogContent>
                <DialogTitle>Navigation test</DialogTitle>
              </DialogContent>
            </Dialog>
          ) : null}
          <button
            type="button"
            onClick={() => {
              void closeModalAndWait(() => setOpen(false)).then(navigated)
            }}
          >
            Continue
          </button>
        </>
      )
    }

    render(<Harness />)
    await screen.findByRole("dialog")
    fireEvent.click(screen.getByText("Continue"))

    expect(back).toHaveBeenCalledOnce()
    expect(navigated).not.toHaveBeenCalled()

    window.dispatchEvent(new PopStateEvent("popstate"))
    await waitFor(() => expect(navigated).toHaveBeenCalledOnce())
  })
})
