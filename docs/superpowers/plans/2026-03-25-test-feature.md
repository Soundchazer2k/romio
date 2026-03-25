# `/test-feature` Skill: Playwright Testing Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Playwright testing infrastructure with a mocked IPC layer, then deliver the `/test-feature <screen>` skill and `test-writer` subagent that generate and run per-screen interaction tests.

**Architecture:** Playwright targets the Vite dev server at `:1444` in standard Chromium (no Tauri shell). When `VITE_TEST_MODE=true`, Vite aliases `@/lib/ipc` → `ipc.mock.ts` and `@tauri-apps/plugin-*` → `tauri-plugins.mock.ts`, making the full UI testable without the Rust backend. The `/test-feature` skill gathers screen context, dispatches a `test-writer` subagent to generate test files, then runs Playwright and reports results.

**Tech Stack:** `@playwright/test`, Vite module aliases, React 18, TypeScript, Zustand, pnpm, Tauri v2

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `playwright.config.ts` | Create | Playwright config: Chromium, Vite webServer, baseURL |
| `src/lib/ipc.mock.ts` | Create | Typed fixture implementations of every `ipc.ts` function |
| `src/lib/tauri-plugins.mock.ts` | Create | Mock `readDir` (plugin-fs) and `open` (plugin-dialog) |
| `vite.config.ts` | Modify | Add `VITE_TEST_MODE` block that splices in mock aliases |
| `package.json` | Modify | Add `"test:e2e": "playwright test"` script |
| `tests/smoke.spec.ts` | Create | One-step infrastructure smoke test (navigate to `/`, assert title) |
| `.claude/agents/test-writer.md` | Create | Subagent definition: reads context bundle, writes spec files |
| `.claude/skills/test-feature/SKILL.md` | Create | Skill definition: validates arg, gathers context, dispatches subagent, runs Playwright |

---

## Chunk 1: Playwright Infrastructure

### Task 1: Install Playwright

**Files:**
- Modify: `package.json` (devDependencies)

- [ ] **Step 1: Install `@playwright/test`**

```bash
cd "H:/Vibe Coding/Romio"
pnpm add -D @playwright/test
```

Expected: `@playwright/test` appears in `package.json` devDependencies.

- [ ] **Step 2: Install the Chromium browser binary**

```bash
pnpm exec playwright install chromium
```

