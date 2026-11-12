// SPDX-License-Identifier: GPL-3.0
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, fireEvent, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ProjectsScreen } from "@/components/dashboard/ProjectsScreen";
import { useAppStore } from "@/stores";
import type { Project } from "@/types";

const project = (id: string, name: string) =>
  ({ id, name, libraryRoots: ["/roms"], targetFrontends: [], emulatorPrefs: {}, createdAt: "" }) as Project;
const ALPHA = project("a", "Alpha");
const BETA  = project("b", "Beta");

const mocks = vi.hoisted(() => ({ listProjects: vi.fn(), getSupportedFrontends: vi.fn(), getProject: vi.fn() }));
vi.mock("@/lib/ipc", () => ({ ipc: mocks }));

/** getProject answers only when the test says so, per call. */
function deferred() {
  const calls: { id: string; resolve: (p: Project) => void; reject: (e: Error) => void }[] = [];
  mocks.getProject.mockImplementation((id: string) =>
    new Promise<Project>((resolve, reject) => { calls.push({ id, resolve, reject }); }));
  return calls;
}

function renderProjects() {
  return render(<QueryClientProvider client={new QueryClient()}><ProjectsScreen /></QueryClientProvider>);
}

describe("opening a project from Projects", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listProjects.mockResolvedValue([ALPHA, BETA]);
    mocks.getSupportedFrontends.mockResolvedValue([]);
    useAppStore.setState({ screen: "projects", activeProject: null });
  });
  afterEach(cleanup);

  it("opens the last project picked, whichever answer arrives last", async () => {
    const calls = deferred();
    renderProjects();
    fireEvent.click(await screen.findByText("Alpha"));
    fireEvent.click(screen.getByText("Beta"));

    await act(async () => { calls[1].resolve(BETA); });
    await act(async () => { calls[0].resolve(ALPHA); });
    expect(useAppStore.getState().activeProject?.id).toBe("b");
  });

  it("drops a pick you walked away from", async () => {
    const calls = deferred();
    const first = renderProjects();
    fireEvent.click(await screen.findByText("Alpha"));
    first.unmount();

    // Back on Projects, and this time Beta
    renderProjects();
    fireEvent.click(await screen.findByText("Beta"));
    await act(async () => { calls[1].resolve(BETA); });
    await act(async () => { calls[0].resolve(ALPHA); });
    expect(useAppStore.getState().activeProject?.id).toBe("b");
  });

  it("keeps the newer answer when the same project is picked twice", async () => {
    const calls = deferred();
    renderProjects();
    fireEvent.click(await screen.findByText("Alpha"));
    fireEvent.click(screen.getByText("Alpha"));

    const newer = { ...ALPHA, name: "Alpha, rescanned" };
    await act(async () => { calls[1].resolve(newer); });
    await act(async () => { calls[0].resolve(ALPHA); });
    expect(useAppStore.getState().activeProject).toBe(newer);
  });

  it("says so when the project can't be opened, but not for a pick that was replaced", async () => {
    const calls = deferred();
    renderProjects();
    fireEvent.click(await screen.findByText("Alpha"));
    fireEvent.click(screen.getByText("Beta"));

    await act(async () => { calls[0].reject(new Error("old")); });
    expect(screen.queryByRole("alert")).toBeNull();
    await act(async () => { calls[1].reject(new Error("locked")); });
    expect(screen.getByRole("alert").textContent).toContain("locked");
    expect(useAppStore.getState().screen).toBe("projects");
  });
});
