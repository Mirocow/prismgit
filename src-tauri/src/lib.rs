// PrismGit — Tauri backend (Rust).
//
// Exposes Git operations as IPC commands callable from the React frontend
// via `invoke('git_status', { repoPath: '/path' })`.
//
// Architecture: all git operations shell out to `git -C <repo> <args>` via
// std::process::Command — matches the Electron version's simple-git approach.
//
// File watching (replaces chokidar): `watch_repo` starts a `notify` watcher
// and emits a `repo:changed` event to the frontend on every filesystem change.

use std::sync::Mutex;
use notify::RecommendedWatcher;

/// Result of a git CLI invocation — serialised to JSON for IPC.
#[derive(serde::Serialize)]
pub struct GitCommandResult {
    pub ok: bool,
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
}

/// File watcher state — one per-repo. Replaces chokidar from Electron.
#[derive(Default)]
pub struct WatcherState {
    pub watcher: Mutex<Option<RecommendedWatcher>>,
}

// ============================================================================
// Commands module — wrapping #[tauri::command] functions in a submodule
// works around the E0255 "__cmd__<name> defined multiple times" proc-macro
// bug (tauri-apps/tauri#10340). The macro generates a hidden __cmd__<name>
// macro for each command; keeping them in a separate scope prevents
// re-import conflicts at the crate root.
// ============================================================================
mod commands {
    use super::{GitCommandResult, WatcherState};
    use std::process::Command;
    use std::path::Path;
    use std::sync::mpsc;
    use tauri::{Emitter, State};
    use notify::{Watcher, RecursiveMode, RecommendedWatcher, Config};

    /// Run an arbitrary git command in the given repo.
    pub fn git_raw_impl(repo_path: String, args: Vec<String>) -> Result<GitCommandResult, String> {
        let mut cmd = Command::new("git");
        cmd.arg("-C").arg(&repo_path).args(&args);
        let output = cmd.output().map_err(|e| format!("git spawn failed: {}", e))?;
        let exit_code = output.status.code().unwrap_or(-1);
        let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
        let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
        let ok = output.status.success();
        Ok(GitCommandResult { ok, stdout, stderr, exit_code })
    }

    #[tauri::command]
    pub fn git_raw(repo_path: String, args: Vec<String>) -> Result<GitCommandResult, String> {
        git_raw_impl(repo_path, args)
    }

    #[tauri::command]
    pub fn git_status(repo_path: String) -> Result<GitCommandResult, String> {
        git_raw_impl(repo_path, vec![
            "status".into(),
            "--porcelain=v1".into(),
            "--branch".into(),
            "--untracked-files=all".into(),
        ])
    }

    #[tauri::command]
    pub fn git_branches(repo_path: String) -> Result<GitCommandResult, String> {
        let format = "%(refname)\x1f%(refname:short)\x1f%(upstream:short)\x1f%(objectname:short)\x1f%(committerdate:iso)";
        git_raw_impl(repo_path, vec![
            "for-each-ref".into(),
            format!("--format={}", format),
            "refs/heads".into(),
            "refs/remotes".into(),
        ])
    }

    #[tauri::command]
    pub fn git_tags(repo_path: String) -> Result<GitCommandResult, String> {
        let format = "%(refname:short)%x00%(objectname:short)%x00(*objectname:short)%x00%(creatordate:iso)";
        git_raw_impl(repo_path, vec![
            "for-each-ref".into(),
            "--sort=-creatordate".into(),
            format!("--format={}", format),
            "refs/tags".into(),
        ])
    }

    #[tauri::command]
    pub fn git_stash_list(repo_path: String) -> Result<GitCommandResult, String> {
        let format = "%H%x00%gs%x00%cr";
        git_raw_impl(repo_path, vec![
            "stash".into(),
            "list".into(),
            format!("--format={}", format),
        ])
    }

