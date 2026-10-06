use desktop_manager::{
    model::*,
    storage::{private_json, Storage},
};
use serde_json::json;

fn workspace(path: &std::path::Path) -> Workspace {
    serde_json::from_value(
        json!({"id":"1234567890abcdef1234567890abcdef","name":"Fixture","path":path,"port":28766}),
    )
    .unwrap()
}

#[test]
fn duplicate_workspace_ids_do_not_load_into_one_runtime_slot() {
    let d = tempfile::tempdir().unwrap();
    let w = workspace(d.path());
    let config = Config {
        workspaces: vec![w.clone(), w],
        ..Default::default()
    };
    private_json(&d.path().join("desktop-v2.json"), &config).unwrap();
    let before = std::fs::read(d.path().join("desktop-v2.json")).unwrap();
    let storage = Storage::open(d.path().into()).unwrap();
    assert!(
        storage.load().is_err(),
        "duplicate IDs would share one process slot and ambiguous credentials"
    );
    assert_eq!(
        std::fs::read(d.path().join("desktop-v2.json")).unwrap(),
        before
    );
}

#[test]
fn duplicate_legacy_ids_do_not_commit_an_ambiguous_migration() {
    let d = tempfile::tempdir().unwrap();
    let record = json!({"id":"1234567890abcdef1234567890abcdef","name":"Fixture","path":d.path()});
    private_json(
        &d.path().join("profiles.json"),
        &json!({"profiles":[record.clone(),record]}),
    )
    .unwrap();
    let storage = Storage::open(d.path().into()).unwrap();
    assert!(
        storage.load().is_err(),
        "duplicate legacy IDs must be rejected before migration commits"
    );
    assert!(!d.path().join("desktop-v2.json").exists());
}

#[test]
fn workspace_ids_cannot_alias_on_case_insensitive_filesystems() {
    let d = tempfile::tempdir().unwrap();
    let first = workspace(d.path());
    let mut second = first.clone();
    second.id = second.id.to_ascii_uppercase();
    let config = Config {
        workspaces: vec![first, second],
        ..Default::default()
    };
    private_json(&d.path().join("desktop-v2.json"), &config).unwrap();
    let storage = Storage::open(d.path().into()).unwrap();
    assert!(
        storage.load().is_err(),
        "case-only aliases would share state files on macOS/Windows"
    );
}

#[test]
fn invalid_config_write_preserves_the_last_valid_configuration() {
    let d = tempfile::tempdir().unwrap();
    let storage = Storage::open(d.path().into()).unwrap();
    let w = workspace(d.path());
    let mut config = Config {
        workspaces: vec![w.clone()],
        ..Default::default()
    };
    storage.save(&config).unwrap();
    let before = std::fs::read(d.path().join("desktop-v2.json")).unwrap();
    let mut alias = w;
    alias.id = alias.id.to_ascii_uppercase();
    config.workspaces.push(alias);
    assert!(storage.save(&config).is_err());
    assert_eq!(
        std::fs::read(d.path().join("desktop-v2.json")).unwrap(),
        before
    );
}

#[cfg(unix)]
mod mocked_tools {
    use super::*;
    use desktop_manager::{core, tunnel, Manager};
    use serde_json::Value;
    use std::{
        ffi::{OsStr, OsString},
        fs,
        os::unix::fs::PermissionsExt,
        path::PathBuf,
        sync::{Mutex, MutexGuard},
    };

