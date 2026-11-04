// SPDX-License-Identifier: GPL-3.0
// @vitest-environment jsdom
// Uses the real store: leaving a screen unmounts it, so its local state can't be what remembers.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SavesScreen } from "@/components/saves/SavesScreen";
import { useAppStore } from "@/stores";
import type { Project } from "@/types";

vi.mock("@/lib/ipc", () => ({
  ipc: {
    discoverSaveRoots: () => Promise.resolve([]),
    getOperationLog:   () => Promise.resolve([]),
  },
}));

const project = (id: string, root: string) =>
  ({ id, name: id, libraryRoots: [root], targetFrontends: [], emulatorPrefs: {}, createdAt: "" }) as Project;

function showScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><SavesScreen /></QueryClientProvider>);
  return screen.getByPlaceholderText(/RetroBat/i) as HTMLInputElement;
}

describe("Saves root", () => {
  beforeEach(() => useAppStore.setState({ activeProject: project("a", "/library-a"), saveRoots: {} }));
  afterEach(cleanup);

  it("keeps a typed path after leaving the screen, for that project only", () => {
    fireEvent.change(showScreen(), { target: { value: "/typed-a" } });
    cleanup();
    expect(showScreen().value).toBe("/typed-a");
    cleanup();

    useAppStore.setState({ activeProject: project("b", "/library-b") });
    expect(showScreen().value).toBe("/library-b");
    cleanup();

    useAppStore.setState({ activeProject: project("a", "/library-a") });
    expect(showScreen().value).toBe("/typed-a");
  });

  it("can be cleared without snapping back to the library root", () => {
    fireEvent.change(showScreen(), { target: { value: "" } });
    cleanup();
    expect(showScreen().value).toBe("");
  });
});