Expected: Output ends with `✓ Chromium ... is already installed` or `Downloading Chromium ...` — either is fine.

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: add @playwright/test dependency"
```

---

### Task 2: Create `playwright.config.ts`

**Files:**
- Create: `playwright.config.ts`

- [ ] **Step 1: Write the config**

Create `H:/Vibe Coding/Romio/playwright.config.ts`:

```ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://localhost:1444",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:1444",
    reuseExistingServer: !process.env.CI,
    env: {
      VITE_TEST_MODE: "true",
    },
  },
});
```

- [ ] **Step 2: Commit**

```bash
git add playwright.config.ts
git commit -m "chore: add playwright.config.ts"
```

---

### Task 3: Modify `vite.config.ts` to add test aliases

**Files:**
- Modify: `vite.config.ts`

Current file content:
```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig(async () => ({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  clearScreen: false,
  server: {
    port: 1444,
    strictPort: true,
    host: "127.0.0.1",
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
```

- [ ] **Step 1: Add the `VITE_TEST_MODE` block**

Replace the entire file with:

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// process.env is read at config evaluation time (NOT import.meta.env at runtime).
// This is the correct pattern for Vite module aliasing.
const isTestMode = process.env.VITE_TEST_MODE === "true";

export default defineConfig(async () => ({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // When VITE_TEST_MODE=true, swap real IPC and Tauri plugins for mocks
      // so Playwright can run against the Vite dev server without the Rust backend.
      ...(isTestMode
        ? {
            "@/lib/ipc": path.resolve(__dirname, "src/lib/ipc.mock.ts"),
            "@tauri-apps/plugin-fs": path.resolve(
              __dirname,
              "src/lib/tauri-plugins.mock.ts"
            ),
            "@tauri-apps/plugin-dialog": path.resolve(
              __dirname,
              "src/lib/tauri-plugins.mock.ts"
            ),
          }
        : {}),
    },
  },
  clearScreen: false,
  server: {
    port: 1444,
    strictPort: true,
    host: "127.0.0.1",
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
```

- [ ] **Step 2: Commit**

```bash
git add vite.config.ts
git commit -m "chore: add VITE_TEST_MODE alias block to vite.config.ts"
```

---

### Task 4: Add `test:e2e` script to `package.json`

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add the script**

In `package.json`, find the `"scripts"` block and add `"test:e2e"` alongside the existing scripts:

```json
"test:e2e": "playwright test"
```

After editing, the scripts block should contain:
```json
"scripts": {
  "dev": "vite",
  "build": "tsc && vite build",
  "preview": "vite preview",
  "tauri": "tauri",
  "lint": "eslint src --ext ts,tsx --report-unused-disable-directives --max-warnings 0",
  "typecheck": "tsc --noEmit",
  "test": "vitest",
  "test:ui": "vitest --ui",
  "test:e2e": "playwright test"
}
```

- [ ] **Step 2: Commit**

```bash
git add package.json
git commit -m "chore: add test:e2e script"
```

---

### Task 5: Infrastructure smoke test

**Files:**
- Create: `tests/smoke.spec.ts`

This test only checks that Playwright can start the dev server and load the app. It does NOT test any UI — that's the job of the generated per-screen tests.

- [ ] **Step 1: Create the smoke test**

Create `H:/Vibe Coding/Romio/tests/smoke.spec.ts`:

```ts
import { test, expect } from "@playwright/test";

// This test only verifies the infrastructure is wired correctly:
// - Vite dev server starts with VITE_TEST_MODE=true
// - The app loads without a crash
// - The IPC mock alias is active (no "invoke is not a function" errors in console)
test("app loads without errors in test mode", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  await page.goto("/");

  // App shell should render
  await expect(page.locator("body")).not.toBeEmpty();

  // No IPC errors — if the alias isn't working, we'd see "invoke is not a function"
  const ipcErrors = consoleErrors.filter((e) => e.includes("invoke"));
  expect(ipcErrors).toHaveLength(0);
});
```

- [ ] **Step 2: Run the smoke test**

```bash
cd "H:/Vibe Coding/Romio"
pnpm exec playwright test tests/smoke.spec.ts
```

Expected output:
```
Running 1 test using 1 worker
  ✓  tests/smoke.spec.ts:8:1 › app loads without errors in test mode (Xms)
1 passed
```

If you see `invoke is not a function` in the failure output, the Vite alias is not applying — double-check that `process.env.VITE_TEST_MODE` (not `import.meta.env.VITE_TEST_MODE`) is used in `vite.config.ts`.

If you see `ERR_CONNECTION_REFUSED`, the dev server didn't start — check that `pnpm dev` works normally first.

- [ ] **Step 3: Commit**

```bash
git add tests/smoke.spec.ts
git commit -m "test: add infrastructure smoke test"
```

---

## Chunk 2: Mock Files

### Task 6: Create `src/lib/ipc.mock.ts`

**Files:**
- Create: `src/lib/ipc.mock.ts`

This file mirrors every export from `src/lib/ipc.ts` but returns typed fixture data. Return types are derived from `src/types/index.ts`. The `ipc` object is exported with the same shape — components import `{ ipc }` from `@/lib/ipc` and the alias transparently swaps in this file.

- [ ] **Step 1: Create the mock**

Create `H:/Vibe Coding/Romio/src/lib/ipc.mock.ts`:

```ts
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
  getScanStatus: async (_projectId: string) =>
    ({ isRunning: false, projectId: _projectId }),
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
```

- [ ] **Step 2: Verify TypeScript is happy**

```bash
cd "H:/Vibe Coding/Romio"
pnpm typecheck
```

Expected: No errors. If you see type mismatches, check that all fixture shapes match the interfaces in `src/types/index.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/ipc.mock.ts
git commit -m "test: add ipc.mock.ts with typed fixtures for all implemented screens"
```

---

### Task 7: Create `src/lib/tauri-plugins.mock.ts`

**Files:**
- Create: `src/lib/tauri-plugins.mock.ts`

This file is aliased to replace both `@tauri-apps/plugin-fs` and `@tauri-apps/plugin-dialog` in test mode. It must export everything those plugins export that the codebase uses:
- `readDir` (used in `FormatScreen.tsx`)
- `open` (used in `FormatConfigBar.tsx` and `ProjectsScreen.tsx`)

- [ ] **Step 1: Create the mock**

Create `H:/Vibe Coding/Romio/src/lib/tauri-plugins.mock.ts`:

```ts
// SPDX-License-Identifier: GPL-3.0
// Mock for @tauri-apps/plugin-fs and @tauri-apps/plugin-dialog.
// Both packages are aliased to this file when VITE_TEST_MODE=true.
// Add exports here when a new component directly imports from either plugin.

// ── plugin-fs ─────────────────────────────────────────────────────────────────

export interface DirEntry {
  name: string;
  isDirectory: boolean;
  isFile: boolean;
  isSymlink: boolean;
  path?: string;
}

// FormatScreen.tsx calls readDir(libraryPath) to enumerate ROM directories,
// then readDir(systemPath) to enumerate files within each system folder.
// This mock returns a realistic two-level structure for test assertions.
export async function readDir(path: string): Promise<DirEntry[]> {
  // First-level call: return system directories
  if (!path.includes("/")) {
    return [
      { name: "psx", isDirectory: true, isFile: false, isSymlink: false },
      { name: "gba", isDirectory: true, isFile: false, isSymlink: false },
    ];
  }
  // Second-level call: return ROM files within a system directory
  return [
    { name: "game1.bin", isDirectory: false, isFile: true, isSymlink: false },
    { name: "game2.chd", isDirectory: false, isFile: true, isSymlink: false },
  ];
}

// ── plugin-dialog ─────────────────────────────────────────────────────────────

interface OpenDialogOptions {
  directory?: boolean;
  multiple?: boolean;
  title?: string;
  filters?: Array<{ name: string; extensions: string[] }>;
}

// FormatConfigBar.tsx and ProjectsScreen.tsx call open({ directory: true })
// to let the user pick a folder. Return a stable fixture path.
export async function open(
  _options?: OpenDialogOptions
): Promise<string | string[] | null> {
  return "/fixture/selected/path";
}
```

- [ ] **Step 2: Verify TypeScript is happy**

```bash
pnpm typecheck
```

Expected: No errors.

- [ ] **Step 3: Re-run the smoke test to confirm both mock aliases work**

```bash
pnpm exec playwright test tests/smoke.spec.ts
```

Expected: `1 passed`. If `readDir is not a function` or `open is not a function` appears in console errors, the alias for `@tauri-apps/plugin-fs` or `@tauri-apps/plugin-dialog` is not resolving — re-check `vite.config.ts`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/tauri-plugins.mock.ts
git commit -m "test: add tauri-plugins.mock.ts for plugin-fs and plugin-dialog"
```

---

## Chunk 3: Skill and Subagent

### Task 8: Create the `test-writer` subagent

**Files:**
- Create: `.claude/agents/test-writer.md`

This is the Claude Code subagent definition. The skill dispatches it with a context bundle and expects a structured output. The subagent writes test files and updates mock files.

- [ ] **Step 1: Create the `.claude/agents/` directory if it doesn't exist**

```bash
mkdir -p "H:/Vibe Coding/Romio/.claude/agents"
```

- [ ] **Step 2: Write the subagent definition**

Create `H:/Vibe Coding/Romio/.claude/agents/test-writer.md`:

```markdown
---
name: test-writer
description: Writes Playwright interaction tests for a single Romio screen. Dispatched by the test-feature skill with a context bundle. Never invoked directly by the user.
---

# test-writer

You write Playwright interaction tests for a single Romio screen. You are always dispatched with a context bundle — read everything in it before writing anything.

## Context bundle you will receive

- Screen component file(s) from `src/components/<screen>/`
- Relevant Zustand store slices from `src/stores/index.ts`
- Relevant IPC functions from `src/lib/ipc.ts`
- TypeScript types from `src/types/index.ts`
- Current `src/lib/ipc.mock.ts` (read before adding fixtures — never duplicate)
- Current `src/lib/tauri-plugins.mock.ts` (same hygiene rules)
- Existing `tests/<screen>.spec.ts` if present (add tests, never delete)

## What to write

Write exactly four test categories per screen. Use `test.describe('<Screen Name> screen', () => { ... })` as the outer block. Use a `beforeEach` that navigates to `/` and clicks the sidebar nav link for the screen.

### Category 1 — Render
Verify the screen mounts without crashing and key structural elements are visible. Check at least: the screen heading/title text, the primary content area, the sidebar nav item being active.

### Category 2 — Interaction
Verify the primary action works end-to-end through the mocked IPC. For example:
- BIOS screen: changing the Frontend dropdown updates the entries list
- Format screen: entering a path and clicking Scan triggers the scan flow and results appear
- Preflight screen: the check host environment results render

### Category 3 — Error state
Verify the screen handles a failure gracefully. Temporarily override the relevant ipc mock function to return a rejected Promise, then check that the screen shows an error message rather than crashing. Use `page.evaluate` to override the mock if needed.

### Category 4 — Navigation
Verify at least one link or button in this screen navigates to another screen (use `expect(page).toHaveURL(...)` or check that a different screen heading appears).

## IPC mock hygiene

- Read `src/lib/ipc.mock.ts` fully before writing
- Add only missing exports — never modify or overwrite existing ones
- All new fixture return types must exactly match `src/types/index.ts` — do not infer, look them up
- Same rules apply to `src/lib/tauri-plugins.mock.ts`

## Rust tests (conditional)

Write a `#[cfg(test)]` block in the relevant engine file **only if** the screen's IPC calls map to engine functions that contain conditional logic, validation, or transformation — not pure data reads or passthroughs. Look in `src-tauri/src/engine/` to decide. If no engine file exists for this screen, skip Rust tests and note it in the summary.

## Required output format

Return this structured summary after writing all files. Do not skip any field.

```
FILES_WRITTEN:
  - tests/<screen>.spec.ts  (created | updated)
  - src/lib/ipc.mock.ts  (updated with N new fixtures | unchanged)
  - src/lib/tauri-plugins.mock.ts  (updated with N new exports | unchanged)
  - src-tauri/src/engine/<file>.rs  (updated with tests | skipped: <reason>)

FIXTURES_ADDED:
  - <function_name>: <one-line description of what the fixture returns>
  (or "none" if no new fixtures were needed)

SKIPPED:
  - <item>: <reason>
  (or "none")

TESTS_WRITTEN:
  - <test name>: <one-line description>
  (one entry per test case)
```

If a required source file is missing, return:

```
ERROR: <specific file> not found — cannot generate tests for this screen.
```
```

- [ ] **Step 3: Commit**

```bash
git add .claude/agents/test-writer.md
git commit -m "feat: add test-writer subagent definition"
```

---

### Task 9: Create the `/test-feature` skill

**Files:**
- Create: `.claude/skills/test-feature/SKILL.md`

- [ ] **Step 1: Create the `.claude/skills/test-feature/` directory**

```bash
mkdir -p "H:/Vibe Coding/Romio/.claude/skills/test-feature"
```

- [ ] **Step 2: Write the skill definition**

Create `H:/Vibe Coding/Romio/.claude/skills/test-feature/SKILL.md`:

```markdown
---
name: test-feature
description: Generate and run Playwright interaction tests for a named Romio screen. Invoked as /test-feature <screen>. Dispatches the test-writer subagent, then runs Playwright and reports results.
---

# /test-feature

Generate and run Playwright interaction tests for the named Romio screen.

## Usage

```
/test-feature <screen>
```

Example: `/test-feature bios`

## Step 1: Validate the screen name

Derive the valid screen list dynamically from the filesystem: list directories in `src/components/` that contain a file matching `*Screen.tsx`. Exclude placeholder screens (those where no meaningful UI is implemented — check CLAUDE.md's "Screens & Status" section for the current list).

Current valid screens (update this list as screens are implemented):
`welcome`, `projects`, `dashboard`, `preflight`, `bios`, `saves`, `format`

If the argument does not match a valid screen name, print:

```
❌ Unknown screen: "<arg>"
Valid screens: welcome, projects, dashboard, preflight, bios, saves, format
```

Then stop.

## Step 2: Gather the context bundle

Read these files before dispatching the subagent:

1. All `.tsx` files in `src/components/<screen>/`
2. `src/stores/index.ts` — identify which store slices the screen uses
3. `src/lib/ipc.ts` — identify which `ipc.*` functions the screen calls
4. `src/types/index.ts` — the full types file
5. `src/lib/ipc.mock.ts` — current state of the mock
6. `src/lib/tauri-plugins.mock.ts` — current state of plugin mocks
7. `tests/<screen>.spec.ts` — existing tests if present (pass to subagent for incremental update)

## Step 3: Dispatch the `test-writer` subagent

Dispatch the `test-writer` subagent (defined in `.claude/agents/test-writer.md`), providing the full context bundle from Step 2.

Wait for the subagent to complete and return its structured summary.

If the summary is missing, malformed, or starts with `ERROR:`, report the error to the user and stop — do not run Playwright.

## Step 4: Run Playwright

```bash
pnpm exec playwright test tests/<screen>.spec.ts
```

Where `<screen>` is the argument passed to this skill.

## Step 5: Report results

Report to the user:

```
📁 Files written:
  <list from subagent FILES_WRITTEN section>

🔌 Fixtures added:
  <list from subagent FIXTURES_ADDED section>

⏭ Skipped:
  <list from subagent SKIPPED section>

🧪 Tests written:
  <list from subagent TESTS_WRITTEN section>

✅ Results: X passed, Y failed
```

If any tests failed, include the test name, the failing assertion, and the line number from the Playwright output.
```

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/test-feature/SKILL.md
git commit -m "feat: add /test-feature skill definition"
```

---

### Task 10: End-to-end validation

Verify the complete system works by running `/test-feature` against the `bios` screen — the most fully-implemented screen with the most IPC calls.

- [ ] **Step 1: Run `/test-feature bios`**

In Claude Code, invoke:
```
/test-feature bios
```

The skill will:
1. Validate `bios` as a known screen
2. Read `src/components/bios/BiosScreen.tsx`, store slices, IPC calls, types, and mock files
3. Dispatch the `test-writer` subagent
4. The subagent writes `tests/bios.spec.ts` and updates `ipc.mock.ts` if needed
5. Run `pnpm exec playwright test tests/bios.spec.ts`

- [ ] **Step 2: Verify results**

Expected:
```
✅ Results: 4 passed, 0 failed
```

The four tests should correspond to the four categories: Render, Interaction, Error state, Navigation.

If fewer than 4 tests pass:
- **`invoke is not a function`**: The `@/lib/ipc` Vite alias isn't applying — check `vite.config.ts`
- **`readDir is not a function`**: The `@tauri-apps/plugin-fs` alias isn't applying — check `vite.config.ts`
- **Element not found**: The fixture data in `ipc.mock.ts` may not match what the component expects — check the BIOS result shape against `BiosSystemResult` in `src/types/index.ts`

- [ ] **Step 3: Commit the generated test file**

```bash
git add tests/bios.spec.ts src/lib/ipc.mock.ts
git commit -m "test: add bios screen Playwright tests (generated by test-writer)"
```

---

## Done

The `/test-feature` skill is now fully operational. For each new screen:

1. Finish implementing the screen
2. Run `/test-feature <screen>`
3. Review the generated tests
4. Commit `tests/<screen>.spec.ts`

The `ipc.mock.ts` and `tauri-plugins.mock.ts` files grow automatically with each run — the test-writer subagent adds only what's missing.
