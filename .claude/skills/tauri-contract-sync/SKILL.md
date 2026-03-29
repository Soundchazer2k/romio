---
name: tauri-contract-sync
description: Use when a Rust model or Tauri command is added or changed, when src/types/index.ts or src/lib/ipc.ts is modified, when tsc fails near IPC boundaries, or when reviewing a PR that touches the frontend/backend boundary in this Tauri project.
---

# Romio Tauri Contract Sync

## Purpose

Maintenance/audit skill — detects and fixes drift between Rust models and TS types. Does not design features or add screens.

Syncs across three layers:
1. Rust models → TS types
2. Tauri commands → TS IPC wrappers
3. TS IPC wrappers → IPC mock

## Repo Rules

- All `invoke()` calls must live in `src/lib/ipc.ts`
- `src/types/index.ts` must mirror `src-tauri/src/models/`
- `src/lib/ipc.mock.ts` must match the real IPC surface closely enough for tests
- Do not call `invoke()` directly from components
- Rust `#[serde(rename_all = "camelCase")]` means `source_path` → `sourcePath` in TS — use this rule to derive all TS field names from Rust struct fields
- Tauri maps Rust `snake_case` parameter names to `camelCase` in JS at the call site: `project_id: String` in Rust → `{ projectId }` in `invoke()`

## Inputs To Inspect First

- `src-tauri/src/models/**/*.rs`
- `src-tauri/src/commands/**/*.rs`
- `src/types/index.ts`
- `src/lib/ipc.ts`
- `src/lib/ipc.mock.ts`

## Checks

1. For each serializable Rust model exposed across IPC, confirm a TS type/interface exists.
2. For each `#[tauri::command]`, confirm a wrapper exists in `src/lib/ipc.ts`.
3. Confirm wrapper argument names match Tauri's camelCase mapping of Rust parameter names (e.g. `project_id` → `projectId`). This is the most common drift source.
4. Confirm wrapper return types match Rust return payloads.
5. Confirm `src/lib/ipc.mock.ts` exports the same callable surface as `src/lib/ipc.ts`.
6. Confirm there is no direct `invoke(` usage outside `src/lib/ipc.ts`.

## Commands

```bash
# Find all Tauri commands, model structs/enums, and stray invoke() calls
rg -n "#\[tauri::command\]|pub struct|pub enum|invoke\(" src src-tauri

# TypeScript check (required)
npx tsc --noEmit

# Rust compile check (required when any Rust is touched)
cargo check
```

## Fix or Ask

Fix mismatches silently as you go — editing TS types, wrappers, and the mock is within scope. Report what you changed.

Stop and ask before fixing if:
- A Rust model has no obvious TS representation
- A command payload shape is ambiguous from local code
- Fixing drift would require feature design, not sync work

## Allowed Actions

- Edit TS types, IPC wrappers, and IPC mock
- Edit Rust command signatures only if needed for consistency
- Add or update narrow unit tests for contract coverage
- Do not redesign features or add new screens

## Output Format

Report only:
- Mismatches found and fixed
- Files changed
- Checks run and results
- Any unresolved ambiguity
