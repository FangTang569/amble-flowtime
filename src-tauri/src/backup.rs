use std::fs;
use std::time::SystemTime;
use tauri::AppHandle;
use tauri::Manager;

#[tauri::command]
pub fn backup_database(date_str: String, app: AppHandle) -> Result<String, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;

    let db_path = app_data.join("amble.db");
    let backup_dir = app_data.join("backups");
    fs::create_dir_all(&backup_dir).map_err(|e| e.to_string())?;

    // Skip if already backed up today
    let backup_path = backup_dir.join(format!("amble-{}.db", date_str));
    if backup_path.exists() {
        return Ok("skipped".into());
    }

    // Copy database
    fs::copy(&db_path, &backup_path).map_err(|e| e.to_string())?;

    // Clean up backups older than 7 days
    let now = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap()
        .as_secs();
    let seven_days: u64 = 7 * 86400;

    if let Ok(entries) = fs::read_dir(&backup_dir) {
        for entry in entries.flatten() {
            if let Ok(meta) = entry.metadata() {
                if let Ok(mtime) = meta.modified() {
                    let age = mtime
                        .duration_since(SystemTime::UNIX_EPOCH)
                        .map(|d| d.as_secs())
                        .unwrap_or(0);
                    if now.saturating_sub(age) > seven_days {
                        let _ = fs::remove_file(entry.path());
                    }
                }
            }
        }
    }

    Ok("ok".into())
}
