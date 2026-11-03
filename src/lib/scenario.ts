// SPDX-License-Identifier: GPL-3.0
// The three moments Romio serves (DESIGN.md, "Who it is for"). The scenario decides
// where Romio starts after a project opens and which checks the dashboard leads with.

import type { Screen } from "@/stores";

export type Scenario = "curator" | "handheld" | "rescuer";

export type DashboardCheck = "bios" | "saves" | "format";

interface ScenarioInfo {
  title:       string;
  description: string;
  /** First screen after a project opens */
  start:       Screen;
  /** Dashboard check cards, most relevant first */
  checks:      DashboardCheck[];
}

export const SCENARIOS: Record<Scenario, ScenarioInfo> = {
  curator: {
    title:       "I'm about to change something",
    description: "Updating an emulator, switching frontends, or rescanning. Saves get checked first.",
    start:       "saves",
    checks:      ["saves", "bios", "format"],
  },
  handheld: {
    title:       "I'm setting up a new device",
    description: "A Steam Deck, Retroid or Batocera box. One step at a time, starting with your system.",
    start:       "preflight",
    checks:      ["bios", "format", "saves"],
  },
  rescuer: {
    title:       "Something just broke",
    description: "Games or saves stopped working after an update. Romio looks for what changed.",
    start:       "dashboard",
    checks:      ["bios", "saves", "format"],
  },
};

export const SCENARIO_ORDER: Scenario[] = ["curator", "handheld", "rescuer"];

/** Where to go after opening a project; pre-flight when no scenario was picked. */
export function startScreen(scenario: Scenario | null): Screen {
  return scenario ? SCENARIOS[scenario].start : "preflight";
}

/** Dashboard check order; the handheld order is the neutral default. */
export function dashboardChecks(scenario: Scenario | null): DashboardCheck[] {
  return SCENARIOS[scenario ?? "handheld"].checks;
}
