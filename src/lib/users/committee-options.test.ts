import { describe, expect, it } from "vitest";
import {
  getMemberCommitteeChoices,
  isPresidentCommittee,
  PRESIDENT_COMMITTEE_KEY,
} from "./committee-options";

const committees = [
  { id: "president-id", name: "President" },
  { id: "cia-id", name: "CIA" },
  { id: "copr-id", name: "COPR" },
];

describe("member committee choices", () => {
  it("uses the canonical President lookup key", () => {
    expect(PRESIDENT_COMMITTEE_KEY).toBe("President");
    expect(isPresidentCommittee(committees[0])).toBe(true);
    expect(isPresidentCommittee(committees[1])).toBe(false);
  });

  it("excludes President while preserving every normal committee in order", () => {
    expect(getMemberCommitteeChoices(committees)).toEqual([
      committees[1],
      committees[2],
    ]);
  });
});
