# Architecture Overview

## Stack

Romio is built on **Tauri 2** with a **Rust backend** and **React/TypeScript frontend**.

| Layer | Technology | Responsibility |
|---|---|---|
| App shell | Tauri 2 | Native desktop wrapper, IPC bridge, file system access, installer |
| Backend | Rust | All engine logic: BIOS validation, hash computation, path normalization, save registry, host checks, format matrix |
| Frontend | React 18 + TypeScript | All UI: screens, Romio companion, state management |
| Styling | Tailwind CSS + shadcn/ui | Design system with Romio color tokens |
| State | Zustand | Lightweight global state (active project, screen, Romio state) |
| Data fetching | TanStack Query | Async command results with caching |
| Animations | Framer Motion | Screen transitions, mascot state changes, progress indicators |
| Database | SQLite (rusqlite) | Project state, operation log, scan results — persisted via bundled database |

## Why Tauri over Electron

- **Single-file installer** — 5–8MB on all platforms vs. 150–200MB for Electron
- **Rust backend** is the right tool for hash-intensive, filesystem-heavy validation work
- **No bundled Chromium** — uses the OS webview (WebView2 on Windows, WKWebView on macOS, WebKitGTK on Linux)
- **Lower memory footprint** for a tool that may scan libraries of 50,000+ files
- All three platforms produce a native installer from one codebase via GitHub Actions

## Layer boundaries

The rules engine (`src-tauri/src/engine/`) has **no Tauri dependencies**. It is pure Rust and fully unit-testable in isolation. The `commands/` layer is the thin Tauri IPC wrapper that calls the engine and returns serializable results.

This means the engine can be extracted as a library crate in the future without touching any UI code.

## IPC contract

All Tauri commands are typed in `src/lib/ipc.ts`. Never call `invoke()` directly from components — import from `ipc` instead. This keeps the type contract in one place and makes refactoring tractable.

## Data files

The JSON files in `src-tauri/data/` are the community-maintainable rules databases:

- `bios_rules.json` — BIOS filename, MD5 hashes, placement paths per frontend/emulator
- `format_matrix.json` — Format-to-emulator compatibility rules
- `save_paths.json` — Known save-path migration history per emulator/frontend
- `emulator_matrix.json` — Emulator recommendation and activity status

These are loaded at runtime via `include_str!()` and are bundled with the app binary.
They can be updated independently of the app binary by the community.

→ [IPC Contract](./ipc-contract.md)
→ [Rules Databases](./rules-databases.md)
→ [Data Model](./data-model.md)
