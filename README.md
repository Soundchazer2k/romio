# Romio

<p align="center">
  <img src="src/assets/romio/romio_welcome.png" alt="Romio mascot" width="180" />
</p>

<p align="center">
  <strong>Your retro library's best friend.</strong><br/>
  Validate, fix, and export your ROM collection across any frontend — without losing your saves.
</p>

<p align="center">
  <a href="https://github.com/your-org/romio/releases"><img alt="Latest Release" src="https://img.shields.io/github/v/release/your-org/romio?style=flat-square&color=4A8C5C" /></a>
  <a href="LICENSE"><img alt="License: GPL-3.0" src="https://img.shields.io/badge/license-GPL--3.0-E03030?style=flat-square" /></a>
  <a href="https://github.com/your-org/romio/actions"><img alt="Build" src="https://img.shields.io/github/actions/workflow/status/your-org/romio/build.yml?style=flat-square" /></a>
</p>

---

## What is Romio?

Romio is a desktop facilitation tool for retro library correctness and frontend interoperability.
It is **not** an emulator. It is **not** a frontend. It is the compatibility and hygiene layer
that answers the questions every retrogaming power user faces:

- Are my BIOS files correct and in the right place *for this specific frontend*?
- Will my ROM formats actually work with the active emulator?
- Are my saves safe if I update this emulator?
- Why did my scanner create duplicates?
- Is my machine missing runtime dependencies that will cause silent launch failures?

Romio catches these problems **before** they bite you.

## Download

Get the installer for your platform from the [Releases page](https://github.com/your-org/romio/releases).

| Platform | Installer |
|---|---|
| Windows | `Romio_x.x.x_x64-setup.exe` |
| macOS | `Romio_x.x.x_universal.dmg` |
| Linux | `Romio_x.x.x_amd64.AppImage` |

No dependencies to install. No terminal required. Just download and run.

## Quick Start

1. Launch Romio and create a new project
2. Point it at your ROM library root(s)
3. Select your target frontend (ES-DE, RetroBat, LaunchBox, etc.)
4. Run the scan — Romio will tell you exactly what's missing, wrong, or at risk
5. Follow the guided repair flows
6. Export when everything is green

→ [Full getting started guide](docs/getting-started/installation.md)

## Features

- **BIOS validation** — hash-first identification, frontend-aware path rules, 5-state output model
- **Format compatibility** — catches .daphne, standard Xbox ISO, .rvz cross-emulator issues and more
- **Save protection** — detects save roots at risk before emulator updates, creates checkpoints
- **Host environment checks** — catches missing VC++, Vulkan, .NET before your first launch attempt
- **Multi-disc toolkit** — M3U generation with explicit confirmation, no silent grouping
- **ScummVM support** — pointer file generation, engine:game ID disambiguation
- **Installed title validation** — shortcut content validity, title ID naming convention checks
- **ES-DE quirks encoded** — arcade BIOS path rules, .hypseus extension, all silent failures documented
- **Preview before write** — nothing touches your library without you seeing the change plan first

## Building from Source

```bash
# Prerequisites: Rust 1.75+, Node 20+, pnpm
git clone https://github.com/your-org/romio
cd romio
pnpm install
pnpm tauri dev
```

→ [Full developer setup guide](docs/getting-started/dev-setup.md)

## Contributing

Romio is community-maintained. The most impactful contributions don't require Rust knowledge —
the BIOS rules database and emulator matrix live in JSON files that anyone can update.

→ [Contributing guide](docs/contributing/overview.md)
→ [How to add/update BIOS rules](docs/contributing/bios-database.md)
→ [How to add a frontend adapter](docs/contributing/frontend-adapter.md)

## License

Romio is free software, released under the [GNU General Public License v3.0](LICENSE).

The BIOS rules database contains factual hash and placement data only.
Romio never distributes, embeds, or links to copyrighted BIOS files.
