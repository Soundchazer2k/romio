# BIOS Status Persistence and Dashboard Integration — Design Spec

**Date:** 2026-03-29
**Status:** Approved (rev 2 — post spec-review fixes)
**Scope:** Rust backend + SQLite schema + TypeScript frontend

---

## Problem

BIOS validation in Romio is currently stateless and ephemeral:

- `BiosScreen` requires the user to manually type a `bios_root` path every session
- Each system row fires a live `validate_bios` IPC call on demand — no persistence
- `get_bios_status` is a stub returning `vec![]`
- The dashboard's BIOS action card shows no health information
- BIOS state is not associated with a project

This design adds project-scoped BIOS configuration and persistent results, wires BIOS sweep into the scan lifecycle, and surfaces live status on the dashboard.

---

## Goals

1. Store `bios_root` on the `Project` model — nullable, user-supplied, cleared when changed
2. Run a full BIOS sweep automatically at scan-end if `bios_root` is configured
3. Allow manual re-validation from `BiosScreen`
4. Show a live BIOS health badge on the dashboard action card
5. Render `BiosScreen` from persisted results instead of driving live queries from the frontend

---

## Non-Goals

- Per-system selective re-validation (lazy caching) — not needed for 12 systems
- Multiple frontend targets for BIOS validation — first of `target_frontends` wins (explicit)
- Separate `bios_results` table — JSON blob on `projects` is sufficient; data is always read/written as a project-scoped atomic set

---

## Architecture

### Three-state BIOS status model

| `bios_root` | `bios_results` | Meaning |
|---|---|---|
| `NULL` | `NULL` | Not configured |
| non-null | `NULL` | Configured, not yet validated (or last validation errored) |
| non-null | non-null JSON | Configured and validated — results are current |

On the frontend:
- `activeProject.biosRoot == null` → Not configured
- `activeProject.biosRoot != null && activeProject.biosResults == null` → Configured, not validated
- `activeProject.biosRoot != null && activeProject.biosResults != null` → Validated

### Layering constraint

`src-tauri/src/engine/` contains pure Rust — no DB calls. `db::bios::load_all_rules()` is called in the command layer and the loaded rules are **injected into** the engine function. This keeps `bios_sweep.rs` unit-testable without a live DB.

---

## Section 1 — Data Layer

### SQLite migration `003_bios.sql`

```sql
ALTER TABLE projects ADD COLUMN IF NOT EXISTS bios_root              TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS bios_results           TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS bios_last_validated_at TEXT;
```

### Rust `Project` model additions (`models/project.rs`)

```rust
pub bios_root:              Option<String>,
pub bios_results:           Option<Vec<BiosSystemResult>>,
pub bios_last_validated_at: Option<DateTime<Utc>>,
```

### `db::projects` changes

**`create`** — new fields default to `NULL`; do not serialize empty JSON.

**`get` / `list`** — select and deserialize the three new columns:
- `bios_root`: `Option<String>` — NULL maps to `None`
- `bios_results`: deserialize JSON via `serde_json::from_str`. On failure (malformed JSON, partial write), map to `None` — same defensive pattern as `scan_stats`
- `bios_last_validated_at`: parse RFC3339, map failure to `None`

**`update_bios_results(id: &str, results: Vec<BiosSystemResult>) -> Result<()>`**
Atomically replaces `bios_results` (full set serialized as JSON) and stamps `bios_last_validated_at = now()`. Does not touch `bios_root`. This is the only write path for results.

**`update_bios_root(id: &str, bios_root: Option<&str>) -> Result<()>`**
Updates `bios_root` and **atomically clears `bios_results` and `bios_last_validated_at`** in the same SQL statement. Changing the path always invalidates prior results. Empty-string input is normalized to `NULL` defensively in this function (callers should also normalize).

### TypeScript `Project` type additions (`src/types/index.ts`)

```ts
biosRoot?:             string;
biosResults?:          BiosSystemResult[];   // undefined = not yet validated or not configured
biosLastValidatedAt?:  string;              // RFC3339 string; undefined if not validated
```

New response type (also add to `src/types/index.ts`):

```ts
export interface BiosStatusResponse {
  configured:       boolean;               // true if bios_root is set on the project
  validated:        boolean;               // true if bios_results is non-null in DB
  results:          BiosSystemResult[];    // empty array when not validated; never undefined
  lastValidatedAt?: string;
}
```

The `validated` boolean is the unambiguous signal for the "configured but not yet validated" case, separating it from "validated and results array is present." `results: []` alone cannot represent this distinction. The three-state mapping from DB to response:

