# BIOS Status Persistence and Dashboard Integration — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist project-scoped BIOS configuration and validation results in SQLite, wire a BIOS sweep into the scan lifecycle, and surface live BIOS health on the dashboard action card.

**Architecture:** A new pure-engine `bios_sweep.rs` receives injected BIOS rules and a narrow config struct, returning a complete per-system snapshot. The command layer loads rules from DB, calls the engine, and persists results as a JSON blob on the `projects` table. The frontend renders from persisted results rather than driving per-system live queries.

**Tech Stack:** Rust (rusqlite, serde_json, tempfile for tests), TypeScript, React, @tanstack/react-query, Zustand

**Spec:** `docs/superpowers/specs/2026-03-29-bios-status-persistence-design.md`

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src-tauri/src/db/migrations/003_bios.sql` | Create | Three ALTER TABLE statements |
| `src-tauri/src/db/mod.rs` | Modify | Call migration 003 |
| `src-tauri/src/models/bios.rs` | Modify | Add `errored: bool` to `BiosSystemResult` |
| `src-tauri/src/models/project.rs` | Modify | Add `bios_root`, `bios_results`, `bios_last_validated_at` |
| `src-tauri/src/db/projects.rs` | Modify | Add `update_bios_results`, `update_bios_root`; update `get`/`list`/`create` |
| `src-tauri/src/engine/bios_sweep.rs` | Create | `BiosSystemDef`, `BIOS_SYSTEMS`, `BiosSweepConfig`, `run_sweep`, 3 unit tests |
| `src-tauri/src/engine/mod.rs` | Modify | Register `pub mod bios_sweep` |
| `src-tauri/src/commands/bios.rs` | Modify | `BiosStatusResponse`, `resolve_primary_frontend`, replace `get_bios_status`, add `revalidate_bios` + `set_bios_root` |
| `src-tauri/src/commands/scan.rs` | Modify | Add best-effort BIOS sweep after `update_scan_completion` |
| `src-tauri/src/lib.rs` | Modify | Register two new commands |
| `src/types/index.ts` | Modify | `errored` on `BiosSystemResult`; new `Project` fields; `BiosStatusResponse` |
| `src/lib/ipc.ts` | Modify | Replace `getBiosStatus`, add `revalidateBios`, `setBiosRoot` |
| `src/lib/ipc.mock.ts` | Modify | Fix fixture keys, add `errored`, replace/add three bindings |
| `src/components/dashboard/DashboardScreen.tsx` | Modify | `badge` prop on `ActionCard`, `biosBadge()` function |
| `src/components/bios/BiosScreen.tsx` | Rewrite | Persisted-results rendering, path config mode, revalidate button |

---

## Chunk 1: Data Foundations

### Task 1: SQLite migration

**Files:**
- Create: `src-tauri/src/db/migrations/003_bios.sql`
- Modify: `src-tauri/src/db/mod.rs`

- [ ] **Step 1: Create the migration file**

```sql
-- src-tauri/src/db/migrations/003_bios.sql
ALTER TABLE projects ADD COLUMN IF NOT EXISTS bios_root              TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS bios_results           TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS bios_last_validated_at TEXT;
```

- [ ] **Step 2: Register migration in `db/mod.rs`**

In `run_migrations`, add after the existing migration 002 call:

```rust
fn run_migrations(conn: &Connection) -> Result<()> {
    conn.execute_batch(include_str!("migrations/001_initial.sql"))?;
    conn.execute_batch(include_str!("migrations/002_scan_stats.sql"))?;
    conn.execute_batch(include_str!("migrations/003_bios.sql"))?;
    Ok(())
}
```

- [ ] **Step 3: Verify it compiles**

```bash
cargo check
```
Expected: no errors (the migration SQL is not validated at compile time, but the `include_str!` macro will fail if the file is missing).

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/db/migrations/003_bios.sql src-tauri/src/db/mod.rs
git commit -m "feat: add SQLite migration 003 — bios_root, bios_results, bios_last_validated_at"
```

---

### Task 2: Add `errored: bool` to `BiosSystemResult`

**Files:**
- Modify: `src-tauri/src/models/bios.rs`
- Modify: `src/types/index.ts`

The existing `validate_system_bios` command (live per-system) always returns `errored: false`. Only the new sweep engine produces `errored: true`.

- [ ] **Step 1: Update the Rust struct in `models/bios.rs`**

Find the `BiosSystemResult` struct (currently lines 52–58). Add `errored`:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BiosSystemResult {
    pub system:   String,
    pub entries:  Vec<BiosEntryResult>,
    pub blocking: bool,
    pub errored:  bool,  // true if validation failed for this system during a sweep
}
```

- [ ] **Step 2: Fix all existing construction sites**

`validate_system_bios` in `engine/bios_validator.rs` returns a `BiosSystemResult` at line 57. Add `errored: false` there:

```rust
Ok(BiosSystemResult { system, entries, blocking, errored: false })
```

- [ ] **Step 3: Verify it compiles**

```bash
cargo check
```
Expected: no errors.

- [ ] **Step 4: Update TS type in `src/types/index.ts`**

Find the `BiosSystemResult` interface (~line 82) and add `errored`:

```ts
export interface BiosSystemResult {
  system:   string;
  entries:  BiosEntryResult[];
  blocking: boolean;
  errored:  boolean;
}
```

- [ ] **Step 5: Update the mock fixture in `src/lib/ipc.mock.ts`**

Find `FIXTURE_BIOS_RESULT` and make two changes — fix the system ID and add `errored`:

```ts
const FIXTURE_BIOS_RESULT: BiosSystemResult = {
  system: "ps1",   // was "psx" — canonical id is "ps1"
  entries: [ ... same entries as before ... ],
  blocking: true,
  errored: false,
};
```

Also fix `FIXTURE_PROJECT.emulatorPrefs` key from the EmulationStation long name to the short BIOS ID:

```ts
emulatorPrefs: { "ps1": "duckstation" },  // was "Sony - PlayStation"
```

- [ ] **Step 6: Type-check**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 7: Run unit tests (should all still pass)**

```bash
pnpm test --run
```
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/models/bios.rs src-tauri/src/engine/bios_validator.rs src/types/index.ts src/lib/ipc.mock.ts
git commit -m "feat: add errored: bool to BiosSystemResult; fix mock fixture system id and emulatorPrefs key"
```

