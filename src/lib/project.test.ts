// SPDX-License-Identifier: GPL-3.0
import { describe, it, expect } from "vitest";
import type { Project, ScanStats } from "@/types";
import { ipc } from "@/lib/ipc.mock";

describe("ScanStats shape", () => {
  it("has all required numeric fields", () => {
    const stats: ScanStats = {
      totalFiles: 10, classified: 8,
      blockingIssues: 1, errors: 1, warnings: 2, advisories: 3,
    };
    expect(stats.totalFiles).toBe(10);
    expect(stats.classified).toBe(8);
    expect(stats.blockingIssues).toBe(1);
  });
});

describe("project IPC mock — load path", () => {
  it("listProjects returns an array with at least one project", async () => {
    const projects = await ipc.listProjects();
    expect(Array.isArray(projects)).toBe(true);
    expect(projects.length).toBeGreaterThan(0);
  });

  it("getProject returns a project with the expected shape", async () => {
    const project: Project = await ipc.getProject("test-project-1");
    expect(project.id).toBeTruthy();
    expect(project.name).toBeTruthy();
    expect(Array.isArray(project.libraryRoots)).toBe(true);
  });

  it("getProject returns scan stats after a scan has run", async () => {
    const project = await ipc.getProject("test-project-1");
    // The fixture represents post-scan state
    expect(project.scanStats).toBeDefined();
    expect(project.scanStats!.totalFiles).toBeGreaterThan(0);
    expect(project.lastScannedAt).toBeTruthy();
  });
});

describe("scan IPC mock — scan flow", () => {
  it("scanLibrary resolves without error", async () => {
    await expect(ipc.scanLibrary("proj-1", ["/roms"])).resolves.toBeUndefined();
  });

  it("getScanStatus returns the expected shape", async () => {
    const status = await ipc.getScanStatus("proj-1");
    expect(typeof status.isRunning).toBe("boolean");
    expect(status.projectId).toBe("proj-1");
  });

  it("cancelScan resolves without error", async () => {
    await expect(ipc.cancelScan()).resolves.toBeUndefined();
  });
});