    static ENVIRONMENT: Mutex<()> = Mutex::new(());
    struct Harness {
        _guard: MutexGuard<'static, ()>,
        root: tempfile::TempDir,
        saved: Vec<(OsString, Option<OsString>)>,
    }
    impl Harness {
        fn new() -> Self {
            let guard = ENVIRONMENT.lock().unwrap_or_else(|e| e.into_inner());
            let mut h = Self {
                _guard: guard,
                root: tempfile::tempdir().unwrap(),
                saved: vec![],
            };
            fs::create_dir(h.bin()).unwrap();
            let old_path = std::env::var_os("PATH").unwrap_or_default();
            let path = std::env::join_paths(
                std::iter::once(h.bin()).chain(std::env::split_paths(&old_path)),
            )
            .unwrap();
            h.set("PATH", path);
            for (key, _) in std::env::vars_os() {
                if key.to_string_lossy().starts_with("TUNNEL_") {
                    h.saved.push((key.clone(), std::env::var_os(&key)));
                    std::env::remove_var(key);
                }
            }
            h
        }
        fn bin(&self) -> PathBuf {
            self.root.path().join("bin")
        }
        fn home(&self) -> PathBuf {
            self.root.path().join("home")
        }
        fn set(&mut self, key: impl AsRef<OsStr>, value: impl AsRef<OsStr>) {
            self.saved
                .push((key.as_ref().to_os_string(), std::env::var_os(&key)));
            std::env::set_var(key, value);
        }
        fn tool(&self, name: &str, source: &str) -> PathBuf {
            let python = core::find_program("python3").unwrap();
            let script = self.bin().join(format!("{name}_fixture.py"));
            fs::write(&script, source).unwrap();
            let executable = self.bin().join(name);
            fs::write(
                &executable,
                format!(
                    "#!/bin/sh\nexec {} {} \"$@\"\n",
                    shell_words::quote(&python.to_string_lossy()),
                    shell_words::quote(&script.to_string_lossy())
                ),
            )
            .unwrap();
            fs::set_permissions(&executable, fs::Permissions::from_mode(0o700)).unwrap();
            executable
        }
        fn scenario(&self, value: Value) {
            private_json(&self.bin().join("scenario.json"), &value).unwrap();
        }
        fn invocations(&self) -> Vec<Value> {
            fs::read_to_string(self.bin().join("calls.jsonl"))
                .unwrap_or_default()
                .lines()
                .map(|s| serde_json::from_str(s).unwrap())
                .collect()
        }
        fn cloudflare(&self) {
            self.tool("cloudflared", include_str!("fixtures/mock_cloudflared.py"));
        }
        fn uv(&self) {
            self.tool("uv", include_str!("fixtures/mock_uv.py"));
        }
        fn manager_with_selected_core(&self) -> (std::sync::Arc<Manager>, Config) {
            let current = self.tool("current-core", "print('coding-tools-mcp 0.4.0')\n");
            let previous = self.tool("previous-core", "print('coding-tools-mcp 0.3.0')\n");
            let config = Config {
                managed_core: Some(current.to_string_lossy().into()),
                previous_core: Some(previous.to_string_lossy().into()),
                ..Default::default()
            };
            private_json(&self.home().join("desktop-v2.json"), &config).unwrap();
            (Manager::open(self.home()).unwrap(), config)
        }
    }
    impl Drop for Harness {
        fn drop(&mut self) {
            for (key, previous) in self.saved.iter().rev() {
                if let Some(value) = previous {
                    std::env::set_var(key, value);
                } else {
                    std::env::remove_var(key);
                }
            }
        }
    }

    #[test]
    fn missing_selected_managed_core_does_not_silently_switch_to_path() {
        let h = Harness::new();
        h.tool("coding-tools-mcp", "print('coding-tools-mcp 9.9.9')\n");
        let config = Config {
            managed_core: Some(
                h.root
                    .path()
                    .join("deleted-pinned-core")
                    .to_string_lossy()
                    .into(),
            ),
            ..Default::default()
        };
        assert!(
            core::resolve(&workspace(h.root.path()), &config).is_err(),
            "missing selected core silently switched to a different PATH installation"
        );
    }

