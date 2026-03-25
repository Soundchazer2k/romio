# Design Spec: `/test-feature` Skill — Playwright UI Testing via Subagent

**Date:** 2026-03-25
**Project:** Romio (Tauri v2 desktop app)
**Status:** In Review

---

## Overview

A manually-invoked skill that generates and runs Playwright interaction tests for any implemented Romio screen. The user calls `/test-feature <screen>` after finishing a feature; the skill dispatches a specialized test-writer subagent, then runs the generated tests and reports results.

**Important boundary:** Playwright targets `http://localhost:1444` (the Vite dev server) in a standard Chromium browser process. The Tauri shell is never involved in these tests. This is intentional — it is what makes IPC mocking possible and keeps tests fast and deterministic.

---

## Goals

- Basic interaction tests exist for every implemented screen
- Tests run without the Rust backend (IPC layer is mocked)
- Zero friction: one command generates and runs tests
- Tests cover render, interaction, error states, and navigation
- Rust engine unit tests are written alongside UI tests when business logic warrants it (see decision rule below)

## Non-Goals

- Full end-to-end tests through the real Tauri + Rust backend (Rust logic is covered by `cargo test` on the engine layer)
- Automatic test generation on commit or file save
- Visual regression / screenshot diffing
- Testing placeholder/unimplemented screens (`multidisc`, `scummvm`, `installed`, `export`, `preview`, `rollback`) until their implementations are complete

---

## Architecture

```
User: /test-feature bios
         │
         ▼
  skill: test-feature (SKILL.md)
  ├── validates screen name against implemented screen list (see Valid Screen Names)
  ├── resolves context bundle: component files, store slices, IPC calls, TS types, ipc.mock.ts
  ├── dispatches ──▶ subagent: test-writer (.claude/agents/test-writer.md)
  │                     ├── reads all provided context files
  │                     ├── adds missing IPC fixtures to ipc.mock.ts (no duplicates)
  │                     ├── writes: tests/bios.spec.ts
  │                     └── writes: src-tauri/src/engine/*_tests.rs  (if Rust rule triggers)
  │                     └── returns: structured summary (see Subagent Output Contract)
  └── runs: pnpm exec playwright test tests/bios.spec.ts
       └── reports: files written, fixtures added, pass/fail counts, failure details
```

---

## Components

### 1. One-Time Infrastructure

**`playwright.config.ts`** (project root)
- Browser: Chromium (deliberate — these tests run against the Vite dev server in a browser, not the Tauri WebView)
- `webServer.command`: `pnpm dev`
- `webServer.url`: `http://localhost:1444`
- `webServer.env`: `{ VITE_TEST_MODE: 'true' }` — this env var is read by `vite.config.ts` at config evaluation time (see Vite alias details below)
- `baseURL`: `http://localhost:1444`
- `testDir`: `./tests`

