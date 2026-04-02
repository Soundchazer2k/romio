// SPDX-License-Identifier: GPL-3.0
use anyhow::Result;
use uuid::Uuid;
use chrono::Utc;
use crate::models::project::{Project, CreateProjectRequest, ScanStats};

pub fn create(req: CreateProjectRequest) -> Result<Project> {
    let project = Project {
        id:               Uuid::new_v4(),
        name:             req.name,
        library_roots:    req.library_roots,
        target_frontends: req.target_frontends,
        emulator_prefs:   std::collections::HashMap::new(),
        created_at:       Utc::now(),
        last_scanned_at:  None,
        scan_stats:       None,
        bios_root:              None,
        bios_results:           None,
        bios_last_validated_at: None,
    };
    crate::db::with_conn(|conn| {
        conn.execute(
            "INSERT INTO projects
             (id, name, library_roots, target_frontends, emulator_prefs, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![
                project.id.to_string(),
                project.name,
                serde_json::to_string(&project.library_roots)?,
                serde_json::to_string(&project.target_frontends)?,
                serde_json::to_string(&project.emulator_prefs)?,
                project.created_at.to_rfc3339(),
            ],
        )?;
        Ok(())
    })?;
    Ok(project)
}

/// Called after a successful scan. Persists `last_scanned_at` and `scan_stats`.
pub fn update_scan_completion(id: &str, stats: ScanStats) -> Result<()> {
    let stats_json = serde_json::to_string(&stats)?;
    let now = Utc::now().to_rfc3339();
    crate::db::with_conn(|conn| {
        conn.execute(
            "UPDATE projects SET last_scanned_at = ?1, scan_stats = ?2 WHERE id = ?3",
            rusqlite::params![now, stats_json, id],
        )?;
        Ok(())
    })
}

pub fn get(id: &str) -> Result<Project> {
    crate::db::with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT id, name, library_roots, target_frontends, emulator_prefs,
                    created_at, last_scanned_at, scan_stats,
                    bios_root, bios_results, bios_last_validated_at
             FROM projects WHERE id = ?1"
        )?;
        let row = stmt.query_row(rusqlite::params![id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, Option<String>>(6)?,
                row.get::<_, Option<String>>(7)?,
                row.get::<_, Option<String>>(8)?,   // bios_root
                row.get::<_, Option<String>>(9)?,   // bios_results
                row.get::<_, Option<String>>(10)?,  // bios_last_validated_at
            ))
        })?;
        Ok(Project {
            id:               Uuid::parse_str(&row.0).unwrap_or_default(),
            name:             row.1,
            library_roots:    serde_json::from_str(&row.2).unwrap_or_default(),
            target_frontends: serde_json::from_str(&row.3).unwrap_or_default(),
            emulator_prefs:   serde_json::from_str(&row.4).unwrap_or_default(),
            created_at:       chrono::DateTime::parse_from_rfc3339(&row.5)
                                .map(|d| d.with_timezone(&Utc))
                                .unwrap_or_else(|_| Utc::now()),
            last_scanned_at:  row.6.and_then(|s|
                                chrono::DateTime::parse_from_rfc3339(&s)
                                    .map(|d| d.with_timezone(&Utc)).ok()),
            scan_stats:       row.7.and_then(|s|
                                serde_json::from_str::<ScanStats>(&s).ok()),
            bios_root:              row.8,
            bios_results:           row.9.and_then(|s| serde_json::from_str(&s).ok()),
            bios_last_validated_at: row.10.and_then(|s|
                                        chrono::DateTime::parse_from_rfc3339(&s)
                                            .map(|d| d.with_timezone(&Utc)).ok()),
        })
    })
}

