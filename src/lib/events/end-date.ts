export function activeEventEndDateError({
  initialStatus,
  initialEndDate,
  nextEndDate,
}: {
  initialStatus: "Draft" | "Active" | undefined;
  initialEndDate: string | undefined;
  nextEndDate: string;
}) {
  return initialStatus === "Active" &&
    Boolean(initialEndDate) &&
    nextEndDate.length === 0
      ? "Active events need an end date. Choose an end date and try again."
      : null;
}
