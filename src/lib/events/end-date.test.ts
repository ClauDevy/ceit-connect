import { describe, expect, it } from "vitest";
import { activeEventEndDateError } from "./end-date";
import { getEventSaveErrorMessage } from "./save-error";

describe("Active event end-date validation", () => {
  it("blocks only clearing an existing Active end date", () => {
    expect(activeEventEndDateError({ initialStatus: "Active", initialEndDate: "2026-11-10", nextEndDate: "" }))
      .toBe("Active events need an end date. Choose an end date and try again.");
    expect(activeEventEndDateError({ initialStatus: "Active", initialEndDate: "", nextEndDate: "" })).toBeNull();
    expect(activeEventEndDateError({ initialStatus: "Draft", initialEndDate: "", nextEndDate: "" })).toBeNull();
    expect(activeEventEndDateError({ initialStatus: "Active", initialEndDate: "", nextEndDate: "2026-11-10" })).toBeNull();
  });

  it("keeps CCD06 as the database-authority fallback", () => {
    expect(getEventSaveErrorMessage({ code: "CCD06", message: "private database text" }))
      .toBe("Active events need an end date. Choose an end date and try again.");
  });
});
