// SPDX-License-Identifier: GPL-3.0
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "@/App";
import { useScanStore } from "@/stores";
import type { ScanProgressEvent } from "@/types";

const events = vi.hoisted(() => ({ handler: null as null | ((e: { payload: ScanProgressEvent }) => void) }));

vi.mock("@tauri-apps/api/event", () => ({
  listen: (_: string, handler: (e: { payload: ScanProgressEvent }) => void) => {
    events.handler = handler;
    return Promise.resolve(() => {});
  },
}));

describe("scan progress events", () => {
  it("keeps scanning after the walk ends: saving and the BIOS sweep still have to run", async () => {
    useScanStore.setState({ scanningProject: { id: "p", name: "Test" }, scanId: "p:1", progress: null });
    render(<QueryClientProvider client={new QueryClient()}><App /></QueryClientProvider>);
    await waitFor(() => expect(events.handler).toBeTruthy());

    events.handler!({ payload: { scanId: "p:1", filesScanned: 3, filesTotal: 3, currentPath: "", phase: "complete" } });

    expect(useScanStore.getState().scanningProject).toBeTruthy();
    // Stays up, so the panel doesn't vanish before the saving event arrives.
    expect(useScanStore.getState().progress?.phase).toBe("complete");
  });

  it("says it's finishing, with no count, once the walk's results are being saved", async () => {
    useScanStore.setState({ scanningProject: { id: "p", name: "Test" }, scanId: "p:1", progress: null });
    render(<QueryClientProvider client={new QueryClient()}><App /></QueryClientProvider>);
    await waitFor(() => expect(events.handler).toBeTruthy());

    act(() => events.handler!({ payload: { scanId: "p:1", filesScanned: 3, currentPath: "", phase: "saving" } }));

    expect(useScanStore.getState().progress?.phase).toBe("saving");
    expect(screen.getByText("Finishing scan of Test…")).toBeTruthy();
    expect(screen.queryByText(/d files/)).toBeNull();
  });

  it("drops an event from an earlier scan, so it can't show under the next scan's project", async () => {
    useScanStore.setState({ scanningProject: { id: "q", name: "Other" }, scanId: "q:1", progress: null });
    render(<QueryClientProvider client={new QueryClient()}><App /></QueryClientProvider>);
    await waitFor(() => expect(events.handler).toBeTruthy());

    act(() => events.handler!({ payload: { scanId: "p:1", filesScanned: 900, currentPath: "/old", phase: "hashing" } }));
    expect(useScanStore.getState().progress).toBeNull();

    act(() => events.handler!({ payload: { scanId: "q:1", filesScanned: 2, currentPath: "/new", phase: "hashing" } }));
    expect(useScanStore.getState().progress?.filesScanned).toBe(2);
  });

  it("drops an event that arrives after its scan has ended", async () => {
    useScanStore.setState({ scanningProject: null, scanId: null, progress: null });
    render(<QueryClientProvider client={new QueryClient()}><App /></QueryClientProvider>);
    await waitFor(() => expect(events.handler).toBeTruthy());

    act(() => events.handler!({ payload: { scanId: "p:1", filesScanned: 3, currentPath: "", phase: "saving" } }));
    expect(useScanStore.getState().progress).toBeNull();
  });
});
