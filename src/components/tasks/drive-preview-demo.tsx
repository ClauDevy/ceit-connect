"use client";

import { useState } from "react";
import {
  YourWorkCard,
  type NewWorkLink,
  type WorkLink,
} from "@/components/tasks/your-work-card";
import { Button } from "@/components/ui/button";

const MOCK_LINKS: WorkLink[] = [
  {
    id: "mock-drive-file",
    name: "Mock event brief",
    url: "https://drive.google.com/file/d/MockDriveFileId_123456789/view",
  },
  {
    id: "mock-drive-folder",
    url: "https://drive.google.com/drive/folders/MockDriveFolderId_123456",
  },
];

export function DrivePreviewDemo() {
  const [links, setLinks] = useState<WorkLink[]>(MOCK_LINKS);
  const [isAssignee, setIsAssignee] = useState(true);

  function addLink(link: NewWorkLink) {
    setLinks((current) => [
      ...current,
      { id: `mock-${current.length + 1}`, ...link },
    ]);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-3">
        <p className="text-sm text-muted-foreground">
          Mock role: {isAssignee ? "task assignee" : "task viewer"}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setIsAssignee((current) => !current)}
        >
          View as {isAssignee ? "viewer" : "assignee"}
        </Button>
      </div>
      <YourWorkCard links={links} isAssignee={isAssignee} onAddLink={addLink} />
    </div>
  );
}
