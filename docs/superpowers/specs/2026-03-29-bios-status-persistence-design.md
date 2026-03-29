# BIOS Status Persistence and Dashboard Integration — Design Spec

**Date:** 2026-03-29
**Status:** Approved
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
| non-null | `NULL` | Configured, not yet validated (or last validation failed) |
| non-null | non-null JSON | Configured and validated — results are current |

The distinction between "configured but not yet validated" and "configured but validation errored" is handled at the UI layer: both map to `bios_root != null && bios_results == null`, but the screen shows a retry action either way.

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
pub bios_root:             Option<String>,
pub bios_results:          Option<Vec<BiosSystemResult>>,
pub bios_last_validated_at: Option<DateTime<Utc>>,
```

### `db::projects` changes

**`create`** — new fields default to `NULL`; do not serialize empty JSON.

**`get` / `list`** — select and deserialize the three new columns. `bios_results` deserializes from JSON; `NULL` maps to `None`.

**`update_bios_results(id: &str, results: Vec<BiosSystemResult>) -> Result<()>`**
Atomically replaces `bios_results` (serialized as JSON) and stamps `bios_last_validated_at = now()`. Does not touch `bios_root`.

**`update_bios_root(id: &str, bios_root: Option<&str>) -> Result<()>`**
Updates `bios_root`. **Always clears `bios_results` and `bios_last_validated_at` atomically** — changing the path invalidates all prior results. Empty-string input is normalized to `NULL` at the Rust layer (defensive; callers should normalize before sending).

### TypeScript `Project` type additions (`src/types/index.ts`)

```ts
biosRoot?:             string;
biosResults?:          BiosSystemResult[];   // undefined = not yet validated or not configured
biosLastValidatedAt?:  string;              // RFC3339 string, not Date
```

New response type:

```ts
export interface BiosStatusResponse {
  configured:       boolean;               // bios_root is set
  results:          BiosSystemResult[];    // empty array if not yet validated
  lastValidatedAt?: string;
}
```

`biosResults: []` (empty array) means validated and no systems returned — should never happen in practice given the backend always sweeps the full canonical list. `undefined` means not validated.

---

## Section 2 — Engine Module `engine::bios_sweep`

New file: `src-tauri/src/engine/bios_sweep.rs`

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

This is the **single source of truth** for which systems are in scope for BIOS validation. `BiosScreen.tsx`'s hardcoded `SYSTEMS` array is removed; the frontend renders from persisted results.

### Config struct

```rust
pub struct BiosSweepConfig {
    pub bios_root:      PathBuf,
    pub frontend:       String,                        // validated single frontend
    pub emulator_prefs: HashMap<String, String>,       // system_id → emulator_id
}
```

Takes only what the engine needs — no coupling to the full `Project` model.

### `run_sweep`

```rust
pub fn run_sweep(config: &BiosSweepConfig) -> Result<Vec<BiosSystemResult>>
```

Iterates `BIOS_SYSTEMS`. For each system:
1. Resolves emulator: `config.emulator_prefs.get(system.id).unwrap_or(system.default_emulator)`
2. Loads rules: `db::bios::load_rules_for_system(system.id)` — if the system has no rules in the database, skip it with an empty-but-non-blocking `BiosSystemResult` rather than erroring
3. Calls `bios_validator::validate_system_bios`
4. **If validation fails for one system**, log the error and continue — the sweep is not aborted. One bad system does not invalidate the rest of the snapshot.

Returns the full result set — all canonical systems present, even if empty or non-applicable.

### Unit tests

```
test_sweep_all_systems_returned_on_empty_dir
  → temp dir with no files; run_sweep returns one result per BIOS_SYSTEMS entry
  → protects the "complete snapshot" contract

test_sweep_blocking_when_required_bios_missing
  → temp dir missing a required file; relevant system result has blocking: true

test_sweep_emulator_pref_overrides_default
  → emulator_prefs override wins; correct emulator used in path resolution
```

---

## Section 3 — Commands Layer

### Shared helper (new, used by both `bios.rs` and `scan.rs`)

```rust
// In a shared location, e.g. commands/mod.rs or a small commands/helpers.rs
pub fn resolve_primary_frontend(frontends: &[String]) -> Result<String, String> {
    frontends.first()
        .cloned()
        .ok_or_else(|| "project has no target frontends configured".to_string())
}
```

Both `revalidate_bios` and the scan-end sweep call this helper. The rule cannot drift between the two sites.

### `get_bios_status(project_id: String) -> Result<BiosStatusResponse, String>`

Reads `bios_root`, `bios_results`, `bios_last_validated_at` from the persisted project. Returns `BiosStatusResponse`. **No validation runs.** Fast, read-only.

### `revalidate_bios(project_id: String) -> Result<BiosStatusResponse, String>`

1. Load project from DB
2. Check `bios_root` — return error `"BIOS path not configured"` if `None`
3. Call `resolve_primary_frontend`
4. Build `BiosSweepConfig`
5. Call `engine::bios_sweep::run_sweep`
6. Call `db::projects::update_bios_results`
7. Return fresh `BiosStatusResponse` — one round-trip, no extra fetch needed

### `set_bios_root(project_id: String, bios_root: Option<String>) -> Result<(), String>`

Normalizes input: trim whitespace; empty string → `None`. Delegates to `db::projects::update_bios_root`, which atomically clears stale results. Returns `()`.

Frontend must call `ipc.getProject(projectId)` after success and update `activeProject` in Zustand so the dashboard and BIOS screen stay consistent.

### `scan_library` addition

After `update_scan_completion` succeeds:

```rust
if let Some(bios_root) = &project.bios_root {
    match resolve_primary_frontend(&project.target_frontends) {
        Ok(frontend) => {
            let config = BiosSweepConfig { … };
            match engine::bios_sweep::run_sweep(&config) {
                Ok(results) => {
                    let _ = db::projects::update_bios_results(&project_id, results);
                }
                Err(e) => {
                    eprintln!(
                        "[scan] BIOS sweep failed \
                         project_id={} bios_root={} frontend={}: {}",
                        project_id, bios_root, frontend, e
                    );
                }
            }
        }
        Err(e) => eprintln!("[scan] BIOS sweep skipped: {}", e),
    }
}
```

BIOS sweep failure does **not** fail the scan. Logged with `project_id`, `bios_root`, and frontend for debuggability.

---

## Section 4 — Frontend

### `src/lib/ipc.ts` additions

```ts
getBiosStatus:  (projectId: string) =>
                  invoke<BiosStatusResponse>("get_bios_status", { projectId }),

