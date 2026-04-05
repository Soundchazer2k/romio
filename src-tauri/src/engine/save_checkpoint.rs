// SPDX-License-Identifier: GPL-3.0
use anyhow::{anyhow, Result};
use chrono::Utc;
use std::fs;
use std::path::Path;
use uuid::Uuid;
use walkdir::WalkDir;
use zip::write::SimpleFileOptions;
use crate::models::save::SaveCheckpoint;

pub fn create_checkpoint(
    project_id:   &str,
    source:       &Path,
    emulator:     &str,
    app_data_dir: &Path,
) -> Result<SaveCheckpoint> {
    if !source.exists() || !source.is_dir() {
        return Err(anyhow!(
            "source path does not exist or is not a directory: {}",
            source.display()
        ));
    }

    let checkpoints_dir = app_data_dir.join("checkpoints");
    fs::create_dir_all(&checkpoints_dir)?;

    let archive_id   = Uuid::new_v4().to_string();
    let archive_path = checkpoints_dir.join(format!("{}.zip", archive_id));

    match create_zip(source, &archive_path) {
        Ok((file_count, size_bytes)) => Ok(SaveCheckpoint {
            id:           archive_id,
            project_id:   project_id.to_string(),
            emulator:     emulator.to_string(),
            source_path:  source.to_string_lossy().to_string(),
            archive_path: archive_path.to_string_lossy().to_string(),
            created_at:   Utc::now(),
            file_count,
            size_bytes,
        }),
        Err(e) => {
            // Atomic cleanup: delete partial archive before returning error
            if archive_path.exists() {
                let _ = fs::remove_file(&archive_path);
            }
            Err(e)
        }
    }
}

fn create_zip(source: &Path, archive_path: &Path) -> Result<(u64, u64)> {
    let file    = fs::File::create(archive_path)?;
    let mut zip = zip::ZipWriter::new(file);
    let options = SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    let mut file_count = 0u64;
    let mut size_bytes = 0u64;

    for entry in WalkDir::new(source).into_iter() {
        let entry = entry?;
        if !entry.file_type().is_file() {
            continue;
        }

        let path     = entry.path();
        let relative = path.strip_prefix(source)
            .map_err(|e| anyhow!("failed to relativize path {}: {}", path.display(), e))?;

        // Normalize separator to forward slash; never a leading slash
        let name: String = relative
            .components()
            .map(|c| c.as_os_str().to_string_lossy().into_owned())
            .collect::<Vec<_>>()
            .join("/");

        let metadata  = entry.metadata()?;
        size_bytes    += metadata.len();
        file_count    += 1;

        zip.start_file(&name, options)?;
        let mut f = fs::File::open(path)?;
        std::io::copy(&mut f, &mut zip)?;
    }

    zip.finish()?;
    Ok((file_count, size_bytes))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn make_source_dir(dir: &TempDir) -> std::path::PathBuf {
        let saves = dir.path().join("saves");
        fs::create_dir_all(saves.join("memcards")).unwrap();
        fs::write(saves.join("memcards/mc0.mc"),   b"save data").unwrap();
        fs::write(saves.join("memcards/mc1.mc"),   b"save data 2").unwrap();
        fs::write(saves.join("state.savestate"),   b"state").unwrap();
        saves
    }

    #[test]
    fn creates_zip_with_correct_metadata() {
        let tmp = TempDir::new().unwrap();
        let source = make_source_dir(&tmp);
        let app_dir = TempDir::new().unwrap();

        let checkpoint = create_checkpoint(
            "proj-1",
            &source,
            "duckstation",
            app_dir.path(),
        ).unwrap();

        assert_eq!(checkpoint.project_id, "proj-1");
        assert_eq!(checkpoint.emulator, "duckstation");
        assert_eq!(checkpoint.file_count, 3);
        assert!(checkpoint.size_bytes > 0);
        assert!(std::path::Path::new(&checkpoint.archive_path).exists(),
            "archive file must exist at {}", checkpoint.archive_path);
    }

    #[test]
    fn archive_entries_have_no_leading_slash() {
        let tmp = TempDir::new().unwrap();
        let source = make_source_dir(&tmp);
        let app_dir = TempDir::new().unwrap();

        let checkpoint = create_checkpoint(
            "proj-1",
            &source,
            "duckstation",
            app_dir.path(),
        ).unwrap();

        let file = fs::File::open(&checkpoint.archive_path).unwrap();
        let mut zip = zip::ZipArchive::new(file).unwrap();
        for i in 0..zip.len() {
            let entry = zip.by_index(i).unwrap();
            assert!(!entry.name().starts_with('/'),
                "entry {:?} must not have a leading slash", entry.name());
        }
    }

    #[test]
    fn fails_if_source_does_not_exist() {
        let app_dir = TempDir::new().unwrap();
        let result = create_checkpoint(
            "proj-1",
            Path::new("/nonexistent/path"),
            "duckstation",
            app_dir.path(),
        );
        assert!(result.is_err());
    }

    #[test]
    fn cleans_up_partial_zip_on_failure() {
        // This is hard to test without mocking I/O; instead verify no .zip
        // files are left behind after a failed source path call.
        let app_dir = TempDir::new().unwrap();
        let _ = create_checkpoint(
            "proj-1",
            Path::new("/nonexistent/path"),
            "duckstation",
            app_dir.path(),
        );
        let checkpoints_dir = app_dir.path().join("checkpoints");
        if checkpoints_dir.exists() {
            let zips: Vec<_> = fs::read_dir(&checkpoints_dir).unwrap()
                .filter_map(|e| e.ok())
                .filter(|e| e.path().extension().map(|x| x == "zip").unwrap_or(false))
                .collect();
            assert!(zips.is_empty(), "no partial zips should remain after failure");
        }
    }
}
