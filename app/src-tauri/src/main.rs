#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

const USAGE: &str = "usage:
  pr-tour open [branch] [--repo <path>] [--tour <file>] [--generate]
  pr-tour generate [branch] [--base <branch>] [--repo <path>] [--fresh | --session <id>]
                   [--force] [--output <file>] [--dry-run]
  pr-tour validate <tour.json> [--repo <path>]
  pr-tour ask --step <id> [--repo <path>] [--branch <branch>] [--dry-run] <question>";

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let rest = args.get(1..).unwrap_or_default();
    match args.first().map(String::as_str) {
        Some("validate") => std::process::exit(pr_tour_lib::validate::cli(rest)),
        Some("generate") => std::process::exit(pr_tour_lib::generate_cli(rest)),
        Some("ask") => std::process::exit(pr_tour_lib::ask_cli(rest)),
        Some("open") => std::process::exit(open_detached(rest)),
        Some("-h" | "--help" | "help") => println!("{USAGE}"),
        _ => pr_tour_lib::run(args, pr_tour_lib::LaunchLock::acquire()),
    }
}

/// Starts the app in the background and returns at once, so a terminal or a
/// launcher isn't held. If the app is already running, the new process hands
/// the request over and exits.
fn open_detached(args: &[String]) -> i32 {
    let mut command = std::process::Command::new(std::env::current_exe().expect("own executable"));
    command.args(args).stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null());
    #[cfg(unix)]
    std::os::unix::process::CommandExt::process_group(&mut command, 0);
    match command.spawn() {
        Ok(_) => 0,
        Err(error) => {
            eprintln!("pr-tour: cannot start the app: {error}");
            1
        }
    }
}
