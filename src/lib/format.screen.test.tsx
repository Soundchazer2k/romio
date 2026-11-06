// SPDX-License-Identifier: GPL-3.0
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { open } from "@tauri-apps/plugin-dialog";
import { FormatScreen } from "@/components/format/FormatScreen";
import { FormatSystemRow } from "@/components/format/FormatSystemRow";
import { FormatReferenceDrawer } from "@/components/format/FormatReferenceDrawer";
import { FormatImpactTable } from "@/components/format/FormatImpactTable";
import { emulatorForSystem } from "@/lib/utils";
import type { EmulatorMatrixEntry, FormatCheckResult, FormatCompatibilityState, FormatRule } from "@/types";

const MATRIX = [
  { system: "ps1", recommended: "duckstation", alternatives: ["lr-pcsx-rearmed"] },
  { system: "nes", recommended: "mesen2", alternatives: ["lr-nestopia"] },
] as EmulatorMatrixEntry[];

const TWO_FOLDERS = [
  { name: "psx", path: "/roms/psx", system: "ps1", files: ["/roms/psx/a.chd"] },
  { name: "nes", path: "/roms/nes", system: "nes", files: ["/roms/nes/b.nes"] },
];

const mocks = vi.hoisted(() => ({
  checkFormat: vi.fn(),
  listLibraryFolders: vi.fn(),
  getFormatMatrix: vi.fn(),
  getEmulatorMatrix: vi.fn(),
}));

