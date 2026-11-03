// SPDX-License-Identifier: GPL-3.0
import { describe, it, expect } from "vitest";
import { SCENARIOS, SCENARIO_ORDER, startScreen, dashboardChecks } from "@/lib/scenario";

describe("scenarios", () => {
  it("start where DESIGN.md says each moment leads", () => {
    expect(startScreen("curator")).toBe("saves");
    expect(startScreen("handheld")).toBe("preflight");
    expect(startScreen("rescuer")).toBe("dashboard");
    expect(startScreen(null)).toBe("preflight");
  });

  it("list every dashboard check exactly once", () => {
    for (const id of SCENARIO_ORDER) {
      expect([...SCENARIOS[id].checks].sort()).toEqual(["bios", "format", "saves"]);
    }
    expect(dashboardChecks(null)).toEqual(SCENARIOS.handheld.checks);
  });

  it("curator leads with saves", () => {
    expect(dashboardChecks("curator")[0]).toBe("saves");
  });
});
