mod backup;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::default().build())
        .invoke_handler(tauri::generate_handler![backup::backup_database])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
