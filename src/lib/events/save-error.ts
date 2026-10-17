type SupabaseSaveError = {
  code?: string;
  message: string;
};

export function getEventSaveErrorMessage(error: SupabaseSaveError) {
  if (error.code === "40P01") {
    return "Another task change happened at the same time. Please try saving again.";
  }

  return error.message;
}