    #[tauri::command]
    pub fn git_log(repo_path: String, max_count: Option<u32>) -> Result<GitCommandResult, String> {
        let n = max_count.unwrap_or(500);
        let format = "%H%x00%h%x00%s%x00%an%x00%ae%x00%aI%x00%cn%x00%ce%x00%cI%x00%b%x00%D";
        git_raw_impl(repo_path, vec![
            "log".into(),
            format!("-{}", n),
            format!("--pretty=format:{}", format),
            "--date=iso-strict".into(),
            "--decorate=full".into(),
            "--topo-order".into(),
        ])
    }

    #[tauri::command]
    pub fn git_reflog(
        repo_path: String,
        ref_name: Option<String>,
        max_count: Option<u32>,
    ) -> Result<GitCommandResult, String> {
        let n = max_count.unwrap_or(500);
        let mut args = vec![
            "reflog".into(),
            format!("-{}", n),
            "--format=%H%x00%gd%x00%gs%x00%cr".into(),
        ];
        if let Some(r) = ref_name {
            args.push(r);
        }
        git_raw_impl(repo_path, args)
    }

    #[tauri::command]
    pub fn watch_repo(
        repo_path: String,
        app: tauri::AppHandle,
        state: State<'_, WatcherState>,
    ) -> Result<(), String> {
        // Stop any existing watcher.
        {
            let mut guard = state.watcher.lock().map_err(|e| e.to_string())?;
            if guard.is_some() { *guard = None; }
        }

        let app_handle = app.clone();
        let path_to_watch = Path::new(&repo_path).join(".git");
        let path_str = path_to_watch.to_string_lossy().to_string();

        let mut watcher: RecommendedWatcher = RecommendedWatcher::new(
            move |res: notify::Result<notify::Event>| {
                if let Ok(_event) = res {
                    let _ = app_handle.emit("repo:changed", &path_str);
                }
            },
            Config::default(),
        ).map_err(|e| format!("notify init failed: {}", e))?;

        watcher
            .watch(Path::new(&repo_path), RecursiveMode::Recursive)
            .map_err(|e| format!("notify watch failed: {}", e))?;

        let mut guard = state.watcher.lock().map_err(|e| e.to_string())?;
        *guard = Some(watcher);
        Ok(())
    }

    #[tauri::command]
    pub fn unwatch_repo(state: State<'_, WatcherState>) -> Result<(), String> {
        let mut guard = state.watcher.lock().map_err(|e| e.to_string())?;
        *guard = None;
        Ok(())
    }

    #[tauri::command]
    pub async fn open_repo_picker(app: tauri::AppHandle) -> Result<Option<String>, String> {
        use tauri_plugin_dialog::DialogExt;
        let folder = app.dialog().file().blocking_pick_folder();
        Ok(folder.map(|f| f.to_string()))
    }

    /// Show a confirmation dialog (yes/no). Returns true if confirmed.
    ///
    /// tauri-plugin-dialog v2.7+ `.show()` takes a callback (FnOnce(bool))
    /// rather than returning a Future. We block on the callback via a channel.
    #[tauri::command]
    pub fn confirm_dialog(
        app: tauri::AppHandle,
        title: String,
        message: String,
    ) -> Result<bool, String> {
        use tauri_plugin_dialog::DialogExt;
        let (tx, rx) = mpsc::channel();
        app.dialog()
            .message(message)
            .title(title)
            .show(move |ok| {
                let _ = tx.send(ok);
            });
        rx.recv().map_err(|e| format!("dialog channel closed: {}", e))
    }
}

/// Tauri app entry point.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialize logging (RUST_LOG=info for verbose output).
    let _ = env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("warn"))
        .try_init();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(WatcherState::default())
        .invoke_handler(tauri::generate_handler![
            commands::git_raw,
            commands::git_status,
            commands::git_branches,
            commands::git_tags,
            commands::git_stash_list,
            commands::git_log,
            commands::git_reflog,
            commands::watch_repo,
            commands::unwatch_repo,
            commands::open_repo_picker,
            commands::confirm_dialog,
        ])
        .setup(|_app| {
            log::info!("PrismGit (Tauri) backend started");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running PrismGit Tauri application");
}
