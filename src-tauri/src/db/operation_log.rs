// SPDX-License-Identifier: GPL-3.0
use anyhow::{anyhow, Result};
use chrono::DateTime;
use rusqlite::params;
use uuid::Uuid;
use crate::models::validation::OperationLogEntry;

pub fn insert(entry: &OperationLogEntry) -> Result<()> {
    if entry.project_id.is_empty() {
        return Err(anyhow!("project_id is required"));
    }
    crate::db::with_conn(|conn| {
        conn.execute(
            "INSERT INTO operation_log
             (id, project_id, operation, description, affected_paths, reversible, rolled_back, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                entry.id.to_string(),
                entry.project_id,
                entry.operation,
                entry.description,
                serde_json::to_string(&entry.affected_paths)?,
                entry.reversible as i32,
                entry.rolled_back as i32,
                entry.created_at.to_rfc3339(),
            ],
        )?;
        Ok(())
    })
}

pub fn insert_tx(tx: &rusqlite::Transaction, entry: &OperationLogEntry) -> Result<()> {
    if entry.project_id.is_empty() {
        return Err(anyhow!("project_id is required"));
    }
    tx.execute(
        "INSERT INTO operation_log
         (id, project_id, operation, description, affected_paths, reversible, rolled_back, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            entry.id.to_string(),
            entry.project_id,
            entry.operation,
            entry.description,
            serde_json::to_string(&entry.affected_paths)?,
            entry.reversible as i32,
            entry.rolled_back as i32,
            entry.created_at.to_rfc3339(),
        ],
    )?;
    Ok(())
}

pub fn list(project_id: &str) -> Result<Vec<OperationLogEntry>> {
    crate::db::with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT id, project_id, operation, description, affected_paths,
                    reversible, rolled_back, created_at
             FROM operation_log
             WHERE project_id = ?1
             ORDER BY created_at DESC",
        )?;
        let mut rows = stmt.query(params![project_id])?;
        let mut out = Vec::new();
        while let Some(row) = rows.next()? {
            let id_str: String          = row.get(0)?;
            let id = match Uuid::parse_str(&id_str) {
                Ok(u)  => u,
                Err(e) => {
                    eprintln!("[db::operation_log] skipping row with malformed id {:?}: {}", id_str, e);
                    continue;
                }
            };
            let pid: Option<String>     = row.get(1)?;
            let Some(project_id) = pid else {
                eprintln!("[db::operation_log] skipping row with NULL project_id, id={:?}", id_str);
                continue;
            };
            let paths_json: String      = row.get(4)?;
            let affected_paths: Vec<String> = serde_json::from_str(&paths_json).unwrap_or_default();
            let created_at_str: String  = row.get(7)?;
            let created_at = match DateTime::parse_from_rfc3339(&created_at_str) {
                Ok(dt) => dt.with_timezone(&chrono::Utc),
                Err(e) => {
                    eprintln!("[db::operation_log] skipping row with malformed created_at {:?}: {}", created_at_str, e);
                    continue;
                }
            };
            out.push(OperationLogEntry {
                id,
                project_id,
                operation:      row.get(2)?,
                description:    row.get(3)?,
                affected_paths,
                reversible:     row.get::<_, i32>(5)? != 0,
                rolled_back:    row.get::<_, i32>(6)? != 0,
                created_at,
            });
        }
        Ok(out)
    })
}

pub fn mark_rolled_back(id: &str) -> Result<()> {
    crate::db::with_conn(|conn| {
        let rows = conn.execute(
            "UPDATE operation_log SET rolled_back = 1 WHERE id = ?1",
            params![id],
        )?;
        if rows == 0 {
            return Err(anyhow!("operation log entry not found: {}", id));
        }
        Ok(())
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;
    use serial_test::serial;
    use tempfile::TempDir;

    fn init_test_db() -> TempDir {
        let dir = TempDir::new().unwrap();
        crate::db::init(dir.path()).unwrap();
        dir
    }

    fn make_project() -> String {
        let req = crate::models::project::CreateProjectRequest {
            name:             "test-project".to_string(),
            library_roots:    vec![],
            target_frontends: vec![],
        };
        crate::db::projects::create(req).unwrap().id.to_string()
    }

    fn make_entry(project_id: &str) -> OperationLogEntry {
        OperationLogEntry {
            id:             Uuid::new_v4(),
            project_id:     project_id.to_string(),
            operation:      "create_checkpoint".to_string(),
            description:    "Test checkpoint".to_string(),
            affected_paths: vec!["/saves/test".to_string(), "/checkpoints/test.zip".to_string()],
            reversible:     false,
            rolled_back:    false,
            created_at:     Utc::now(),
        }
    }

    #[test]
    #[serial]
    fn operation_log_round_trip() {
        let _dir = init_test_db();
        let project_id = make_project();
        let entry = make_entry(&project_id);
        let id_str = entry.id.to_string();
        insert(&entry).unwrap();
        let results = list(&project_id).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id.to_string(), id_str);
        assert_eq!(results[0].project_id, project_id);
        assert_eq!(results[0].operation, "create_checkpoint");
        assert_eq!(results[0].affected_paths.len(), 2);
        assert!(!results[0].rolled_back);
    }

    #[test]
    #[serial]
    fn mark_rolled_back_flips_flag() {
        let _dir = init_test_db();
        let project_id = make_project();
        let entry = make_entry(&project_id);
        let id_str = entry.id.to_string();
        insert(&entry).unwrap();
        mark_rolled_back(&id_str).unwrap();
        let results = list(&project_id).unwrap();
        assert!(results[0].rolled_back);
    }

    #[test]
    #[serial]
    fn list_filters_by_project_id() {
        let _dir = init_test_db();
        let proj_a = make_project();
        let proj_b = make_project();
        insert(&make_entry(&proj_a)).unwrap();
        insert(&make_entry(&proj_b)).unwrap();
        let a = list(&proj_a).unwrap();
        let b = list(&proj_b).unwrap();
        assert_eq!(a.len(), 1);
        assert_eq!(b.len(), 1);
    }

    #[test]
    #[serial]
    fn insert_rejects_empty_project_id() {
        let _dir = init_test_db();
        let mut e = make_entry("x");
        e.project_id = "".to_string();
        assert!(insert(&e).is_err());
    }
}
