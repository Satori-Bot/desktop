#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use desktop_manager::{model::*, Manager};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use tauri::{Emitter, Manager as _, State};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
type AppManager = Arc<Manager>;
async fn work<T: Send + 'static>(
    manager: AppManager,
    f: impl FnOnce(&Manager) -> std::result::Result<T, desktop_manager::Error> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(move || f(&manager).map_err(|e| e.to_string()))
        .await
        .map_err(|e| e.to_string())?
}
// Keep the public command surface explicit and small. All blocking work leaves the UI thread.
#[tauri::command]
async fn snapshot(state: State<'_, AppManager>) -> Result<Snapshot, String> {
    work(state.inner().clone(), |m| Ok(m.snapshot())).await
}
#[tauri::command]
async fn save_workspace(
    state: State<'_, AppManager>,
    workspace: Workspace,
    secrets: Option<Secrets>,
) -> Result<Workspace, String> {
    work(state.inner().clone(), move |m| {
        m.save_workspace(workspace, secrets)
    })
    .await
}
#[tauri::command]
async fn delete_workspace(state: State<'_, AppManager>, id: String) -> Result<(), String> {
    work(state.inner().clone(), move |m| m.delete_workspace(&id)).await
}
macro_rules! operation {
    ($name:ident,$method:ident,$result:ty) => {
        #[tauri::command]
        async fn $name(state: State<'_, AppManager>, id: String) -> Result<$result, String> {
            work(state.inner().clone(), move |m| m.$method(&id)).await
        }
    };
}
operation!(start_workspace, start, Status);
operation!(stop_workspace, stop, Status);
operation!(restart_workspace, restart, Status);
operation!(retry_tunnel, retry_tunnel, Status);
operation!(activity, activity, Vec<Activity>);
operation!(diagnose, diagnose, Vec<Diagnostic>);
operation!(check_public_route, check_public_route, String);
operation!(export_diagnostics, export_diagnostics, String);
operation!(auth_details, auth_details, serde_json::Value);
#[tauri::command]
async fn logs(
    state: State<'_, AppManager>,
    id: String,
    kind: String,
    cursor: u64,
) -> Result<Logs, String> {
    work(state.inner().clone(), move |m| m.logs(&id, &kind, cursor)).await
}
#[tauri::command]
async fn connection_config(
    state: State<'_, AppManager>,
    id: String,
    public: bool,
) -> Result<String, String> {
    work(state.inner().clone(), move |m| {
        m.connection_config(&id, public)
    })
    .await
}
struct TrayItems {
    show: tauri::menu::MenuItem<tauri::Wry>,
    quit: tauri::menu::MenuItem<tauri::Wry>,
}

fn tray_labels(language: &str) -> (&'static str, &'static str) {
    if language == "zh" {
        ("显示 Coding Tools MCP", "停止服务并退出")
    } else {
        ("Show Coding Tools MCP", "Stop services and quit")
    }
}

#[tauri::command]
async fn save_settings(
    app: tauri::AppHandle,
    state: State<'_, AppManager>,
    settings: Settings,
) -> Result<Settings, String> {
    let saved = work(state.inner().clone(), move |m| m.save_settings(settings)).await?;
    if let Some(items) = app.try_state::<TrayItems>() {
        let labels = tray_labels(&saved.language);
        let _ = items.show.set_text(labels.0);
        let _ = items.quit.set_text(labels.1);
    }
    Ok(saved)
}
#[tauri::command]
async fn install_core(state: State<'_, AppManager>, version: String) -> Result<String, String> {
    work(state.inner().clone(), move |m| m.install_core(&version)).await
}
#[tauri::command]
async fn rollback_core(state: State<'_, AppManager>) -> Result<String, String> {
    work(state.inner().clone(), |m| m.rollback_core()).await
}
#[tauri::command]
async fn cloudflare_login(state: State<'_, AppManager>) -> Result<String, String> {
    work(state.inner().clone(), |m| m.cloudflare_login()).await
}
#[tauri::command]
async fn setup_named_tunnel(
    state: State<'_, AppManager>,
    id: String,
    name: String,
    hostname: String,
) -> Result<Workspace, String> {
    work(state.inner().clone(), move |m| {
        m.setup_named_tunnel(&id, &name, &hostname)
    })
    .await
}
#[tauri::command]
async fn validate_workspace_path(path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        desktop_manager::runtime::validate_workspace_folder(&path).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn validate_core_override(path: String, args: Vec<String>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        desktop_manager::core::validate_override(&args, std::path::Path::new(&path))
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn pick_directory(app: tauri::AppHandle) -> Result<Option<String>, String> {
    pick_path(app, true).await
}
#[tauri::command]
async fn pick_core_executable(app: tauri::AppHandle) -> Result<Option<String>, String> {
    pick_path(app, false).await
}
async fn pick_path(app: tauri::AppHandle, directory: bool) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let picker = app.dialog().file();
        let selection = if directory {
            picker.blocking_pick_folder()
        } else {
            picker.blocking_pick_file()
        };
        selection
            .map(|f| {
                f.into_path().map_err(|e| e.to_string()).and_then(|p| {
                    p.into_os_string()
                        .into_string()
                        .map_err(|_| "Folder path must use valid UTF-8 characters".to_owned())
                })
            })
            .transpose()
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn open_workspace(state: State<'_, AppManager>, id: String) -> Result<(), String> {
    let path = state.workspace_path(&id).map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || open::that(path).map_err(|e| e.to_string()))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn quit_app(app: tauri::AppHandle, state: State<'_, AppManager>) -> Result<(), String> {
    work(state.inner().clone(), |m| m.shutdown()).await?;
    app.state::<AtomicBool>().store(true, Ordering::SeqCst);
    app.exit(0);
    Ok(())
}
fn show(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}
fn request_quit(app: tauri::AppHandle) {
    let m = app.state::<AppManager>().inner().clone();
    tauri::async_runtime::spawn(async move {
        match work(m, |m| m.shutdown()).await {
            Ok(()) => {
                app.state::<AtomicBool>().store(true, Ordering::SeqCst);
                app.exit(0);
            }
            Err(error) => {
                show(&app);
                let _ = app.emit("shutdown-error", &error);
                app.dialog()
                    .message(error)
                    .title("Could not stop services")
                    .kind(tauri_plugin_dialog::MessageDialogKind::Error)
                    .show(|_| {});
            }
        }
    });
}
fn startup_error(app: &tauri::App, error: desktop_manager::Error) {
    use desktop_manager::storage::{Storage, CONFIG_BACKUP, CONFIG_FILE};
    app.state::<AtomicBool>().store(true, Ordering::SeqCst);
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
    let handle = app.handle().clone();
    let home = Manager::default_home().ok();
    let can_restore = home.as_ref().is_some_and(|dir| {
        Storage::open(dir.clone()).is_ok_and(|storage| storage.has_recoverable_backup())
    });
    let location = home.as_ref().map_or(String::new(), |dir| {
        format!(
            "\n\nConfiguration: {}\nBackup: {}",
            dir.join(CONFIG_FILE).display(),
            dir.join(CONFIG_BACKUP).display()
        )
    });
    let dialog = app.dialog().message(format!(
        "{error:#}{location}\n\nOriginal files were preserved. Close this dialog and reopen the app after repairing or restoring the configuration."
    )).title("Coding Tools MCP could not start").kind(MessageDialogKind::Error);
    if !can_restore {
        dialog.show(move |_| handle.exit(1));
        return;
    }
    dialog
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Restore backup".into(),
            "Close".into(),
        ))
        .show(move |restore| {
            if !restore {
                handle.exit(1);
                return;
            }
            tauri::async_runtime::spawn_blocking(move || {
                let result = Manager::default_home()
                    .and_then(Storage::open)
                    .and_then(|s| s.restore_backup());
                let text = match result {
                    Ok(()) => "Backup restored. Reopen Coding Tools MCP.".to_owned(),
                    Err(error) => format!("Could not restore the backup: {error:#}"),
                };
                let app = handle.clone();
                handle.dialog().message(text).show(move |_| app.exit(1));
            });
        });
}

