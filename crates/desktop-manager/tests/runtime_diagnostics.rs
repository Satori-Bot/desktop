use desktop_manager::{core, model::Workspace, Manager};
use serde_json::json;
use std::{path::Path, sync::Mutex};

static FIXTURE: Mutex<()> = Mutex::new(());

fn assert_workspace_probe(command: Vec<String>, workspace_path: &Path) {
    let _guard = FIXTURE.lock().unwrap_or_else(|error| error.into_inner());
    let manager = Manager::open(workspace_path.join("private-home")).unwrap();
    let workspace: Workspace = serde_json::from_value(json!({
        "name":"Relative runtime fixture", "path":workspace_path, "coreCommand":command
    }))
    .unwrap();
    let workspace = manager.save_workspace(workspace, None).unwrap();
    let version = core::version_output(&workspace.core_command, workspace_path).unwrap();
    assert!(version.starts_with("coding-tools-mcp 0.5.0"));
    let diagnosis = manager.diagnose(&workspace.id).unwrap();
    let core = diagnosis
        .iter()
        .find(|row| row.name == "Core executable")
        .unwrap();
    let diagnostic_level = core.level.clone();
    let diagnostic_message = core.message.clone();
    let started = manager.start(&workspace.id);
    let stopped = manager.stop(&workspace.id);
    manager.shutdown().unwrap();
    assert_eq!(
        diagnostic_level, "ok",
        "diagnostics used a different directory: {diagnostic_message}"
    );
    assert_eq!(started.unwrap().local_state, "ready");
    let stopped = stopped.unwrap();
    assert!(!stopped.cleanup_pending && !stopped.port_release_pending);
}

#[test]
fn diagnostic_relative_arguments_use_the_workspace_directory() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(
        dir.path().join("core fixture.py"),
        include_str!("fixtures/fake_core.py"),
    )
    .unwrap();
    let python = std::env::var("PYTHON")
        .unwrap_or_else(|_| if cfg!(windows) { "python" } else { "python3" }.into());
    let python = core::find_program(&python).unwrap();
    assert_workspace_probe(
        vec![python.to_str().unwrap().into(), "./core fixture.py".into()],
        dir.path(),
    );
}

#[cfg(unix)]
#[test]
fn diagnostic_relative_executable_uses_the_workspace_directory() {
    use std::os::unix::fs::PermissionsExt;
    let dir = tempfile::tempdir().unwrap();
    let executable = dir.path().join("core fixture");
    std::fs::write(
        dir.path().join("core fixture.py"),
        include_str!("fixtures/fake_core.py"),
    )
    .unwrap();
    let python =
        core::find_program(&std::env::var("PYTHON").unwrap_or_else(|_| "python3".into())).unwrap();
    std::fs::write(
        &executable,
        format!(
            "#!/bin/sh\nexec {} './core fixture.py' \"$@\"\n",
            shell_words::quote(python.to_str().unwrap())
        ),
    )
    .unwrap();
    std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o700)).unwrap();
    assert_workspace_probe(vec!["./core fixture".into()], dir.path());
}

#[test]
fn diagnostic_absolute_command_remains_supported() {
    let dir = tempfile::tempdir().unwrap();
    let script = dir.path().join("core fixture.py");
    std::fs::write(&script, include_str!("fixtures/fake_core.py")).unwrap();
    let python = std::env::var("PYTHON")
        .unwrap_or_else(|_| if cfg!(windows) { "python" } else { "python3" }.into());
    let python = core::find_program(&python).unwrap();
    assert_workspace_probe(
        vec![
            python.to_str().unwrap().into(),
            script.to_str().unwrap().into(),
        ],
        dir.path(),
    );
}

#[cfg(windows)]
#[test]
fn diagnostic_relative_executable_uses_the_workspace_directory() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(
        dir.path().join("core fixture.py"),
        include_str!("fixtures/fake_core.py"),
    )
    .unwrap();
    let python =
        core::find_program(&std::env::var("PYTHON").unwrap_or_else(|_| "python".into())).unwrap();
    std::fs::write(
        dir.path().join("core fixture.cmd"),
        format!("@\"{}\" \"core fixture.py\" %*\r\n", python.display()),
    )
    .unwrap();
    assert_workspace_probe(vec![".\\core fixture.cmd".into()], dir.path());
}