    #[test]
    fn failed_install_preserves_selected_core_and_rollback_target() {
        let h = Harness::new();
        h.uv();
        h.scenario(json!({"failInstall":true}));
        let (manager, _) = h.manager_with_selected_core();
        let before = fs::read(h.home().join("desktop-v2.json")).unwrap();
        assert!(manager.install_core("0.5.0").is_err());
        assert_eq!(fs::read(h.home().join("desktop-v2.json")).unwrap(), before);
        manager.rollback_core().unwrap();
    }

    #[test]
    fn installed_core_must_report_the_requested_exact_version() {
        let h = Harness::new();
        h.uv();
        h.scenario(json!({"reportedCoreVersion":"9.9.9"}));
        let (manager, _) = h.manager_with_selected_core();
        let before = fs::read(h.home().join("desktop-v2.json")).unwrap();
        let result = manager.install_core("0.5.0");
        assert!(
            result.is_err(),
            "installer accepted coding-tools-mcp 9.9.9 while claiming verified version 0.5.0"
        );
        assert_eq!(fs::read(h.home().join("desktop-v2.json")).unwrap(), before);
    }

    #[test]
    fn install_config_write_failure_does_not_switch_in_memory() {
        let h = Harness::new();
        h.uv();
        h.scenario(json!({}));
        let (manager, before) = h.manager_with_selected_core();
        let config_path = h.home().join("desktop-v2.json");
        fs::rename(&config_path, h.home().join("saved.json")).unwrap();
        fs::create_dir(&config_path).unwrap();
        assert!(manager.install_core("0.5.0").is_err());
        fs::remove_dir(&config_path).unwrap();
        fs::rename(h.home().join("saved.json"), &config_path).unwrap();
        manager
            .save_settings(Settings {
                language: "zh".into(),
                close_to_tray: true,
            })
            .unwrap();
        let actual: Config = serde_json::from_slice(&fs::read(config_path).unwrap()).unwrap();
        assert_eq!(actual.managed_core, before.managed_core);
        assert_eq!(actual.previous_core, before.previous_core);
    }

    #[test]
    fn failed_rollback_probe_keeps_both_core_selections() {
        let h = Harness::new();
        let (manager, _) = h.manager_with_selected_core();
        h.tool("previous-core", "raise SystemExit(1)\n");
        let before = fs::read(h.home().join("desktop-v2.json")).unwrap();
        assert!(manager.rollback_core().is_err());
        assert_eq!(fs::read(h.home().join("desktop-v2.json")).unwrap(), before);
    }

    #[test]
    fn discovery_skips_non_executable_path_shadow() {
        let h = Harness::new();
        fs::write(h.bin().join("coding-tools-mcp"), b"not executable").unwrap();
        let fallback = h.root.path().join("fallback");
        fs::create_dir(&fallback).unwrap();
        let expected = fallback.join("coding-tools-mcp");
        fs::write(&expected, b"#!/bin/sh\nexit 0\n").unwrap();
        fs::set_permissions(&expected, fs::Permissions::from_mode(0o700)).unwrap();
        std::env::set_var("PATH", std::env::join_paths([h.bin(), fallback]).unwrap());
        assert_eq!(
            core::find_program("coding-tools-mcp"),
            Some(expected),
            "a non-executable file hid a usable later PATH installation"
        );
    }

    #[test]
    fn relative_path_discovery_returns_a_stable_absolute_executable() {
        let mut h = Harness::new();
        let local = tempfile::tempdir_in(std::env::current_dir().unwrap()).unwrap();
        let executable = local.path().join("coding-tools-mcp");
        fs::write(&executable, b"#!/bin/sh\nexit 0\n").unwrap();
        fs::set_permissions(&executable, fs::Permissions::from_mode(0o700)).unwrap();
        h.set("PATH", local.path().file_name().unwrap());
        let discovered = core::find_program("coding-tools-mcp").unwrap();
        assert!(
            discovered.is_absolute(),
            "relative result could select a different workspace-local executable after chdir"
        );
        assert_eq!(discovered, executable);
    }