fn main() {
    if let Some(code) = desktop_manager::supervisor::run_if_requested() {
        std::process::exit(code);
    }
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if app.try_state::<AppManager>().is_some() {
                show(app);
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .manage(AtomicBool::new(false))
        .setup(|app| {
            let manager = match Manager::default_home().and_then(|home| {
                #[cfg(unix)]
                let supervisor = Some(std::env::current_exe()?);
                #[cfg(not(unix))]
                let supervisor = None;

                // Only activate the sidecar in builds with its packaging overlay.
                // Use Tauri's actual executable location (including AppImage) and
                // the specific packaged binary name, not the working directory.
                let bundled_uv =
                    if app
                        .config()
                        .bundle
                        .external_bin
                        .as_ref()
                        .is_some_and(|binaries| {
                            binaries
                                .iter()
                                .any(|path| path == "gen/runtime-installer/coding-tools-mcp-uv")
                        })
                    {
                        let executable = tauri::utils::platform::current_exe()?;
                        let name = if cfg!(windows) {
                            "coding-tools-mcp-uv.exe"
                        } else {
                            "coding-tools-mcp-uv"
                        };
                        Some(executable.with_file_name(name))
                    } else {
                        None
                    };
                Manager::open_native(home, supervisor, bundled_uv)
            }) {
                Ok(manager) => manager,
                Err(error) => {
                    startup_error(app, error);
                    return Ok(());
                }
            };
            let labels = tray_labels(&manager.settings().language);
            app.manage(manager);
            let show_item =
                tauri::menu::MenuItem::with_id(app, "show", labels.0, true, None::<&str>)?;
            let quit_item =
                tauri::menu::MenuItem::with_id(app, "quit", labels.1, true, None::<&str>)?;
            let menu = tauri::menu::Menu::with_items(app, &[&show_item, &quit_item])?;
            app.manage(TrayItems {
                show: show_item,
                quit: quit_item,
            });
            let mut tray = tauri::tray::TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("Coding Tools MCP")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => show(app),
                    "quit" => request_quit(app.clone()),
                    _ => {}
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let app = window.app_handle();
                if !app.state::<AtomicBool>().load(Ordering::SeqCst) {
                    api.prevent_close();
                    if app.state::<AppManager>().settings().close_to_tray {
                        let _ = window.hide();
                    } else {
                        request_quit(app.clone());
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            snapshot,
            save_workspace,
            delete_workspace,
            start_workspace,
            stop_workspace,
            restart_workspace,
            retry_tunnel,
            activity,
            logs,
            diagnose,
            check_public_route,
            export_diagnostics,
            connection_config,
            auth_details,
            save_settings,
            pick_directory,
            pick_core_executable,
            validate_workspace_path,
            validate_core_override,
            open_workspace,
            install_core,
            rollback_core,
            cloudflare_login,
            setup_named_tunnel,
            quit_app
        ])
        .build(tauri::generate_context!())
        .expect("Could not start Coding Tools MCP desktop");
    app.run(|app, event| {
        if let tauri::RunEvent::ExitRequested { api, .. } = event {
            if !app.state::<AtomicBool>().load(Ordering::SeqCst) {
                api.prevent_exit();
                request_quit(app.clone());
            }
        }
    });
}