| DB state | `configured` | `validated` | `results` |
|---|---|---|---|
| `bios_root = NULL` | `false` | `false` | `[]` |
| `bios_root = X, bios_results = NULL` | `true` | `false` | `[]` |
| `bios_root = X, bios_results = JSON` | `true` | `true` | deserialized array |

---

## Section 2 — Engine Module `engine::bios_sweep`

New file: `src-tauri/src/engine/bios_sweep.rs`
Register in `src-tauri/src/engine/mod.rs` as `pub mod bios_sweep;`

### Canonical system list

```rust
pub struct BiosSystemDef {
    pub id:               &'static str,
    pub default_emulator: &'static str,
}

pub const BIOS_SYSTEMS: &[BiosSystemDef] = &[
    BiosSystemDef { id: "ps1",       default_emulator: "duckstation"         },
    BiosSystemDef { id: "ps2",       default_emulator: "pcsx2"               },
    BiosSystemDef { id: "saturn",    default_emulator: "lr-beetle-saturn"    },
    BiosSystemDef { id: "segacd",    default_emulator: "lr-genesis-plus-gx"  },
    BiosSystemDef { id: "sega32x",   default_emulator: "lr-picodrive"        },
    BiosSystemDef { id: "dreamcast", default_emulator: "lr-flycast"          },
    BiosSystemDef { id: "tg16cd",    default_emulator: "lr-beetle-pce"       },
    BiosSystemDef { id: "nds",       default_emulator: "melonds"             },
    BiosSystemDef { id: "fds",       default_emulator: "lr-mesen"            },
    BiosSystemDef { id: "3do",       default_emulator: "lr-opera"            },
    BiosSystemDef { id: "neogeo",    default_emulator: "lr-fbneo"            },
    BiosSystemDef { id: "xbox",      default_emulator: "xemu"                },
];
```

This is the **single source of truth** for which systems are in scope for BIOS validation. `BiosScreen.tsx`'s hardcoded `SYSTEMS` array is removed in Section 4.

### Config struct

```rust
pub struct BiosSweepConfig {
    pub bios_root:      PathBuf,
    pub frontend:       String,                        // validated single frontend
    pub emulator_prefs: HashMap<String, String>,       // system_id → emulator_id
}
```

`emulator_prefs` is populated directly from `project.emulator_prefs` (the full map, unfiltered) at both call sites — `revalidate_bios` and `scan_library`. The engine resolves per-system by key lookup, falling back to `BiosSystemDef.default_emulator`.

### `run_sweep` signature

`run_sweep` takes `config` by **reference** (`&BiosSweepConfig`) — it must not take ownership, so `config.frontend` remains accessible after the call for error logging at the call site.

```rust
pub fn run_sweep(
    config:    &BiosSweepConfig,     // borrow, not move — caller may need fields after the call
    all_rules: &[BiosRule],          // loaded by caller from db::bios::load_all_rules()
) -> Result<Vec<BiosSystemResult>>
```

Rules are **injected from the command layer**, not fetched inside the engine. This keeps `bios_sweep.rs` free of DB calls and unit-testable with in-memory fixtures.

### `run_sweep` behavior

Iterates `BIOS_SYSTEMS`. For each system:
1. Resolves emulator: `config.emulator_prefs.get(system.id).map(String::as_str).unwrap_or(system.default_emulator)`
2. Filters rules: `all_rules.iter().filter(|r| r.system == system.id)`
3. If no rules exist for this system, push a non-blocking `BiosSystemResult { system: system.id.to_string(), entries: vec![], blocking: false }` and continue. The `system` field is populated from `system.id` directly — **not** from `rules.first()` which would yield empty string.
4. Calls `bios_validator::validate_system_bios(bios_root, filtered_rules, frontend, emulator)`
5. If validation **errors** for one system: log the error, push the non-blocking fallback result, continue. One system error does not abort the sweep.

Returns the full result set — all 12 canonical systems present in every call.

### Unit tests

```
test_sweep_all_systems_returned_on_empty_dir
  → run_sweep with empty temp dir and no rules; result length == BIOS_SYSTEMS.len()
  → protects the "complete snapshot" contract

test_sweep_blocking_when_required_bios_missing
  → temp dir missing a required file; relevant system result has blocking: true

test_sweep_emulator_pref_overrides_default
  → emulator_prefs["ps1"] = "lr-pcsx-rearmed"; confirm that emulator is passed to
    validate_system_bios instead of the default "duckstation"
```

---

## Section 3 — Commands Layer

### Shared helper — `resolve_primary_frontend`

