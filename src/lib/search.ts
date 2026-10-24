export function preventSearchFormSubmission(event: {
  key: string;
  preventDefault: () => void;
}) {
  if (event.key === "Enter") event.preventDefault();
}
