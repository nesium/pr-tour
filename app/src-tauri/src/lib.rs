mod commands;
mod generate;
mod git;
mod hunks;
mod locate;
mod types;
pub mod validate;
mod windows;

use tauri::{Manager, WindowEvent};
use windows::{OpenRequest, WindowLabel, Windows};

pub use generate::cli as generate_cli;

/// Runs the app for `args` (see [`OpenRequest`]). A second launch hands its
/// arguments to the running app and exits.
pub fn run(args: Vec<String>) {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            let request = OpenRequest::from_args(argv.get(1..).unwrap_or_default(), cwd.as_ref());
            let app = app.clone();
            tauri::async_runtime::spawn(async move { open_or_explain(&app, request).await });
        }))
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .manage(Windows::default())
        .setup(move |app| {
            let cwd = std::env::current_dir().unwrap_or_default();
            let request = OpenRequest::from_args(&args, &cwd);
            let app = app.handle().clone();
            tauri::async_runtime::spawn(async move { open_or_explain(&app, request).await });
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::Destroyed = event {
                window.state::<Windows>().closed(&WindowLabel::of(window));
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::window_content,
            commands::generation_state,
            commands::start_generation,
            commands::cancel_generation,
            commands::open_repo,
            commands::read_tour,
            commands::validate_tour,
            commands::branch_tip,
            commands::file_diff,
        ])
        .run(tauri::generate_context!())
        .expect("error while running the PR tour app");
}

async fn open_or_explain(app: &tauri::AppHandle, request: Result<Option<OpenRequest>, String>) {
    match request {
        Ok(request) => windows::open_or_explain(app, request).await,
        Err(problem) => windows::show_start(app, Some(problem)),
    }
}