Add to `src-tauri/src/commands/bios.rs` (as a `pub fn`, not a command):

```rust
/// Returns the primary frontend for BIOS validation (first of the project's target_frontends).
/// BIOS validation always targets one frontend; the first is canonical.
pub fn resolve_primary_frontend(frontends: &[String]) -> Result<String, String> {
    frontends.first()
        .cloned()
        .ok_or_else(|| "project has no target frontends configured".to_string())
}
```

`commands/mod.rs` is a module manifest (only `pub mod` declarations) — do not add function bodies there. `commands/scan.rs` calls this as `crate::commands::bios::resolve_primary_frontend(...)`. The rule cannot drift between sites.

### `get_bios_status(project_id: String) -> Result<BiosStatusResponse, String>`

Reads `bios_root`, `bios_results`, `bios_last_validated_at` from the persisted project. Constructs and returns `BiosStatusResponse` using the three-state mapping from Section 1. **No validation runs.** Fast, read-only.

### Rust `BiosStatusResponse` struct

Define in `src-tauri/src/commands/bios.rs` (same file as the commands that return it):

```rust
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BiosStatusResponse {
    pub configured:         bool,
    pub validated:          bool,
    pub results:            Vec<crate::models::bios::BiosSystemResult>,
    pub last_validated_at:  Option<String>,   // RFC3339 or None
}
```

Tauri serializes this to camelCase via `#[serde(rename_all = "camelCase")]`, matching the TS interface in Section 1.

### `revalidate_bios(project_id: String) -> Result<BiosStatusResponse, String>`

1. Load project from DB
2. Check `bios_root` — return error `"BIOS path not configured"` if `None`
3. Call `resolve_primary_frontend(&project.target_frontends)`
4. Call `db::bios::load_all_rules()` to load all BIOS rules
5. Build `BiosSweepConfig { bios_root, frontend, emulator_prefs: project.emulator_prefs.clone() }`
6. Call `engine::bios_sweep::run_sweep(&config, &all_rules)`
7. Call `db::projects::update_bios_results(&project_id, results)`
8. Return fresh `BiosStatusResponse` — one round-trip, caller does not need a second fetch for BIOS state

After this call, the **frontend must also call `ipc.getProject(projectId)` and update `activeProject`** so that `biosResults` and `biosLastValidatedAt` are reflected in the full project state (dashboard badge, etc.).

### `set_bios_root(project_id: String, bios_root: Option<String>) -> Result<(), String>`

Normalizes input: trim whitespace; empty string → `None`. Delegates to `db::projects::update_bios_root`, which atomically clears stale results. Returns `()`.

`()` is intentional — path changes are infrequent and the cleared state is immediately consistent. The frontend calls `ipc.getProject(projectId)` after success to refresh `activeProject`.

### `scan_library` addition

Insert the BIOS sweep block **after the `update_scan_completion` call on line 54–55**.

DB safety note: `db::projects::get` and `db::bios::load_all_rules` each call `db::with_conn` independently (acquiring and releasing the mutex one at a time). They must not be nested inside each other or inside another `with_conn` closure — that would deadlock on the single-writer mutex. The snippet below calls them sequentially, not nested, which is safe.

`run_sweep` takes `config: &BiosSweepConfig` (a reference), so `config` is not moved and remains accessible for the error-branch log after the call.

```rust
// After: crate::db::projects::update_scan_completion(&project_id, stats) ...

// Best-effort BIOS sweep — failure does not fail the scan
let project = crate::db::projects::get(&project_id);
if let Ok(project) = project {
    if let Some(bios_root) = &project.bios_root {
        match crate::commands::bios::resolve_primary_frontend(&project.target_frontends) {
            Ok(frontend) => {
                match crate::db::bios::load_all_rules() {
                    Ok(all_rules) => {
                        let config = crate::engine::bios_sweep::BiosSweepConfig {
                            bios_root:      std::path::PathBuf::from(bios_root),
                            frontend,
                            emulator_prefs: project.emulator_prefs.clone(),
                        };
                        match crate::engine::bios_sweep::run_sweep(&config, &all_rules) {
                            Ok(results) => {
                                let _ = crate::db::projects::update_bios_results(
                                    &project_id, results
                                );
                            }
                            Err(e) => eprintln!(
                                "[scan] BIOS sweep failed \
                                 project_id={} bios_root={} frontend={}: {}",
                                project_id, bios_root, &config.frontend, e
                            ),
                        }
                    }
                    Err(e) => eprintln!("[scan] BIOS rules load failed: {}", e),
                }
            }
            Err(e) => eprintln!("[scan] BIOS sweep skipped: {}", e),
        }
    }
}
```

