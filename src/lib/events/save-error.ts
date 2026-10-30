type SupabaseSaveError = {
  code?: string;
  message: string;
};

export function getEventSaveErrorMessage(error: SupabaseSaveError) {
  if (error.code === "CCD01") {
    return "This creator already has 10 Draft events. Launch, archive, or delete a Draft before saving another.";
  }
  if (error.code === "40P01") {
    return "Another task change happened at the same time. Please try saving again.";
  }
  if (error.code === "CCP01") {
    return "This event already has the maximum of 200 tasks.";
  }
  if (error.code === "CCT01") {
    return "Only an active Co-Admin can create an event from an Archived template.";
  }
  if (error.code === "CCT02") {
    return "The Archived template is unavailable.";
  }
  if (error.code === "CCT03") {
    return "The template task selection is invalid.";
  }

  return error.message;
}
