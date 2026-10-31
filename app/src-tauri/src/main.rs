#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.first().is_some_and(|a| a == "validate") {
        std::process::exit(pr_tour_lib::validate::cli(&args[1..]));
    }
    pr_tour_lib::run(pr_tour_lib::Launch::from_args(&args));
}
