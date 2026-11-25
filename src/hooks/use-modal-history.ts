"use client"

import * as React from "react"

const MODAL_HISTORY_KEY = "__ceitConnectModal"
const MODAL_HISTORY_VERSION = 1
const DEFAULT_WAIT_MS = 300

type ModalMarker = {
  id: string
  version: number
}

type ModalRegistration = {
  kind: "modal" | "guard"
  isActive: () => boolean
  requestClose: () => void
}

type Waiter = {
  resolve: () => void
  timer: ReturnType<typeof setTimeout>
}

const registrations = new Map<string, ModalRegistration>()
const stack: string[] = []
const requestedClosures = new Set<string>()
const missingGuardMarkers = new Set<string>()
const waiters = new Set<Waiter>()

let listening = false
let traversalPending = false
let traversalTimer: ReturnType<typeof setTimeout> | null = null
let traversalId: string | null = null
let timedOutTraversalId: string | null = null
let recoveringLateTraversal = false

function getMarker(state: unknown): ModalMarker | null {
  if (!state || typeof state !== "object") return null

  const marker = (state as Record<string, unknown>)[MODAL_HISTORY_KEY]
  if (!marker || typeof marker !== "object") return null

  const { id, version } = marker as Partial<ModalMarker>
  return typeof id === "string" && version === MODAL_HISTORY_VERSION
    ? { id, version }
    : null
}

export function stripModalMarkerState(state: unknown): unknown {
  if (!state || typeof state !== "object" || !getMarker(state)) return state

  const nextState = { ...(state as Record<string, unknown>) }
  delete nextState[MODAL_HISTORY_KEY]
  return nextState
}

function stateWithMarker(id: string) {
  const currentState =
    window.history.state && typeof window.history.state === "object"
      ? window.history.state
      : {}

  return {
    ...currentState,
    [MODAL_HISTORY_KEY]: { id, version: MODAL_HISTORY_VERSION },
  }
}

function settleWaiters() {
  if (traversalPending || requestedClosures.size > 0) return

  for (const waiter of waiters) {
    clearTimeout(waiter.timer)
    waiter.resolve()
  }
  waiters.clear()
}

function clearTraversalTimer() {
  if (traversalTimer) clearTimeout(traversalTimer)
  traversalTimer = null
}

function discardTopMarkerInPlace(id: string) {
  try {
    if (getMarker(window.history.state)?.id === id) {
      window.history.replaceState(
        stripModalMarkerState(window.history.state),
        "",
        window.location.href,
      )
    }
  } catch {
    // History is an enhancement. Modal closing and navigation must still proceed.
  }
}

function finishTraversalWithoutPopstate(id: string) {
  if (!traversalPending || stack.at(-1) !== id) return

  traversalPending = false
  clearTraversalTimer()
  traversalId = null
  timedOutTraversalId = id
  requestedClosures.delete(id)
  settleWaiters()
}

function pushMarker(id: string) {
  try {
    window.history.pushState(stateWithMarker(id), "", window.location.href)
    stack.push(id)
    return true
  } catch {
    return false
  }
}

function restoreMarker(id: string) {
  try {
    window.history.pushState(stateWithMarker(id), "", window.location.href)
    return true
  } catch {
    return false
  }
}

function drainRequestedClosures() {
  if (traversalPending) return

  const id = stack.at(-1)
  if (!id || !requestedClosures.has(id)) {
    settleWaiters()
    return
  }

  traversalPending = true
  traversalId = id
  try {
    window.history.back()
    traversalTimer = setTimeout(
      () => finishTraversalWithoutPopstate(id),
      DEFAULT_WAIT_MS,
    )
  } catch {
    finishTraversalWithoutPopstate(id)
  }
}

