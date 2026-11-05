// SPDX-License-Identifier: GPL-3.0
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { Sidebar } from "@/components/shared/Sidebar";
import { useAppStore } from "@/stores";
import type { Project } from "@/types";

const PROJECT = { id: "p", name: "Test", libraryRoots: [], targetFrontends: [], emulatorPrefs: {}, createdAt: "" } as Project;
const WARNING = "Save data at risk. Review this carefully before proceeding.";

describe("Sidebar companion", () => {
  beforeEach(() => {
    useAppStore.setState({ screen: "saves", romioState: "difficult_save", activeProject: PROJECT });
  });
  afterEach(cleanup);

  it("doesn't carry one screen's warning to the next", async () => {
    render(<Sidebar />);
    expect(screen.getByText(WARNING)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Format Check/ }));

    expect(useAppStore.getState().screen).toBe("format");
    // The old line animates out first
    expect(await screen.findByText("Ready when you are.")).toBeTruthy();
    expect(screen.queryByText(WARNING)).toBeNull();
  });

  it("asks for a scan on a Dashboard that has no checks to pick yet", () => {
    useAppStore.setState({ screen: "dashboard", romioState: "idle" });
    render(<Sidebar />);
    expect(screen.getByText("Scan your library first and we'll see what needs checking.")).toBeTruthy();
  });

  it("points at the checks once a scan has found something", () => {
    useAppStore.setState({ screen: "dashboard", romioState: "idle", activeProject: { ...PROJECT, scanStats: { totalFiles: 21 } } as Project });
    render(<Sidebar />);
    expect(screen.getByText("Pick a check and I'll get to it.")).toBeTruthy();
  });

  it("goes back to Projects with the project still open, so you can return to it", () => {
    render(<Sidebar />);
    fireEvent.click(screen.getByRole("button", { name: /^Projects$/ }));
    expect(useAppStore.getState().screen).toBe("projects");
    expect(useAppStore.getState().activeProject).toBe(PROJECT);
    expect(useAppStore.getState().romioState).toBe("idle");
  });

  it("keeps the warning when you click the screen you're already on", () => {
    render(<Sidebar />);
    fireEvent.click(screen.getByRole("button", { name: /Save Migration/ }));
    expect(screen.getByText(WARNING)).toBeTruthy();
  });

  it("still says no project is open when none is", () => {
    useAppStore.setState({ screen: "projects", romioState: "idle", activeProject: null });
    render(<Sidebar />);
    expect(screen.getByText(/No project open\. Create or open a project/)).toBeTruthy();
  });
});