revalidateBios: (projectId: string) =>
                  invoke<BiosStatusResponse>("revalidate_bios", { projectId }),

setBiosRoot:    (projectId: string, biosRoot: string | null) =>
                  invoke<void>("set_bios_root", { projectId, biosRoot }),
```

### `DashboardScreen.tsx` — BIOS action card upgrade

The existing `ActionCard` for "BIOS Validation" gains a `badge` prop showing live status. Badge logic (evaluated in priority order):

```
activeProject.biosRoot is undefined/null  → "Not configured"  — muted gray
activeProject.biosResults is undefined    → "Not validated"   — muted gray
any result.blocking === true              → "N blocking"      — red
any entry state MISSING_REQUIRED
  or MISSING_OPTIONAL                     → "N missing"       — amber
all entries state === "PRESENT_VALID"     → "All valid"       — green
```

"Missing" count = entries in states `MISSING_REQUIRED` or `MISSING_OPTIONAL` only. Wrong-path and hash-mismatch are surfaced on the BIOS screen but do not count as "missing" on the badge.

No new queries on the dashboard — badge reads from `activeProject` in Zustand. The existing `ipc.getProject()` refresh after scan already brings down `biosResults`.

### `BiosScreen.tsx` — rework

**Path configuration mode** (when `biosRoot` is unset):
- Show path input + Save button
- Save calls `ipc.setBiosRoot`, then `ipc.getProject` → `setActiveProject`
- No system list rendered

**Validated mode** (when `biosRoot` is set):
- Show configured path with an "Edit" action
- Edit calls `ipc.setBiosRoot(null)` to clear, or updates to new path; always followed by `getProject` refresh
- `useQuery(["bios_status", projectId], () => ipc.getBiosStatus(projectId))` — uses `activeProject.biosResults` as `initialData`
- "Revalidate BIOS" button triggers `ipc.revalidateBios(projectId)`; on success calls `ipc.getProject(projectId)` → `setActiveProject(updated)` so dashboard badge also updates
- System list rendered from query results, **not** from a hardcoded frontend constant
- If `biosRoot` is set but `biosResults` is still undefined (configured, not yet validated — or prior run errored): show "No results yet" with a "Validate now" CTA

**Hardcoded `SYSTEMS` array removed.** The frontend no longer defines which systems exist.

---

## Error and Edge Cases

| Scenario | Behavior |
|---|---|
| `bios_root` set, validation not yet run | `BiosScreen` shows "Not validated" state with CTA; dashboard badge shows "Not validated" |
| `bios_root` set, `revalidate_bios` errors | Results stay `None`; screen shows configured path + retry action; does not regress to "not configured" |
| `bios_root` changed | `update_bios_root` atomically clears results; next getProject fetch reflects cleared state |
| Scan-end BIOS sweep errors | Scan still succeeds; BIOS results unchanged; error logged with context |
| System has no rules in DB | `run_sweep` returns a non-blocking empty `BiosSystemResult` for that system |
| `bios_root` is empty string from frontend | `setBiosRoot` trims and converts to `null`; `update_bios_root` normalizes defensively |
| Project has no `target_frontends` | Both `revalidate_bios` and scan-end sweep return/log error; no sweep attempted |

---

## Files Changed

| File | Change |
|---|---|
| `src-tauri/src/db/migrations/003_bios.sql` | New — three ALTER TABLE statements |
| `src-tauri/src/db/mod.rs` | Add migration 003 call |
| `src-tauri/src/models/project.rs` | Add three fields to `Project` |
| `src-tauri/src/db/projects.rs` | Add `update_bios_results`, `update_bios_root`; update `get`/`list`/`create` |
| `src-tauri/src/engine/bios_sweep.rs` | New — `BiosSystemDef`, `BIOS_SYSTEMS`, `BiosSweepConfig`, `run_sweep`, 3 tests |
| `src-tauri/src/engine/mod.rs` | Add `pub mod bios_sweep` |
| `src-tauri/src/commands/bios.rs` | Replace `get_bios_status` stub; add `revalidate_bios`, `set_bios_root` |
| `src-tauri/src/commands/scan.rs` | Add scan-end BIOS sweep block |
| `src-tauri/src/commands/mod.rs` or `helpers.rs` | Add `resolve_primary_frontend` helper |
| `src-tauri/src/lib.rs` | Register new commands |
| `src/types/index.ts` | Add `Project` fields; add `BiosStatusResponse` |
| `src/lib/ipc.ts` | Add `getBiosStatus`, `revalidateBios`, `setBiosRoot` |
| `src/lib/ipc.mock.ts` | Add mock implementations for new IPC calls |
| `src/components/dashboard/DashboardScreen.tsx` | Upgrade BIOS action card with live badge |
| `src/components/bios/BiosScreen.tsx` | Rework: persisted results, path config mode, remove hardcoded system list |
