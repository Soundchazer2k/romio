// SPDX-License-Identifier: GPL-3.0
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FormatScreen } from "@/components/format/FormatScreen";
import { FormatSystemRow } from "@/components/format/FormatSystemRow";
import { FormatReferenceDrawer } from "@/components/format/FormatReferenceDrawer";
import { emulatorForSystem } from "@/lib/utils";
import type { EmulatorMatrixEntry, FormatCheckResult, FormatCompatibilityState, FormatRule } from "@/types";

const MATRIX = [
  { system: "ps1", recommended: "duckstation", alternatives: ["lr-pcsx-rearmed"] },
  { system: "nes", recommended: "mesen2", alternatives: ["lr-nestopia"] },
] as EmulatorMatrixEntry[];

const mocks = vi.hoisted(() => ({
  checkFormat: vi.fn(),
}));

vi.mock("@/stores", () => ({
  useAppStore: () => ({
    activeProject: { libraryRoots: ["/roms"], targetFrontends: ["esde", "retrobat"] },
  }),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

vi.mock("@/lib/ipc", () => ({
  ipc: {
    getFormatMatrix:    () => Promise.resolve([]),
    getEmulatorMatrix:  () => Promise.resolve(MATRIX),
    listLibraryFolders: () => Promise.resolve([
      { name: "psx", path: "/roms/psx", files: ["/roms/psx/a.chd"] },
      { name: "nes", path: "/roms/nes", files: ["/roms/nes/b.nes"] },
    ]),
    checkFormat: (...args: unknown[]) => mocks.checkFormat(...args),
  },
}));

function result(state: FormatCompatibilityState, extra: Partial<FormatCheckResult> = {}): FormatCheckResult {
  return { path: `/roms/x/${Math.random()}.iso`, extension: "iso", system: "xbox", emulator: "xemu", state, ...extra };
}

function renderRow(results: FormatCheckResult[]) {
  return render(
    <FormatSystemRow
      group={{ system: "xbox", results }}
      rules={[]}
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

  it("shows unchecked files next to issues", () => {
    renderRow([result("FormatIncompatible"), result("Unknown"), result("Unknown")]);
    expect(screen.getByText("1 issue")).toBeTruthy();
    expect(screen.getByText("2 unchecked")).toBeTruthy();
  });

  it("counts unchecked files when some files are fine", () => {
    renderRow([result("Compatible"), result("Unknown")]);
    expect(screen.getByText("1 unchecked")).toBeTruthy();
  });

  it("says No rules yet when no file could be checked", () => {
    renderRow([result("Unknown"), result("Unknown")]);
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
});
