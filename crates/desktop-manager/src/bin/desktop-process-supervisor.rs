//! Headless entry point for native lifecycle integration tests. The packaged
//! desktop calls the same function before it initializes Tauri.
fn main() {
    std::process::exit(desktop_manager::supervisor::run_if_requested().unwrap_or(2));
}
