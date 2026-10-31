mod commands;
mod git;
mod hunks;
mod locate;
mod types;
pub mod validate;

pub use commands::Launch;

pub fn run(launch: Launch) {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .manage(launch)
        .manage(commands::TourWatcher::default())
        .invoke_handler(tauri::generate_handler![
            commands::launch,
            commands::locate,
            commands::read_tour,
            commands::validate_tour,
            commands::branch_tip,
            commands::file_diff,
            commands::watch_tour,
        ])
        .run(tauri::generate_context!())
        .expect("error while running the PR tour app");
}