---

### Task 3: Extend `Project` model (Rust + TypeScript)

**Files:**
- Modify: `src-tauri/src/models/project.rs`
- Modify: `src/types/index.ts`

- [ ] **Step 1: Add three fields to the Rust `Project` struct**

In `models/project.rs`, extend `Project` (currently ends at `scan_stats`):

```rust
use crate::models::bios::BiosSystemResult;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id:                     Uuid,
    pub name:                   String,
    pub library_roots:          Vec<String>,
    pub target_frontends:       Vec<String>,
    pub emulator_prefs:         std::collections::HashMap<String, String>,
    pub created_at:             DateTime<Utc>,
    pub last_scanned_at:        Option<DateTime<Utc>>,
    pub scan_stats:             Option<ScanStats>,
    // BIOS fields
    pub bios_root:              Option<String>,
    pub bios_results:           Option<Vec<BiosSystemResult>>,
    pub bios_last_validated_at: Option<DateTime<Utc>>,
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cargo check
```
Expected: errors on `db::projects` construction sites (they don't set the new fields yet — that's Task 4).

- [ ] **Step 3: Add TS fields to `Project` interface in `src/types/index.ts`**

Find `export interface Project` (~line 99). Add three optional fields after `scanStats`:

```ts
export interface Project {
  id:               string;
  name:             string;
  libraryRoots:     string[];
  targetFrontends:  string[];
  emulatorPrefs:    Record<string, string>;
  createdAt:        string;
  lastScannedAt?:   string;
  scanStats?:       ScanStats;
  biosRoot?:        string;
  biosResults?:     BiosSystemResult[];
  biosLastValidatedAt?: string;
}
```

Also add `BiosStatusResponse` after the `Project` block:

```ts
export interface BiosStatusResponse {
  configured:       boolean;
  validated:        boolean;
  results:          BiosSystemResult[];
  lastValidatedAt?: string;
}
```

- [ ] **Step 4: Type-check**

```bash
npx tsc --noEmit
```
Expected: no TS errors (Rust not yet updated — that's Task 4).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/models/project.rs src/types/index.ts
git commit -m "feat: add bios_root/bios_results/bios_last_validated_at to Project model and TS types"
```

---

### Task 4: Update `db::projects`

**Files:**
- Modify: `src-tauri/src/db/projects.rs`

This is the largest Rust task. Read the entire current file at `src-tauri/src/db/projects.rs` before making changes.

- [ ] **Step 1: Write failing test for `update_bios_root` clearing stale results**

Add a `#[cfg(test)]` block at the bottom of `db/projects.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use std::path::PathBuf;
    use tempfile::TempDir;

    fn init_test_db() -> TempDir {
        let dir = TempDir::new().unwrap();
        db::init(dir.path()).unwrap();
        dir
    }

    #[test]
    fn test_update_bios_root_clears_stale_results() {
        let _dir = init_test_db();
        // Create a project
        let req = crate::models::project::CreateProjectRequest {
            name: "test".to_string(),
            library_roots: vec![],
            target_frontends: vec!["esde".to_string()],
        };
        let project = create(req).unwrap();

        // Write some fake bios results
        let fake_results: Vec<crate::models::bios::BiosSystemResult> = vec![];
        update_bios_results(&project.id.to_string(), fake_results).unwrap();

        // Confirm results are written
        let p = get(&project.id.to_string()).unwrap();
        assert!(p.bios_results.is_some());
        assert!(p.bios_last_validated_at.is_some());

        // Change bios_root — should clear results
        update_bios_root(&project.id.to_string(), Some("new/path")).unwrap();
        let p2 = get(&project.id.to_string()).unwrap();
        assert_eq!(p2.bios_root.as_deref(), Some("new/path"));
        assert!(p2.bios_results.is_none(), "changing bios_root must clear stale results");
        assert!(p2.bios_last_validated_at.is_none());
    }
}
```

- [ ] **Step 2: Run test to see it fail**

```bash
cargo test db::projects::tests::test_update_bios_root_clears_stale_results 2>&1
```
Expected: compile error — `update_bios_results` and `update_bios_root` not defined yet.

- [ ] **Step 3: Update `create` to default new fields to `None`**

In the `create` function, add the three new fields when constructing the `Project` struct:

```rust
pub fn create(req: CreateProjectRequest) -> Result<Project> {
    let project = Project {
        id:                     Uuid::new_v4(),
        name:                   req.name,
        library_roots:          req.library_roots,
        target_frontends:       req.target_frontends,
        emulator_prefs:         std::collections::HashMap::new(),
        created_at:             Utc::now(),
        last_scanned_at:        None,
        scan_stats:             None,
        bios_root:              None,
        bios_results:           None,
        bios_last_validated_at: None,
    };
    // INSERT stays the same — new columns default to NULL
    ...
}
```

- [ ] **Step 4: Update `get` and `list` to select and deserialize the three new columns**

The SQL SELECT in `get` currently selects 8 columns. Change to 11:

```sql
SELECT id, name, library_roots, target_frontends, emulator_prefs,
       created_at, last_scanned_at, scan_stats,
       bios_root, bios_results, bios_last_validated_at
FROM projects WHERE id = ?1
```

In the row destructuring, add indices 8, 9, 10:

```rust
let row = stmt.query_row(rusqlite::params![id], |row| {
    Ok((
        row.get::<_, String>(0)?,           // id
        row.get::<_, String>(1)?,           // name
        row.get::<_, String>(2)?,           // library_roots
        row.get::<_, String>(3)?,           // target_frontends
        row.get::<_, String>(4)?,           // emulator_prefs
        row.get::<_, String>(5)?,           // created_at
        row.get::<_, Option<String>>(6)?,   // last_scanned_at
        row.get::<_, Option<String>>(7)?,   // scan_stats
        row.get::<_, Option<String>>(8)?,   // bios_root
        row.get::<_, Option<String>>(9)?,   // bios_results
        row.get::<_, Option<String>>(10)?,  // bios_last_validated_at
    ))
})?;
```

When constructing the `Project` from the row tuple (using `.8`, `.9`, `.10`):

```rust
bios_root:              row.8,
bios_results:           row.9.and_then(|s| serde_json::from_str(&s).ok()),
bios_last_validated_at: row.10.and_then(|s|
                            chrono::DateTime::parse_from_rfc3339(&s)
                                .map(|d| d.with_timezone(&Utc)).ok()),