    #[test]
    fn cloudflare_setup_cannot_inherit_dns_overwrite_permission() {
        let mut h = Harness::new();
        h.cloudflare();
        h.scenario(json!({}));
        h.set("TUNNEL_FORCE_PROVISIONING_DNS", "true");
        fs::create_dir(h.home()).unwrap();
        tunnel::setup(
            &workspace(h.root.path()),
            "fixture-tunnel",
            "mcp.example.invalid",
            &h.home(),
        )
        .unwrap();
        let route = h
            .invocations()
            .into_iter()
            .find(|v| v["kind"] == "route")
            .unwrap();
        assert_eq!(
            route["overwrite"], false,
            "ambient environment granted unrequested DNS overwrite permission"
        );
        assert!(route["arguments"]
            .as_array()
            .unwrap()
            .iter()
            .any(|v| v == "--overwrite-dns=false"));
        assert_eq!(
            route["config"],
            json!({}),
            "setup must not load unrelated default cloudflared configuration"
        );
    }

    #[test]
    fn selected_cloudflare_credentials_cannot_be_overridden_by_ambient_token() {
        let mut h = Harness::new();
        h.cloudflare();
        h.scenario(json!({}));
        h.set("TUNNEL_TOKEN", "ambient-token-for-another-tunnel");
        h.set("TUNNEL_TOKEN_FILE", "/another/tunnel.token");
        h.set("TUNNEL_CRED_CONTENTS", "ambient-credentials");
        let credentials = h.root.path().join("selected-credentials.json");
        private_json(
            &credentials,
            &json!({"TunnelID":"11111111-1111-4111-8111-111111111111"}),
        )
        .unwrap();
        let mut w = workspace(h.root.path());
        w.access = "named".into();
        w.auth = "bearer".into();
        w.public_url = "https://mcp.example.invalid".into();
        w.tunnel_name = "11111111-1111-4111-8111-111111111111".into();
        w.credentials_file = credentials.to_string_lossy().into();
        let state = h.root.path().join("state");
        fs::create_dir(&state).unwrap();
        let (mut process, _) = tunnel::start(&w, &Secrets::initialized(), &state).unwrap();
        process.stop().unwrap();
        let run = h
            .invocations()
            .into_iter()
            .find(|v| v["kind"] == "run")
            .unwrap();
        assert!(
            run["token"].is_null()
                && run["tokenFile"].is_null()
                && run["credentialContents"].is_null(),
            "ambient authentication displaced selected credential file: {run}"
        );
    }

    #[test]
    fn dns_failure_preserves_workspace_and_retry_reuses_created_tunnel() {
        let h = Harness::new();
        h.cloudflare();
        h.scenario(json!({"failFirstRoute":true}));
        let manager = Manager::open(h.home()).unwrap();
        let w = manager
            .save_workspace(workspace(h.root.path()), None)
            .unwrap();
        let before = fs::read(h.home().join("desktop-v2.json")).unwrap();
        assert!(manager
            .setup_named_tunnel(&w.id, "fixture-tunnel", "mcp.example.invalid")
            .is_err());
        assert_eq!(fs::read(h.home().join("desktop-v2.json")).unwrap(), before);
        assert_eq!(manager.snapshot().workspaces[0].access, "local");
        let ready = manager
            .setup_named_tunnel(&w.id, "fixture-tunnel", "mcp.example.invalid")
            .unwrap();
        assert_eq!(ready.access, "named");
        let calls = h.invocations();
        assert_eq!(calls.iter().filter(|v| v["kind"] == "create").count(), 1);
        assert_eq!(calls.iter().filter(|v| v["kind"] == "route").count(), 2);
    }