vi.mock("@/stores", () => ({
  useAppStore: () => ({
    activeProject: { libraryRoots: ["/roms"], targetFrontends: ["esde", "retrobat"] },
  }),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

vi.mock("@/lib/ipc", () => ({
  ipc: {
    getFormatMatrix:    () => mocks.getFormatMatrix(),
    getEmulatorMatrix:  () => mocks.getEmulatorMatrix(),
    listLibraryFolders: () => mocks.listLibraryFolders(),
    checkFormat: (...args: unknown[]) => mocks.checkFormat(...args),
  },
}));

function result(state: FormatCompatibilityState, extra: Partial<FormatCheckResult> = {}): FormatCheckResult {
  return { path: `/roms/x/${Math.random()}.iso`, extension: "iso", system: "xbox", emulator: "xemu", state, ...extra };
}

function renderRow(results: FormatCheckResult[], rules: FormatRule[] = []) {
  return render(
    <FormatSystemRow
      group={{ system: "xbox", results }}
      rules={rules}
      stagedFixes={[]}
      expanded={false}
      onToggle={() => undefined}
      index={0}
      onStageFix={() => undefined}
    />
  );
}

describe("emulatorForSystem", () => {
  it("uses the recommended emulator on auto", () =>
    expect(emulatorForSystem("nes", "auto", MATRIX)).toBe("mesen2"));
  it("uses a picked emulator on a system that lists it", () =>
    expect(emulatorForSystem("nes", "lr-nestopia", MATRIX)).toBe("lr-nestopia"));
  it("keeps the recommended emulator on a system that can't use the pick", () =>
    expect(emulatorForSystem("ps1", "lr-nestopia", MATRIX)).toBe("duckstation"));
  it("has no emulator for a system outside the matrix", () =>
    expect(emulatorForSystem("foo", "lr-nestopia", MATRIX)).toBe("unknown"));
});

describe("FormatScreen", () => {
  beforeEach(() => {
    mocks.listLibraryFolders.mockReset();
    mocks.listLibraryFolders.mockResolvedValue(TWO_FOLDERS);
    mocks.getFormatMatrix.mockReset();
    mocks.getFormatMatrix.mockResolvedValue([]);
    mocks.getEmulatorMatrix.mockReset();
    mocks.getEmulatorMatrix.mockResolvedValue(MATRIX);
    mocks.checkFormat.mockReset();
    mocks.checkFormat.mockImplementation((path: string, system: string, emulator: string) =>
      Promise.resolve({ path, extension: "x", system, emulator, state: "Compatible" }));
  });

  async function setUp() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><FormatScreen /></QueryClientProvider>);
    // The picker lists matrix emulators once the matrix has loaded
    await screen.findByRole("option", { name: "lr-nestopia" });
  }

  const scan = async () => {
    fireEvent.click(screen.getByRole("button", { name: /Scan/ }));
    await screen.findByText("nes");
  };

  it("applies a picked emulator only to systems that can use it", async () => {
    await setUp();
    fireEvent.change(screen.getByDisplayValue("auto"), { target: { value: "lr-nestopia" } });
    await scan();

    expect(mocks.checkFormat).toHaveBeenCalledWith("/roms/nes/b.nes", "nes", "lr-nestopia", "esde");
    expect(mocks.checkFormat).toHaveBeenCalledWith("/roms/psx/a.chd", "ps1", "duckstation", "esde");
    expect(screen.getByText("lr-nestopia", { selector: "span" })).toBeTruthy();
    expect(screen.getByText("duckstation", { selector: "span" })).toBeTruthy();
  });

  it("says which systems a pick applied to, and that the rest didn't use it", async () => {
    await setUp();
    fireEvent.change(screen.getByDisplayValue("auto"), { target: { value: "lr-nestopia" } });
    await scan();

    const notice = screen.getByRole("status").textContent;
    expect(notice).toContain("lr-nestopia only applies to nes");
    expect(notice).toContain("1 other system");
  });

  it("says so when a pick applies to no scanned system", async () => {
    mocks.listLibraryFolders.mockResolvedValue([TWO_FOLDERS[0]]);
    await setUp();
    fireEvent.change(screen.getByDisplayValue("auto"), { target: { value: "lr-nestopia" } });
    fireEvent.click(screen.getByRole("button", { name: /Scan/ }));

    await screen.findByText("ps1");
    expect(screen.getByRole("status").textContent).toContain("lr-nestopia doesn't apply to any system in this scan");
  });

  it("adds no notice when every scanned system used the pick", async () => {
    mocks.listLibraryFolders.mockResolvedValue([TWO_FOLDERS[1]]);
    await setUp();
    fireEvent.change(screen.getByDisplayValue("auto"), { target: { value: "lr-nestopia" } });
    await scan();

    expect(screen.queryByRole("status")).toBeNull();
  });

  it("says where a pick applied, without counting a system with no emulator as using a different one", async () => {
    mocks.listLibraryFolders.mockResolvedValue([
      TWO_FOLDERS[1],
      { name: "foo", path: "/roms/foo", system: "foo", files: ["/roms/foo/c.x"] },
    ]);
    await setUp();
    fireEvent.change(screen.getByDisplayValue("auto"), { target: { value: "lr-nestopia" } });
    await scan();

    const notice = screen.getByRole("status").textContent;
    expect(notice).toContain("lr-nestopia only applies to nes");
    expect(notice).not.toContain("different");
  });

  it("says a pick ran nowhere when no scanned system has an emulator", async () => {
    mocks.listLibraryFolders.mockResolvedValue([
      { name: "foo", path: "/roms/foo", system: "foo", files: ["/roms/foo/c.x"] },
    ]);
    await setUp();
    fireEvent.change(screen.getByDisplayValue("auto"), { target: { value: "lr-nestopia" } });
    fireEvent.click(screen.getByRole("button", { name: /Scan/ }));

    await screen.findByText("foo");
    const notice = screen.getByRole("status").textContent;
    expect(notice).toContain("lr-nestopia doesn't apply to any system in this scan");
    expect(notice).not.toContain("different");
  });

  it("can't scan until the rules and emulators have loaded", async () => {
    mocks.getFormatMatrix.mockReturnValue(new Promise(() => undefined));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><FormatScreen /></QueryClientProvider>);

    await screen.findByRole("option", { name: "lr-nestopia" });
    expect((screen.getByRole("button", { name: /Scan/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText("Run a scan to check your library")).toBeNull();
    expect(screen.getByText("Loading format rules…")).toBeTruthy();
  });

  it("says so and can't scan when the rules fail to load", async () => {
    mocks.getEmulatorMatrix.mockRejectedValue(new Error("no"));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><FormatScreen /></QueryClientProvider>);

    await screen.findByText(/couldn't load its format rules/);
    expect((screen.getByRole("button", { name: /Scan/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText("Run a scan to check your library")).toBeNull();
  });

  it("opens one folder picker at a time", async () => {
    let close: (picked: string | null) => void = () => undefined;
    vi.mocked(open).mockReset();
    vi.mocked(open).mockReturnValue(new Promise((resolve) => { close = resolve; }));
    await setUp();
    const browse = screen.getByTitle("Browse") as HTMLButtonElement;

    fireEvent.click(browse);
    fireEvent.click(browse);
    expect(open).toHaveBeenCalledTimes(1);

    close("/picked");
    await waitFor(() => expect(browse.disabled).toBe(false));
    expect(screen.getByDisplayValue("/picked")).toBeTruthy();
  });

  it("flags results as out of date when the emulator or frontend changes, until a new scan", async () => {
    await setUp();
    await scan();
    expect(screen.queryByRole("status")).toBeNull();

    const emulatorSelect = screen.getByDisplayValue("auto");
    fireEvent.change(emulatorSelect, { target: { value: "lr-nestopia" } });
    expect(screen.getByRole("status").textContent).toContain("esde with emulator auto");
    fireEvent.change(emulatorSelect, { target: { value: "auto" } });
    expect(screen.queryByRole("status")).toBeNull();

    fireEvent.change(screen.getByDisplayValue("esde"), { target: { value: "retrobat" } });
    expect(screen.getByRole("status")).toBeTruthy();

    await scan();
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  });
});

describe("FormatScreen after an empty scan", () => {
  beforeEach(() => {
    mocks.listLibraryFolders.mockReset();
    mocks.listLibraryFolders.mockResolvedValue([]);
    mocks.getFormatMatrix.mockResolvedValue([]);
    mocks.getEmulatorMatrix.mockResolvedValue(MATRIX);
  });

  it("names the scanned library and flags it out of date when the root changes", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><FormatScreen /></QueryClientProvider>);
    await screen.findByRole("option", { name: "lr-nestopia" });
    await waitFor(() => expect((screen.getByRole("button", { name: /Scan/ }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: /Scan/ }));
    await screen.findByText(/No game files found in \/roms\./);
    expect(screen.queryByRole("status")).toBeNull();

    fireEvent.change(screen.getByDisplayValue("/roms"), { target: { value: "/other" } });

    expect(screen.getByText(/No game files found in \/roms\./)).toBeTruthy();
    expect(screen.queryByText(/No game files found in \/other/)).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("/roms");
  });
});

describe("FormatSystemRow badge", () => {
  it("says All OK only when nothing needs attention", () => {
    renderRow([result("Compatible")]);
    expect(screen.getByText("All OK")).toBeTruthy();
  });

  it("shows a condition instead of All OK", () => {
    renderRow([result("Compatible", { condition: "Must be an XISO" }), result("Compatible")]);
    expect(screen.getByText("1 conditional")).toBeTruthy();
    expect(screen.queryByText("All OK")).toBeNull();
  });

  it("shows files not checked next to issues", () => {
    renderRow([result("FormatIncompatible"), result("Unknown"), result("Unknown")]);
    expect(screen.getByText("1 issue")).toBeTruthy();
    expect(screen.getByText("2 not checked")).toBeTruthy();
  });

  it("counts files not checked when some files are fine", () => {
    renderRow([result("Compatible"), result("Unknown")]);
    expect(screen.getByText("1 not checked")).toBeTruthy();
  });

  it("says No rules yet when no file could be checked", () => {
    renderRow([result("Unknown"), result("Unknown")]);
    expect(screen.getByText("No rules yet")).toBeTruthy();
  });

  it("says not checked, not No rules yet, when the system has rules but none cover its files", () => {
    renderRow(
      [result("Unknown"), result("Unknown")],
      [{ system: "xbox", extension: "chd", emulator: "xemu", support: "supported" }]
    );
    expect(screen.getByText("2 not checked")).toBeTruthy();
    expect(screen.queryByText("No rules yet")).toBeNull();
  });

  it("says No rules yet when the system has rules, but none for the emulator it used", () => {
    renderRow(
      [result("Unknown"), result("Unknown")],
      [{ system: "xbox", extension: "iso", emulator: "another", support: "supported" }]
    );
    expect(screen.getByText("No rules yet")).toBeTruthy();
  });

  it("names the condition on the expanded file row", () => {
    render(
      <FormatSystemRow
        group={{ system: "xbox", results: [result("Compatible", { condition: "Must be an XISO", notes: "xemu docs" })] }}
        rules={[]} stagedFixes={[]} expanded onToggle={() => undefined} index={0} onStageFix={() => undefined}
      />
    );
    expect(screen.getByText("Conditional")).toBeTruthy();
    expect(screen.getByText("Must be an XISO")).toBeTruthy();
    expect(screen.getByText("xemu docs")).toBeTruthy();
  });
});

describe("FormatReferenceDrawer", () => {
  it("shows a rule's condition and notes", () => {
    const rules: FormatRule[] = [
      { system: "xbox", extension: "iso", emulator: "xemu", support: { conditional: { condition: "Must be an XISO" } }, notes: "xemu docs" },
      { system: "nes", extension: "nes", emulator: "mesen2", support: "supported", notes: "Plain note" },
    ];
    render(<FormatReferenceDrawer open rules={rules} onClose={() => undefined} />);
    const table = within(screen.getByRole("table"));
    expect(table.getByText("Must be an XISO")).toBeTruthy();
    expect(table.getByText("xemu docs")).toBeTruthy();
    expect(table.getByText("Plain note")).toBeTruthy();
  });

  it("shows why a format is unsupported", () => {
    const rules: FormatRule[] = [
      { system: "gamecube", extension: "rvz", emulator: "lr-dolphin", support: { unsupported: { reason: "Convert it to .iso" } } },
    ];
    render(<FormatReferenceDrawer open rules={rules} onClose={() => undefined} />);
    expect(within(screen.getByRole("table")).getByText("Convert it to .iso")).toBeTruthy();
  });
});

describe("FormatImpactTable", () => {
  it("shows a conditional rule in amber, like the file row", () => {
    render(
      <FormatImpactTable
        extension="iso"
        system="xbox"
        rules={[{ system: "xbox", extension: "iso", emulator: "xemu", support: { conditional: { condition: "Must be an XISO" } } }]}
      />
    );
    expect(screen.getByText("Conditional").className).toContain("text-amber-400");
  });
});

describe("FormatScreen on folders it didn't fully check", () => {
  beforeEach(() => {
    mocks.checkFormat.mockReset();
    mocks.listLibraryFolders.mockReset();
    mocks.getFormatMatrix.mockReset();
    mocks.getEmulatorMatrix.mockReset();
    mocks.getFormatMatrix.mockResolvedValue([]);
    mocks.getEmulatorMatrix.mockResolvedValue(MATRIX);
    mocks.checkFormat.mockImplementation(async (path: string, system: string, emulator: string) => ({
      path, extension: "x", system, emulator, state: "Compatible",
    }));
  });

  async function scan() {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <FormatScreen />
      </QueryClientProvider>
    );
    await waitFor(() => expect((screen.getByRole("button", { name: /Scan/ }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: /Scan/ }));
  }

  it("shows no All OK on a system with a read failure, and alerts", async () => {
    mocks.listLibraryFolders.mockResolvedValue([
      { name: "psx", path: "/roms/psx", system: "ps1", files: ["/roms/psx/a.chd"], error: "denied", uncheckedSubfolders: false },
    ]);
    await scan();
    expect((await screen.findByRole("alert")).textContent).toContain("psx");
    expect(await screen.findByText("Not fully checked")).toBeTruthy();
    expect(screen.queryByText("All OK")).toBeNull();
  });

  it("shows no All OK on an installed-tree system, and names it without an alert", async () => {
    mocks.listLibraryFolders.mockResolvedValue([
      { name: "dos", path: "/roms/dos", system: "dos", files: ["/roms/dos/a.zip"], error: null, uncheckedSubfolders: true },
    ]);
    await scan();
    expect(await screen.findByText("Not fully checked")).toBeTruthy();
    expect(screen.queryByText("All OK")).toBeNull();
    expect((await screen.findByText(/inside game folders/)).textContent).toContain("dos");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("still names an installed-tree system that has no rows, instead of saying nothing was found", async () => {
    mocks.listLibraryFolders.mockResolvedValue([
      { name: "windows", path: "/roms/windows", system: "windows", files: [], error: null, uncheckedSubfolders: true },
    ]);
    await scan();
    expect((await screen.findByText(/inside game folders/)).textContent).toContain("windows");
    expect(screen.queryByText(/No game files found/)).toBeNull();
  });
});
