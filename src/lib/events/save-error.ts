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

  return error.message;
}
