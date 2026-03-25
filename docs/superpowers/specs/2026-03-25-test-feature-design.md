# Design Spec: `/test-feature` Skill — Playwright UI Testing via Subagent

**Date:** 2026-03-25
**Project:** Romio (Tauri v2 desktop app)
**Status:** Approved

---

## Overview

A manually-invoked skill that generates and runs Playwright interaction tests for any implemented Romio screen. The user calls `/test-feature <screen>` after finishing a feature; the skill dispatches a specialized test-writer subagent, then runs the generated tests and reports results.

---

## Goals

- Basic interaction tests exist for every implemented screen
- Tests run without the Rust backend (IPC layer is mocked)
- Zero friction: one command generates and runs tests
- Tests cover render, interaction, error states, and navigation
- Rust engine unit tests are written alongside UI tests when business logic warrants it

## Non-Goals

- Full end-to-end tests through the real Tauri + Rust backend (out of scope; Rust logic is covered by native `cargo test`)
- Automatic test generation on commit or file save
- Visual regression / screenshot diffing

---

## Architecture

```
User: /test-feature bios
         │
         ▼
  skill: test-feature (SKILL.md)
  ├── resolves files: BiosScreen.tsx, relevant store slices, IPC calls, TS types, ipc.mock.ts
  ├── dispatches ──▶ subagent: test-writer (.claude/agents/test-writer.md)
  │                     ├── reads all provided context files
  │                     ├── writes: tests/bios.spec.ts
  │                     └── writes: src-tauri/src/engine/*_tests.rs  (if needed)
  └── runs: pnpm exec playwright test tests/bios.spec.ts
       └── reports: pass/fail counts, failure details, files written
```

---

## Components

### 1. One-Time Infrastructure

**`playwright.config.ts`** (project root)
- Browser: Chromium (matches Tauri's WebView2 on Windows)
- `webServer`: auto-starts `pnpm dev` (Vite on `:1444`) before tests; waits for it to be ready
- `baseURL`: `http://localhost:1444`
- `testDir`: `./tests`
- Sets `VITE_TEST_MODE=true` in the webServer env so Vite applies the IPC alias

**`src/lib/ipc.mock.ts`**
- Mirrors every function signature exported from `src/lib/ipc.ts`
- Returns realistic fixture data typed against `src/types/index.ts`
- Covers all currently implemented screens: `bios`, `preflight`, `dashboard`, `saves`, `format`
- Grows incrementally — test-writer subagent adds fixtures for new screens when invoked

**`vite.config.ts` (small addition)**
- When `process.env.VITE_TEST_MODE === 'true'`, resolves `@/lib/ipc` → `@/lib/ipc.mock`
- No other changes; components never know the difference

**`pnpm` script addition in `package.json`**
```json
"test:e2e": "playwright test"
```

---

### 2. The Skill — `.claude/skills/test-feature/SKILL.md`

**Invocation:** User-only, called as `/test-feature <screen>`

**Steps:**
1. Accept `<screen>` as the argument (e.g. `bios`, `format`, `preflight`)
2. Resolve the context bundle:
   - `src/components/<screen>/` — all component files for that screen
   - `src/stores/index.ts` — filtered to slices the screen uses
   - `src/lib/ipc.ts` — filtered to functions the screen calls
   - `src/types/index.ts` — relevant type definitions
   - `src/lib/ipc.mock.ts` — current mock state
   - `tests/<screen>.spec.ts` — existing test file if present (for incremental updates)
3. Dispatch the `test-writer` subagent with the context bundle
4. Wait for the subagent to return a summary of files written
5. Run `pnpm exec playwright test tests/<screen>.spec.ts`
6. Report to the user:
   - Files created/updated
   - Test count (pass / fail)
   - Failure details with the specific assertion and line if any tests fail

---

### 3. The Subagent — `.claude/agents/test-writer.md`

**Dispatched by:** The `test-feature` skill only. Never invoked directly.

**Responsibilities:**

For every screen, writes at minimum four test categories:

| Category | What it verifies |
|---|---|
| **Render** | Screen mounts without crashing; key UI elements are visible |
| **Interaction** | Primary action works end-to-end through the mocked IPC (e.g. clicking Scan triggers scan flow, results populate) |
| **Error state** | Screen handles IPC returning errors or empty data gracefully |
| **Navigation** | Buttons/links that route to other screens actually navigate |

Additionally:
- If the screen exercises meaningful business rules in `src-tauri/src/engine/`, writes a `#[cfg(test)]` block in the relevant engine file covering those rules
- Adds any missing fixture data to `src/lib/ipc.mock.ts` needed for the new tests
- If a test file already exists for the screen, adds new tests without deleting existing ones

**Returns:** A plain-text summary listing each file written and a one-line description of each test, so the skill can surface it to the user.

---

### 4. Generated Test Files

**Location:** `tests/<screen>.spec.ts`

**Example structure for `tests/bios.spec.ts`:**
```ts
import { test, expect } from '@playwright/test';

test.describe('BIOS screen', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'BIOS' }).click();
  });

  test('renders system registry with fixture entries', async ({ page }) => { ... });
  test('validated entries show green VALIDATED badge', async ({ page }) => { ... });
  test('missing entries show MISSING badge and recovery action', async ({ page }) => { ... });
  test('selecting a different frontend updates the registry', async ({ page }) => { ... });
  test('shows empty state when no BIOS directory is set', async ({ page }) => { ... });
});
```

---

## File Layout After Setup

```
romio/
├── playwright.config.ts               ← new
├── tests/
│   ├── bios.spec.ts                   ← generated by subagent
│   ├── format.spec.ts                 ← generated by subagent
│   └── ...                            ← one per screen
├── src/
│   └── lib/
│       ├── ipc.ts                     ← unchanged
│       └── ipc.mock.ts                ← new; grows with each /test-feature run
├── vite.config.ts                     ← small addition (VITE_TEST_MODE alias)
└── .claude/
    ├── skills/
    │   └── test-feature/
    │       └── SKILL.md               ← new
    └── agents/
        └── test-writer.md             ← new
```

---

## Error Handling

| Failure | Behaviour |
|---|---|
| Screen name not recognised | Skill lists valid screen names and exits |
| Vite dev server fails to start | Playwright reports startup error; skill surfaces it |
| IPC mock missing a function the screen calls | Subagent adds it; if the function's return type is unknown it uses a typed empty/default value |
| Generated test fails on first run | Skill reports failure + assertion detail; user decides whether to fix test or fix code |
| Rust engine file not found for a screen | Subagent skips Rust test generation and notes it in the summary |

---

## Testing the Testing System

The infrastructure itself is verified by running `/test-feature bios` against the already-implemented BIOS screen immediately after setup. If that produces ≥4 passing tests, the system is working.

---

## Out of Scope

- `tauri-driver` / full native E2E (complex Windows setup, brittle)
- Auto-running tests on file save or commit
- Visual regression / screenshot comparison
- Testing placeholder screens (`format`, `multidisc`, `scummvm`, `installed`, `export`, `preview`, `rollback`) until their implementations are complete
