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
                    created_at, last_scanned_at, scan_stats
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
        })
    })
}

pub fn list() -> Result<Vec<Project>> {
    crate::db::with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT id, name, library_roots, target_frontends, emulator_prefs,
                    created_at, last_scanned_at, scan_stats
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
        })
        .collect();
        Ok(projects)
    })
}
