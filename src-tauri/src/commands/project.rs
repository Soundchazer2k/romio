// SPDX-License-Identifier: GPL-3.0
use crate::models::project::{Project, CreateProjectRequest};

#[tauri::command]
pub async fn create_project(req: CreateProjectRequest) -> Result<Project, String> {
    crate::db::projects::create(req).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn open_project(id: String) -> Result<Project, String> {
    crate::db::projects::get(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_projects() -> Result<Vec<Project>, String> {
    crate::db::projects::list().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_project(id: String) -> Result<Project, String> {
    crate::db::projects::get(&id).map_err(|e| e.to_string())
}
