# Changelog

All notable changes to Romio will be documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Romio uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- Initial project scaffold
- Tauri + Rust backend + React/TypeScript frontend structure
- BIOS rules database schema and initial data
- Format compatibility matrix schema and initial data
- Save-path migration registry schema
- Host environment checker module stubs
- All 13 Romio mascot states wired to UX contexts
- GPL-3.0 license
- GitHub Actions CI/CD pipeline for Windows, macOS, Linux
- Eden `.nsp`/`.xci` format rules

### Changed
- Switch: Eden is now recommended; Ryubing (halted Feb 2026) and Sudachi (ended Jul 2025) dropped as alternatives
- 32X BIOS files marked optional — PicoDrive does not need them
- `syscard3.pce` accepts the libretro/Batocera MD5 `38179df8f4ac870017db21ebcbf53114`

### Removed
- PCSX2 save rule whose old and new paths were identical, which flagged a false conflict

---

<!-- New releases go above this line -->
