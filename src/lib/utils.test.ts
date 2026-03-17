import { describe, it, expect } from "vitest";
import {
  formatStateColor,
  formatStateBg,
  formatStateLabel,
  formatSupportLabel,
  groupResultsBySystem,
} from "./utils";
import type { FormatCheckResult } from "@/types";

describe("formatStateColor", () => {
  it("returns green for Compatible", () =>
    expect(formatStateColor("Compatible")).toBe("text-romio-green"));
  it("returns amber for FormatDeprecated", () =>
    expect(formatStateColor("FormatDeprecated")).toBe("text-amber-400"));
  it("returns red for FormatIncompatible", () =>
    expect(formatStateColor("FormatIncompatible")).toBe("text-romio-red"));
  it("returns gray for Unknown", () =>
    expect(formatStateColor("Unknown")).toBe("text-romio-gray"));
  it("returns muted for NotApplicable", () =>
    expect(formatStateColor("NotApplicable")).toBe("text-romio-gray opacity-50"));
});

describe("formatStateBg", () => {
  it("returns green bg for Compatible", () =>
    expect(formatStateBg("Compatible")).toBe("bg-romio-green/10"));
  it("returns amber bg for FormatDeprecated", () =>
    expect(formatStateBg("FormatDeprecated")).toBe("bg-amber-400/10"));
  it("returns red bg for FormatIncompatible", () =>
    expect(formatStateBg("FormatIncompatible")).toBe("bg-romio-red/10"));
  it("returns empty for NotApplicable", () =>
    expect(formatStateBg("NotApplicable")).toBe(""));
});

describe("formatStateLabel", () => {
  it("labels Compatible", () => expect(formatStateLabel("Compatible")).toBe("Compatible"));
  it("labels FormatDeprecated", () => expect(formatStateLabel("FormatDeprecated")).toBe("Deprecated"));
  it("labels FormatIncompatible", () => expect(formatStateLabel("FormatIncompatible")).toBe("Incompatible"));
  it("labels Unknown", () => expect(formatStateLabel("Unknown")).toBe("Unknown"));
  it("labels NotApplicable", () => expect(formatStateLabel("NotApplicable")).toBe("N/A"));
});

describe("formatSupportLabel", () => {
  it("labels string supported", () =>
    expect(formatSupportLabel("supported")).toBe("Supported"));
  it("labels deprecated with replacement", () =>
    expect(formatSupportLabel({ deprecated: { replacement: "hypseus" } }))
      .toBe("Deprecated → .hypseus"));
  it("labels unsupported", () =>
    expect(formatSupportLabel({ unsupported: { reason: "No .rvz support" } }))
      .toBe("Unsupported"));
  it("labels conditional", () =>
    expect(formatSupportLabel({ conditional: { condition: "Requires BIOS" } }))
      .toBe("Conditional"));
});

describe("groupResultsBySystem", () => {
  it("groups results by system field", () => {
    const results: FormatCheckResult[] = [
      { path: "/a.rvz",    extension: "rvz",    system: "gamecube", emulator: "dolphin",    state: "Compatible" },
      { path: "/b.daphne", extension: "daphne", system: "daphne",   emulator: "hypseus",    state: "FormatDeprecated" },
      { path: "/c.rvz",    extension: "rvz",    system: "gamecube", emulator: "lr-dolphin", state: "FormatIncompatible" },
    ];
    const groups = groupResultsBySystem(results);
    expect(groups).toHaveLength(2);
    const gc = groups.find((g) => g.system === "gamecube")!;
    expect(gc.results).toHaveLength(2);
    const da = groups.find((g) => g.system === "daphne")!;
    expect(da.results).toHaveLength(1);
  });

  it("uses 'unknown' for results with no system", () => {
    const results: FormatCheckResult[] = [
      { path: "/a.bin", extension: "bin", state: "Unknown" },
    ];
    const groups = groupResultsBySystem(results);
    expect(groups[0].system).toBe("unknown");
  });
});