function handlePopState() {
  if (recoveringLateTraversal) {
    if (getMarker(window.history.state)) {
      try {
        window.history.replaceState(
          stripModalMarkerState(window.history.state),
          "",
          window.location.href,
        )
        window.history.forward()
      } catch {
        recoveringLateTraversal = false
      }
    } else {
      recoveringLateTraversal = false
    }
    return
  }

  const id = stack.at(-1)
  if (!id) {
    const staleMarker = getMarker(window.history.state)
    if (staleMarker) discardTopMarkerInPlace(staleMarker.id)
    return
  }

  const registration = registrations.get(id)
  const requested = requestedClosures.has(id)
  if (registration?.kind === "guard" && !requested) {
    missingGuardMarkers.add(id)
    registration.requestClose()
    return
  }

  stack.pop()

  traversalPending = false
  clearTraversalTimer()
  traversalId = null

  if (timedOutTraversalId === id) {
    timedOutTraversalId = null
    requestedClosures.delete(id)
    recoveringLateTraversal = true
    try {
      window.history.forward()
    } catch {
      recoveringLateTraversal = false
    }
    return
  }

  requestedClosures.delete(id)

  if (!requested) registration?.requestClose()

  setTimeout(() => {
    if (
      registrations.get(id) === registration &&
      registration?.kind === "modal" &&
      registration?.isActive()
    ) {
      pushMarker(id)
    }
    const guardId = stack.at(-1)
    const guard = guardId ? registrations.get(guardId) : undefined
    if (
      guardId &&
      guard?.kind === "guard" &&
      guard.isActive() &&
      missingGuardMarkers.delete(guardId)
    ) {
      restoreMarker(guardId)
    }
    drainRequestedClosures()
  }, 0)
}

function ensureListening() {
  if (listening) return
  window.addEventListener("popstate", handlePopState)
  listening = true
}

function registerModal(id: string, registration: ModalRegistration) {
  registrations.set(id, registration)
  ensureListening()
  return () => {
    if (registrations.get(id) === registration) registrations.delete(id)
    if (registration.kind === "guard") {
      missingGuardMarkers.delete(id)
      const traversalStillOwnsMarker =
        traversalId === id || timedOutTraversalId === id
      if (!traversalStillOwnsMarker) {
        requestedClosures.delete(id)
        for (let index = stack.length - 1; index >= 0; index -= 1) {
          if (stack[index] === id) stack.splice(index, 1)
        }
        discardTopMarkerInPlace(id)
      }
      settleWaiters()
      return
    }
    queueMicrotask(() => {
      if (registrations.has(id)) return

      const traversalStillOwnsMarker =
        traversalId === id || timedOutTraversalId === id
      if (!traversalStillOwnsMarker) {
        requestedClosures.delete(id)
        for (let index = stack.length - 1; index >= 0; index -= 1) {
          if (stack[index] === id) stack.splice(index, 1)
        }
        discardTopMarkerInPlace(id)
      }
      settleWaiters()
    })
  }
}

function openModal(id: string) {
  if (stack.includes(id)) return

  const currentMarker = getMarker(window.history.state)
  if (currentMarker?.id === id) {
    stack.push(id)
    return
  }

  const topId = stack.at(-1)
  if (currentMarker && topId === currentMarker.id && !registrations.has(topId)) {
    try {
      window.history.replaceState(stateWithMarker(id), "", window.location.href)
      stack[stack.length - 1] = id
      return
    } catch {
      // Fall through to a normal marker push.
    }
  }

  pushMarker(id)
}

function requestModalClose(id: string) {
  if (!stack.includes(id)) return
  requestedClosures.add(id)
  drainRequestedClosures()
}

function noteModalClosed(id: string) {
  if (!stack.includes(id)) return
  requestedClosures.add(id)
  drainRequestedClosures()
}

export function waitForModalHistory(timeoutMs = DEFAULT_WAIT_MS) {
  if (!traversalPending && requestedClosures.size === 0) {
    return Promise.resolve()
  }

  return new Promise<void>((resolve) => {
    const waiter: Waiter = {
      resolve: () => {
        waiters.delete(waiter)
        resolve()
      },
      timer: setTimeout(() => {
        waiters.delete(waiter)
        resolve()
      }, timeoutMs),
    }
    waiters.add(waiter)
  })
}