BIOS sweep failure does **not** fail the scan. Logged with `project_id`, `bios_root`, and frontend.

### New commands to register in `lib.rs`

Add `revalidate_bios` and `set_bios_root` to the `invoke_handler` list alongside the existing BIOS commands (`validate_bios`, `get_bios_rules`, `get_bios_status`). All are in the already-registered `commands::bios` module — no new `pub mod` entry in `commands/mod.rs` is needed.

---

## Section 4 — Frontend

### `src/lib/ipc.ts` — replace existing `getBiosStatus`, add two new bindings

**Remove** the existing line:
```ts
getBiosStatus:    (projectId: string)  => invoke<BiosSystemResult[]>("get_bios_status", { projectId }),
```

**Replace with** (and add the two new bindings):
```ts
getBiosStatus:  (projectId: string) =>
                  invoke<BiosStatusResponse>("get_bios_status", { projectId }),

revalidateBios: (projectId: string) =>
                  invoke<BiosStatusResponse>("revalidate_bios", { projectId }),

setBiosRoot:    (projectId: string, biosRoot: string | null) =>
                  invoke<void>("set_bios_root", { projectId, biosRoot }),
```

### `src/lib/ipc.mock.ts` — add mock implementations

```ts
getBiosStatus:  (_projectId: string) => Promise.resolve({
                  configured: false, validated: false, results: [], lastValidatedAt: undefined
                }),
revalidateBios: (_projectId: string) => Promise.resolve({
                  configured: true, validated: true, results: [], lastValidatedAt: new Date().toISOString()
                }),
setBiosRoot:    (_projectId: string, _biosRoot: string | null) => Promise.resolve(),
```

Remove the old `getBiosStatus` mock binding that returned `BiosSystemResult[]`.

### `DashboardScreen.tsx` — BIOS action card upgrade

`ActionCard` gains a `badge` optional prop:

```ts
badge?: { label: string; color: "gray" | "amber" | "red" | "green" }
```

The badge renders as a small pill/label inside the existing card layout, after the description. No layout restructuring needed.

Badge derivation (evaluated in priority order from `activeProject`):

```ts
function biosBadge(project: Project): { label: string; color: "gray" | "amber" | "red" | "green" } {
  if (!project.biosRoot)     return { label: "Not configured", color: "gray" };
  if (!project.biosResults)  return { label: "Not validated",  color: "gray" };

  const results = project.biosResults;
  const blockingCount = results.filter(r => r.blocking).length;
  const missingCount  = results.flatMap(r => r.entries)
                               .filter(e => e.state === "MISSING_REQUIRED" || e.state === "MISSING_OPTIONAL")
                               .length;

  if (blockingCount > 0) return { label: `${blockingCount} blocking`, color: "red" };
  if (missingCount  > 0) return { label: `${missingCount} missing`,   color: "amber" };
  return { label: "All valid", color: "green" };
}
```

"Missing" means `MISSING_REQUIRED` or `MISSING_OPTIONAL` only. `PRESENT_WRONG_PATH` and `PRESENT_HASH_MISMATCH` are not counted as missing — they surface on the BIOS screen.

No new queries on the dashboard — badge reads from `activeProject` in Zustand. The existing `ipc.getProject()` refresh after scan already delivers `biosResults`.

### `BiosScreen.tsx` — rework

**Remove:**
- The hardcoded `SYSTEMS` constant array
- The `biosRoot` free-text input state (`useState<string>("")`)
- The `selectedFrontend` dropdown — frontend selection is now handled by the backend (primary frontend wins); showing a dropdown that has no effect on persisted results would be misleading

**Path configuration mode** (`biosRoot` is `undefined` or `null`):
- Show a path input + Save button
- On save: trim input; if empty, do nothing. Call `ipc.setBiosRoot(projectId, trimmed)`, then `ipc.getProject(projectId)` → `setActiveProject(updated)`
- No system list

**Validated mode** (`biosRoot` is set):
- Show the configured path as read-only text with an "Edit path" button
- Edit path: show inline input to change or clear; call `setBiosRoot` followed by `getProject` refresh
- Clearing path (`setBiosRoot(id, null)`) returns screen to configuration mode
- `useQuery(["bios_status", projectId], () => ipc.getBiosStatus(projectId), { initialData: ..., enabled: ... })`

  `enabled`: only fire the IPC call when `biosRoot` is set. When `biosRoot` is `null`, the project is not configured and there is nothing to fetch — skip the IPC call entirely:
  ```ts
  enabled: !!activeProject?.biosRoot,
  ```

  `initialData` derived from `activeProject` (avoids flicker on first render):
  ```ts
  initialData: activeProject ? {
    configured:      !!activeProject.biosRoot,
    validated:       !!activeProject.biosResults,
    results:         activeProject.biosResults ?? [],
    lastValidatedAt: activeProject.biosLastValidatedAt,
  } : undefined
  ```

