// SPDX-License-Identifier: GPL-3.0
//! SQLite project database — persists project state between sessions.

pub mod projects;
pub mod bios;
pub mod format;
pub mod save;
pub mod emulator;
pub mod artifacts;
pub mod checkpoints;
pub mod operation_log;

use anyhow::Result;
use rusqlite::Connection;
use std::path::Path;
use std::sync::Mutex;

// Global connection — single writer, Romio is a single-user desktop app
static DB: Mutex<Option<Connection>> = Mutex::new(None);

/// Initialize the database at the given app data directory.
pub fn init(app_dir: &Path) -> Result<()> {
    let db_path = app_dir.join("romio.db");
    let conn = Connection::open(db_path)?;
    run_migrations(&conn)?;
    *DB.lock().unwrap() = Some(conn);
    Ok(())
}

fn run_migrations(conn: &Connection) -> Result<()> {
    let version: i64 = conn.query_row(
        "PRAGMA user_version", [], |r| r.get(0)
    )?;

    if version < 1 {
        conn.execute_batch(include_str!("migrations/001_initial.sql"))?;
        conn.execute_batch("PRAGMA user_version = 1")?;
    }
    if version < 2 {
        conn.execute_batch(include_str!("migrations/002_scan_stats.sql"))?;
        conn.execute_batch("PRAGMA user_version = 2")?;
    }
    if version < 3 {
        conn.execute_batch(include_str!("migrations/003_bios.sql"))?;
        conn.execute_batch("PRAGMA user_version = 3")?;
    }
    if version < 4 {
        conn.execute_batch(include_str!("migrations/004_save_indexes.sql"))?;
        conn.execute_batch("PRAGMA user_version = 4")?;
    }

    Ok(())
}

pub fn with_conn<F, T>(f: F) -> Result<T>
where
    F: FnOnce(&Connection) -> Result<T>,
{
    let guard = DB.lock().unwrap();
    let conn = guard.as_ref().ok_or_else(|| anyhow::anyhow!("DB not initialized"))?;
    f(conn)
}

/// Opens a rusqlite transaction and passes it to `f`.
/// Commits on Ok; rolls back automatically on Err (Transaction drop).
pub fn with_transaction<F, T>(f: F) -> Result<T>
where
    F: FnOnce(&rusqlite::Transaction) -> Result<T>,
{
    let mut guard = DB.lock().unwrap();
    let conn = guard.as_mut().ok_or_else(|| anyhow::anyhow!("DB not initialized"))?;
    let tx = conn.transaction()?;
    let result = f(&tx)?;
    tx.commit()?;
    Ok(result)
}
