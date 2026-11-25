// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import * as React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog"
import { ConfirmDialog } from "@/components/shared/confirm-dialog"
import {
  closeModalAndWait,
  getModalHistoryStackForTest,
  useBackNavigationGuard,
} from "@/hooks/use-modal-history"

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

  it("keeps a parent modal open while recovering a timed-out child traversal", async () => {
    const parentChanges = vi.fn()
    const back = vi.spyOn(window.history, "back").mockImplementation(() => undefined)
    vi.spyOn(window.history, "forward").mockImplementation(() => undefined)

    function Harness() {
      const [parentOpen, setParentOpen] = React.useState(true)
      const [childOpen, setChildOpen] = React.useState(true)

      return (
        <Dialog
          open={parentOpen}
          onOpenChange={(open) => {
            parentChanges(open)
            setParentOpen(open)
          }}
        >
          <DialogContent>
            <DialogTitle>Parent modal</DialogTitle>
            {childOpen ? (
              <Dialog open onOpenChange={setChildOpen}>
                <DialogContent>
                  <DialogTitle>Child modal</DialogTitle>
                  <button
                    type="button"
                    onClick={() => void closeModalAndWait(() => setChildOpen(false))}
                  >
                    Close child
                  </button>
                </DialogContent>
              </Dialog>
            ) : null}
          </DialogContent>
        </Dialog>
      )
    }

    render(<Harness />)
    await screen.findByText("Child modal")
    fireEvent.click(screen.getByText("Close child"))

    expect(back).toHaveBeenCalledOnce()
    await new Promise((resolve) => setTimeout(resolve, 320))

    window.dispatchEvent(new PopStateEvent("popstate"))
    window.dispatchEvent(new PopStateEvent("popstate"))
    window.dispatchEvent(new PopStateEvent("popstate"))
    await Promise.resolve()

    expect(parentChanges).not.toHaveBeenCalledWith(false)
    expect(screen.getByText("Parent modal")).toBeTruthy()
  })

  it("closes a modal before asking a dirty form whether to leave", async () => {
    function Harness() {
      const [modalOpen, setModalOpen] = React.useState(false)
      const [confirmOpen, setConfirmOpen] = React.useState(false)
      useBackNavigationGuard(true, () => setConfirmOpen(true))
      return (
        <>
          <button type="button" onClick={() => setModalOpen(true)}>Open task</button>
          <Dialog open={modalOpen} onOpenChange={setModalOpen}>
            <DialogContent><DialogTitle>Task editor</DialogTitle></DialogContent>
          </Dialog>
          <ConfirmDialog
            open={confirmOpen}
            onOpenChange={setConfirmOpen}
            title="Discard unsaved changes?"
            description="Your changes have not been saved."
            cancelLabel="Keep editing"
            confirmLabel="Discard changes"
            onConfirm={() => undefined}
          />
        </>
      )
    }

    render(<Harness />)
    fireEvent.click(screen.getByText("Open task"))
    await screen.findByText("Task editor")

    window.dispatchEvent(new PopStateEvent("popstate"))
    await waitFor(() => expect(screen.queryByText("Task editor")).toBeNull())
    expect(screen.queryByText("Discard unsaved changes?")).toBeNull()

    window.dispatchEvent(new PopStateEvent("popstate"))
    await screen.findByText("Discard unsaved changes?")
  })

  it("repeats Back and Keep editing without growing history", async () => {
    function Harness() {
      const [confirmOpen, setConfirmOpen] = React.useState(false)
      useBackNavigationGuard(true, () => setConfirmOpen(true))
      return (
        <ConfirmDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          title="Discard unsaved changes?"
          description="Your changes have not been saved."
          cancelLabel="Keep editing"
          confirmLabel="Discard changes"
          onConfirm={() => undefined}
        />
      )
    }

    render(<Harness />)
    await waitFor(() => expect(window.history.state?.__ceitConnectModal).toBeTruthy())
    const guardId = window.history.state.__ceitConnectModal.id
    const initialLength = window.history.length

    for (let attempt = 0; attempt < 3; attempt += 1) {
      window.history.back()
      await screen.findByText("Discard unsaved changes?")
      fireEvent.click(screen.getByText("Keep editing"))
      await waitFor(() => {
        expect(screen.queryByText("Discard unsaved changes?")).toBeNull()
        expect(window.history.state?.__ceitConnectModal).toBeTruthy()
      })
      expect(window.history.length).toBe(initialLength)
      expect(getModalHistoryStackForTest().filter((id) => id === guardId)).toHaveLength(1)
      expect(new Set(getModalHistoryStackForTest()).size).toBe(
        getModalHistoryStackForTest().length,
      )
    }
  })

  it("strips a dirty guard on unmount without navigating Back", async () => {
    const back = vi.spyOn(window.history, "back")
    function Harness() {
      useBackNavigationGuard(true, () => undefined)
      return null
    }

    const view = render(<Harness />)
    await waitFor(() => expect(window.history.state?.__ceitConnectModal).toBeTruthy())
    view.unmount()

    expect(back).not.toHaveBeenCalled()
    expect(window.history.state?.__ceitConnectModal).toBeUndefined()
  })
})