- System list renders from `query.data.results` — not from a frontend constant

- **"Revalidate BIOS" button:**
  ```ts
  const revalidateMut = useMutation({
    mutationFn: () => ipc.revalidateBios(activeProject.id),
    onSuccess: async () => {
      const updated = await ipc.getProject(activeProject.id);
      setActiveProject(updated);
      queryClient.invalidateQueries({ queryKey: ["bios_status", activeProject.id] });
    },
  });
  ```
  `invalidateQueries` forces the `useQuery` to re-fetch from the backend, keeping the system list and dashboard badge consistent.

**"Configured but not validated" state** (`configured: true, validated: false`):
- Show configured path
- Show "No validation results yet" message
- Show "Validate Now" CTA button (same as Revalidate)
- Do not regress to the "not configured" path input mode

**"Configured, validation errored" state:** Indistinguishable from "configured, not validated" at the data layer (both have `bios_results = NULL`). The screen shows the same state and CTA. The error is logged on the backend.

---

## Error and Edge Cases

| Scenario | Behavior |
|---|---|
| `bios_root` set, validation not yet run | `BiosScreen` shows "Not validated" state with CTA; dashboard badge shows "Not validated" |
| `bios_root` set, `revalidate_bios` errors | Results stay `None`; screen shows configured path + retry action; does not regress to "not configured" |
| `bios_root` changed | `update_bios_root` atomically clears results; next `getProject` fetch reflects cleared state |
| Scan-end BIOS sweep errors | Scan still succeeds; BIOS results unchanged; error logged with project_id, bios_root, frontend |
| System has no rules in DB | `run_sweep` pushes non-blocking empty result with `system: system.id` — snapshot always has 12 entries |
| `bios_root` is empty string from frontend | `setBiosRoot` trims and converts to `null`; `update_bios_root` also normalizes defensively |
| Project has no `target_frontends` | `resolve_primary_frontend` returns error; sweep skipped; logged |
| `bios_results` JSON is malformed in DB | `serde_json::from_str` failure maps to `None` — same pattern as `scan_stats` |
| `selectedFrontend` dropdown | Removed; frontend dropdown in old BiosScreen had no effect on persisted results |

---

## Files Changed

| File | Change |
|---|---|
| `src-tauri/src/db/migrations/003_bios.sql` | New — three ALTER TABLE statements |
| `src-tauri/src/db/mod.rs` | Add migration 003 call in `run_migrations` |
| `src-tauri/src/models/project.rs` | Add three fields to `Project` |
| `src-tauri/src/db/projects.rs` | Add `update_bios_results`, `update_bios_root`; update `get`/`list`/`create` |
| `src-tauri/src/engine/bios_sweep.rs` | New — `BiosSystemDef`, `BIOS_SYSTEMS`, `BiosSweepConfig`, `run_sweep`, 3 tests |
| `src-tauri/src/engine/mod.rs` | Add `pub mod bios_sweep;` |
| `src-tauri/src/commands/bios.rs` | Replace `get_bios_status` stub (change return type + binding); add `revalidate_bios`, `set_bios_root` |
| `src-tauri/src/commands/scan.rs` | Add scan-end BIOS sweep block after `update_scan_completion` (line 54–55) |
| `src-tauri/src/commands/bios.rs` | Add `resolve_primary_frontend` as `pub fn` (non-command helper, called by `scan.rs` as `crate::commands::bios::resolve_primary_frontend`) |
| `src-tauri/src/lib.rs` | Register `revalidate_bios` and `set_bios_root` commands |
| `src/types/index.ts` | Add `Project` fields; add `BiosStatusResponse` (with `validated: boolean`) |
| `src/lib/ipc.ts` | Replace `getBiosStatus` binding; add `revalidateBios`, `setBiosRoot` |
| `src/lib/ipc.mock.ts` | Replace `getBiosStatus` mock; add `revalidateBios`, `setBiosRoot` mocks |
| `src/components/dashboard/DashboardScreen.tsx` | Add `badge` prop to `ActionCard`; wire `biosBadge()` to BIOS card |
| `src/components/bios/BiosScreen.tsx` | Full rework: persisted results, path config mode, revalidate button, remove hardcoded system list and frontend dropdown |
