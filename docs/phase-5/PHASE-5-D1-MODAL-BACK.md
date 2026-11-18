# Phase 5 — Batch D1: modal Back handling

Batch D1 gives every shared `Dialog`, `Sheet`, and `AlertDialog` one temporary browser-history marker while open. Browser Back closes the top modal first; nested modals unwind one at a time. Closing through X, Cancel, an action, or a navigation handoff removes the same marker. The phone-only Priority filter uses the same behavior; desktop popovers and other non-modal menus, selects, tooltips, and filters remain unchanged.

The marker is merged into the existing Next.js history state. A stale marker found after refresh is stripped with `replaceState` without navigating. Navigation handoffs wait at most about 300 ms, so history support cannot trap sign-out or another intended navigation. Busy dialogs reject Back dismissal and immediately re-arm their marker.

## Real-phone checklist

- Open each task dialog/sheet, confirmation dialog, picker, mobile notification sheet, More sheet, and phone Priority filter; swipe Back and confirm only the top surface closes.
- Open a nested confirmation and confirm successive Back gestures close one modal at a time, then navigate the page.
- Close surfaces with X, Cancel, backdrop, and their successful action; press Back afterward and confirm there is no extra same-page stop.
- From notification and More links, sign-out, event archive, admin step-down, and Backlog-to-Edit flows, confirm the intended navigation still completes after the modal closes.
- While a modal action is busy, swipe Back and confirm the modal and page remain in place; retry after completion.
- Refresh while a modal is open, then press Back; confirm there is no unexpected history jump.
- Confirm desktop notification/Priority popovers, committee filter, selects, dropdowns, and tooltips keep their existing dismissal and add no Back step.

Event-form unsaved-work protection and scroll restoration are intentionally deferred to later Batch D work.
