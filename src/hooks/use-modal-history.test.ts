import { describe, expect, it } from "vitest"

import { stripModalMarkerState } from "@/hooks/use-modal-history"

describe("modal history state", () => {
  it("strips only its stale marker and keeps framework-owned state", () => {
    const state = {
      __NA: true,
      __PRIVATE_NEXTJS_INTERNALS_TREE: ["", {}],
      __ceitConnectModal: { id: "modal-1", version: 1 },
      ownerValue: "kept",
    }

    expect(stripModalMarkerState(state)).toEqual({
      __NA: true,
      __PRIVATE_NEXTJS_INTERNALS_TREE: ["", {}],
      ownerValue: "kept",
    })
  })

  it("leaves unrelated history state unchanged", () => {
    const state = { __NA: true, ownerValue: "kept" }
    expect(stripModalMarkerState(state)).toBe(state)
  })
})
