// SPDX-License-Identifier: GPL-3.0
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DashboardScreen } from "@/components/dashboard/DashboardScreen";
import { useAppStore, useScanStore } from "@/stores";
import type { Project } from "@/types";

const PROJECT = { id: "p", name: "Test", libraryRoots: ["/roms"], targetFrontends: [], emulatorPrefs: {}, createdAt: "" } as Project;

const mocks = vi.hoisted(() => ({ scanLibrary: vi.fn(), getProject: vi.fn() }));
vi.mock("@/lib/ipc", () => ({ ipc: mocks }));

function renderDashboard() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <DashboardScreen />
    </QueryClientProvider>
  );
}

/** Starts a scan and returns the handles that end it. */
function startScan() {
  let finish!: () => void;
  let fail!: (e: Error) => void;
  mocks.scanLibrary.mockReturnValue(new Promise<void>((res, rej) => { finish = res; fail = rej; }));
  const view = renderDashboard();
  fireEvent.click(screen.getAllByRole("button", { name: /scan/i })[0]);
  return { view, finish: () => finish(), fail: (e: Error) => fail(e) };
}

describe("Dashboard scan and the companion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getProject.mockResolvedValue(PROJECT);
    useAppStore.setState({ screen: "dashboard", romioState: "idle", activeProject: PROJECT });
    useScanStore.setState({ isScanning: false, progress: null, scanError: null });
  });
  afterEach(cleanup);

  it("shows processing during a scan and nothing left running when it ends", async () => {
    const { finish } = startScan();
    await waitFor(() => expect(useAppStore.getState().romioState).toBe("processing"));
    finish();
    await waitFor(() => expect(useAppStore.getState().romioState).toBe("idle"));
  });

  it("doesn't overwrite another screen's warning when the scan finishes", async () => {
    const { view, finish } = startScan();
    await waitFor(() => expect(useScanStore.getState().isScanning).toBe(true));

    view.unmount();
    useAppStore.setState({ screen: "saves", romioState: "difficult_save" });
    finish();

    await waitFor(() => expect(useScanStore.getState().isScanning).toBe(false));
    expect(useAppStore.getState().romioState).toBe("difficult_save");
  });

  it("doesn't overwrite another screen's warning when the scan fails", async () => {
    const { view, fail } = startScan();
    await waitFor(() => expect(useScanStore.getState().isScanning).toBe(true));

    view.unmount();
    useAppStore.setState({ screen: "saves", romioState: "difficult_save" });
    fail(new Error("unreadable"));

    await waitFor(() => expect(useScanStore.getState().isScanning).toBe(false));
    expect(useAppStore.getState().romioState).toBe("difficult_save");
  });

  it("still reports a failed scan if you were away when it failed", async () => {
    const { view, fail } = startScan();
    await waitFor(() => expect(useScanStore.getState().isScanning).toBe(true));

    view.unmount();
    fail(new Error("unreadable"));
    await waitFor(() => expect(useScanStore.getState().isScanning).toBe(false));

    renderDashboard();
    expect(screen.getByRole("alert").textContent).toContain("unreadable");
  });

  it("clears the failure when the next scan starts", async () => {
    const { fail } = startScan();
    fail(new Error("unreadable"));
    expect(await screen.findByRole("alert")).toBeTruthy();

    mocks.scanLibrary.mockReturnValue(new Promise<void>(() => {}));
    fireEvent.click(screen.getAllByRole("button", { name: /scan/i })[0]);

    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it("doesn't show one project's failure on another", async () => {
    const { view, fail } = startScan();
    fail(new Error("unreadable"));
    await waitFor(() => expect(useScanStore.getState().scanError).toBeTruthy());

    view.unmount();
    useAppStore.setState({ activeProject: { ...PROJECT, id: "other" } });
    renderDashboard();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows processing again when you come back mid-scan", () => {
    useScanStore.setState({ isScanning: true });
    useAppStore.setState({ romioState: "idle" });
    renderDashboard();
    expect(useAppStore.getState().romioState).toBe("processing");
  });
});
