// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ImportantEmailControl } from "./important-email-control";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ rpc: mocks.rpc }),
}));

beforeEach(() => vi.clearAllMocks());

describe("ImportantEmailControl", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows a safe message and no toggle when unavailable", () => {
    render(<ImportantEmailControl available={false} initialEnabled />);
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.getByText(/temporarily unavailable/i)).toBeTruthy();
  });

  it("has an accessible default-on toggle and reduced-motion fallback", () => {
    render(<ImportantEmailControl available initialEnabled />);
    const toggle = screen.getByLabelText("Email me about important updates");
    expect(toggle).toHaveProperty("checked", true);
    expect(toggle.className).toContain("motion-reduce:transition-none");
  });

  it("settles success and restores the prior value after failure", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: false, error: null });
    render(<ImportantEmailControl available initialEnabled />);
    const toggle = screen.getByLabelText("Email me about important updates") as HTMLInputElement;
    fireEvent.click(toggle);
    await screen.findByText("Important emails are off.");
    expect(toggle.checked).toBe(false);

    mocks.rpc.mockRejectedValueOnce(new Error("network"));
    fireEvent.click(toggle);
    await screen.findByText(/couldn’t update/i);
    await waitFor(() => expect(toggle.disabled).toBe(false));
    expect(toggle.checked).toBe(false);
  });
});