export function getModalHistoryStackForTest() {
  return [...stack]
}

export async function closeModalAndWait(
  close: () => void,
  timeoutMs = DEFAULT_WAIT_MS,
) {
  const id = stack.at(-1)
  if (id) requestModalClose(id)
  try {
    close()
  } catch {
    return
  }
  await waitForModalHistory(timeoutMs)
}

export function useModalHistory<TDetails>(
  open: boolean,
  onOpenChange: ((open: boolean, details: TDetails) => void) | undefined,
  requestHistoryClose: () => void,
  enabled = true,
) {
  const reactId = React.useId()
  const id = `modal-${reactId}`
  const openRef = React.useRef(open)
  const enabledRef = React.useRef(enabled)
  const onOpenChangeRef = React.useRef(onOpenChange)
  const requestHistoryCloseRef = React.useRef(requestHistoryClose)

  React.useEffect(() => {
    openRef.current = open
    enabledRef.current = enabled
    onOpenChangeRef.current = onOpenChange
    requestHistoryCloseRef.current = requestHistoryClose
  }, [enabled, onOpenChange, open, requestHistoryClose])

  React.useEffect(() => {
    return registerModal(id, {
      kind: "modal",
      isActive: () => openRef.current && enabledRef.current,
      requestClose: () => requestHistoryCloseRef.current(),
    })
  }, [id])

  React.useEffect(() => {
    if (open && enabled) openModal(id)
    else noteModalClosed(id)
  }, [enabled, id, open])

  return React.useCallback(
    (nextOpen: boolean, details: TDetails) => {
      if (!nextOpen && enabled) requestModalClose(id)
      onOpenChangeRef.current?.(nextOpen, details)
    },
    [enabled, id],
  )
}

export function useBackNavigationGuard(
  enabled: boolean,
  onBackAttempt: () => void,
) {
  const reactId = React.useId()
  const id = `guard-${reactId}`
  const enabledRef = React.useRef(enabled)
  const releasedRef = React.useRef(false)
  const onBackAttemptRef = React.useRef(onBackAttempt)

  React.useEffect(() => {
    enabledRef.current = enabled
    onBackAttemptRef.current = onBackAttempt
    if (!enabled) releasedRef.current = false
  }, [enabled, onBackAttempt])

  React.useEffect(() => {
    return registerModal(id, {
      kind: "guard",
      isActive: () => enabledRef.current && !releasedRef.current,
      requestClose: () => onBackAttemptRef.current(),
    })
  }, [id])

  React.useEffect(() => {
    if (enabled && !releasedRef.current) openModal(id)
    else noteModalClosed(id)
  }, [enabled, id])

  return React.useCallback(async () => {
    if (releasedRef.current) {
      await waitForModalHistory()
      return
    }

    releasedRef.current = true
    if (missingGuardMarkers.delete(id)) {
      requestedClosures.delete(id)
      for (let index = stack.length - 1; index >= 0; index -= 1) {
        if (stack[index] === id) stack.splice(index, 1)
      }
      settleWaiters()
      return
    }

    requestModalClose(id)
    await waitForModalHistory()
  }, [id])
}

const phoneModalQuery = "(max-width: 639px)"

function subscribeToPhoneViewport(onChange: () => void) {
  const media = window.matchMedia(phoneModalQuery)
  media.addEventListener("change", onChange)
  return () => media.removeEventListener("change", onChange)
}

function getPhoneViewportSnapshot() {
  return window.matchMedia(phoneModalQuery).matches
}

export function useIsPhoneModalViewport() {
  return React.useSyncExternalStore(
    subscribeToPhoneViewport,
    getPhoneViewportSnapshot,
    () => false,
  )
}

if (typeof window !== "undefined") {
  const staleMarker = getMarker(window.history.state)
  if (staleMarker) {
    try {
      window.history.replaceState(
        stripModalMarkerState(window.history.state),
        "",
        window.location.href,
      )
    } catch {
      // Fail open: stale history metadata must never block app startup.
    }
  }
}
