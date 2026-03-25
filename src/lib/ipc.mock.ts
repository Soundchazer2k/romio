// SPDX-License-Identifier: GPL-3.0
// Mock implementation of ipc.ts for Playwright tests.
// Imported via Vite alias when VITE_TEST_MODE=true — components never know.
// Return types must match src/types/index.ts exactly.

import type {
  Project, CreateProjectRequest,
  BiosSystemResult, BiosRule,
  HostEnvironmentReport,
  SaveRoot, MigrationPlan,
  FrontendInfo,
  FormatRule, FormatCheckResult, EmulatorMatrixEntry,
} from "@/types";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const FIXTURE_PROJECT: Project = {
  id: "test-project-1",
  name: "Test Library",
  libraryRoots: ["/Volumes/External_SSD/Roms"],
  targetFrontends: ["esde", "batocera"],
  emulatorPrefs: { "Sony - PlayStation": "duckstation" },
  createdAt: "2026-01-01T00:00:00Z",
  lastScannedAt: "2026-03-25T10:00:00Z",
  scanStats: {
    totalFiles: 240,
    classified: 238,
    blockingIssues: 1,
    errors: 1,
    warnings: 3,
    advisories: 5,
  },
};

const FIXTURE_BIOS_RESULT: BiosSystemResult = {
  system: "psx",
  entries: [
    {
      rule: {
        filename: "scph5501.bin",
        knownGoodMd5: ["8dd7d5296a650fac7319bce665a6a53c"],
        knownBadMd5: [],
        system: "psx",
        requirement: "required",
        compressed: false,
        defaultPath: "bios/scph5501.bin",
        frontendPaths: { esde: "bios/scph5501.bin" },
        emulatorPaths: { duckstation: "bios/scph5501.bin" },
      },
      foundPath: "/Volumes/External_SSD/Emulation/BIOS/scph5501.bin",
      foundMd5: "8dd7d5296a650fac7319bce665a6a53c",
      state: "PRESENT_VALID",
    },
    {
      rule: {
        filename: "scph70012.bin",
        knownGoodMd5: ["b9d9a0286c33dc6b7237bb13cd46fdee"],
        knownBadMd5: [],
        system: "ps2",
        requirement: "required",
        compressed: false,
        defaultPath: "bios/scph70012.bin",
        frontendPaths: {},
        emulatorPaths: { pcsx2: "bios/PS2/scph70012.bin" },
      },
      state: "MISSING_REQUIRED",
    },
  ],
  blocking: true,
};

const FIXTURE_HOST_ENV: HostEnvironmentReport = {
  platform: "windows",
  checks: [
    {
      id: "vcredist",
      name: "Visual C++ Redistributable",
      description: "Required by several Windows emulators",
      affectedEmulators: ["duckstation", "pcsx2"],
      state: "present",
      detectedVersion: "14.38",
    },
    {
      id: "dotnet",
      name: ".NET Runtime",
      description: "Required by some emulators",
      affectedEmulators: ["ryujinx"],
      state: "missing",
      minimumVersion: "8.0",
      remediation: {
        description: "Download from https://dotnet.microsoft.com",
        url: "https://dotnet.microsoft.com/download/dotnet/8.0",
        autoFixable: false,
      },
    },
  ],
  allPass: false,
  blockingCount: 0,
};

const FIXTURE_SAVE_ROOTS: SaveRoot[] = [
  {
    path: "/home/user/.config/retroarch/saves",
    emulator: "retroarch",
    isSymlink: false,
    fileCount: 42,
    sizeBytes: 1048576,
    migrationState: "migration_needed",
  },
  {
    path: "/home/user/.config/retroarch/states",
    emulator: "retroarch",
    isSymlink: true,
    realPath: "/mnt/external/states",
    fileCount: 15,
    sizeBytes: 524288,
    migrationState: "already_migrated",
  },
];

const FIXTURE_MIGRATION_PLAN: MigrationPlan = {
  sourcePath: "/home/user/.config/retroarch/saves",
  destinationPath: "/mnt/external/saves",
  fileCount: 42,
  sizeBytes: 1048576,
  emulator: "retroarch",
  requiresBackup: true,
  steps: [
    { order: 1, action: "create_checkpoint", description: "Backup current saves", reversible: false },
    { order: 2, action: "copy_files", description: "Copy save files", reversible: true },
    { order: 3, action: "verify_destination", description: "Verify copy integrity", reversible: true },
  ],
};

const FIXTURE_FRONTENDS: FrontendInfo[] = [
  { id: "esde", name: "EmulationStation Desktop Edition", tier: 1 },
  { id: "batocera", name: "Batocera", tier: 1 },
  { id: "retrobat", name: "RetroBat", tier: 2 },
];