    #[test]
    fn retry_with_a_different_tunnel_name_cannot_silently_reuse_old_identity() {
        let h = Harness::new();
        h.cloudflare();
        h.scenario(json!({"failFirstRoute":true}));
        fs::create_dir(h.home()).unwrap();
        let w = workspace(h.root.path());
        assert!(tunnel::setup(&w, "first-name", "mcp.example.invalid", &h.home()).is_err());
        let changed = tunnel::setup(&w, "different-name", "mcp.example.invalid", &h.home());
        let names: Vec<_> = h
            .invocations()
            .into_iter()
            .filter(|v| v["kind"] == "create")
            .map(|v| v["name"].as_str().unwrap().to_owned())
            .collect();
        assert!(
            changed.is_err() || names.iter().any(|name| name == "different-name"),
            "successful retry claimed the new tunnel name but reused credentials from first-name"
        );
    }

    #[test]
    fn explicit_workspace_token_survives_environment_isolation_without_entering_arguments() {
        let mut h = Harness::new();
        h.cloudflare();
        h.scenario(json!({}));
        h.set("TUNNEL_TOKEN", "ambient-unrelated-token");
        let mut w = workspace(h.root.path());
        w.access = "named".into();
        w.auth = "bearer".into();
        w.public_url = "https://mcp.example.invalid".into();
        let mut secrets = Secrets::initialized();
        secrets.cloudflare_token = "explicit-workspace-token".into();
        let state = h.root.path().join("state");
        let (mut process, _) = tunnel::start(&w, &secrets, &state).unwrap();
        process.stop().unwrap();
        let run = h
            .invocations()
            .into_iter()
            .find(|v| v["kind"] == "run")
            .unwrap();
        assert_eq!(run["token"], "explicit-workspace-token");
        assert!(!run["arguments"]
            .to_string()
            .contains("explicit-workspace-token"));
        assert_eq!(run["config"], json!({}));
    }

    #[test]
    fn quick_tunnel_cannot_inherit_ad_hoc_named_configuration() {
        let mut h = Harness::new();
        h.cloudflare();
        h.scenario(json!({}));
        h.set("TUNNEL_NAME", "unrequested-tunnel-name");
        let mut w = workspace(h.root.path());
        w.access = "quick".into();
        w.auth = "bearer".into();
        let (mut process, url) =
            tunnel::start(&w, &Secrets::initialized(), &h.root.path().join("state")).unwrap();
        process.stop().unwrap();
        assert_eq!(url, "https://offline-fixture.trycloudflare.com");
        let run = h
            .invocations()
            .into_iter()
            .find(|v| v["kind"] == "run")
            .unwrap();
        assert!(run["name"].is_null());
        assert_eq!(run["config"], json!({}));
    }

    #[test]
    fn resumed_setup_rejects_swapped_credentials_before_routing() {
        let h = Harness::new();
        h.cloudflare();
        h.scenario(json!({}));
        fs::create_dir(h.home()).unwrap();
        let w = workspace(h.root.path());
        let (_, credentials, _) =
            tunnel::setup(&w, "fixture-tunnel", "mcp.example.invalid", &h.home()).unwrap();
        let before = h.invocations().len();
        private_json(
            &credentials,
            &json!({"TunnelID":"22222222-2222-4222-8222-222222222222"}),
        )
        .unwrap();
        assert!(tunnel::setup(&w, "fixture-tunnel", "mcp.example.invalid", &h.home()).is_err());
        assert_eq!(
            h.invocations().len(),
            before,
            "changed credentials must not trigger DNS operations"
        );
    }

    #[test]
    fn legacy_credentials_require_explicit_id_and_can_resume_without_creation() {
        let h = Harness::new();
        h.cloudflare();
        h.scenario(json!({}));
        let w = workspace(h.root.path());
        let id = "11111111-1111-4111-8111-111111111111";
        private_json(
            &h.home().join("tunnels").join(format!("{}.json", w.id)),
            &json!({"TunnelID":id}),
        )
        .unwrap();
        assert!(tunnel::setup(&w, "unverified-name", "mcp.example.invalid", &h.home()).is_err());
        assert!(h.invocations().is_empty());
        let (actual, _, _) = tunnel::setup(&w, id, "mcp.example.invalid", &h.home()).unwrap();
        assert_eq!(actual, id);
        assert_eq!(
            h.invocations()
                .iter()
                .filter(|v| v["kind"] == "create")
                .count(),
            0
        );
    }

