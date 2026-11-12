// SPDX-License-Identifier: GPL-3.0
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DashboardScreen } from "@/components/dashboard/DashboardScreen";
import { useAppStore, useScanStore } from "@/stores";
import type { Project, ScanProgress } from "@/types";

const PROJECT = { id: "p", name: "Test", libraryRoots: ["/roms"], targetFrontends: [], emulatorPrefs: {}, createdAt: "" } as Project;

const SAVING = { filesScanned: 3, currentPath: "", phase: "saving" } as const;

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
    useScanStore.setState({ scanningProject: null, progress: null, scanErrors: {} });
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
    await waitFor(() => expect(useScanStore.getState().scanningProject).toBeTruthy());

    view.unmount();
    useAppStore.setState({ screen: "saves", romioState: "difficult_save" });
    finish();

    await waitFor(() => expect(useScanStore.getState().scanningProject).toBeNull());
    expect(useAppStore.getState().romioState).toBe("difficult_save");
  });

  it("doesn't overwrite another screen's warning when the scan fails", async () => {
    const { view, fail } = startScan();
    await waitFor(() => expect(useScanStore.getState().scanningProject).toBeTruthy());

    view.unmount();
    useAppStore.setState({ screen: "saves", romioState: "difficult_save" });
    fail(new Error("unreadable"));

    await waitFor(() => expect(useScanStore.getState().scanningProject).toBeNull());
    expect(useAppStore.getState().romioState).toBe("difficult_save");
  });

  it("still reports a failed scan if you were away when it failed", async () => {
    const { view, fail } = startScan();
    await waitFor(() => expect(useScanStore.getState().scanningProject).toBeTruthy());

    view.unmount();
    fail(new Error("unreadable"));
    await waitFor(() => expect(useScanStore.getState().scanningProject).toBeNull());

    useAppStore.setState({ romioState: "idle" });
    renderDashboard();
    expect(screen.getByRole("alert").textContent).toContain("unreadable");
    expect(useAppStore.getState().romioState).toBe("error");
  });

  it("doesn't blame the games when the scan itself fails", async () => {
    const { fail } = startScan();
    fail(new Error("unreadable"));
    await waitFor(() => expect(useAppStore.getState().romioState).toBe("error"));
  });

  it("stays on processing until the new results have loaded", async () => {
    let loaded!: (p: Project) => void;
    mocks.getProject.mockReturnValue(new Promise<Project>((res) => { loaded = res; }));
    const { finish } = startScan();
    finish();

    await waitFor(() => expect(useScanStore.getState().scanningProject).toBeNull());
    expect(useAppStore.getState().romioState).toBe("processing");

    loaded(PROJECT);
    await waitFor(() => expect(useAppStore.getState().romioState).toBe("idle"));
  });

  it("doesn't go idle when a new scan started before the last one's results loaded", async () => {
    let loaded!: (p: Project) => void;
    mocks.getProject.mockReturnValue(new Promise<Project>((res) => { loaded = res; }));
    const { finish } = startScan();
    finish();
    await waitFor(() => expect(useScanStore.getState().scanningProject).toBeNull());

    act(() => useScanStore.getState().setScanning(PROJECT));
    loaded(PROJECT);
    await waitFor(() => expect(useAppStore.getState().activeProject).toBe(PROJECT));
    expect(useAppStore.getState().romioState).toBe("processing");
  });

  it("has no old results to mention when a first scan fails", async () => {
    const { fail } = startScan();
    fail(new Error("unreadable"));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("The scan stopped.");
    expect(alert.textContent).not.toContain("results");
  });

  it("doesn't promise old results are intact after a failure", async () => {
    useAppStore.setState({ activeProject: { ...PROJECT, scanStats: { totalFiles: 21 } } as Project });
    const { fail } = startScan();
    fail(new Error("Failed to persist artifacts"));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("may be out of date");
    expect(alert.textContent).not.toContain("unchanged");
  });

  it("doesn't call a finished scan failed when only the reload fails", async () => {
    mocks.getProject.mockRejectedValue(new Error("db locked"));
    const { finish } = startScan();
    finish();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("The scan finished");
    expect(alert.textContent).not.toContain("stopped");
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
    await waitFor(() => expect(useScanStore.getState().scanErrors.p).toBeTruthy());

    view.unmount();
    useAppStore.setState({ activeProject: { ...PROJECT, id: "other" } });
    renderDashboard();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps the panel up from the walk's end until the command returns", async () => {
    const { finish } = startScan();
    await waitFor(() => expect(useScanStore.getState().scanningProject).toBeTruthy());

    act(() => useScanStore.setState({ progress: { filesScanned: 5, filesTotal: 5, currentPath: "", phase: "complete" } }));
    expect(screen.getByText("5 files")).toBeTruthy();

    act(() => useScanStore.setState({ progress: SAVING }));
    expect(screen.getByText("Finishing scan…")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Finishing…" })).toBeTruthy();
    expect(screen.queryByText(/d files/)).toBeNull();

    finish();
    await waitFor(() => expect(screen.queryByText("Finishing scan…")).toBeNull());
    expect(useScanStore.getState().scanningProject).toBeNull();
    expect(useScanStore.getState().progress).toBeNull();
  });

  it("pulses the bar only while finishing, so a long wait doesn't look hung", async () => {
    const { view, finish } = startScan();
    await waitFor(() => expect(useScanStore.getState().scanningProject).toBeTruthy());
    const pulsingBar = () => view.container.querySelector(".animate-pulse");

    act(() => useScanStore.setState({ progress: { filesScanned: 3, currentPath: "/roms/a", phase: "classifying" } }));
    expect(pulsingBar()).toBeNull();

    act(() => useScanStore.setState({ progress: { filesScanned: 5, filesTotal: 5, currentPath: "", phase: "complete" } }));
    expect(pulsingBar()).toBeNull();

    act(() => useScanStore.setState({ progress: SAVING }));
    expect(pulsingBar()).not.toBeNull();

    finish();
    await waitFor(() => expect(pulsingBar()).toBeNull());
  });

  it("drops the finishing state and shows no results when saving fails", async () => {
    const { fail } = startScan();
    await waitFor(() => expect(useScanStore.getState().scanningProject).toBeTruthy());
    act(() => useScanStore.setState({ progress: SAVING }));

    fail(new Error("Failed to persist artifacts"));

    expect((await screen.findByRole("alert")).textContent).toContain("Failed to persist artifacts");
    expect(screen.queryByText("Finishing scan…")).toBeNull();
    expect(useScanStore.getState().progress).toBeNull();
    expect(mocks.getProject).not.toHaveBeenCalled();
  });

  it("clears a cancelled scan's panel when the command returns: no saving event arrives", async () => {
    const { finish } = startScan();
    await waitFor(() => expect(useScanStore.getState().scanningProject).toBeTruthy());
    act(() => useScanStore.setState({ progress: { filesScanned: 3, currentPath: "/roms/a", phase: "classifying" } }));

    // The walk stops, sends "complete", and the command returns without saving.
    act(() => useScanStore.setState({ progress: { filesScanned: 3, filesTotal: 3, currentPath: "", phase: "complete" } }));
    expect(screen.queryByText("Finishing scan…")).toBeNull();

    finish();
    await waitFor(() => expect(useScanStore.getState().scanningProject).toBeNull());
    expect(useScanStore.getState().progress).toBeNull();
    expect(screen.queryByText("3 files")).toBeNull();
  });

  it("doesn't start a new scan showing a saving event that arrived late", async () => {
    useScanStore.setState({ progress: SAVING });
    const { finish } = startScan();

    await waitFor(() => expect(useScanStore.getState().scanningProject).toBeTruthy());
    expect(screen.queryByText("Finishing scan…")).toBeNull();
    finish();
  });

  it("shows processing again when you come back mid-scan", () => {
    useScanStore.setState({ scanningProject: PROJECT });
    useAppStore.setState({ romioState: "idle" });
    renderDashboard();
    expect(useAppStore.getState().romioState).toBe("processing");
  });

  describe("when you switch projects mid-scan", () => {
    const OTHER = { ...PROJECT, id: "other", name: "Other" } as Project;
    const SCANNED = { ...PROJECT, scanStats: { totalFiles: 21 } } as Project;

    /** Starts a scan of PROJECT, then opens OTHER's Dashboard the way the app does. */
    async function switchMidScan() {
      const scan = startScan();
      await waitFor(() => expect(useScanStore.getState().scanningProject).toBeTruthy());
      scan.view.unmount();
      useAppStore.setState({ activeProject: OTHER, romioState: "idle" });
      const view = renderDashboard();
      return { ...scan, view };
    }

    it("keeps the project you switched to when the scan succeeds", async () => {
      mocks.getProject.mockResolvedValue(SCANNED);
      const { finish } = await switchMidScan();
      finish();

      await waitFor(() => expect(mocks.getProject).toHaveBeenCalledWith("p"));
      await waitFor(() => expect(useScanStore.getState().scanningProject).toBeNull());
      await new Promise((res) => setTimeout(res));
      expect(useAppStore.getState().activeProject).toBe(OTHER);
      expect(useAppStore.getState().romioState).toBe("idle");
    });

    it("keeps the project you switched to if the reload resolves after you switch", async () => {
      let loaded!: (p: Project) => void;
      mocks.getProject.mockReturnValue(new Promise<Project>((res) => { loaded = res; }));
      const { view, finish } = startScan();
      finish();
      await waitFor(() => expect(mocks.getProject).toHaveBeenCalled());

      view.unmount();
      useAppStore.setState({ activeProject: OTHER, romioState: "difficult_save" });
      loaded(SCANNED);
      await new Promise((res) => setTimeout(res));

      expect(useAppStore.getState().activeProject).toBe(OTHER);
      expect(useAppStore.getState().romioState).toBe("difficult_save");
    });

    it("still applies the results if you came back before the scan succeeded", async () => {
      mocks.getProject.mockResolvedValue(SCANNED);
      const { view, finish } = await switchMidScan();
      view.unmount();
      useAppStore.setState({ activeProject: PROJECT });
      renderDashboard();
      finish();

      await waitFor(() => expect(useAppStore.getState().activeProject).toBe(SCANNED));
    });

    it("keeps the failure off the project you switched to", async () => {
      const { fail } = await switchMidScan();
      fail(new Error("unreadable"));

      await waitFor(() => expect(useScanStore.getState().scanningProject).toBeNull());
      expect(screen.queryByRole("alert")).toBeNull();
      expect(useAppStore.getState().romioState).toBe("idle");
    });

    it("reports the failure when you come back to the project that failed", async () => {
      const { view, fail } = await switchMidScan();
      fail(new Error("unreadable"));
      await waitFor(() => expect(useScanStore.getState().scanningProject).toBeNull());

      view.unmount();
      useAppStore.setState({ activeProject: PROJECT });
      renderDashboard();
      expect(screen.getByRole("alert").textContent).toContain("unreadable");
      expect(useAppStore.getState().romioState).toBe("error");
    });

    it("doesn't call a scan failed on the other project when only its reload fails", async () => {
      mocks.getProject.mockRejectedValue(new Error("db locked"));
      const { finish } = await switchMidScan();
      finish();

      await waitFor(() => expect(mocks.getProject).toHaveBeenCalledWith("p"));
      await new Promise((res) => setTimeout(res));
      expect(screen.queryByRole("alert")).toBeNull();
      expect(useScanStore.getState().scanErrors.p).toBeFalsy();
    });

    it("keeps one project's unresolved failure when another project scans", async () => {
      useScanStore.setState({ scanErrors: { p: "unreadable" } });
      useAppStore.setState({ activeProject: OTHER });
      const { view, finish } = startScan();
      finish();
      await waitFor(() => expect(useScanStore.getState().scanningProject).toBeNull());

      view.unmount();
      useAppStore.setState({ activeProject: PROJECT });
      renderDashboard();
      expect(screen.getByRole("alert").textContent).toContain("unreadable");
    });

    it("won't start a second scan, and names the one that's running", async () => {
      await switchMidScan();
      mocks.scanLibrary.mockClear();

      const running = screen.getByRole("button", { name: "Scanning Test…" }) as HTMLButtonElement;
      const scanNow = screen.getByRole("button", { name: /Scan Now/ }) as HTMLButtonElement;
      expect(running.disabled).toBe(true);
      expect(scanNow.disabled).toBe(true);
      fireEvent.click(scanNow);
      expect(mocks.scanLibrary).not.toHaveBeenCalled();
    });

    it("still names the other project while its scan is finishing", async () => {
      await switchMidScan();
      act(() => useScanStore.getState().setProgress({ filesScanned: 3, currentPath: "", phase: "saving" }));
      expect(screen.getByRole("button", { name: "Finishing Test…" })).toBeTruthy();
    });

    it("shows no processing mood or progress for a scan of another project", async () => {
      await switchMidScan();
      // Set after the switch: starting a scan clears whatever progress was there
      act(() => useScanStore.getState().setProgress({ filesScanned: 3, filesTotal: 9, currentPath: "/roms/a.bin", phase: "hashing" } as ScanProgress));
      expect(useAppStore.getState().romioState).toBe("idle");
      expect(screen.queryByText("/roms/a.bin")).toBeNull();
    });

    it("refreshes the Projects list once the scan is saved", async () => {
      const client = new QueryClient();
      const invalidate = vi.spyOn(client, "invalidateQueries");
      let finish!: () => void;
      mocks.scanLibrary.mockReturnValue(new Promise<void>((res) => { finish = res; }));
      render(<QueryClientProvider client={client}><DashboardScreen /></QueryClientProvider>);
      fireEvent.click(screen.getAllByRole("button", { name: /scan/i })[0]);
      await waitFor(() => expect(useScanStore.getState().scanningProject).toBeTruthy());
      // Not while the scan runs: the list would be re-read before the results exist
      expect(invalidate).not.toHaveBeenCalled();

      finish();
      await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ["projects"] }));
    });
  });
});
