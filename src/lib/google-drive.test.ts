import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseGoogleDriveLink, toPreviewUrl } from "./google-drive";

const FILE_ID = "1AbC_def-GhijkLMNopQRstuVwxyz234";
const FOLDER_ID = "0BxyZ_folder-ID987654321";

const workLinksMigration = readFileSync(
  new URL(
    "../../supabase/migrations/20261017150000_task_work_links.sql",
    import.meta.url,
  ),
  "utf8",
);
const databasePatternSource = workLinksMigration.match(
  /select p_url ~\s*\n\s*'([^']+)'/,
)?.[1];
if (!databasePatternSource) {
  throw new Error("The task-work-link database URL pattern was not found.");
}
const databaseCanonicalUrlPattern = new RegExp(databasePatternSource);

describe("parseGoogleDriveLink", () => {
  it.each([
    `https://drive.google.com/file/d/${FILE_ID}/view`,
    `https://drive.google.com/file/d/${FILE_ID}/view?usp=sharing`,
    `https://drive.google.com/open?id=${FILE_ID}`,
  ])("parses a Drive file URL: %s", (url) => {
    expect(parseGoogleDriveLink(url)).toEqual({
      id: FILE_ID,
      type: "file",
      openUrl: `https://drive.google.com/file/d/${FILE_ID}/view`,
      previewUrl: `https://drive.google.com/file/d/${FILE_ID}/preview`,
    });
  });

  it("preserves a safe resource key in canonical file URLs", () => {
    expect(
      parseGoogleDriveLink(
        `https://drive.google.com/file/d/${FILE_ID}/view?usp=sharing&resourcekey=example-key_123`,
      ),
    ).toEqual({
      id: FILE_ID,
      type: "file",
      openUrl: `https://drive.google.com/file/d/${FILE_ID}/view?resourcekey=example-key_123`,
      previewUrl: `https://drive.google.com/file/d/${FILE_ID}/preview?resourcekey=example-key_123`,
    });
  });

  it.each([
    `https://drive.google.com/drive/folders/${FOLDER_ID}`,
    `https://drive.google.com/drive/u/0/folders/${FOLDER_ID}`,
  ])("parses a Drive folder URL: %s", (url) => {
    expect(parseGoogleDriveLink(url)).toEqual({
      id: FOLDER_ID,
      type: "folder",
      openUrl: `https://drive.google.com/drive/folders/${FOLDER_ID}`,
      previewUrl: null,
    });
  });

  it.each([
    ["document", "document", "GoogleDoc_ID123456789"],
    ["spreadsheets", "spreadsheet", "GoogleSheet_ID123456"],
    ["presentation", "presentation", "GoogleSlides_ID123456"],
  ] as const)("parses a Google %s URL", (resource, type, id) => {
    expect(
      parseGoogleDriveLink(`https://docs.google.com/${resource}/d/${id}/edit`),
    ).toEqual({
      id,
      type,
      openUrl: `https://docs.google.com/${resource}/d/${id}/edit`,
      previewUrl: `https://docs.google.com/${resource}/d/${id}/preview`,
    });
  });

  it.each([
    "http://drive.google.com/file/d/valid-looking-id/view",
    "javascript:alert(1)",
    "data:text/html,hello",
    "https://drive.google.com.evil.com/file/d/valid-looking-id/view",
    "https://evil.com/drive.google.com/file/d/valid-looking-id/view",
    "https://drive.google.com@evil.com/file/d/valid-looking-id/view",
    "https://evil.com@drive.google.com/file/d/valid-looking-id/view",
    "https://drive.google.com:444/file/d/valid-looking-id/view",
    "https://www.drive.google.com/file/d/valid-looking-id/view",
    "https://docs.google.com/forms/d/valid-looking-id/edit",
    "https://drive.google.com/open",
    `https://drive.google.com/file/d/${FILE_ID}/view/extra`,
    `https://docs.google.com/document/d/${FILE_ID}/edit/extra`,
    `https://drive.google.com/file/d/${FILE_ID}/view?resourcekey=%3Cscript%3E`,
    "https://drive.google.com/file/d/%2e%2e/view",
    "not a URL",
    "",
  ])("rejects an unsafe or malformed value: %s", (url) => {
    expect(parseGoogleDriveLink(url)).toBeNull();
    expect(toPreviewUrl(url)).toBeNull();
  });
});

describe("toPreviewUrl", () => {
  it("returns a canonical preview URL for a supported file", () => {
    expect(
      toPreviewUrl(
        `https://drive.google.com/file/d/${FILE_ID}/view?usp=sharing`,
      ),
    ).toBe(`https://drive.google.com/file/d/${FILE_ID}/preview`);
  });

  it("returns null for a folder because folders cannot be embedded", () => {
    expect(
      toPreviewUrl(`https://drive.google.com/drive/folders/${FOLDER_ID}`),
    ).toBeNull();
  });
});

describe("database canonical URL parity", () => {
  it.each([
    [
      "file",
      `https://drive.google.com/open?id=${FILE_ID}`,
      `https://drive.google.com/file/d/${FILE_ID}/view`,
    ],
    [
      "folder",
      `https://drive.google.com/drive/u/0/folders/${FOLDER_ID}`,
      `https://drive.google.com/drive/folders/${FOLDER_ID}`,
    ],
    [
      "document",
      "https://docs.google.com/document/d/GoogleDoc_ID123456789/edit",
      "https://docs.google.com/document/d/GoogleDoc_ID123456789/edit",
    ],
    [
      "spreadsheet",
      "https://docs.google.com/spreadsheets/d/GoogleSheet_ID123456/edit",
      "https://docs.google.com/spreadsheets/d/GoogleSheet_ID123456/edit",
    ],
    [
      "presentation",
      "https://docs.google.com/presentation/d/GoogleSlides_ID123456/edit",
      "https://docs.google.com/presentation/d/GoogleSlides_ID123456/edit",
    ],
  ])(
    "keeps the %s parser output inside the database canonical pattern",
    (_type, input, expectedOpenUrl) => {
      const parsed = parseGoogleDriveLink(input);
      expect(parsed?.openUrl).toBe(expectedOpenUrl);
      expect(databaseCanonicalUrlPattern.test(expectedOpenUrl)).toBe(true);
    },
  );

  it("keeps a canonical resource key inside the database pattern", () => {
    const parsed = parseGoogleDriveLink(
      `https://drive.google.com/file/d/${FILE_ID}/view?usp=sharing&resourcekey=key_123`,
    );
    expect(parsed?.openUrl).toBe(
      `https://drive.google.com/file/d/${FILE_ID}/view?resourcekey=key_123`,
    );
    expect(databaseCanonicalUrlPattern.test(parsed!.openUrl)).toBe(true);
  });

  it.each([
    `https://drive.google.com/open?id=${FILE_ID}`,
    `https://drive.google.com/drive/u/0/folders/${FOLDER_ID}`,
    `http://drive.google.com/file/d/${FILE_ID}/view`,
    `https://drive.google.com/file/d/${FILE_ID}/view?usp=sharing`,
  ])("keeps a noncanonical input outside the stored URL pattern: %s", (url) => {
    expect(databaseCanonicalUrlPattern.test(url)).toBe(false);
  });
});
