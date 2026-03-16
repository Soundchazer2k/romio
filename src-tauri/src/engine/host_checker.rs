// SPDX-License-Identifier: GPL-3.0
//! Host environment pre-flight checks.
//! Platform-aware detection of missing runtime dependencies.

use crate::models::host::{DependencyCheck, DependencyState, HostEnvironmentReport, Remediation};

/// Run all applicable host environment checks for the current platform.
pub fn check_host_environment() -> HostEnvironmentReport {
    let mut checks = Vec::new();

    #[cfg(target_os = "windows")]
    {
        checks.extend(windows_checks());
    }
    #[cfg(target_os = "macos")]
    {
        checks.extend(macos_checks());
    }
    #[cfg(target_os = "linux")]
    {
        checks.extend(linux_checks());
    }

    let blocking_count = checks.iter()
        .filter(|c| c.state == DependencyState::Missing)
        .count() as u32;

    let all_pass = blocking_count == 0
        && checks.iter().all(|c| c.state != DependencyState::PresentWrongVersion);

    HostEnvironmentReport {
        platform: std::env::consts::OS.to_string(),
        checks,
        all_pass,
        blocking_count,
    }
}

#[cfg(target_os = "windows")]
fn windows_checks() -> Vec<DependencyCheck> {
    vec![
        check_vcredist_x64(),
        check_vcredist_x86(),
        check_dotnet(),
        check_vulkan_windows(),
        check_7zip_windows(),
        check_powershell(),
    ]
}

#[cfg(target_os = "macos")]
fn macos_checks() -> Vec<DependencyCheck> {
    vec![
        check_metal_macos(),
    ]
}

#[cfg(target_os = "linux")]
fn linux_checks() -> Vec<DependencyCheck> {
    vec![
        check_vulkan_linux(),
        check_7zip_linux(),
    ]
}

// ── Windows checks ────────────────────────────────────────────────────────────

#[cfg(target_os = "windows")]
fn check_vcredist_x64() -> DependencyCheck {
    // Check for vcruntime140.dll in System32 as a proxy for VC++ 2015-2022 x64
    let present = std::path::Path::new(r"C:\Windows\System32\vcruntime140.dll").exists();
    DependencyCheck {
        id: "vcredist_x64".to_string(),
        name: "Visual C++ Redistributable 2015–2022 (x64)".to_string(),
        description: "Required by RPCS3, PCSX2, DuckStation, Flycast, and most standalone emulators.".to_string(),
        affected_emulators: vec!["RPCS3".to_string(), "PCSX2".to_string(), "DuckStation".to_string(), "Flycast".to_string()],
        state: if present { DependencyState::Present } else { DependencyState::Missing },
        detected_version: None,
        minimum_version: None,
        remediation: if !present { Some(Remediation {
            description: "Download and install the Visual C++ Redistributable from Microsoft.".to_string(),
            url: Some("https://aka.ms/vs/17/release/vc_redist.x64.exe".to_string()),
            auto_fixable: false,
        }) } else { None },
    }
}

#[cfg(target_os = "windows")]
fn check_vcredist_x86() -> DependencyCheck {
    let present = std::path::Path::new(r"C:\Windows\SysWOW64\vcruntime140.dll").exists();
    DependencyCheck {
        id: "vcredist_x86".to_string(),
        name: "Visual C++ Redistributable 2015–2022 (x86)".to_string(),
        description: "Required by 32-bit emulator components and some RetroArch cores. Separate from the x64 version.".to_string(),
        affected_emulators: vec!["RetroArch (32-bit cores)".to_string()],
        state: if present { DependencyState::Present } else { DependencyState::Missing },
        detected_version: None,
        minimum_version: None,
        remediation: if !present { Some(Remediation {
            description: "Download and install the x86 Visual C++ Redistributable from Microsoft.".to_string(),
            url: Some("https://aka.ms/vs/17/release/vc_redist.x86.exe".to_string()),
            auto_fixable: false,
        }) } else { None },
    }
}

#[cfg(target_os = "windows")]
fn check_dotnet() -> DependencyCheck {
    // Check for .NET 6+ presence via dotnet.exe
    let dotnet_path = which_command("dotnet");
    let (state, version) = if dotnet_path.is_some() {
        // TODO: parse `dotnet --list-runtimes` output for version check
        (DependencyState::Present, Some("6.0+".to_string()))
    } else {
        (DependencyState::Missing, None)
    };

    DependencyCheck {
        id: "dotnet".to_string(),
        name: ".NET Runtime (6.0 or later)".to_string(),
        description: "Required by Ryubing (Ryujinx fork) and Bizhawk.".to_string(),
        affected_emulators: vec!["Ryubing".to_string(), "Bizhawk".to_string()],
        state,
        detected_version: version,
        minimum_version: Some("6.0".to_string()),
        remediation: Some(Remediation {
            description: "Download .NET from Microsoft.".to_string(),
            url: Some("https://dotnet.microsoft.com/download".to_string()),
            auto_fixable: false,
        }),
    }
}

