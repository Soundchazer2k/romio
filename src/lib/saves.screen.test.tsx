// SPDX-License-Identifier: GPL-3.0
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SavesScreen } from "@/components/saves/SavesScreen";
import type { SaveRoot } from "@/types";

// vi.hoisted runs before module evaluation — safe to reference from vi.mock factories
const mocks = vi.hoisted(() => ({
  activeProject: null as Record<string, unknown> | null,
  setRomioState: vi.fn(),
  discoverSaveRoots: vi.fn((_root?: string) => Promise.resolve([] as SaveRoot[])),
  getOperationLog: vi.fn((_id?: string) => Promise.resolve([])),
}));

vi.mock("@/stores", () => ({
  useAppStore: () => ({
    activeProject: mocks.activeProject,
    setRomioState: mocks.setRomioState,
  }),
}));

vi.mock("@/lib/ipc", () => ({
  ipc: {
    discoverSaveRoots: (root: string) => mocks.discoverSaveRoots(root),
    getOperationLog:   (id: string)   => mocks.getOperationLog(id),
  },
}));

function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SavesScreen />
    </QueryClientProvider>
  );
}

describe("SavesScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.activeProject = null;
    mocks.discoverSaveRoots.mockResolvedValue([]);
    mocks.getOperationLog.mockResolvedValue([]);
  });

  it("shows blocked state when no active project", () => {
    renderScreen();
    expect(screen.getByText("Open a project to use Save Migration.")).toBeTruthy();
  });

  it("shows scan UI when active project is set", () => {
    mocks.activeProject = { id: "proj-1", name: "My Library" };
    renderScreen();
    expect(screen.getByText("Save Migration")).toBeTruthy();
    expect(screen.queryByText("Open a project to use Save Migration.")).toBeNull();
  });

  it("Plan Migration button is disabled when root has no expectedDestination", async () => {
    mocks.activeProject = { id: "proj-1", name: "My Library" };
    const rootWithoutDest: SaveRoot = {
      path:           "/saves/duckstation",
      emulator:       "duckstation",
      isSymlink:      false,
      fileCount:      5,
      sizeBytes:      4096,
      migrationState: "migration_needed",
      // expectedDestination intentionally omitted
    };
    mocks.discoverSaveRoots.mockResolvedValue([rootWithoutDest]);

    renderScreen();
    fireEvent.change(
      screen.getByPlaceholderText(/RetroBat/i),
      { target: { value: "/home/user/retrobat" } },
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /plan migration/i })).toBeTruthy();
    });

    const btn = screen.getByRole("button", { name: /plan migration/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("execute control is not a clickable button", async () => {
    mocks.activeProject = { id: "proj-1", name: "My Library" };
    mocks.discoverSaveRoots.mockResolvedValue([]);

    renderScreen();

    // The execute control must never appear as a <button> — it is a locked <div>
    // If it were a <button>, getByRole("button", { name: /execute migration/i }) would find it.
    // We assert it does NOT exist as an interactive button.
    expect(
      screen.queryByRole("button", { name: /execute migration/i }),
    ).toBeNull();
  });
});
