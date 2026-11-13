import type { Committee, CommitteeSlug } from "@/lib/types";

export const PRESIDENT_COMMITTEE_KEY: CommitteeSlug = "President";

export function isPresidentCommittee(
  committee: Pick<Committee, "name">,
) {
  return committee.name === PRESIDENT_COMMITTEE_KEY;
}

export function getMemberCommitteeChoices<
  TCommittee extends Pick<Committee, "name">,
>(committees: readonly TCommittee[]) {
  return committees.filter((committee) => !isPresidentCommittee(committee));
}
