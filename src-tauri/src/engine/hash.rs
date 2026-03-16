// SPDX-License-Identifier: GPL-3.0
//! Hash computation for BIOS and ROM file identification.
//! Uses MD5 as the primary identity mechanism (matching community BIOS databases).
//! Uses Blake3 for fast file identity fingerprinting during large library scans.

use anyhow::Result;
use std::io::Read;
use std::path::Path;

/// Compute the MD5 hash of a file. Used for BIOS validation.
/// Returns the hash as a lowercase hex string.
pub fn md5_file(path: &Path) -> Result<String> {
    let mut file = std::fs::File::open(path)?;
    let mut buffer = Vec::new();
    file.read_to_end(&mut buffer)?;
    let digest = md5::compute(&buffer);
    Ok(format!("{:x}", digest))
}

/// Compute a fast Blake3 hash of a file for identity fingerprinting.
/// Used during scan to quickly detect changed files without full MD5 cost.
pub fn blake3_file(path: &Path) -> Result<String> {
    let mut file = std::fs::File::open(path)?;
    let mut hasher = blake3::Hasher::new();
    let mut buffer = [0u8; 65536];
    loop {
        let n = file.read(&mut buffer)?;
        if n == 0 { break; }
        hasher.update(&buffer[..n]);
    }
    Ok(hasher.finalize().to_hex().to_string())
}

/// Compute MD5 for a byte slice (used for small BIOS files already in memory).
pub fn md5_bytes(data: &[u8]) -> String {
    let digest = md5::compute(data);
    format!("{:x}", digest)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::NamedTempFile;

    #[test]
    fn test_md5_known_value() {
        let mut file = NamedTempFile::new().unwrap();
        file.write_all(b"hello world").unwrap();
        let hash = md5_file(file.path()).unwrap();
        assert_eq!(hash, "5eb63bbbe01eeed093cb22bb8f5acdc3");
    }

    #[test]
    fn test_md5_bytes_matches_file() {
        let data = b"romio test data";
        let mut file = NamedTempFile::new().unwrap();
        file.write_all(data).unwrap();
        let file_hash = md5_file(file.path()).unwrap();
        let bytes_hash = md5_bytes(data);
        assert_eq!(file_hash, bytes_hash);
    }
}
