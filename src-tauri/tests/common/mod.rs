// SPDX-License-Identifier: GPL-3.0
//! Fake retro library for scenario tests.
//!
//! Everything here is built in a temp folder at test time and deleted afterwards.
//! Cargo compiles `tests/` only for `cargo test`, so none of it reaches the app
//! binary or the installer (the bundle ships `data/*` only).
//!
//! No real ROMs or BIOS: every "dump" is a few bytes of known text. BIOS rules are
//! the shipped ones with their hashes swapped for the fixture hashes, so paths,
//! file names and requirements stay real while the content stays legal.

#![allow(dead_code)] // each test binary uses a different subset

use std::fs;
use std::path::{Path, PathBuf};

use romio_lib::db;
use romio_lib::engine::hash::md5_bytes;
use romio_lib::models::bios::{BadDumpEntry, BiosRule};

pub struct Library {
    dir: tempfile::TempDir,
}

impl Library {
    pub fn new() -> Self {
        Self { dir: tempfile::tempdir().expect("temp dir") }
    }

    pub fn root(&self) -> &Path {
        self.dir.path()
    }

    pub fn path(&self, rel: &str) -> PathBuf {
        rel.split('/').filter(|c| !c.is_empty()).fold(self.root().to_path_buf(), |p, c| p.join(c))
    }

    /// Write a file (creating parents) and return its path.
    pub fn file(&self, rel: &str, contents: &[u8]) -> PathBuf {
        let path = self.path(rel);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, contents).unwrap();
        path
    }

    /// Write a placeholder game file; its bytes only need to be non-empty.
    pub fn game(&self, rel: &str) -> PathBuf {
        self.file(rel, b"romio fixture game")
    }

    /// Write `count` small save files under `rel`.
    pub fn saves(&self, rel: &str, count: usize) -> PathBuf {
        for i in 0..count {
            self.file(&format!("{rel}/slot{i}.sav"), b"romio fixture save");
        }
        self.path(rel)
    }

    /// Write a fake BIOS dump whose bytes hash to `fake_md5(name)`.
    pub fn bios(&self, rel: &str, name: &str) -> PathBuf {
        self.file(rel, fake_bios_bytes(name).as_bytes())
    }
}

pub fn fake_bios_bytes(name: &str) -> String {
    format!("romio fixture bios: {name}")
}

/// The hash a fake dump of `name` will have.
pub fn fake_md5(name: &str) -> String {
    md5_bytes(fake_bios_bytes(name).as_bytes())
}

/// The shipped BIOS rules, with each rule's known-good hash replaced by the
/// fixture hash of its own file name. Rules that ship with no known-good hash
/// keep an empty list: Romio can't validate those, so neither can a fixture.
pub fn fixture_bios_rules() -> Vec<BiosRule> {
    db::bios::load_all_rules()
        .expect("shipped bios_rules.json parses")
        .into_iter()
        .map(|mut r| {
            if !r.known_good_md5.is_empty() {
                r.known_good_md5 = vec![fake_md5(&r.filename)];
            }
            r
        })
        .collect()
}

/// Mark the fake dump `bad_name` as a known bad dump of `filename`.
pub fn with_bad_dump(mut rules: Vec<BiosRule>, filename: &str, bad_name: &str, label: &str) -> Vec<BiosRule> {
    let rule = rules.iter_mut().find(|r| r.filename == filename).expect("rule exists");
    rule.known_bad_md5.push(BadDumpEntry { md5: fake_md5(bad_name), label: label.into() });
    rules
}

/// Takes away the current user's right to list `path` until dropped, then gives it back.
pub struct ReadDenied(PathBuf);

/// Make `path` unlistable for the current user. Returns `None` when the OS ignores
/// it (for example tests running as root), so callers can skip instead of failing.
pub fn deny_read(path: &Path) -> Option<ReadDenied> {
    #[cfg(windows)]
    {
        let user = current_windows_user();
        icacls(path, &["/deny", &format!("{user}:(RD)")]);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o000)).unwrap();
    }
    let guard = ReadDenied(path.to_path_buf());
    fs::read_dir(path).is_err().then_some(guard)
}

impl Drop for ReadDenied {
    fn drop(&mut self) {
        // Restore access so the temp dir can be deleted
        #[cfg(windows)]
        icacls(&self.0, &["/remove:d", &current_windows_user()]);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = fs::set_permissions(&self.0, fs::Permissions::from_mode(0o755));
        }
    }
}

#[cfg(windows)]
fn current_windows_user() -> String {
    let out = std::process::Command::new("whoami").output().expect("whoami runs");
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

#[cfg(windows)]
fn icacls(path: &Path, args: &[&str]) {
    let status = std::process::Command::new("icacls").arg(path).args(args)
        .stdout(std::process::Stdio::null())
        .status().expect("icacls runs");
    assert!(status.success(), "icacls {args:?} failed on {}", path.display());
}
