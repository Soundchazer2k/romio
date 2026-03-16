# Contributing to the BIOS Database

The BIOS rules database lives in `src-tauri/data/bios_rules.json`.
Updating it **does not require Rust or TypeScript knowledge** — it is a JSON file with a documented schema.

## Schema

Each entry in the array follows this structure:

```json
{
  "filename":         "scph5501.bin",
  "knownGoodMd5":     ["490f666e1afb15b7362b406ed1cea246"],
  "knownBadMd5":      [{ "md5": "...", "label": "Description of bad dump" }],
  "system":           "ps1",
  "region":           "US",
  "requirement":      "required",
  "compressed":       false,
  "defaultPath":      "",
  "frontendPaths":    { "esde": "roms/arcade/" },
  "emulatorPaths":    { "lr-kronos": "kronos/" },
  "notes":            "Human-readable notes shown in the UI",
  "dumpingGuideUrl":  "https://..."
}
```

## Fields

| Field | Type | Description |
|---|---|---|
| `filename` | string | Exact expected filename. Case-sensitive on Linux/macOS. |
| `knownGoodMd5` | string[] | Known-good MD5 hashes. Multiple allowed (valid revisions). |
| `knownBadMd5` | array | Known bad-dump MD5s with labels. Shown to user as specific errors. |
| `system` | string | System ID matching ES-DE folder names (e.g. "ps1", "saturn"). |
| `region` | string \| null | Region label: "US", "JP", "EU", or null. |
| `requirement` | enum | `"required"` \| `"optional"` \| `"keys_crypto"` \| `"not_required"` |
| `compressed` | boolean | `true` if the file must be a zip (FBNeo, MAME). `false` if it must be extracted. |
| `defaultPath` | string | Default placement relative to the bios root. Empty = flat bios/. |
| `frontendPaths` | object | Per-frontend path overrides. Key = frontend ID. |
| `emulatorPaths` | object | Per-emulator path overrides. Key = emulator ID. |
| `notes` | string \| null | Notes shown in the UI alongside the validation result. |
| `dumpingGuideUrl` | string \| null | Link to official dumping guidance for MISSING_REQUIRED cases. |

## How to submit a change

1. Fork the repo
2. Edit `src-tauri/data/bios_rules.json`
3. Use the [BIOS database issue template](.github/ISSUE_TEMPLATE/bios_database.md) to describe what changed and why
4. Open a PR — no code review needed for data-only changes if the schema is valid

## Validating your JSON

```bash
node -e "JSON.parse(require('fs').readFileSync('src-tauri/data/bios_rules.json','utf8')); console.log('Valid')"
```
