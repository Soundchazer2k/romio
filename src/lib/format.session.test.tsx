// SPDX-License-Identifier: GPL-3.0
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FormatScreen } from "@/components/format/FormatScreen";
import { FormatFixPlanModal } from "@/components/format/FormatFixPlanModal";
import { runFormatScan } from "@/lib/format-scan";
import { useAppStore, useFormatStore } from "@/stores";
import type { EmulatorMatrixEntry, FormatCheckResult, Project, StagedFix } from "@/types";

const mocks = vi.hoisted(() => ({
  checkFormatBatch: vi.fn(),
  listLibraryFolders: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

vi.mock("@/lib/ipc", () => ({
  ipc: {
    getFormatMatrix:    () => Promise.resolve([]),
    getEmulatorMatrix:  () => Promise.resolve([
      { system: "nes", recommended: "mesen2", alternatives: ["lr-nestopia"] },
    ] as EmulatorMatrixEntry[]),
    listLibraryFolders: (root: string) => mocks.listLibraryFolders(root),
    checkFormatBatch: (...args: unknown[]) => mocks.checkFormatBatch(...args),
  },
}));

const project = (id: string, root: string) =>
  ({ id, libraryRoots: [root], targetFrontends: ["esde", "retrobat"] }) as unknown as Project;
const A = project("a", "/a");
const B = project("b", "/b");

const pass = (path: string, system: string, emulator: string): FormatCheckResult =>
  ({ path, extension: "x", system, emulator, state: "Compatible" });

const passAll = (paths: string[], system: string, emulator: string) =>
  paths.map((path) => pass(path, system, emulator));

/** Holds the next batch check open until the returned function is called. */
function holdNextCheck() {
  let finish = () => {};
  mocks.checkFormatBatch.mockImplementationOnce((paths: string[], system: string, emulator: string) =>
    new Promise((resolve) => { finish = () => resolve(passAll(paths, system, emulator)); }));
  return () => finish();
}

/** Mounts the screen, as navigating to it does. Unmount it to navigate away. */
async function openScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(<QueryClientProvider client={client}><FormatScreen /></QueryClientProvider>);
  await screen.findByRole("option", { name: "lr-nestopia" });
  return view;
}

const rootInput = () => screen.getByPlaceholderText("/path/to/roms") as HTMLInputElement;
const scanButton = () => screen.getByRole("button", { name: /Scan/ }) as HTMLButtonElement;
const stopButton = () => screen.getByRole("button", { name: "Stop" }) as HTMLButtonElement;
const flush = () => act(async () => { await new Promise((r) => setTimeout(r)); });
const STOPPED = /You stopped the scan/;

describe("FormatScreen across navigation", () => {
  beforeEach(() => {
    useFormatStore.setState({ sessions: {} });
    useAppStore.setState({ activeProject: A });
    mocks.listLibraryFolders.mockReset();
    // The system is named after the root, to tell apart whose results are showing
    mocks.listLibraryFolders.mockImplementation((root: string) => {
      const system = root === "/b" ? "snes" : "nes";
      return Promise.resolve([{ name: system, path: `${root}/${system}`, system, files: [`${root}/${system}/1.bin`] }]);
    });
    mocks.checkFormatBatch.mockReset();
    mocks.checkFormatBatch.mockImplementation((paths: string[], system: string, emulator: string) =>
      Promise.resolve(passAll(paths, system, emulator)));
  });
  afterEach(cleanup);

  it("keeps results and custom inputs after a finished scan", async () => {
    const view = await openScreen();
    fireEvent.change(rootInput(), { target: { value: "/custom" } });
    fireEvent.change(screen.getByDisplayValue("esde"), { target: { value: "retrobat" } });
    fireEvent.change(screen.getByDisplayValue("auto"), { target: { value: "lr-nestopia" } });
    fireEvent.click(scanButton());
    await screen.findByText("nes");
    view.unmount();

    await openScreen();

    expect(screen.getByText("nes")).toBeTruthy();
    expect(rootInput().value).toBe("/custom");
    expect(screen.getByDisplayValue("retrobat")).toBeTruthy();
    expect(screen.getByDisplayValue("lr-nestopia")).toBeTruthy();
    // Nothing changed since the scan, and nothing ran again
    expect(screen.queryByText(/out of date/)).toBeNull();
    expect(mocks.listLibraryFolders).toHaveBeenCalledTimes(1);
  });

  it("keeps inputs typed before any scan", async () => {
    const view = await openScreen();
    fireEvent.change(rootInput(), { target: { value: "/custom" } });
    view.unmount();

    await openScreen();

    expect(rootInput().value).toBe("/custom");
  });

  it("brings an expanded row back collapsed", async () => {
    const view = await openScreen();
    fireEvent.click(scanButton());
    fireEvent.click(await screen.findByText("nes"));
    await screen.findByText("1.bin");
    view.unmount();

    await openScreen();

    expect(screen.getByText("nes")).toBeTruthy();
    expect(screen.queryByText("1.bin")).toBeNull();
  });

  it("returning mid-run shows that scan still running, with no second one, then its results", async () => {
    const finish = holdNextCheck();

    const view = await openScreen();
    fireEvent.click(scanButton());
    await waitFor(() => expect(mocks.checkFormatBatch).toHaveBeenCalled());
    view.unmount();

    await openScreen();

    expect(scanButton().disabled).toBe(true);
    fireEvent.click(scanButton());
    expect(screen.queryByText("Run a scan to check your library")).toBeNull();
    expect(mocks.listLibraryFolders).toHaveBeenCalledTimes(1);

    act(finish);

    await screen.findByText("nes");
    expect(scanButton().disabled).toBe(false);
  });

  it("returning mid-run shows the count the scan has reached, and it keeps moving", async () => {
    const files = Array.from({ length: 450 }, (_, i) => `/a/nes/${i}.bin`);
    mocks.listLibraryFolders.mockResolvedValueOnce([{ name: "nes", path: "/a/nes", system: "nes", files }]);
    mocks.checkFormatBatch.mockImplementationOnce((paths: string[], system: string, emulator: string) =>
      Promise.resolve(passAll(paths, system, emulator)));
    const finishSecond = holdNextCheck();

    const view = await openScreen();
    fireEvent.click(scanButton());
    await screen.findByText("Checked 200 of 450 files");
    view.unmount();

    // The count moves on while nobody is watching
    finishSecond();
    const finishThird = holdNextCheck();
    await flush();

    await openScreen();

    expect(screen.getByText("Checked 400 of 450 files")).toBeTruthy();
    expect(mocks.listLibraryFolders).toHaveBeenCalledTimes(1);

    act(finishThird);

    await screen.findByText("nes");
    expect(screen.queryByText(/^Checked /)).toBeNull();
  });

  it("shows no count from another project's scan", async () => {
    const finish = holdNextCheck();

    const view = await openScreen();
    fireEvent.click(scanButton());
    await screen.findByText("Checked 0 of 1 file");
    view.unmount();

    useAppStore.setState({ activeProject: B });
    const viewB = await openScreen();

    expect(screen.queryByText(/^Checked /)).toBeNull();
    viewB.unmount();

    useAppStore.setState({ activeProject: A });
    await openScreen();

    expect(screen.getByText("Checked 0 of 1 file")).toBeTruthy();
    act(finish);
    await screen.findByText("nes");
  });

  it("starts a new scan's count from nothing, not from the last scan's total", async () => {
    await openScreen();
    fireEvent.click(scanButton());
    await screen.findByText("nes");

    let list = () => {};
    mocks.listLibraryFolders.mockImplementationOnce(() =>
      new Promise((resolve) => { list = () => resolve([]); }));
    fireEvent.click(scanButton());

    expect(screen.getByText("Finding game files…")).toBeTruthy();
    expect(screen.queryByText(/^Checked /)).toBeNull();
    act(list);
    await flush();
  });

  it("shows results of a scan that finished while away", async () => {
    const finish = holdNextCheck();

    const view = await openScreen();
    fireEvent.click(scanButton());
    await waitFor(() => expect(mocks.checkFormatBatch).toHaveBeenCalled());
    view.unmount();
    finish();
    await flush();

    await openScreen();

    expect(screen.getByText("nes")).toBeTruthy();
    expect(scanButton().disabled).toBe(false);
  });

  it("keeps an error from a scan that failed while away", async () => {
    let fail = () => {};
    mocks.listLibraryFolders.mockImplementationOnce(() =>
      new Promise((_, reject) => { fail = () => reject(new Error("Couldn't read it")); }));

    const view = await openScreen();
    fireEvent.click(scanButton());
    view.unmount();
    fail();
    await flush();

    await openScreen();

    expect(screen.getByRole("alert").textContent).toContain("Couldn't read it");
    expect(scanButton().disabled).toBe(false);
  });

  it("keeps staged fixes after leaving, and a new scan clears them", async () => {
    mocks.checkFormatBatch.mockImplementationOnce((paths: string[], system: string, emulator: string) =>
      Promise.resolve(paths.map((path) => ({
        ...pass(path, system, emulator),
        state:     "FormatIncompatible",
        fixAction: { actionType: "rename", description: "Rename it", safe: true },
      }))));

    const view = await openScreen();
    fireEvent.click(scanButton());
    fireEvent.click(await screen.findByText("nes"));
    fireEvent.click(await screen.findByRole("button", { name: "Stage fix" }));
    expect(screen.getByText(/1 fix staged/)).toBeTruthy();
    view.unmount();

    await openScreen();

    expect(screen.getByText(/1 fix staged/)).toBeTruthy();

    fireEvent.click(scanButton());

    await screen.findByText("nes");
    await waitFor(() => expect(screen.queryByText(/fix staged/)).toBeNull());
  });

  it("starts nothing when called while that project's scan is running", async () => {
    const finish = holdNextCheck();

    const first = runFormatScan(A, []);
    await waitFor(() => expect(mocks.checkFormatBatch).toHaveBeenCalled());
    await runFormatScan(A, []);

    expect(mocks.listLibraryFolders).toHaveBeenCalledTimes(1);
    expect(mocks.checkFormatBatch).toHaveBeenCalledTimes(1);

    finish();
    await first;
  });

  it("keeps overlapping scans of two projects apart, with the later one finishing first", async () => {
    const finishA = holdNextCheck();
    const view = await openScreen();
    fireEvent.click(scanButton());
    await waitFor(() => expect(mocks.checkFormatBatch).toHaveBeenCalledTimes(1));
    view.unmount();

    const finishB = holdNextCheck();
    useAppStore.setState({ activeProject: B });
    const viewB = await openScreen();
    fireEvent.click(scanButton());
    await waitFor(() => expect(mocks.checkFormatBatch).toHaveBeenCalledTimes(2));

    act(finishB);
    await screen.findByText("snes");
    expect(scanButton().disabled).toBe(false);

    act(finishA);
    await flush();
    expect(screen.getByText("snes")).toBeTruthy();
    expect(screen.queryByText("nes")).toBeNull();
    viewB.unmount();

    useAppStore.setState({ activeProject: A });
    await openScreen();

    expect(screen.getByText("nes")).toBeTruthy();
    expect(screen.queryByText("snes")).toBeNull();
    expect(scanButton().disabled).toBe(false);
  });

  it("stops a scan that never returns after leaving and coming back, and can scan again", async () => {
    mocks.checkFormatBatch.mockImplementationOnce(() => new Promise(() => {}));

    const view = await openScreen();
    fireEvent.click(scanButton());
    await screen.findByText("Checked 0 of 1 file");
    view.unmount();

    await openScreen();
    expect(scanButton().disabled).toBe(true);

    fireEvent.click(stopButton());

    expect(screen.getByText(STOPPED)).toBeTruthy();
    expect(screen.queryByText(/^Checked /)).toBeNull();
    expect(screen.queryByText("Run a scan to check your library")).toBeNull();
    expect(stopButton().disabled).toBe(true);
    expect(scanButton().disabled).toBe(false);
    expect(document.activeElement).toBe(scanButton());

    fireEvent.click(scanButton());

    expect(screen.queryByText(STOPPED)).toBeNull();
    await screen.findByText("nes");
    expect(screen.queryByText(STOPPED)).toBeNull();
    expect(scanButton().disabled).toBe(false);
  });

  it("keeps one live region from scanning through to the stopped notice", async () => {
    mocks.checkFormatBatch.mockImplementationOnce(() => new Promise(() => {}));
    await openScreen();
    const region = document.querySelector("[aria-live]")!;
    expect(region.textContent).toBe("");
    expect(stopButton().disabled).toBe(true);

    fireEvent.click(scanButton());
    await screen.findByText("Checked 0 of 1 file");
    expect(document.querySelector("[aria-live]")).toBe(region);
    expect(region.textContent).toBe("Checked 0 of 1 file");
    expect(stopButton().disabled).toBe(false);

    fireEvent.click(stopButton());
    expect(document.querySelector("[aria-live]")).toBe(region);
    expect(region.textContent).toMatch(STOPPED);
  });

  it("says the fix plan changes nothing and asks for no consent to apply it", () => {
    const result = pass("/a/nes/1.bin", "nes", "mesen2");
    render(<FormatFixPlanModal
      fixes={[{ result, fix: { actionType: "rename", description: "Rename it", safe: true } as StagedFix["fix"] }]}
      onClose={() => {}}
    />);

    expect(screen.getByText(/Applying fixes isn't built yet, so nothing will change/)).toBeTruthy();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByRole("button", { name: "Apply Fixes" })).toBeNull();
  });

  it("names the config fields through their labels", async () => {
    await openScreen();
    expect(screen.getByLabelText("Library root")).toBe(rootInput());
    expect((screen.getByLabelText("Frontend") as HTMLSelectElement).value).toBe("esde");
    expect((screen.getByLabelText("Emulator") as HTMLSelectElement).value).toBe("auto");
  });

  it("a stopped run settling late sends no more chunks and doesn't touch the new scan", async () => {
    const files = Array.from({ length: 450 }, (_, i) => `/a/nes/old-${i}.bin`);
    mocks.listLibraryFolders.mockResolvedValueOnce([{ name: "nes", path: "/a/nes", system: "nes", files }]);
    const finishOld = holdNextCheck();

    await openScreen();
    fireEvent.click(scanButton());
    await screen.findByText("Checked 0 of 450 files");
    fireEvent.click(stopButton());

    const finishNew = holdNextCheck();
    fireEvent.click(scanButton());
    await screen.findByText("Checked 0 of 1 file");

    act(finishOld);
    await flush();

    // Neither its count, its finally nor a next chunk got through
    expect(screen.getByText("Checked 0 of 1 file")).toBeTruthy();
    expect(scanButton().disabled).toBe(true);
    expect(mocks.checkFormatBatch).toHaveBeenCalledTimes(2);

    act(finishNew);
    fireEvent.click(await screen.findByText("nes"));

    await screen.findByText("1.bin");
    expect(screen.queryByText(/old-/)).toBeNull();
    expect(scanButton().disabled).toBe(false);
  });

  it("a stopped run's late answer leaves the stopped state alone", async () => {
    const finishChecks = holdNextCheck();
    await openScreen();
    fireEvent.click(scanButton());
    await screen.findByText("Checked 0 of 1 file");
    fireEvent.click(stopButton());

    act(finishChecks);
    await flush();

    expect(screen.getByText(STOPPED)).toBeTruthy();
    expect(screen.queryByText("nes")).toBeNull();
    expect(screen.queryByText(/No game files found/)).toBeNull();
  });

  it("a run stopped while listing ignores a late failure", async () => {
    let fail = () => {};
    mocks.listLibraryFolders.mockImplementationOnce(() =>
      new Promise((_, reject) => { fail = () => reject(new Error("Couldn't read it")); }));

    await openScreen();
    fireEvent.click(scanButton());
    fireEvent.click(stopButton());

    act(fail);
    await flush();

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText(STOPPED)).toBeTruthy();
    expect(scanButton().disabled).toBe(false);
  });

  it("doesn't carry results or inputs over to another project, and keeps them for the first", async () => {
    const view = await openScreen();
    fireEvent.change(screen.getByDisplayValue("esde"), { target: { value: "retrobat" } });
    fireEvent.click(scanButton());
    await screen.findByText("nes");
    view.unmount();

    useAppStore.setState({ activeProject: B });
    const viewB = await openScreen();

    expect(screen.queryByText("nes")).toBeNull();
    expect(rootInput().value).toBe("/b");
    expect(screen.getByDisplayValue("esde")).toBeTruthy();
    viewB.unmount();

    useAppStore.setState({ activeProject: A });
    await openScreen();

    expect(screen.getByText("nes")).toBeTruthy();
    expect(rootInput().value).toBe("/a");
    expect(screen.getByDisplayValue("retrobat")).toBeTruthy();
  });

  it("puts a scan that ends after a project switch under its own project only", async () => {
    const finish = holdNextCheck();

    const view = await openScreen();
    fireEvent.click(scanButton());
    await waitFor(() => expect(mocks.checkFormatBatch).toHaveBeenCalled());
    view.unmount();

    useAppStore.setState({ activeProject: B });
    const viewB = await openScreen();

    // A's run neither blocks B nor shows here, before or after it ends
    expect(scanButton().disabled).toBe(false);
    act(finish);
    await flush();
    expect(screen.queryByText("nes")).toBeNull();

    fireEvent.click(scanButton());
    await screen.findByText("snes");
    expect(screen.queryByText("nes")).toBeNull();
    viewB.unmount();

    useAppStore.setState({ activeProject: A });
    await openScreen();

    expect(screen.getByText("nes")).toBeTruthy();
    expect(screen.queryByText("snes")).toBeNull();
  });
});