**`src/lib/ipc.mock.ts`**
- Mirrors every function signature exported from `src/lib/ipc.ts`
- All return types must match exactly the types defined in `src/types/index.ts` — no guessing
- Returns realistic fixture data (enough to exercise happy paths and one error path per function)
- Grows incrementally: the test-writer subagent reads the current file before writing, checks for existing exports, and only adds missing ones — never duplicates or overwrites existing fixtures
- If two screens share an IPC function (e.g. `list_projects`), the fixture is written once and reused
- Fixture shape conflicts (e.g. a function's return type changed) are flagged in the subagent summary for the developer to resolve manually

**`src/lib/tauri-plugins.mock.ts`** (companion mock)

Some screens import Tauri plugin APIs directly rather than going through `ipc.ts`. At time of writing:
- `FormatScreen.tsx` imports `readDir` from `@tauri-apps/plugin-fs`
- `FormatConfigBar.tsx` and `ProjectsScreen.tsx` import `open` from `@tauri-apps/plugin-dialog`

These bypass the `@/lib/ipc` alias and will throw at test time unless separately mocked. A companion mock file covers these:
- `src/lib/tauri-plugins.mock.ts` — exports `readDir` (returns fixture directory entries) and `open` (returns a fixture path string)
- A second Vite alias maps `@tauri-apps/plugin-fs` and `@tauri-apps/plugin-dialog` to this file when `VITE_TEST_MODE=true`

The test-writer subagent adds fixtures to this file using the same hygiene rules as `ipc.mock.ts` (read before write, no duplicates, typed from `src/types/index.ts`).

**`vite.config.ts` (addition)**

The actual `vite.config.ts` uses an async factory form. The `VITE_TEST_MODE` alias additions must be merged into the existing factory — do not replace it:

```ts
// process.env checked at config evaluation time (NOT import.meta.env at runtime)
const isTestMode = process.env.VITE_TEST_MODE === 'true';

export default defineConfig(async () => ({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Merge in test-mode aliases alongside the existing "@" alias:
      ...(isTestMode ? {
        "@/lib/ipc": path.resolve(__dirname, "src/lib/ipc.mock.ts"),
        "@tauri-apps/plugin-fs": path.resolve(__dirname, "src/lib/tauri-plugins.mock.ts"),
        "@tauri-apps/plugin-dialog": path.resolve(__dirname, "src/lib/tauri-plugins.mock.ts"),
      } : {}),
    },
  },
  // ...rest of existing config unchanged
}));
```

Note: `process.env.VITE_TEST_MODE` is evaluated when Vite processes the config file, not at browser runtime. Using `import.meta.env` here would not work for module aliasing.

**`package.json` addition**
```json
"test:e2e": "playwright test"
```

---

### 2. Valid Screen Names

The skill resolves valid screen names from the filesystem at `src/components/` — specifically, directories that contain a `*Screen.tsx` file. Placeholder screens (those listed in CLAUDE.md as "Placeholder — backend stubs exist, UI TODO") are excluded from valid names. At time of writing, valid screens are:

`welcome` `projects` `dashboard` `preflight` `bios` `saves` `format`

If the user passes an unrecognised name, the skill prints the current valid list (derived from the filesystem, not hardcoded) and exits without dispatching the subagent.

---

### 3. The Skill — `.claude/skills/test-feature/SKILL.md`

**Invocation:** User-only, `/test-feature <screen>`

**Steps:**
1. Accept `<screen>` as the argument
2. Validate against the implemented screen list (see Valid Screen Names); exit with list if invalid
3. Resolve the context bundle:
   - `src/components/<screen>/` — all component files
   - `src/stores/index.ts` — store slices the screen reads/writes
   - `src/lib/ipc.ts` — IPC functions the screen calls
   - `src/types/index.ts` — relevant type definitions
   - `src/lib/ipc.mock.ts` — current mock (so subagent knows what already exists)
   - `tests/<screen>.spec.ts` — existing test file if present (for incremental updates)
4. Dispatch the `test-writer` subagent with the full context bundle
5. Receive the structured subagent summary (see Subagent Output Contract); if summary is missing or malformed, report the failure and stop
6. Run `pnpm exec playwright test tests/<screen>.spec.ts`
7. Report to the user:
   - Files written/updated
   - IPC fixtures added to `ipc.mock.ts`
   - Any items skipped (e.g. Rust tests) and why
   - Test count (pass / fail)
   - For failures: the specific test name, assertion, and line number

---

### 4. The Subagent — `.claude/agents/test-writer.md`

**Dispatched by:** The `test-feature` skill only. Never invoked directly.

**Writes four test categories per screen:**

| Category | What it verifies |
|---|---|
| **Render** | Screen mounts without crashing; key structural elements are visible |
| **Interaction** | Primary action works end-to-end through mocked IPC (e.g. clicking Scan triggers scan flow, results populate the list) |
| **Error state** | Screen handles IPC returning an error or empty/null data without crashing or blank UI |
| **Navigation** | Buttons/links that route to other screens actually navigate |

**Rust test decision rule:**
Write a `#[cfg(test)]` block in the relevant engine file **if and only if** the screen's IPC calls map to functions in `src-tauri/src/engine/` that contain conditional logic, validation, or transformation — i.e. more than a direct database read or passthrough. If the engine file is not found, skip Rust test generation and note it in the summary.

**IPC mock hygiene:**
- Read `src/lib/ipc.mock.ts` in full before writing
- Check which functions are already exported
- Add only missing functions; never modify existing fixtures
- All new fixture return types must match `src/types/index.ts` exactly — derive from types, do not infer from usage

**Incremental updates:**
If `tests/<screen>.spec.ts` already exists, add new test cases without deleting existing ones. Preserve the existing `test.describe` block structure.

---

### 5. Subagent Output Contract

The subagent must return a structured summary before the skill proceeds to run tests. The summary must include:

```
FILES_WRITTEN:
  - tests/<screen>.spec.ts  (created | updated)
  - src-tauri/src/engine/<file>_tests.rs  (created | updated | skipped: <reason>)

FIXTURES_ADDED:
  - <function_name>: <brief description of fixture shape>
  - (none) if no new fixtures were needed

SKIPPED:
  - <item>: <reason>

TESTS_WRITTEN:
  - <test name>: <one-line description>
  (one entry per test case)
```

If the subagent cannot produce this summary (e.g. a required source file was missing), it returns an ERROR block with the specific failure reason. The skill treats a missing or malformed summary as a hard failure and does not run Playwright.

---

### 6. Generated Test File Structure

```ts
// tests/bios.spec.ts
import { test, expect } from '@playwright/test';

test.describe('BIOS screen', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'BIOS' }).click();
  });

  // Render
  test('renders system registry with fixture entries', async ({ page }) => { ... });

  // Interaction
  test('selecting a different frontend updates the registry list', async ({ page }) => { ... });

  // Error state
  test('shows empty state message when no BIOS directory is set', async ({ page }) => { ... });

  // Navigation
  test('clicking dashboard nav item navigates to dashboard', async ({ page }) => { ... });
});
```

---

## Infrastructure Validation (First Run)

After completing the one-time infrastructure setup, validate it before running `/test-feature` on any real screen:

1. Confirm `process.env.VITE_TEST_MODE` is read correctly: start Vite with `VITE_TEST_MODE=true pnpm dev` and verify in browser console that `window.__TAURI__` is absent and no IPC errors appear on the BIOS screen
2. Run `/test-feature bios`
3. Expected: ≥ 4 passing tests (one per category: Render, Interaction, Error state, Navigation)
4. If all 4 pass, the infrastructure is correctly wired
5. If tests fail with "invoke is not a function" or similar: the Vite alias is not applying — check that `process.env.VITE_TEST_MODE` (not `import.meta.env`) is used in `vite.config.ts`

---

## Error Handling

| Failure | Behaviour |
|---|---|
| Unrecognised screen name | Skill prints valid screen list (from filesystem) and exits |
| Placeholder screen passed | Skill rejects it and explains it is not yet implemented |
| Vite dev server fails to start | Playwright surfaces startup error; skill reports it verbatim |
| Subagent summary missing or malformed | Skill reports hard failure; does not run Playwright |
| IPC mock missing a function | Subagent adds it with a typed fixture derived from `src/types/index.ts` |
| Fixture shape conflict detected | Subagent notes it in summary; does not overwrite; developer resolves manually |
| Rust engine file not found | Subagent skips Rust test generation; notes it in summary |
| Generated test fails on first run | Skill reports failure with test name, assertion, and line; user decides whether to fix test or fix code |

---

## File Layout After Setup

```
romio/
├── playwright.config.ts                    ← new
├── tests/
│   ├── bios.spec.ts                        ← generated per /test-feature run
│   ├── preflight.spec.ts
│   └── ...
├── src/
│   └── lib/
│       ├── ipc.ts                          ← unchanged
│       ├── ipc.mock.ts                     ← new; grows with each /test-feature run
│       └── tauri-plugins.mock.ts           ← new; mocks readDir, open, etc.
├── vite.config.ts                          ← small addition (VITE_TEST_MODE alias)
├── package.json                            ← adds test:e2e script
└── .claude/
    ├── skills/
    │   └── test-feature/
    │       └── SKILL.md                    ← new
    └── agents/
        └── test-writer.md                  ← new
```
