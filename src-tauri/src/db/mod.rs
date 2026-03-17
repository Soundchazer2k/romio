// SPDX-License-Identifier: GPL-3.0
//! SQLite project database — persists project state between sessions.

pub mod projects;
pub mod bios;
pub mod format;
pub mod save;
pub mod emulator;

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
    conn.execute_batch(include_str!("migrations/001_initial.sql"))?;
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
