// SPDX-License-Identifier: GPL-3.0
use crate::models::format::{FormatRule, FormatCheckResult, SystemFolder};
/// Takes a list so the rules are parsed once per call instead of once per file.
#[tauri::command]
pub async fn check_format_batch(paths: Vec<String>, system: String, emulator: String, frontend: String) -> Result<Vec<FormatCheckResult>, String> {
    let rules = crate::db::format::load_rules().map_err(|e| e.to_string())?;
    Ok(paths.iter()
        .map(|path| crate::engine::format_matrix::check_format(std::path::Path::new(path), &rules, &system, &emulator, &frontend))
        .collect())
}
/// Listed in Rust because the fs plugin only reaches one level below a picked folder.
#[tauri::command]
pub async fn list_library_folders(root: String) -> Result<Vec<SystemFolder>, String> {
    let rules = crate::db::format::load_rules().map_err(|e| e.to_string())?;
    crate::engine::format_matrix::list_system_folders(std::path::Path::new(&root), &rules)
        .map_err(|e| format!("Couldn't read {root}: {e}"))
}
#[tauri::command]
pub async fn get_format_matrix() -> Result<Vec<FormatRule>, String> {
    crate::db::format::load_rules().map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::artifact::FormatCompatibilityState;

    fn batch(paths: Vec<String>, system: &str, emulator: &str, frontend: &str) -> Vec<FormatCheckResult> {
        tauri::async_runtime::block_on(check_format_batch(paths, system.into(), emulator.into(), frontend.into())).unwrap()
    }

    #[test]
    fn batch_gives_each_file_the_same_verdict_as_checking_it_alone_in_order() {
        let rules = crate::db::format::load_rules().unwrap();
        let rule = rules.iter().find(|r| r.frontend.is_none()).unwrap();
        let paths = vec![
            "/roms/b.nosuchformat".to_string(),
            format!("/roms/a.{}", rule.extension),
            format!("/roms/c.{}", rule.extension),
        ];

        let results = batch(paths.clone(), &rule.system, &rule.emulator, "esde");

        assert_eq!(results.len(), 3);
        for (path, result) in paths.iter().zip(&results) {
            assert_eq!(&result.path, path);
            let alone = crate::engine::format_matrix::check_format(std::path::Path::new(path), &rules, &rule.system, &rule.emulator, "esde");
            assert_eq!(format!("{result:?}"), format!("{alone:?}"));
        }
        assert!(matches!(results[0].state, FormatCompatibilityState::Unknown));
        assert!(!matches!(results[1].state, FormatCompatibilityState::Unknown));
    }

    #[test]
    fn batch_of_nothing_is_empty() {
        assert!(batch(vec![], "ps1", "duckstation", "esde").is_empty());
    }
}
