// SPDX-License-Identifier: GPL-3.0
use anyhow::{anyhow, Result};
use chrono::DateTime;
use rusqlite::params;
use crate::models::save::SaveCheckpoint;

pub fn insert(checkpoint: &SaveCheckpoint) -> Result<()> {
    if checkpoint.project_id.is_empty() {
        return Err(anyhow!("project_id is required"));
    }
    crate::db::with_conn(|conn| {
        conn.execute(
            "INSERT INTO save_checkpoints
             (id, project_id, emulator, source_path, archive_path, file_count, size_bytes, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                checkpoint.id,
                checkpoint.project_id,
                checkpoint.emulator,
                checkpoint.source_path,
                checkpoint.archive_path,
                checkpoint.file_count as i64,
                checkpoint.size_bytes as i64,
                checkpoint.created_at.to_rfc3339(),
            ],
        )?;
        Ok(())
    })
}

pub fn insert_tx(tx: &rusqlite::Transaction, checkpoint: &SaveCheckpoint) -> Result<()> {
    if checkpoint.project_id.is_empty() {
        return Err(anyhow!("project_id is required"));
    }
    tx.execute(
        "INSERT INTO save_checkpoints
         (id, project_id, emulator, source_path, archive_path, file_count, size_bytes, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            checkpoint.id,
            checkpoint.project_id,
            checkpoint.emulator,
            checkpoint.source_path,
            checkpoint.archive_path,
            checkpoint.file_count as i64,
            checkpoint.size_bytes as i64,
            checkpoint.created_at.to_rfc3339(),
        ],
    )?;
    Ok(())
}

pub fn list(project_id: &str) -> Result<Vec<SaveCheckpoint>> {
    crate::db::with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT id, project_id, emulator, source_path, archive_path,
                    file_count, size_bytes, created_at
             FROM save_checkpoints
             WHERE project_id = ?1
             ORDER BY created_at DESC",
        )?;
        let mut rows = stmt.query(params![project_id])?;
        let mut out = Vec::new();
        while let Some(row) = rows.next()? {
            let id: String              = row.get(0)?;
            let pid: Option<String>     = row.get(1)?;
            let Some(project_id) = pid else {
                eprintln!("[db::checkpoints] skipping row with NULL project_id, id={:?}", id);
                continue;
            };
            let created_at_str: String  = row.get(7)?;
            let created_at = match DateTime::parse_from_rfc3339(&created_at_str) {
                Ok(dt) => dt.with_timezone(&chrono::Utc),
                Err(e) => {
                    eprintln!("[db::checkpoints] skipping row with malformed created_at {:?}: {}", created_at_str, e);
                    continue;
                }
            };
            out.push(SaveCheckpoint {
                id,
                project_id,
                emulator:     row.get(2)?,
                source_path:  row.get(3)?,
                archive_path: row.get(4)?,
                file_count:   row.get::<_, i64>(5)? as u64,
                size_bytes:   row.get::<_, i64>(6)? as u64,
                created_at,
            });
        }
        Ok(out)
    })
}

pub fn get(id: &str) -> Result<SaveCheckpoint> {
    crate::db::with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT id, project_id, emulator, source_path, archive_path,
                    file_count, size_bytes, created_at
             FROM save_checkpoints WHERE id = ?1",
        )?;
        let row = stmt.query_row(params![id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, i64>(5)?,
                row.get::<_, i64>(6)?,
                row.get::<_, String>(7)?,
            ))
        })?;
        let (id, pid, emulator, source_path, archive_path, file_count, size_bytes, created_at_str) = row;
        let project_id = pid.ok_or_else(|| anyhow!("checkpoint {} has NULL project_id", id))?;
        let created_at = DateTime::parse_from_rfc3339(&created_at_str)
            .map(|dt| dt.with_timezone(&chrono::Utc))
            .map_err(|e| anyhow!("malformed created_at {:?}: {}", created_at_str, e))?;
        Ok(SaveCheckpoint {
            id,
            project_id,
            emulator,
            source_path,
            archive_path,
            file_count: file_count as u64,
            size_bytes: size_bytes as u64,
            created_at,
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;
    use tempfile::TempDir;

    fn init_test_db() -> TempDir {
        let dir = TempDir::new().unwrap();
        crate::db::init(dir.path()).unwrap();
        dir
    }

    fn make_checkpoint(project_id: &str) -> SaveCheckpoint {
        SaveCheckpoint {
            id:           uuid::Uuid::new_v4().to_string(),
            project_id:   project_id.to_string(),
            emulator:     "duckstation".to_string(),
            source_path:  "/saves/duckstation".to_string(),
            archive_path: "/checkpoints/test.zip".to_string(),
            created_at:   Utc::now(),
            file_count:   3,
            size_bytes:   12288,
        }
    }

    #[test]
    fn checkpoint_round_trip() {
        let _dir = init_test_db();
        let cp = make_checkpoint("proj-1");
        insert(&cp).unwrap();
        let results = list("proj-1").unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id, cp.id);
        assert_eq!(results[0].project_id, "proj-1");
        assert_eq!(results[0].file_count, 3);
        assert_eq!(results[0].size_bytes, 12288);
    }

    #[test]
    fn list_filters_by_project_id() {
        let _dir = init_test_db();
        insert(&make_checkpoint("proj-a")).unwrap();
        insert(&make_checkpoint("proj-b")).unwrap();
        let a = list("proj-a").unwrap();
        let b = list("proj-b").unwrap();
        assert_eq!(a.len(), 1);
        assert_eq!(b.len(), 1);
        assert_eq!(a[0].project_id, "proj-a");
        assert_eq!(b[0].project_id, "proj-b");
    }

    #[test]
    fn insert_rejects_empty_project_id() {
        let _dir = init_test_db();
        let mut cp = make_checkpoint("x");
        cp.project_id = "".to_string();
        assert!(insert(&cp).is_err());
    }
}