```

Apply the **same column changes** to `list`. In `list`, the per-row closure uses `p` (not `row`) as the tuple variable name, so the new fields are `p.8`, `p.9`, `p.10`:

```rust
bios_root:              p.8,
bios_results:           p.9.and_then(|s| serde_json::from_str(&s).ok()),
bios_last_validated_at: p.10.and_then(|s|
                            chrono::DateTime::parse_from_rfc3339(&s)
                                .map(|d| d.with_timezone(&Utc)).ok()),
```

The SQL SELECT in `list` needs the same 11-column expansion as `get`.

- [ ] **Step 5: Add `update_bios_results`**

```rust
pub fn update_bios_results(
    id:      &str,
    results: Vec<crate::models::bios::BiosSystemResult>,
) -> Result<()> {
    let results_json = serde_json::to_string(&results)?;
    let now = Utc::now().to_rfc3339();
    crate::db::with_conn(|conn| {
        conn.execute(
            "UPDATE projects
             SET bios_results = ?1, bios_last_validated_at = ?2
             WHERE id = ?3",
            rusqlite::params![results_json, now, id],
        )?;
        Ok(())
    })
}
```

- [ ] **Step 6: Add `update_bios_root`**

```rust
pub fn update_bios_root(id: &str, bios_root: Option<&str>) -> Result<()> {
    // Normalize empty string to NULL
    let normalized = bios_root.and_then(|s| {
        let t = s.trim();
        if t.is_empty() { None } else { Some(t) }
    });
    crate::db::with_conn(|conn| {
        conn.execute(
            // Atomically update path AND clear stale results
            "UPDATE projects
             SET bios_root = ?1, bios_results = NULL, bios_last_validated_at = NULL
             WHERE id = ?2",
            rusqlite::params![normalized, id],
        )?;
        Ok(())
    })
}
```

- [ ] **Step 7: Run the test**

```bash
cargo test db::projects::tests::test_update_bios_root_clears_stale_results 2>&1
```
Expected: PASS.

- [ ] **Step 8: Run all Rust tests**

```bash
cargo test 2>&1
```
Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add src-tauri/src/models/project.rs src-tauri/src/db/projects.rs src/types/index.ts
git commit -m "feat: add bios_root/bios_results fields to Project model and db::projects"
```

---

## Chunk 2: Engine Module

### Task 5: Create `engine::bios_sweep`

**Files:**
- Create: `src-tauri/src/engine/bios_sweep.rs`
- Modify: `src-tauri/src/engine/mod.rs`

- [ ] **Step 1: Write three failing tests in a new file**

Create `src-tauri/src/engine/bios_sweep.rs` with just the test module to start:

