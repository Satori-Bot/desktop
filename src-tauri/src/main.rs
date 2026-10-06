#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use desktop_manager::{model::*, Manager};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use tauri::{Emitter, Manager as _, State};
use tauri_plugin_dialog::DialogExt;
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
#[tauri::command]
async fn save_settings(
    state: State<'_, AppManager>,
    settings: Settings,
) -> Result<Settings, String> {
    work(state.inner().clone(), move |m| m.save_settings(settings)).await
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
async fn pick_directory(app: tauri::AppHandle) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .blocking_pick_folder()
            .map(|f| {
                f.into_path()
                    .map(|p| p.to_string_lossy().into_owned())
                    .map_err(|e| e.to_string())
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
    work(state.inner().clone(), |m| m.stop_all()).await?;
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
        match work(m, |m| m.stop_all()).await {
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
fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| show(app)))
        .plugin(tauri_plugin_dialog::init())
        .manage(AtomicBool::new(false))
        .setup(|app| {
            let manager = match Manager::default_home().and_then(Manager::open) {
                Ok(manager)=>manager,
                Err(error) => {
                    // Never block Tauri's main setup thread waiting for a dialog.
                    app.state::<AtomicBool>().store(true, Ordering::SeqCst);
                    if let Some(window)=app.get_webview_window("main"){let _=window.hide();}
                    let handle=app.handle().clone();
                    app.dialog().message(format!("{error}\n\nYour configuration has been preserved. Restore its backup or correct the reported problem, then reopen the app.")).title("Coding Tools MCP could not start").kind(tauri_plugin_dialog::MessageDialogKind::Error).show(move |_| handle.exit(1));
                    return Ok(());
                }
            };
            app.manage(manager);
            let show_item = tauri::menu::MenuItem::with_id(
                app,
                "show",
                "Show Coding Tools MCP",
                true,
                None::<&str>,
            )?;
            let quit_item = tauri::menu::MenuItem::with_id(
                app,
                "quit",
                "Stop services and quit",
                true,
                None::<&str>,
            )?;
            let menu = tauri::menu::Menu::with_items(app, &[&show_item, &quit_item])?;
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
            export_diagnostics,
            connection_config,
            auth_details,
            save_settings,
            pick_directory,
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
