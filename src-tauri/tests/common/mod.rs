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
/// fixture hash of its own file name.
pub fn fixture_bios_rules() -> Vec<BiosRule> {
    db::bios::load_all_rules()
        .expect("shipped bios_rules.json parses")
        .into_iter()
        .map(|mut r| {
            r.known_good_md5 = vec![fake_md5(&r.filename)];
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
