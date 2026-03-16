// SPDX-License-Identifier: GPL-3.0
use serde::{Deserialize, Serialize};
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrontendInfo { pub id: String, pub name: String, pub tier: u8 }
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportPlan { pub frontend: String, pub operations: Vec<String>, pub dry_run: bool }
#[tauri::command]
pub async fn get_supported_frontends() -> Result<Vec<FrontendInfo>, String> {
    Ok(vec![
        FrontendInfo { id: "esde".into(),      name: "ES-DE".into(),      tier: 1 },
        FrontendInfo { id: "retrobat".into(),  name: "RetroBat".into(),   tier: 1 },
        FrontendInfo { id: "launchbox".into(), name: "LaunchBox".into(),  tier: 1 },
        FrontendInfo { id: "batocera".into(),  name: "Batocera".into(),   tier: 1 },
        FrontendInfo { id: "playnite".into(),  name: "Playnite".into(),   tier: 1 },
        FrontendInfo { id: "pegasus".into(),   name: "Pegasus".into(),    tier: 2 },
    ])
}
#[tauri::command]
pub async fn plan_export(project_id: String, frontend: String) -> Result<ExportPlan, String> {
    Ok(ExportPlan { frontend, operations: vec![], dry_run: false })
}
#[tauri::command]
pub async fn execute_export(_plan: ExportPlan) -> Result<(), String> {
    Err("Export execution not yet implemented".to_string())
}
#[tauri::command]
pub async fn dry_run_export(project_id: String, frontend: String) -> Result<ExportPlan, String> {
    Ok(ExportPlan { frontend, operations: vec![], dry_run: true })
}