pub fn list() -> Result<Vec<Project>> {
    crate::db::with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT id, name, library_roots, target_frontends, emulator_prefs,
                    created_at, last_scanned_at, scan_stats,
                    bios_root, bios_results, bios_last_validated_at
             FROM projects ORDER BY created_at DESC"
        )?;
        let projects: Vec<Project> = stmt.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, Option<String>>(6)?,
                row.get::<_, Option<String>>(7)?,
                row.get::<_, Option<String>>(8)?,   // bios_root
                row.get::<_, Option<String>>(9)?,   // bios_results
                row.get::<_, Option<String>>(10)?,  // bios_last_validated_at
            ))
        })?
        .filter_map(|r| r.ok())
        .map(|p| Project {
            id:               Uuid::parse_str(&p.0).unwrap_or_default(),
            name:             p.1,
            library_roots:    serde_json::from_str(&p.2).unwrap_or_default(),
            target_frontends: serde_json::from_str(&p.3).unwrap_or_default(),
            emulator_prefs:   serde_json::from_str(&p.4).unwrap_or_default(),
            created_at:       chrono::DateTime::parse_from_rfc3339(&p.5)
                                .map(|d| d.with_timezone(&Utc))
                                .unwrap_or_else(|_| Utc::now()),
            last_scanned_at:  p.6.and_then(|s|
                                chrono::DateTime::parse_from_rfc3339(&s)
                                    .map(|d| d.with_timezone(&Utc)).ok()),
            scan_stats:       p.7.and_then(|s|
                                serde_json::from_str::<ScanStats>(&s).ok()),
            bios_root:              p.8,
            bios_results:           p.9.and_then(|s| serde_json::from_str(&s).ok()),
            bios_last_validated_at: p.10.and_then(|s|
                                        chrono::DateTime::parse_from_rfc3339(&s)
                                            .map(|d| d.with_timezone(&Utc)).ok()),
        })
        .collect();
        Ok(projects)
    })
}

pub fn update_bios_results(
    id:      &str,
    results: Vec<crate::models::bios::BiosSystemResult>,
) -> Result<()> {
    let results_json = serde_json::to_string(&results)?;
    let now = Utc::now().to_rfc3339();
    crate::db::with_conn(|conn| {
        conn.execute(
            "UPDATE projects
             SET bios_results = ?1, bios_last_validated_at = ?2
             WHERE id = ?3",
            rusqlite::params![results_json, now, id],
        )?;
        Ok(())
    })
}

pub fn update_bios_root(id: &str, bios_root: Option<&str>) -> Result<()> {
    // Normalize empty string to NULL
    let normalized = bios_root.and_then(|s| {
        let t = s.trim();
        if t.is_empty() { None } else { Some(t) }
    });
    crate::db::with_conn(|conn| {
        conn.execute(
            // Atomically update path AND clear stale results
            "UPDATE projects
             SET bios_root = ?1, bios_results = NULL, bios_last_validated_at = NULL
             WHERE id = ?2",
            rusqlite::params![normalized, id],
        )?;
        Ok(())
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use tempfile::TempDir;

    fn init_test_db() -> TempDir {
        let dir = TempDir::new().unwrap();
        db::init(dir.path()).unwrap();
        dir
    }

    #[test]
    fn test_update_bios_root_clears_stale_results() {
        let _dir = init_test_db();
        // Create a project
        let req = crate::models::project::CreateProjectRequest {
            name: "test".to_string(),
            library_roots: vec![],
            target_frontends: vec!["esde".to_string()],
        };
        let project = create(req).unwrap();

        // Write some fake bios results
        let fake_results: Vec<crate::models::bios::BiosSystemResult> = vec![];
        update_bios_results(&project.id.to_string(), fake_results).unwrap();

        // Confirm results are written
        let p = get(&project.id.to_string()).unwrap();
        assert!(p.bios_results.is_some());
        assert!(p.bios_last_validated_at.is_some());

        // Change bios_root — should clear results
        update_bios_root(&project.id.to_string(), Some("new/path")).unwrap();
        let p2 = get(&project.id.to_string()).unwrap();
        assert_eq!(p2.bios_root.as_deref(), Some("new/path"));
        assert!(p2.bios_results.is_none(), "changing bios_root must clear stale results");
        assert!(p2.bios_last_validated_at.is_none());
    }
}