    #[test]
    fn recorded_missing_credentials_do_not_recreate_a_remote_tunnel() {
        let h = Harness::new();
        h.cloudflare();
        h.scenario(json!({}));
        fs::create_dir(h.home()).unwrap();
        let w = workspace(h.root.path());
        let (_, credentials, _) =
            tunnel::setup(&w, "fixture-tunnel", "mcp.example.invalid", &h.home()).unwrap();
        fs::remove_file(credentials).unwrap();
        let before = h.invocations().len();
        assert!(tunnel::setup(&w, "fixture-tunnel", "mcp.example.invalid", &h.home()).is_err());
        assert_eq!(h.invocations().len(), before);
    }

    #[test]
    fn invalid_dns_destination_is_rejected_before_creating_a_tunnel() {
        let h = Harness::new();
        h.cloudflare();
        h.scenario(json!({}));
        fs::create_dir(h.home()).unwrap();
        let w = workspace(h.root.path());
        for hostname in [
            "127.0.0.1",
            "localhost",
            "-bad.example.com",
            "bad-.example.com",
            "a..example.com",
        ] {
            assert!(
                tunnel::setup(&w, "fixture-tunnel", hostname, &h.home()).is_err(),
                "invalid DNS destination accepted: {hostname}"
            );
        }
        assert!(
            h.invocations().is_empty(),
            "invalid destination created an unnecessary remote tunnel before DNS validation"
        );
    }

    #[test]
    fn successful_supervised_tunnel_seeds_cleanup_before_a_helper_crash() {
        let h = Harness::new();
        h.cloudflare();
        h.scenario(json!({}));
        let mut w = workspace(h.root.path());
        w.access = "named".into();
        w.auth = "bearer".into();
        w.public_url = "https://mcp.example.invalid".into();
        let mut secrets = Secrets::initialized();
        secrets.cloudflare_token = "offline-explicit-token".into();
        let helper = std::path::Path::new(env!("CARGO_BIN_EXE_desktop-process-supervisor"));
        let (mut process, _) =
            tunnel::start_supervised(&w, &secrets, &h.root.path().join("state"), Some(helper))
                .unwrap();
        let run = h
            .invocations()
            .into_iter()
            .find(|v| v["kind"] == "run")
            .unwrap();
        let target_pid = run["pid"].as_u64().unwrap() as u32;
        struct Cleanup(u32, u64);
        impl Drop for Cleanup {
            fn drop(&mut self) {
                let system = sysinfo::System::new_all();
                if system
                    .process(sysinfo::Pid::from_u32(self.0))
                    .is_some_and(|p| p.start_time() == self.1)
                {
                    unsafe {
                        libc::kill(self.0 as i32, libc::SIGKILL);
                    }
                }
            }
        }
        let system = sysinfo::System::new_all();
        let _cleanup = Cleanup(
            target_pid,
            system
                .process(sysinfo::Pid::from_u32(target_pid))
                .unwrap()
                .start_time(),
        );
        unsafe {
            libc::kill(process.pid() as i32, libc::SIGKILL);
        }
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
        while process.alive() && std::time::Instant::now() < deadline {
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        assert!(!process.alive(), "helper fixture did not exit");
        // Do not sample metrics here: startup itself must have preserved the child.
        process.stop().unwrap();
        let system = sysinfo::System::new_all();
        assert!(
            !system
                .process(sysinfo::Pid::from_u32(target_pid))
                .is_some_and(|p| p.status() != sysinfo::ProcessStatus::Zombie),
            "ready tunnel target survived its helper crash and confirmed stop"
        );
    }
}
