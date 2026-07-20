#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {name}! The Universal App desktop shell is running.")
}

/// Shared entry point. `mobile_entry_point` makes the same `run()` the launch
/// symbol on iOS/Android, so desktop and mobile boot from one function.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
