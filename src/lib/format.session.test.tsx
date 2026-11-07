// SPDX-License-Identifier: GPL-3.0
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FormatScreen } from "@/components/format/FormatScreen";
import { useAppStore, useFormatStore } from "@/stores";
import type { EmulatorMatrixEntry, FormatCheckResult, Project } from "@/types";

const mocks = vi.hoisted(() => ({
  checkFormat: vi.fn(),
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
    checkFormat: (...args: unknown[]) => mocks.checkFormat(...args),
  },
}));

const project = (id: string, root: string) =>
  ({ id, libraryRoots: [root], targetFrontends: ["esde", "retrobat"] }) as unknown as Project;
const A = project("a", "/a");
const B = project("b", "/b");

const pass = (path: string, system: string, emulator: string): FormatCheckResult =>
  ({ path, extension: "x", system, emulator, state: "Compatible" });

/** Holds the next file check open until the returned function is called. */
function holdNextCheck() {
  let finish = () => {};
  mocks.checkFormat.mockImplementationOnce((path: string, system: string, emulator: string) =>
    new Promise((resolve) => { finish = () => resolve(pass(path, system, emulator)); }));
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
const flush = () => act(async () => { await new Promise((r) => setTimeout(r)); });

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
    mocks.checkFormat.mockReset();
    mocks.checkFormat.mockImplementation((path: string, system: string, emulator: string) =>
      Promise.resolve(pass(path, system, emulator)));
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
    await waitFor(() => expect(mocks.checkFormat).toHaveBeenCalled());
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

  it("shows results of a scan that finished while away", async () => {
    const finish = holdNextCheck();

    const view = await openScreen();
    fireEvent.click(scanButton());
    await waitFor(() => expect(mocks.checkFormat).toHaveBeenCalled());
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
    await waitFor(() => expect(mocks.checkFormat).toHaveBeenCalled());
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