```rust
// SPDX-License-Identifier: GPL-3.0
//! Project-wide BIOS sweep engine.
//! Pure Rust — no Tauri or DB dependencies. Rules are injected by the command layer.

use anyhow::Result;
use std::collections::HashMap;
use std::path::PathBuf;

use crate::models::bios::{BiosRule, BiosSystemResult};
// BiosRequirement is only needed in tests — keep it out of module-level imports.

pub struct BiosSystemDef {
    pub id:               &'static str,
    pub default_emulator: &'static str,
}

pub const BIOS_SYSTEMS: &[BiosSystemDef] = &[
    BiosSystemDef { id: "ps1",       default_emulator: "duckstation"        },
    BiosSystemDef { id: "ps2",       default_emulator: "pcsx2"              },
    BiosSystemDef { id: "saturn",    default_emulator: "lr-beetle-saturn"   },
    BiosSystemDef { id: "segacd",    default_emulator: "lr-genesis-plus-gx" },
    BiosSystemDef { id: "sega32x",   default_emulator: "lr-picodrive"       },
    BiosSystemDef { id: "dreamcast", default_emulator: "lr-flycast"         },
    BiosSystemDef { id: "tg16cd",    default_emulator: "lr-beetle-pce"      },
    BiosSystemDef { id: "nds",       default_emulator: "melonds"            },
    BiosSystemDef { id: "fds",       default_emulator: "lr-mesen"           },
    BiosSystemDef { id: "3do",       default_emulator: "lr-opera"           },
    BiosSystemDef { id: "neogeo",    default_emulator: "lr-fbneo"           },
    BiosSystemDef { id: "xbox",      default_emulator: "xemu"               },
];

pub struct BiosSweepConfig {
    pub bios_root:      PathBuf,
    pub frontend:       String,
    pub emulator_prefs: HashMap<String, String>,
}

pub fn run_sweep(
    config:    &BiosSweepConfig,
    all_rules: &[BiosRule],
) -> Result<Vec<BiosSystemResult>> {
    todo!("implement run_sweep")
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;
    use crate::models::bios::{BiosRule, BiosRequirement};
    // Note: BadDumpEntry not imported — not needed in these tests.

    fn make_rule(system: &str, filename: &str, md5: &str, req: BiosRequirement) -> BiosRule {
        BiosRule {
            filename:          filename.to_string(),
            known_good_md5:    vec![md5.to_string()],
            known_bad_md5:     vec![],
            system:            system.to_string(),
            region:            None,
            requirement:       req,
            compressed:        false,
            default_path:      "".to_string(),
            frontend_paths:    HashMap::new(),
            emulator_paths:    HashMap::new(),
            notes:             None,
            dumping_guide_url: None,
        }
    }

    #[test]
    fn test_sweep_all_systems_returned_on_empty_dir() {
        let dir = TempDir::new().unwrap();
        let config = BiosSweepConfig {
            bios_root:      dir.path().to_path_buf(),
            frontend:       "esde".to_string(),
            emulator_prefs: HashMap::new(),
        };
        let results = run_sweep(&config, &[]).unwrap();
        assert_eq!(results.len(), BIOS_SYSTEMS.len(),
            "sweep must return one result per canonical system");
        // All should be non-blocking, non-errored (no rules = not applicable)
        assert!(results.iter().all(|r| !r.blocking && !r.errored));
    }

    #[test]
    fn test_sweep_blocking_when_required_bios_missing() {
        let dir = TempDir::new().unwrap();
        let config = BiosSweepConfig {
            bios_root:      dir.path().to_path_buf(),
            frontend:       "esde".to_string(),
            emulator_prefs: HashMap::new(),
        };
        let rule = make_rule("ps1", "scph5501.bin", "deadbeef00000000deadbeef00000000",
                             BiosRequirement::Required);
        let results = run_sweep(&config, &[rule]).unwrap();
        let ps1 = results.iter().find(|r| r.system == "ps1").unwrap();
        assert!(ps1.blocking, "missing required BIOS must set blocking: true");
        assert!(!ps1.errored);
    }

    #[test]
    fn test_sweep_emulator_pref_overrides_default() {
        // This test is deliberately falsifiable: the file is placed at the lr-pcsx-rearmed
        // emulator-specific path. With the default emulator (duckstation), the validator
        // expects the file in a "duckstation/" subdir and will find it at the wrong path
        // (PresentWrongPath). With the override, it expects "lr-psx/" and finds it there
        // (PresentValid). This proves path resolution actually uses the emulator pref.

        let dir = TempDir::new().unwrap();

        // Place the file at the lr-pcsx-rearmed-specific path
        let lr_dir = dir.path().join("lr-psx");
        std::fs::create_dir_all(&lr_dir).unwrap();
        let data = b"fake bios content";
        let hash = crate::engine::hash::md5_bytes(data);
        std::fs::write(lr_dir.join("scph5501.bin"), data).unwrap();

        // Rule: default path is "duckstation" subdir; lr-pcsx-rearmed override is "lr-psx"
        let mut emulator_paths = HashMap::new();
        emulator_paths.insert("lr-pcsx-rearmed".to_string(), "lr-psx".to_string());
        let rule = BiosRule {
            filename:          "scph5501.bin".to_string(),
            known_good_md5:    vec![hash.clone()],
            known_bad_md5:     vec![],
            system:            "ps1".to_string(),
            region:            None,
            requirement:       BiosRequirement::Required,
            compressed:        false,
            default_path:      "duckstation".to_string(),
            frontend_paths:    HashMap::new(),
            emulator_paths,
            notes:             None,
            dumping_guide_url: None,
        };

        // Without override — default emulator "duckstation": expects file in "duckstation/" dir
        let config_default = BiosSweepConfig {
            bios_root:      dir.path().to_path_buf(),
            frontend:       "esde".to_string(),
            emulator_prefs: HashMap::new(),
        };
        let results = run_sweep(&config_default, &[rule.clone()]).unwrap();
        let ps1 = results.iter().find(|r| r.system == "ps1").unwrap();
        assert_eq!(
            ps1.entries[0].state,
            crate::models::artifact::BiosValidationState::PresentWrongPath,
            "without override, file at lr-psx path must be flagged as wrong path for duckstation"
        );

        // With lr-pcsx-rearmed override: expects file in "lr-psx/" dir → PresentValid
        let mut prefs = HashMap::new();
        prefs.insert("ps1".to_string(), "lr-pcsx-rearmed".to_string());
        let config_override = BiosSweepConfig {
            bios_root:      dir.path().to_path_buf(),
            frontend:       "esde".to_string(),
            emulator_prefs: prefs,
        };
        let results2 = run_sweep(&config_override, &[rule]).unwrap();
        let ps1_v2 = results2.iter().find(|r| r.system == "ps1").unwrap();
        assert_eq!(
            ps1_v2.entries[0].state,
            crate::models::artifact::BiosValidationState::PresentValid,
            "with lr-pcsx-rearmed override, file must be found at correct path"
        );
    }
}
```

- [ ] **Step 2: Register module in `engine/mod.rs`**

Add to the end of `engine/mod.rs`:

```rust
pub mod bios_sweep;
```

- [ ] **Step 3: Run tests to see them fail**

```bash
cargo test engine::bios_sweep 2>&1
```
Expected: `test_sweep_all_systems_returned_on_empty_dir` and others fail with "not yet implemented" panic from `todo!`.

- [ ] **Step 4: Implement `run_sweep`**

Replace the `todo!` stub with the full implementation:

```rust
pub fn run_sweep(
    config:    &BiosSweepConfig,
    all_rules: &[BiosRule],
) -> Result<Vec<BiosSystemResult>> {
    let mut results = Vec::with_capacity(BIOS_SYSTEMS.len());

    for system in BIOS_SYSTEMS {
        let emulator = config.emulator_prefs
            .get(system.id)
            .map(String::as_str)
            .unwrap_or(system.default_emulator);

        let rules: Vec<&BiosRule> = all_rules.iter()
            .filter(|r| r.system == system.id)
            .collect();

        if rules.is_empty() {
            // System not in rules database — not applicable, not an error
            results.push(BiosSystemResult {
                system:   system.id.to_string(),
                entries:  vec![],
                blocking: false,
                errored:  false,
            });
            continue;
        }

        match crate::engine::bios_validator::validate_system_bios(
            &config.bios_root,
            &rules.into_iter().cloned().collect::<Vec<_>>(),
            &config.frontend,
            emulator,
        ) {
            Ok(result) => results.push(result),
            Err(e) => {
                eprintln!("[bios_sweep] validation failed for system={} err={}", system.id, e);
                results.push(BiosSystemResult {
                    system:   system.id.to_string(),
                    entries:  vec![],
                    blocking: false,
                    errored:  true,
                });
            }
        }
    }

    Ok(results)
}
```

- [ ] **Step 5: Run engine tests**

```bash
cargo test engine::bios_sweep 2>&1
```
Expected: all 3 tests PASS.

- [ ] **Step 6: Run all Rust tests**

```bash
cargo test 2>&1
```
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/engine/bios_sweep.rs src-tauri/src/engine/mod.rs
git commit -m "feat: add engine::bios_sweep with BIOS_SYSTEMS constant and run_sweep"
```

---

## Chunk 3: Commands Layer

### Task 6: Add `BiosStatusResponse`, `resolve_primary_frontend`, and replace `get_bios_status`

**Files:**
- Modify: `src-tauri/src/commands/bios.rs`

Read the full current file before editing.

- [ ] **Step 1: Add the response struct and helper function**

At the top of `commands/bios.rs` (after the existing `use` declarations), add:

```rust
// Note: `use crate::engine::bios_sweep` is NOT added here — it's only needed
// in Task 7 when revalidate_bios is added. Adding unused imports causes warnings
// (or errors under deny(warnings)).

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BiosStatusResponse {
    pub configured:        bool,
    pub validated:         bool,
    pub results:           Vec<crate::models::bios::BiosSystemResult>,
    pub last_validated_at: Option<String>,
}

