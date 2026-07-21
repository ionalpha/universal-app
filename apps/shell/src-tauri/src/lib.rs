mod commands;
mod error;

use tauri_specta::{collect_commands, Builder};

/// The command surface, in one place.
///
/// This is the single source of truth for the IPC boundary: `run()` mounts it
/// as the invoke handler, and the bindings test exports it to TypeScript. Both
/// read the same builder, so a command cannot exist at runtime without also
/// existing in `bindings.ts` - that is what makes the drift check meaningful
/// rather than decorative.
pub fn ipc() -> Builder<tauri::Wry> {
    Builder::<tauri::Wry>::new().commands(collect_commands![
        commands::greet,
        commands::host_info,
        commands::open_external
    ])
}

/// Shared entry point. `mobile_entry_point` makes the same `run()` the launch
/// symbol on iOS/Android, so desktop and mobile boot from one function.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let ipc = ipc();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(ipc.invoke_handler())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
