// SPDX-License-Identifier: GPL-3.0
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DashboardScreen } from "@/components/dashboard/DashboardScreen";
import { useAppStore, useScanStore } from "@/stores";
import type { Project } from "@/types";

const mocks = vi.hoisted(() => ({ scanLibrary: vi.fn() }));

vi.mock("@/lib/ipc", () => ({
  ipc: {
    scanLibrary: mocks.scanLibrary,
    getProject:  vi.fn(),
  },
}));

const project = {
  id: "p", name: "Library", libraryRoots: ["Z:\\Gone"], targetFrontends: ["retrobat"],
  emulatorPrefs: {}, createdAt: "",
  scanStats: { totalFiles: 21, classified: 20, blockingIssues: 0, errors: 0, warnings: 0, advisories: 0 },
} as Project;

function showScreen() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><DashboardScreen /></QueryClientProvider>);
}

describe("DashboardScreen", () => {
  beforeEach(() => {
    useAppStore.setState({ activeProject: project });
    useScanStore.setState({ isScanning: false, progress: null });
    mocks.scanLibrary.mockReset();
  });
  afterEach(cleanup);

  it("says why a scan failed and that results may be old", async () => {
    mocks.scanLibrary.mockRejectedValue("Couldn't read Z:\\Gone: not found");
    showScreen();
    fireEvent.click(screen.getByRole("button", { name: /Re-scan Library/ }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Couldn't read Z:\\Gone"));
    expect(screen.getByRole("alert").textContent).toContain("may be out of date");
    expect(screen.getByText("21")).toBeTruthy();
    expect(useScanStore.getState().isScanning).toBe(false);
  });

  it("doesn't show counts the scan can't produce", () => {
    showScreen();
    expect(screen.queryByText("Blocking")).toBeNull();
    expect(screen.queryByText("Errors")).toBeNull();
    expect(screen.queryByText("Warnings")).toBeNull();
    expect(screen.getByText("Total Files")).toBeTruthy();
  });
});
