// SPDX-License-Identifier: GPL-3.0
import { describe, it, expect } from "vitest";
import type { OperationLogEntry, SaveCheckpoint, SaveRoot } from "@/types";
import { ipc } from "@/lib/ipc.mock";

describe("OperationLogEntry type contract", () => {
  it("getOperationLog mock returns typed OperationLogEntry array", async () => {
    const log: OperationLogEntry[] = await ipc.getOperationLog("proj-1");
    expect(Array.isArray(log)).toBe(true);
  });
});

describe("SaveCheckpoint type contract", () => {
  it("createSaveCheckpoint mock returns checkpoint with projectId", async () => {
    const cp: SaveCheckpoint = await ipc.createSaveCheckpoint(
      "proj-1", "/saves/test", "duckstation"
    );
    expect(cp.projectId).toBe("proj-1");
    expect(cp.id).toBeTruthy();
    expect(cp.archivePath).toContain(".zip");
  });

  it("getCheckpoints mock returns array", async () => {
    const cps: SaveCheckpoint[] = await ipc.getCheckpoints("proj-1");
    expect(Array.isArray(cps)).toBe(true);
  });
});

describe("SaveRoot.expectedDestination", () => {
  it("fixture has expectedDestination on migration_needed root", async () => {
    const roots: SaveRoot[] = await ipc.discoverSaveRoots("/fake/root");
    const atRisk = roots.filter((r) => r.migrationState === "migration_needed");
    expect(atRisk.length).toBeGreaterThan(0);
    atRisk.forEach((r) => {
      expect(r.expectedDestination).toBeTruthy();
    });
  });
});

describe("createMigrationPlan mock accepts projectId", () => {
  it("passes through to fixture plan", async () => {
    const plan = await ipc.createMigrationPlan(
      "proj-1",
      "/saves/test",
      "/saves/new",
      "retroarch"
    );
    expect(plan.sourcePath).toBeTruthy();
    expect(plan.steps.length).toBeGreaterThan(0);
  });
});