/// Returns the primary frontend for BIOS validation.
/// BIOS sweep targets one frontend — the first of the project's target_frontends.
pub fn resolve_primary_frontend(frontends: &[String]) -> Result<String, String> {
    frontends.first()
        .cloned()
        .ok_or_else(|| "project has no target frontends configured".to_string())
}
```

- [ ] **Step 2: Replace the `get_bios_status` stub**

The current stub returns `Ok(vec![])`. Replace the entire function:

```rust
#[tauri::command]
pub async fn get_bios_status(project_id: String) -> Result<BiosStatusResponse, String> {
    let project = crate::db::projects::get(&project_id)
        .map_err(|e| e.to_string())?;

    let configured = project.bios_root.is_some();
    let validated  = project.bios_results.is_some();
    let results    = project.bios_results.unwrap_or_default();
    let last_validated_at = project.bios_last_validated_at
        .map(|dt| dt.to_rfc3339());

    Ok(BiosStatusResponse { configured, validated, results, last_validated_at })
}
```

- [ ] **Step 3: Verify it compiles**

```bash
cargo check 2>&1
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands/bios.rs
git commit -m "feat: add BiosStatusResponse, resolve_primary_frontend, replace get_bios_status stub"
```

---

### Task 7: Add `revalidate_bios` and `set_bios_root` commands

**Files:**
- Modify: `src-tauri/src/commands/bios.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add `revalidate_bios`**

