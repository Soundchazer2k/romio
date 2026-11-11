// SPDX-License-Identifier: GPL-3.0
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { MultiDiscScreen } from "@/components/multidisc/MultiDiscScreen";
import { ScummVmScreen } from "@/components/scummvm/ScummVmScreen";
import { InstalledScreen } from "@/components/installed/InstalledScreen";
import { useAppStore } from "@/stores";
import { useToolStore } from "@/lib/tool-scan";
import type { MultiDiscSet, Project, ScummVmReport, ShortcutValidationResult, TitleCheck } from "@/types";

const mocks = vi.hoisted(() => ({
  detectMultiDisc: vi.fn(),
  detectScummvm: vi.fn(),
  checkInstalledTitles: vi.fn(),
  validateShortcutContent: vi.fn(),
}));

vi.mock("@/lib/ipc", () => ({ ipc: mocks }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

const project = (id: string, root: string) =>
  ({ id, name: id, libraryRoots: [root], targetFrontends: ["esde"], emulatorPrefs: {}, createdAt: "" }) as Project;

const SETS: MultiDiscSet[] = [
  {
    name: "Alpha", folder: "/lib/psx", system: "ps1",
    discs: [
      { path: "/lib/psx/Alpha (Disc 1).cue", disc: "1", missingTracks: [] },
      { path: "/lib/psx/Alpha (Disc 2).cue", disc: "2", missingTracks: ["alpha (disc 2).bin"] },
    ],
    m3uPath: null, m3uState: "missing", m3uProblems: [],
  },
  {
    name: "Beta", folder: "/lib/saturn", system: "saturn",
    discs: [
      { path: "/lib/saturn/Beta (Disc 1).chd", disc: "1", missingTracks: [] },
      { path: "/lib/saturn/Beta (Disc 2).chd", disc: "2", missingTracks: [] },
    ],
    m3uPath: "/lib/saturn/Beta.m3u", m3uState: "complete", m3uProblems: [],
  },
];

const scanButton = () => screen.getByRole("button", { name: /^Scan/ }) as HTMLButtonElement;
const stopButton = () => screen.getByRole("button", { name: "Stop" }) as HTMLButtonElement;

beforeEach(() => {
  vi.clearAllMocks();
  useToolStore.setState({ sessions: {} });
  useAppStore.setState({ activeProject: project("p1", "/lib") });
});
afterEach(cleanup);

describe("MultiDiscScreen", () => {
  it("scans the project's library root and reports each set", async () => {
    mocks.detectMultiDisc.mockResolvedValue(SETS);
    render(<MultiDiscScreen />);
    expect((screen.getByLabelText("Library root") as HTMLInputElement).value).toBe("/lib");
    expect(stopButton().disabled).toBe(true);

    fireEvent.click(scanButton());
    await screen.findByText("2 multi-disc sets, 1 needs attention");
    expect(mocks.detectMultiDisc).toHaveBeenCalledWith("/lib");
    expect(screen.getByText("No playlist")).toBeTruthy();
    expect(screen.getByText("Playlist complete")).toBeTruthy();
    expect(screen.getByText("Track files missing")).toBeTruthy();
    expect(screen.getByText("alpha (disc 2).bin")).toBeTruthy();
    // Read-only, and says so
    expect(screen.getByText(/doesn't write playlists/)).toBeTruthy();
  });

  it("keeps inputs and results when you leave and come back", async () => {
    mocks.detectMultiDisc.mockResolvedValue(SETS);
    const first = render(<MultiDiscScreen />);
    fireEvent.change(screen.getByLabelText("Library root"), { target: { value: "/other" } });
    fireEvent.click(scanButton());
    await screen.findByText("2 multi-disc sets, 1 needs attention");
    first.unmount();

    render(<MultiDiscScreen />);
    expect((screen.getByLabelText("Library root") as HTMLInputElement).value).toBe("/other");
    expect(screen.getByText("2 multi-disc sets, 1 needs attention")).toBeTruthy();
    expect(mocks.detectMultiDisc).toHaveBeenCalledTimes(1);
  });

  it("keeps each project's session apart", async () => {
    mocks.detectMultiDisc.mockResolvedValue(SETS);
    const first = render(<MultiDiscScreen />);
    fireEvent.click(scanButton());
    await screen.findByText("2 multi-disc sets, 1 needs attention");
    first.unmount();

    useAppStore.setState({ activeProject: project("p2", "/second") });
    render(<MultiDiscScreen />);
    expect((screen.getByLabelText("Library root") as HTMLInputElement).value).toBe("/second");
    expect(screen.getByText("Run a scan to find multi-disc games")).toBeTruthy();
  });

  it("a scan left running finishes while you're away, and a second click starts nothing", async () => {
    let finish!: (sets: MultiDiscSet[]) => void;
    mocks.detectMultiDisc.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const first = render(<MultiDiscScreen />);
    fireEvent.click(scanButton());
    expect(scanButton().disabled).toBe(true);
    first.unmount();

    render(<MultiDiscScreen />);
    expect(scanButton().disabled).toBe(true);
    expect(screen.getByText("Looking for disc sets…")).toBeTruthy();
    finish(SETS);
    await screen.findByText("2 multi-disc sets, 1 needs attention");
    expect(mocks.detectMultiDisc).toHaveBeenCalledTimes(1);
  });

  it("Stop drops a scan that never returns, ignores it if it settles later, and allows a new one", async () => {
    let finish!: (sets: MultiDiscSet[]) => void;
    mocks.detectMultiDisc.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    render(<MultiDiscScreen />);
    const region = document.querySelector("[aria-live]")!;
    fireEvent.click(scanButton());
    expect(stopButton().disabled).toBe(false);

    fireEvent.click(stopButton());
    expect(region.textContent).toMatch(/You stopped the scan/);
    expect(stopButton().disabled).toBe(true);
    expect(document.activeElement).toBe(scanButton());
    // No results, so nothing to call out of date
    fireEvent.change(screen.getByLabelText("Library root"), { target: { value: "/lib2" } });
    expect(screen.queryByText(/out of date/)).toBeNull();
    fireEvent.change(screen.getByLabelText("Library root"), { target: { value: "/lib" } });

    finish(SETS);
    await Promise.resolve();
    expect(screen.queryByText(/multi-disc sets,/)).toBeNull();

    mocks.detectMultiDisc.mockResolvedValue([]);
    fireEvent.keyDown(screen.getByLabelText("Library root"), { key: "Enter" });
    await screen.findByText(/No multi-disc sets found in \/lib/);
    expect(document.querySelector("[aria-live]")).toBe(region);
  });

  it("shows a failed scan as an error, and marks results out of date when the root changes", async () => {
    mocks.detectMultiDisc.mockRejectedValueOnce(new Error("Couldn't read /lib: denied"));
    render(<MultiDiscScreen />);
    fireEvent.click(scanButton());
    expect((await screen.findByRole("alert")).textContent).toBe("Couldn't read /lib: denied");
    expect(scanButton().disabled).toBe(false);

    mocks.detectMultiDisc.mockResolvedValue(SETS);
    fireEvent.click(scanButton());
    await screen.findByText("2 multi-disc sets, 1 needs attention");
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.change(screen.getByLabelText("Library root"), { target: { value: "/moved" } });
    expect(screen.getByText(/these results are out of date/)).toBeTruthy();
  });
});

describe("ScummVmScreen", () => {
  it("reports pointer files, empty pointers and unrecognised folders", async () => {
    const report: ScummVmReport = {
      folder: "/lib/scummvm",
      games: [
        { path: "/lib/scummvm/one", name: "one", engine: "SCUMM", pointerPath: "/lib/scummvm/one/one.scummvm", pointerId: "scumm:one" },
        { path: "/lib/scummvm/two", name: "two", engine: "SCI", pointerPath: null, pointerId: null },
        { path: "/lib/scummvm/three", name: "three", engine: null, pointerPath: "/lib/scummvm/three/three.scummvm", pointerId: "" },
      ],
    };
    mocks.detectScummvm.mockResolvedValue(report);
    render(<ScummVmScreen />);
    fireEvent.click(scanButton());

    await screen.findByText("3 ScummVM folders, 1 without a pointer file");
    expect(screen.getByText("No pointer file")).toBeTruthy();
    // An empty pointer is valid (the file's name is the ID), so it isn't counted or flagged
    expect(screen.getAllByText("Pointer file found")).toHaveLength(2);
    expect(screen.getByText(/the game ID is the file's name/)).toBeTruthy();
    expect(screen.getByText("Files not recognised")).toBeTruthy();
    expect(screen.getByText(/doesn't write pointer files/)).toBeTruthy();
  });

  it("says so when the library has no scummvm folder", async () => {
    mocks.detectScummvm.mockResolvedValue({ folder: null, games: [] });
    render(<ScummVmScreen />);
    fireEvent.click(scanButton());
    await screen.findByText(/No scummvm folder in \/lib\./);
  });
});

describe("InstalledScreen", () => {
  const TITLES: TitleCheck[] = [
    { path: "/g/CUSA00419", folder: "CUSA00419", titleId: "CUSA00419", kind: "game", issues: [] },
    { path: "/g/Renamed", folder: "Renamed", titleId: null, kind: "game", issues: ["Renamed doesn't look like a title ID shadps4 uses."] },
  ];

  it("needs a folder, then checks it for the picked emulator", async () => {
    mocks.checkInstalledTitles.mockResolvedValue(TITLES);
    render(<InstalledScreen />);
    expect(scanButton().disabled).toBe(true);
    expect(screen.getByText(/For RPCS3, pick dev_hdd0\/game/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Emulator"), { target: { value: "shadps4" } });
    fireEvent.change(screen.getByLabelText("Installed titles folder"), { target: { value: "/g" } });
    fireEvent.click(scanButton());

    await screen.findByText("2 installed titles, 1 with problems");
    expect(mocks.checkInstalledTitles).toHaveBeenCalledWith("/g", "shadps4");
    expect(screen.getByText("Renamed doesn't look like a title ID shadps4 uses.")).toBeTruthy();
    expect(screen.getByText("1 problem")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Emulator"), { target: { value: "cemu" } });
    expect(screen.getByText(/these results are out of date/)).toBeTruthy();
  });

  it("checks a pasted launch command and shows each problem with its fix", async () => {
    const bad: ShortcutValidationResult = {
      shortcutPath: "x", isValid: false,
      issues: [{ issueType: "unexpanded_variable", description: "Launch command contains unexpanded variable: %ROMPATH%.", value: "%ROMPATH%", fix: "Regenerate the shortcut." }],
    };
    mocks.validateShortcutContent.mockResolvedValue(bad);
    render(<InstalledScreen />);
    const check = screen.getByRole("button", { name: "Check" }) as HTMLButtonElement;
    expect(check.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Launch command"), { target: { value: "emu %ROMPATH%" } });
    fireEvent.click(check);
    await screen.findByText("Launch command contains unexpanded variable: %ROMPATH%.");
    expect(screen.getByText("Regenerate the shortcut.")).toBeTruthy();
    expect(mocks.validateShortcutContent).toHaveBeenCalledWith("emu %ROMPATH%");

    mocks.validateShortcutContent.mockResolvedValue({ shortcutPath: "y", isValid: true, issues: [] });
    fireEvent.change(screen.getByLabelText("Launch command"), { target: { value: "emu game" } });
    await waitFor(() => expect(screen.queryByText("Regenerate the shortcut.")).toBeNull());
    fireEvent.click(check);
    await screen.findByText(/Nothing wrong found/);
  });
});
