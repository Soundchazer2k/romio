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

Derive the valid screen list dynamically from the filesystem: list directories in `src/components/` that contain a file matching `*Screen.tsx`. Exclude placeholder screens (those where no meaningful UI is implemented — check AGENTS.md's "Screens & Status" section for the current list).

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
7. `src/lib/tauri-api-event.mock.ts` — current state of event mock
8. `tests/<screen>.spec.ts` — existing tests if present (pass to subagent for incremental update)

## Step 3: Dispatch the `test-writer` subagent

Dispatch the `test-writer` subagent (defined in `.Codex/agents/test-writer.md`), providing the full context bundle from Step 2.

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
