// SPDX-License-Identifier: GPL-3.0
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { FormatSystemRow } from "@/components/format/FormatSystemRow";
import type { FormatCheckResult } from "@/types";

const file = (state: FormatCheckResult["state"], i: number): FormatCheckResult => ({
  path: `C:/lib/roms/pico8/${i}.x`,
  extension: "x",
  system: "pico8",
  emulator: "lr-retro8",
  state,
});

function renderRow(...states: FormatCheckResult["state"][]) {
  render(
    <FormatSystemRow
      group={{ system: "pico8", results: states.map(file) }}
      rules={[]}
      stagedFixes={[]}
      expanded={false}
      onToggle={() => {}}
      index={0}
      onStageFix={() => {}}
    />
  );
}

describe("FormatSystemRow badge", () => {
  afterEach(cleanup);

  it("says No rules yet only when no file in the folder has a rule", () => {
    renderRow("Unknown", "Unknown");
    expect(screen.getByText("No rules yet")).toBeTruthy();
  });

  it("counts unchecked files when the folder's other files have rules", () => {
    renderRow("Compatible", "Compatible", "Unknown");
    expect(screen.getByText("1 not checked")).toBeTruthy();
    expect(screen.queryByText("No rules yet")).toBeNull();
    expect(screen.queryByText("All OK")).toBeNull();
  });

  it("says All OK when every file has a rule that passes", () => {
    renderRow("Compatible", "Compatible");
    expect(screen.getByText("All OK")).toBeTruthy();
  });
});

describe("FormatSystemRow on a system Romio didn't fully check", () => {
  afterEach(cleanup);

  function renderPartial(...states: FormatCheckResult["state"][]) {
    return render(
      <FormatSystemRow
        group={{ system: "pico8", results: states.map(file) }}
        rules={[]}
        stagedFixes={[]}
        expanded={false}
        onToggle={() => {}}
        index={0}
        onStageFix={() => {}}
        notFullyChecked
      />
    );
  }

  it("says Not fully checked instead of All OK, without the green border", () => {
    const { container } = renderPartial("Compatible", "Compatible");
    expect(screen.getByText("Not fully checked")).toBeTruthy();
    expect(screen.queryByText("All OK")).toBeNull();
    expect((container.firstChild as HTMLElement).className).not.toContain("border-romio-green");
  });

  it("keeps showing issues first", () => {
    renderPartial("Compatible", "FormatIncompatible");
    expect(screen.getByText("1 issue")).toBeTruthy();
    expect(screen.queryByText("Not fully checked")).toBeNull();
    expect(screen.queryByText("All OK")).toBeNull();
  });
});