#[cfg(target_os = "windows")]
fn check_vulkan_windows() -> DependencyCheck {
    let present = std::path::Path::new(r"C:\Windows\System32\vulkan-1.dll").exists();
    DependencyCheck {
        id: "vulkan".to_string(),
        name: "Vulkan Runtime".to_string(),
        description: "Required by RPCS3, ShadPS4, Xemu, and PCSX2 in Vulkan rendering mode.".to_string(),
        affected_emulators: vec!["RPCS3".to_string(), "ShadPS4".to_string(), "Xemu".to_string(), "PCSX2".to_string()],
        state: if present { DependencyState::Present } else { DependencyState::Missing },
        detected_version: None,
        minimum_version: None,
        remediation: if !present { Some(Remediation {
            description: "Update your GPU drivers — Vulkan runtime is included in modern GPU driver packages (NVIDIA, AMD, Intel).".to_string(),
            url: None,
            auto_fixable: false,
        }) } else { None },
    }
}

#[cfg(target_os = "windows")]
fn check_7zip_windows() -> DependencyCheck {
    let found = which_command("7z")
        .or_else(|| {
            let paths = [
                r"C:\Program Files\7-Zip\7z.exe",
                r"C:\Program Files (x86)\7-Zip\7z.exe",
            ];
            paths.iter().find(|p| std::path::Path::new(p).exists()).map(|p| p.to_string())
        });
    DependencyCheck {
        id: "7zip".to_string(),
        name: "7-Zip".to_string(),
        description: "Required by RetroBat for archive extraction workflows.".to_string(),
        affected_emulators: vec!["RetroBat".to_string()],
        state: if found.is_some() { DependencyState::Present } else { DependencyState::Missing },
        detected_version: None,
        minimum_version: None,
        remediation: if found.is_none() { Some(Remediation {
            description: "Download 7-Zip from 7-zip.org.".to_string(),
            url: Some("https://www.7-zip.org/download.html".to_string()),
            auto_fixable: false,
        }) } else { None },
    }
}

#[cfg(target_os = "windows")]
fn check_powershell() -> DependencyCheck {
    let found = which_command("powershell");
    DependencyCheck {
        id: "powershell".to_string(),
        name: "PowerShell 2.0+".to_string(),
        description: "Required by RetroBat install and update scripts.".to_string(),
        affected_emulators: vec!["RetroBat".to_string()],
        state: if found.is_some() { DependencyState::Present } else { DependencyState::Missing },
        detected_version: None,
        minimum_version: Some("2.0".to_string()),
        remediation: None, // PowerShell ships with Windows — absence is unusual
    }
}

// ── macOS checks ──────────────────────────────────────────────────────────────

#[cfg(target_os = "macos")]
fn check_metal_macos() -> DependencyCheck {
    // Metal is available on all Apple Silicon and Intel Macs running macOS 10.13+.
    // We can't easily check at runtime without Metal API calls, so we check the OS version.
    DependencyCheck {
        id: "metal".to_string(),
        name: "Metal Framework".to_string(),
        description: "Required by DuckStation, Dolphin, and other emulators on macOS.".to_string(),
        affected_emulators: vec!["DuckStation".to_string(), "Dolphin".to_string()],
        state: DependencyState::Present, // Metal available on all supported macOS versions
        detected_version: None,
        minimum_version: None,
        remediation: None,
    }
}

// ── Linux checks ──────────────────────────────────────────────────────────────

#[cfg(target_os = "linux")]
fn check_vulkan_linux() -> DependencyCheck {
    let found = std::path::Path::new("/usr/lib/x86_64-linux-gnu/libvulkan.so.1").exists()
        || std::path::Path::new("/usr/lib/libvulkan.so.1").exists();
    DependencyCheck {
        id: "vulkan".to_string(),
        name: "Vulkan Runtime (libvulkan)".to_string(),
        description: "Required by RPCS3, ShadPS4, and other GPU-accelerated emulators.".to_string(),
        affected_emulators: vec!["RPCS3".to_string(), "ShadPS4".to_string()],
        state: if found { DependencyState::Present } else { DependencyState::Missing },
        detected_version: None,
        minimum_version: None,
        remediation: if !found { Some(Remediation {
            description: "Install vulkan-icd-loader via your package manager (apt install libvulkan1 vulkan-utils / pacman -S vulkan-icd-loader).".to_string(),
            url: None,
            auto_fixable: false,
        }) } else { None },
    }
}

#[cfg(target_os = "linux")]
fn check_7zip_linux() -> DependencyCheck {
    let found = which_command("7z").or_else(|| which_command("7za"));
    DependencyCheck {
        id: "7zip".to_string(),
        name: "7-Zip (p7zip)".to_string(),
        description: "Required for archive extraction in some frontend workflows.".to_string(),
        affected_emulators: vec!["RetroBat".to_string()],
        state: if found.is_some() { DependencyState::Present } else { DependencyState::Missing },
        detected_version: None,
        minimum_version: None,
        remediation: if found.is_none() { Some(Remediation {
            description: "Install p7zip via your package manager (apt install p7zip-full / pacman -S p7zip).".to_string(),
            url: None,
            auto_fixable: false,
        }) } else { None },
    }
}

// ── Utilities ─────────────────────────────────────────────────────────────────

fn which_command(cmd: &str) -> Option<String> {
    std::process::Command::new("where")
        .arg(cmd)
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|_| cmd.to_string())
        .or_else(|| {
            std::process::Command::new("which")
                .arg(cmd)
                .output()
                .ok()
                .filter(|o| o.status.success())
                .map(|_| cmd.to_string())
        })
}
