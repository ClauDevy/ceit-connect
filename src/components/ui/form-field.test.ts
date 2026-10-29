import { describe, expect, it } from "vitest"
import { getFormFieldControlProps } from "./form-field"

describe("getFormFieldControlProps", () => {
  it("returns only DOM-safe single-control keys", () => {
    const props = getFormFieldControlProps({
      id: "field-id",
      labelTarget: "control",
      labelId: "field-label",
      describedBy: "field-message",
    })

    expect(Object.keys(props)).toEqual(["id", "aria-describedby"])
    expect(props).toEqual({
      id: "field-id",
      "aria-describedby": "field-message",
    })
  })

  it("returns the label reference as aria-labelledby for groups", () => {
    const props = getFormFieldControlProps({
      id: "group-id",
      labelTarget: "group",
      labelId: "group-label",
      describedBy: "group-message",
    })

    expect(Object.keys(props)).toEqual([
      "id",
      "aria-labelledby",
      "aria-describedby",
    ])
    expect(props).toEqual({
      id: "group-id",
      "aria-labelledby": "group-label",
      "aria-describedby": "group-message",
    })
  })
})
