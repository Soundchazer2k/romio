// SPDX-License-Identifier: GPL-3.0
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "@/App";
import { useScanStore } from "@/stores";
import type { ScanProgress } from "@/types";

const events = vi.hoisted(() => ({ handler: null as null | ((e: { payload: ScanProgress }) => void) }));

vi.mock("@tauri-apps/api/event", () => ({
  listen: (_: string, handler: (e: { payload: ScanProgress }) => void) => {
    events.handler = handler;
    return Promise.resolve(() => {});
  },
}));

describe("scan progress events", () => {
  it("keeps scanning after the walk ends: saving and the BIOS sweep still have to run", async () => {
    useScanStore.setState({ isScanning: true });
    render(<QueryClientProvider client={new QueryClient()}><App /></QueryClientProvider>);
    await waitFor(() => expect(events.handler).toBeTruthy());

    events.handler!({ payload: { filesScanned: 3, filesTotal: 3, currentPath: "", phase: "complete" } as ScanProgress });

    expect(useScanStore.getState().isScanning).toBe(true);
    expect(useScanStore.getState().progress).toBeNull();
  });
});
