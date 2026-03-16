# Romio — Claude Code Context

## Commands

```bash
pnpm tauri dev       # Start dev (Vite on :1444 + Rust backend)
pnpm tauri build     # Production build
pnpm test            # Vitest unit tests
cargo check          # Rust-only type check (fast)
cargo fix --lib -p romio  # Auto-fix unused import warnings
```

## Architecture

Tauri v2 desktop app: React + TypeScript frontend, Rust backend.

```
src/lib/ipc.ts          ← ALL invoke() calls live here — never call from components directly
src/stores/index.ts     ← Zustand stores (App, Scan, Preflight, BIOS)
src/types/index.ts      ← TS types — must stay in sync with src-tauri/src/models/
src-tauri/src/engine/   ← Pure Rust business logic (no Tauri deps, unit-testable)
src-tauri/src/commands/ ← Thin IPC handlers — call engine, return serializable results
src-tauri/src/adapters/ ← Per-frontend translators (FrontendAdapter trait)
src-tauri/data/*.json   ← Community-editable rules databases (BIOS, format, emulator matrix)
```

## Known Gotchas

**Port:** Vite runs on 1444 (not default 1420). Port 1420 falls in Windows excluded range
1344–1443 on this machine. Both `vite.config.ts` and `tauri.conf.json` devUrl use 1444.

**Icons:** `src-tauri/icons/` must contain `icon.ico` and `icon.icns` — tauri-build requires
them on Windows. Regenerate with: `pnpm tauri icon <source.png>`, then copy output from
`icons/` (root) into `src-tauri/icons/`.

**tauri.conf.json:** Only one config file — `src-tauri/tauri.conf.json`. Do NOT create a
root-level `tauri.conf.json`; the CLI finds it first and fails with "No package info".

**Plugin config in tauri.conf.json:**
- `dialog` plugin takes no config — do not add a `"dialog": {}` entry
- `fs` plugin has no `scope` field — filesystem permissions live in `capabilities/default.json`

## Screens & Status

Implemented: `welcome`, `projects`, `dashboard`, `preflight`, `bios`, `saves`
Placeholder (backend stubs exist, UI TODO): `format`, `multidisc`, `scummvm`, `installed`, `export`, `preview`, `rollback`

## Type Sync

`src/types/index.ts` mirrors `src-tauri/src/models/`. When adding a Rust model, add the
matching TS type. `SaveCheckpoint` is defined in Rust but currently missing from TS types —
fix before using `create_save_checkpoint` IPC call.