Add the import at the top of `commands/bios.rs` (now that it's actually used):

```rust
use crate::engine::bios_sweep;
```

Append the command to `commands/bios.rs`:

```rust
#[tauri::command]
pub async fn revalidate_bios(project_id: String) -> Result<BiosStatusResponse, String> {
    let project = crate::db::projects::get(&project_id)
        .map_err(|e| e.to_string())?;

    let bios_root = project.bios_root
        .as_deref()
        .ok_or("BIOS path not configured")?;

    let frontend = resolve_primary_frontend(&project.target_frontends)?;

    let all_rules = crate::db::bios::load_all_rules()
        .map_err(|e| e.to_string())?;

    let config = bios_sweep::BiosSweepConfig {
        bios_root:      std::path::PathBuf::from(bios_root),
        frontend,
        emulator_prefs: project.emulator_prefs.clone(),
    };

    let results = bios_sweep::run_sweep(&config, &all_rules)
        .map_err(|e| e.to_string())?;

    crate::db::projects::update_bios_results(&project_id, results)
        .map_err(|e| e.to_string())?;

    // Re-read the persisted row so the returned timestamp matches what getProject returns.
    // This avoids a two-Utc::now() divergence between the response and the DB value.
    let updated = crate::db::projects::get(&project_id)
        .map_err(|e| e.to_string())?;

    let last_validated_at = updated.bios_last_validated_at
        .map(|dt| dt.to_rfc3339());

    Ok(BiosStatusResponse {
        configured:        true,
        validated:         true,
        results:           updated.bios_results.unwrap_or_default(),
        last_validated_at,
    })
}
```

- [ ] **Step 2: Add `set_bios_root`**

Append to `commands/bios.rs`:

```rust
#[tauri::command]
pub async fn set_bios_root(
    project_id: String,
    bios_root:  Option<String>,
) -> Result<(), String> {
    // Normalize: trim whitespace, empty string → None
    let normalized = bios_root.and_then(|s| {
        let t = s.trim().to_string();
        if t.is_empty() { None } else { Some(t) }
    });
    crate::db::projects::update_bios_root(&project_id, normalized.as_deref())
        .map_err(|e| e.to_string())
}
```

- [ ] **Step 3: Register in `lib.rs`**

In the `invoke_handler` block, find the BIOS section and add two entries:

```rust
// BIOS validation
commands::bios::validate_bios,
commands::bios::get_bios_rules,
commands::bios::get_bios_status,
commands::bios::revalidate_bios,   // new
commands::bios::set_bios_root,     // new
```

- [ ] **Step 4: Verify it compiles**

```bash
cargo check 2>&1
```
Expected: no errors.

- [ ] **Step 5: Run all Rust tests**

```bash
cargo test 2>&1
```
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/commands/bios.rs src-tauri/src/lib.rs
git commit -m "feat: add revalidate_bios and set_bios_root commands"
```

---

### Task 8: Wire BIOS sweep into `scan_library`

**Files:**
- Modify: `src-tauri/src/commands/scan.rs`

- [ ] **Step 1: Add the best-effort sweep block**

In `commands/scan.rs`, after the `update_scan_completion` call (currently line 54–55), insert:

```rust
    // Best-effort BIOS sweep — failure does not fail the scan.
    // DB note: get() and load_all_rules() each acquire and release the mutex independently.
    // Do NOT nest them inside each other or inside another with_conn closure.
    let project_for_bios = crate::db::projects::get(&project_id);
    if let Ok(project) = project_for_bios {
        if let Some(ref bios_root) = project.bios_root {
            match crate::commands::bios::resolve_primary_frontend(&project.target_frontends) {
                Ok(frontend) => {
                    match crate::db::bios::load_all_rules() {
                        Ok(all_rules) => {
                            let config = crate::engine::bios_sweep::BiosSweepConfig {
                                bios_root:      std::path::PathBuf::from(bios_root),
                                frontend:       frontend.clone(),
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
                                    project_id, bios_root, frontend, e
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

- [ ] **Step 2: Verify it compiles**

```bash
cargo check 2>&1
```
Expected: no errors.

- [ ] **Step 3: Run all Rust tests**

```bash
cargo test 2>&1
```
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands/scan.rs
git commit -m "feat: run best-effort BIOS sweep at end of scan_library when bios_root is configured"
```

---

## Chunk 4: Frontend

### Task 9: Update IPC layer and fix mock

**Files:**
- Modify: `src/lib/ipc.ts`
- Modify: `src/lib/ipc.mock.ts`

Read both files in full before editing.

- [ ] **Step 1: Update `ipc.ts`**

Find the existing `getBiosStatus` line:
```ts
getBiosStatus:    (projectId: string)  => invoke<BiosSystemResult[]>("get_bios_status", { projectId }),
```

Replace it and add two new bindings directly after:
```ts
getBiosStatus:  (projectId: string) =>
                  invoke<BiosStatusResponse>("get_bios_status", { projectId }),
revalidateBios: (projectId: string) =>
                  invoke<BiosStatusResponse>("revalidate_bios", { projectId }),
setBiosRoot:    (projectId: string, biosRoot: string | null) =>
                  invoke<void>("set_bios_root", { projectId, biosRoot }),
```

Add `BiosStatusResponse` to the imports at the top of `ipc.ts`:
```ts
import type {
  ...existing imports...,
  BiosStatusResponse,
} from "@/types";
```

- [ ] **Step 2: Update `ipc.mock.ts`**

Replace the `getBiosStatus` mock binding (currently returns `BiosSystemResult[]`):
```ts
// Old — remove:
getBiosStatus: async (_projectId: string): Promise<BiosSystemResult[]> =>
  [FIXTURE_BIOS_RESULT],

// New:
getBiosStatus:  async (_projectId: string): Promise<BiosStatusResponse> =>
  ({ configured: false, validated: false, results: [], lastValidatedAt: undefined }),
revalidateBios: async (_projectId: string): Promise<BiosStatusResponse> =>
  ({ configured: true, validated: true, results: [], lastValidatedAt: new Date().toISOString() }),
setBiosRoot:    async (_projectId: string, _biosRoot: string | null): Promise<void> =>
  undefined,
```

Add `BiosStatusResponse` to the mock's imports:
```ts
import type {
  ...existing...,
  BiosStatusResponse,
} from "@/types";
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit 2>&1
```
Expected: no errors.

- [ ] **Step 4: Run unit tests**

```bash
pnpm test --run 2>&1
```
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ipc.ts src/lib/ipc.mock.ts
git commit -m "feat: update IPC layer for BIOS persistence — getBiosStatus, revalidateBios, setBiosRoot"
```

---

### Task 10: Upgrade dashboard BIOS action card

**Files:**
- Modify: `src/components/dashboard/DashboardScreen.tsx`

Read the full file before editing.

- [ ] **Step 1: Add `badge` prop to `ActionCard`**

Find the `ActionCard` function signature (around line 200). Change to:

```ts
function ActionCard({ title, description, status, onClick, badge }: {
  title: string;
  description: string;
  status: string;
  onClick: () => void;
  badge?: { label: string; color: "gray" | "amber" | "red" | "green" };
}) {
```

Inside the component, add the badge after the description paragraph:

```tsx
<p className="text-xs text-romio-gray mt-0.5">{description}</p>
{badge && (
  <span className={cn(
    "inline-block mt-1.5 text-xs font-medium px-2 py-0.5 rounded-full",
    badge.color === "red"   && "bg-romio-red/10 text-romio-red",
    badge.color === "amber" && "bg-amber-600/10 text-amber-400",
    badge.color === "green" && "bg-romio-green/10 text-romio-green",
    badge.color === "gray"  && "bg-white/5 text-romio-gray",
  )}>
    {badge.label}
  </span>
)}
```

- [ ] **Step 2: Add `biosBadge` function**

First, add `Project` to the imports at the top of `DashboardScreen.tsx`. It isn't currently imported — add it:

```ts
import type { Project } from "@/types";
```

Add the pure function before `DashboardScreen`:

```ts
function biosBadge(project: Project): {
  label: string;
  color: "gray" | "amber" | "red" | "green";
} {
  if (!project.biosRoot)     return { label: "Not configured", color: "gray" };
  if (!project.biosResults)  return { label: "Not validated",  color: "gray" };

  const results      = project.biosResults;
  const erroredCount  = results.filter(r => r.errored).length;
  const blockingCount = results.filter(r => r.blocking).length;
  const missingCount  = results
    .flatMap(r => r.entries)
    .filter(e => e.state === "MISSING_REQUIRED" || e.state === "MISSING_OPTIONAL")
    .length;

  if (blockingCount > 0) return { label: `${blockingCount} blocking`,          color: "red"   };
  if (erroredCount  > 0) return { label: `${erroredCount} systems incomplete`, color: "amber" };
  if (missingCount  > 0) return { label: `${missingCount} missing`,            color: "amber" };
  return { label: "All valid", color: "green" };
}
```

- [ ] **Step 3: Wire badge to the BIOS action card**

Find the "BIOS Validation" `ActionCard` and add the `badge` prop:

```tsx
<ActionCard
  title="BIOS Validation"
  description="Check all BIOS files for your target frontend"
  status={stats.blockingIssues > 0 ? "error" : "ok"}
  onClick={() => setScreen("bios")}
  badge={biosBadge(activeProject)}
/>
```

- [ ] **Step 4: Type-check**

```bash
npx tsc --noEmit 2>&1
```
Expected: no errors.

- [ ] **Step 5: Run unit tests**

```bash
pnpm test --run 2>&1
```
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/components/dashboard/DashboardScreen.tsx
git commit -m "feat: add live BIOS health badge to dashboard action card"
```

---

### Task 11: Rewrite `BiosScreen`

**Files:**
- Modify: `src/components/bios/BiosScreen.tsx`

This is the largest frontend task. Read the full file before making changes.

**What to remove:**
- The hardcoded `SYSTEMS` constant array (lines 12–25)
- The `biosRoot` local `useState<string>("")` state
- The `selectedFrontend` dropdown select element and its state
- The per-system `useQuery` in `SystemRow` (it will be replaced by a screen-level query)
- The `SystemRow` component (its logic moves into a simpler row driven by persisted data)

**What to add:**
- Screen-level `useQuery` for `["bios_status", projectId]`
- Path configuration mode (when `biosRoot` unset)
- "Edit path" inline mode
- `revalidateMut` mutation with `getProject` refresh + `invalidateQueries`

- [ ] **Step 1: Write the new screen**

Replace the entire file content:

```tsx
// SPDX-License-Identifier: GPL-3.0
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  Shield, ChevronDown, ChevronRight, ExternalLink,
  Copy, FolderOpen, RefreshCw, Pencil,
} from "lucide-react";
import { useAppStore } from "@/stores";
import { ipc } from "@/lib/ipc";
import type { BiosSystemResult, BiosEntryResult } from "@/types";
import { cn, biosStateColor, biosStateBg, biosStateLabel, truncatePath } from "@/lib/utils";

export function BiosScreen() {
  const queryClient = useQueryClient();
  const { activeProject, setActiveProject } = useAppStore();
  const [editingPath, setEditingPath] = useState(false);
  const [pathInput, setPathInput] = useState("");
  const [expandedSystem, setExpandedSystem] = useState<string | null>(null);

  const projectId = activeProject?.id ?? "";

  // Load persisted BIOS status — initialData avoids flash on first render
  const { data: status } = useQuery({
    queryKey:    ["bios_status", projectId],
    queryFn:     () => ipc.getBiosStatus(projectId),
    enabled:     !!activeProject?.biosRoot,
    initialData: activeProject ? {
      configured:      !!activeProject.biosRoot,
      validated:       !!activeProject.biosResults,
      results:         activeProject.biosResults ?? [],
      lastValidatedAt: activeProject.biosLastValidatedAt,
    } : undefined,
  });

  const revalidateMut = useMutation({
    mutationFn: () => ipc.revalidateBios(projectId),
    onSuccess: async () => {
      const updated = await ipc.getProject(projectId);
      setActiveProject(updated);
      queryClient.invalidateQueries({ queryKey: ["bios_status", projectId] });
    },
  });

  async function savePath() {
    const trimmed = pathInput.trim();
    await ipc.setBiosRoot(projectId, trimmed || null);
    const updated = await ipc.getProject(projectId);
    setActiveProject(updated);
    setEditingPath(false);
    setPathInput("");
  }

  async function clearPath() {
    await ipc.setBiosRoot(projectId, null);
    const updated = await ipc.getProject(projectId);
    setActiveProject(updated);
    setEditingPath(false);
    setPathInput("");
  }

  if (!activeProject) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-romio-gray">No project open.</p>
      </div>
    );
  }

  const biosRoot     = activeProject.biosRoot;
  const configured   = !!biosRoot;
  const validated    = !!activeProject.biosResults;
  const results      = status?.results ?? [];

  return (
    <div className="p-8 max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <div className="p-2.5 rounded-xl bg-romio-green/10 border border-romio-green/20">
          <Shield className="w-5 h-5 text-romio-green" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-romio-cream">BIOS Validation</h1>
          <p className="text-romio-gray text-sm mt-0.5">
            Hash-first identification. Frontend-aware path rules.
          </p>
        </div>
      </div>

      {/* Path configuration row */}
      <div className="space-y-2">
        {!configured || editingPath ? (
          /* Not configured, or user clicked Edit */
          <div className="space-y-2">
            <label className="text-xs font-medium text-romio-gray/70 uppercase tracking-widest">
              BIOS directory
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1 flex items-center">
                <div className="absolute left-0 flex items-center h-full pl-3 pr-2.5
                                border-r border-white/10 pointer-events-none">
                  <FolderOpen className="w-4 h-4 text-romio-gray/50" />
                </div>
                <input
                  value={pathInput}
                  onChange={(e) => setPathInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && savePath()}
                  placeholder="/path/to/bios"
                  autoFocus
                  className="w-full pl-11 pr-3 py-2 rounded-lg bg-romio-surface border border-white/10
                             text-sm font-mono text-romio-cream placeholder:text-romio-gray/40
                             focus:outline-none focus:border-romio-green/40"
                />
              </div>
              <button
                onClick={savePath}
                disabled={!pathInput.trim()}
                className="px-4 py-2 rounded-lg text-sm font-semibold bg-romio-green text-white
                           hover:bg-romio-green/90 disabled:opacity-40 disabled:cursor-not-allowed
                           transition-colors"
              >
                Save
              </button>
              {editingPath && (
                <button
                  onClick={() => { setEditingPath(false); setPathInput(""); }}
                  className="px-3 py-2 rounded-lg text-sm text-romio-gray hover:text-romio-cream
                             border border-border transition-colors"
                >
                  Cancel
                </button>
              )}
            </div>
            {!configured && (
              <p className="text-xs text-romio-gray/60">
                Set your BIOS directory to enable validation and automatic sweep on scan.
              </p>
            )}
          </div>
        ) : (
          /* Configured path display */
          <div className="flex items-center justify-between p-3 rounded-lg
                          bg-romio-surface/50 border border-border">
            <div className="flex items-center gap-2 min-w-0">
              <FolderOpen className="w-4 h-4 text-romio-gray/50 flex-shrink-0" />
              <span className="font-mono text-sm text-romio-cream truncate">{biosRoot}</span>
            </div>
            <button
              onClick={() => { setEditingPath(true); setPathInput(biosRoot ?? ""); }}
              className="flex items-center gap-1.5 ml-3 text-xs text-romio-gray
                         hover:text-romio-cream transition-colors flex-shrink-0"
            >
              <Pencil className="w-3 h-3" /> Edit path
            </button>
          </div>
        )}
      </div>

      {/* Action row — shown when configured */}
      {configured && !editingPath && (
        <div className="flex items-center justify-between">
          <div className="text-xs text-romio-gray">
            {status?.lastValidatedAt
              ? `Last validated: ${new Date(status.lastValidatedAt).toLocaleString()}`
              : "Not yet validated"}
          </div>
          <button
            onClick={() => revalidateMut.mutate()}
            disabled={revalidateMut.isPending}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold
                       bg-romio-green/10 text-romio-green border border-romio-green/20
                       hover:bg-romio-green/20 disabled:opacity-40 transition-colors"
          >
            <RefreshCw className={cn("w-3.5 h-3.5", revalidateMut.isPending && "animate-spin")} />
            {revalidateMut.isPending ? "Validating…" : validated ? "Revalidate BIOS" : "Validate Now"}
          </button>
        </div>
      )}

      {/* Not-yet-validated state */}
      {configured && !validated && !revalidateMut.isPending && (
        <div className="flex flex-col items-center justify-center py-10 text-center space-y-3
                        border border-dashed border-border rounded-xl">
          <Shield className="w-8 h-8 text-romio-gray/30" />
          <div>
            <p className="text-romio-cream font-medium text-sm">No validation results yet</p>
            <p className="text-romio-gray text-xs">Run a scan or click "Validate Now" to check your BIOS files.</p>
          </div>
        </div>
      )}

      {/* System results list */}
      {configured && results.length > 0 && (
        <div className="space-y-2">
          {results.map((result, i) => (
            <SystemResultRow
              key={result.system}
              result={result}
              index={i}
              expanded={expandedSystem === result.system}
              onToggle={() => setExpandedSystem(
                expandedSystem === result.system ? null : result.system
              )}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SystemResultRow({ result, expanded, onToggle, index }: {
  result:   BiosSystemResult;
  index:    number;
  expanded: boolean;
  onToggle: () => void;
}) {
  const allValid   = result.entries.length > 0 &&
                     result.entries.every(e => e.state === "PRESENT_VALID");
  const borderColor = result.errored   ? "border-amber-600/30 bg-amber-600/5"
                    : result.blocking  ? "border-romio-red/30 bg-romio-red/5"
                    : allValid         ? "border-romio-green/20"
                    :                   "border-border bg-romio-surface/40";

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.03 }}
      className={cn("rounded-xl border transition-colors overflow-hidden", borderColor)}
    >
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3
                   hover:bg-white/5 transition-colors text-left"
      >
        <div className="flex items-center gap-3">
          {expanded
            ? <ChevronDown  className="w-4 h-4 text-romio-gray flex-shrink-0" />
            : <ChevronRight className="w-4 h-4 text-romio-gray flex-shrink-0" />
          }
          <span className="font-medium text-sm text-romio-cream font-mono">{result.system}</span>
        </div>

        <div className="flex items-center gap-2">
          {result.errored && (
            <span className="text-xs font-medium text-amber-400">Validation error</span>
          )}
          {!result.errored && result.blocking && (
            <span className="text-xs font-medium text-romio-red">Blocking</span>
          )}
          {!result.errored && !result.blocking && allValid && (
            <span className="text-xs font-medium text-romio-green">All valid</span>
          )}
          {!result.errored && !result.blocking && !allValid && result.entries.length > 0 && (
            <span className="text-xs font-medium text-amber-400">
              {result.entries.filter(e =>
                e.state === "MISSING_REQUIRED" || e.state === "MISSING_OPTIONAL"
              ).length} missing
            </span>
          )}
          {result.entries.length === 0 && !result.errored && (
            <span className="text-xs text-romio-gray/50">Not in database</span>
          )}
        </div>
      </button>

      <AnimatePresence>
        {expanded && result.entries.length > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="border-t border-border px-4 py-3 space-y-2">
              {result.entries.map((entry) => (
                <BiosEntryRow key={entry.rule.filename} entry={entry} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function BiosEntryRow({ entry }: { entry: BiosEntryResult }) {
  const [_copied, setCopied] = useState(false);

  function copyMd5() {
    if (entry.foundMd5) {
      navigator.clipboard.writeText(entry.foundMd5);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }

  return (
    <div className={cn(
      "px-3 py-2.5 rounded-lg border text-sm",
      biosStateBg(entry.state),
      entry.state === "PRESENT_VALID"    ? "border-romio-green/10"  :
      entry.state === "MISSING_REQUIRED" ? "border-romio-red/20"    :
                                           "border-border"
    )}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={cn("font-mono text-xs font-medium", biosStateColor(entry.state))}>
              {entry.rule.filename}
            </span>
            {entry.rule.region && (
              <span className="text-xs text-romio-gray border border-border px-1.5 rounded">
                {entry.rule.region}
              </span>
            )}
            <span className={cn("text-xs", biosStateColor(entry.state))}>
              {biosStateLabel(entry.state)}
            </span>
          </div>

          {entry.foundPath && (
            <p className="font-mono text-xs text-romio-gray mt-1 truncate">
              {truncatePath(entry.foundPath)}
            </p>
          )}
          {entry.renameFrom && (
            <p className="text-xs text-amber-400 mt-1">
              Found as: <span className="font-mono">{entry.renameFrom}</span> — rename recommended
            </p>
          )}
          {entry.badDumpLabel && (
            <p className="text-xs text-romio-red mt-1">
              ⚠ Known bad dump: {entry.badDumpLabel}
            </p>
          )}
          {entry.rule.notes && (
            <p className="text-xs text-romio-gray/70 mt-1">{entry.rule.notes}</p>
          )}
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {entry.foundMd5 && (
            <button onClick={copyMd5} title="Copy MD5"
              className="text-romio-gray hover:text-romio-cream transition-colors">
              <Copy className="w-3.5 h-3.5" />
            </button>
          )}
          {entry.state === "MISSING_REQUIRED" && entry.rule.dumpingGuideUrl && (
            <a href={entry.rule.dumpingGuideUrl} target="_blank" rel="noopener noreferrer"
               className="text-blue-400 hover:text-blue-300 transition-colors"
               title="Dumping guide">
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit 2>&1
```
Expected: no errors. If `setActiveProject` is not yet imported from `useAppStore`, add it:
```ts
const { activeProject, setActiveProject, setScreen } = useAppStore();
```

- [ ] **Step 3: Run unit tests**

```bash
pnpm test --run 2>&1
```
Expected: all 27 tests pass.

- [ ] **Step 4: Run full Rust tests**

```bash
cargo test 2>&1
```
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/bios/BiosScreen.tsx
git commit -m "feat: rewrite BiosScreen — persisted results, path config mode, revalidate button"
```

---

## Final Verification

- [ ] **Full type check**

```bash
npx tsc --noEmit 2>&1
```
Expected: no errors.

- [ ] **Full Rust compile and test**

```bash
cargo test 2>&1
```
Expected: all pass including the 3 new `bios_sweep` tests and the `db::projects` test.

- [ ] **Full TS unit tests**

```bash
pnpm test --run 2>&1
```
Expected: all 27+ tests pass.

- [ ] **Push to GitHub**

```bash
git push
```
