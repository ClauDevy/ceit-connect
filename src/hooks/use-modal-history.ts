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
  isOpen: () => boolean
  requestClose: () => void
}

type Waiter = {
  resolve: () => void
  timer: ReturnType<typeof setTimeout>
}

const registrations = new Map<string, ModalRegistration>()
const stack: string[] = []
const requestedClosures = new Set<string>()
const waiters = new Set<Waiter>()

let listening = false
let traversalPending = false
let traversalTimer: ReturnType<typeof setTimeout> | null = null

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
  discardTopMarkerInPlace(id)
  stack.pop()
  requestedClosures.delete(id)
  if (registrations.get(id)?.isOpen()) pushMarker(id)
  drainRequestedClosures()
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

function drainRequestedClosures() {
  if (traversalPending) return

  const id = stack.at(-1)
  if (!id || !requestedClosures.has(id)) {
    settleWaiters()
    return
  }

  traversalPending = true
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
  const id = stack.pop()
  if (!id) return

  traversalPending = false
  clearTraversalTimer()

  const requested = requestedClosures.delete(id)
  const registration = registrations.get(id)

  if (!requested) registration?.requestClose()

  setTimeout(() => {
    if (registration?.isOpen()) pushMarker(id)
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

export async function closeModalAndWait(
  close: () => void,
  timeoutMs = DEFAULT_WAIT_MS,
) {
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
  enabled = true,
) {
  const reactId = React.useId()
  const id = `modal-${reactId}`
  const openRef = React.useRef(open)
  const onOpenChangeRef = React.useRef(onOpenChange)

  React.useEffect(() => {
    openRef.current = open
    onOpenChangeRef.current = onOpenChange
  }, [onOpenChange, open])

  React.useEffect(() => {
    return registerModal(id, {
      isOpen: () => openRef.current,
      requestClose: () => onOpenChangeRef.current?.(false, {} as TDetails),
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
