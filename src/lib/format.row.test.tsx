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