const FIXTURE_EMULATOR_MATRIX: EmulatorMatrixEntry[] = [
  {
    system: "Sony - PlayStation",
    recommended: "duckstation",
    alternatives: ["mednafen"],
    status: "stable",
    biosRequired: true,
  },
  {
    system: "Sony - PlayStation 2",
    recommended: "pcsx2",
    alternatives: [],
    status: "stable",
    biosRequired: true,
  },
  {
    system: "Nintendo - Game Boy Advance",
    recommended: "mgba",
    alternatives: ["vba-m"],
    status: "stable",
    biosRequired: false,
  },
];

const FIXTURE_FORMAT_RESULT: FormatCheckResult = {
  path: "/Roms/psx/game.bin",
  extension: "bin",
  system: "psx",
  emulator: "duckstation",
  state: "Compatible",
};

// ── Mock ipc object — same shape as the real ipc in ipc.ts ───────────────────

export const ipc = {
  // Projects
  createProject: async (_req: CreateProjectRequest): Promise<Project> =>
    FIXTURE_PROJECT,
  openProject: async (_id: string): Promise<Project> =>
    FIXTURE_PROJECT,
  listProjects: async (): Promise<Project[]> =>
    [FIXTURE_PROJECT],
  getProject: async (_id: string): Promise<Project> =>
    FIXTURE_PROJECT,

  // Scan
  scanLibrary: async (_projectId: string, _roots: string[]): Promise<void> =>
    undefined,
  getScanStatus: async (projectId: string) =>
    ({ isRunning: false, projectId }),
  cancelScan: async (): Promise<void> =>
    undefined,

  // Host environment
  checkHostEnv: async (): Promise<HostEnvironmentReport> =>
    FIXTURE_HOST_ENV,

  // BIOS
  validateBios: async (
    _system: string, _biosRoot: string, _frontend: string, _emulator: string
  ): Promise<BiosSystemResult> => FIXTURE_BIOS_RESULT,
  getBiosRules: async (_system: string): Promise<BiosRule[]> =>
    FIXTURE_BIOS_RESULT.entries.map((e) => e.rule),
  getBiosStatus: async (_projectId: string): Promise<BiosSystemResult[]> =>
    [FIXTURE_BIOS_RESULT],

  // Format
  checkFormat: async (
    _path: string, _system: string, _emulator: string, _frontend: string
  ): Promise<FormatCheckResult> => FIXTURE_FORMAT_RESULT,
  getFormatMatrix: async (): Promise<FormatRule[]> => [],
  getEmulatorMatrix: async (): Promise<EmulatorMatrixEntry[]> =>
    FIXTURE_EMULATOR_MATRIX,

  // Save migration
  discoverSaveRoots: async (_frontendRoot: string): Promise<SaveRoot[]> =>
    FIXTURE_SAVE_ROOTS,
  checkMigrationNeeded: async (_frontendRoot: string): Promise<boolean> =>
    true,
  createMigrationPlan: async (
    _source: string, _destination: string, _emulator: string
  ): Promise<MigrationPlan> => FIXTURE_MIGRATION_PLAN,
  executeMigration: async (_plan: MigrationPlan): Promise<void> =>
    undefined,
  createSaveCheckpoint: async (_source: string, _emulator: string): Promise<void> =>
    undefined,

  // Multi-disc (placeholder screens — minimal stubs)
  detectMultiDisc: async (_root: string) => [],
  generateM3u: async (_set: unknown, _outputDir: string, _frontend: string): Promise<string> =>
    "",

  // ScummVM (placeholder screens — minimal stubs)
  detectScummvm: async (_root: string) => [],
  generatePointers: async (_games: unknown[], _frontend: string): Promise<string[]> =>
    [],

  // Installed titles (placeholder screens — minimal stubs)
  validateInstalled: async (_titles: unknown[]) => [],
  validateShortcutContent: async (_command: string) => null,
  generateShortcuts: async (_titles: unknown[], _frontend: string): Promise<string[]> =>
    [],

  // Export (placeholder screens — minimal stubs)
  getSupportedFrontends: async (): Promise<FrontendInfo[]> =>
    FIXTURE_FRONTENDS,
  planExport: async (_projectId: string, _frontend: string) => null,
  executeExport: async (_plan: unknown): Promise<void> => undefined,
  dryRunExport: async (_projectId: string, _frontend: string) => null,

  // Rollback (placeholder screens — minimal stubs)
  getOperationLog: async (_projectId: string) => [],
  rollback: async (_operationId: string): Promise<void> => undefined,
};
