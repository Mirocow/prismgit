// PrismGit — Tauri backend (Rust).
//
// This module is the Tauri counterpart of the Electron main process
// (electron/main.ts + electron/services/*.ts). It exposes the same set
// of high-level Git operations as IPC commands, so the React frontend
// can call them via `invoke('git_status', { repoPath: '/path' })`.
//
// Two execution models are supported by this single backend:
//
//   Path A (default — CLI invocation):
//     Spawn `git -C <repo> <args>` via std::process::Command, capture
//     stdout/stderr/exit code. This is the simplest model and matches
//     what the Electron version did via simple-git. No git binary
//     installation required beyond what's already on the user's PATH.
//
//   Path B (optional — native libgit2):
//     Enable the `git2` feature in Cargo.toml. Faster (no process
//     spawn), but requires libgit2 system library at build time.
//     Recommended for power users with large repos (>50k commits).
//
// File watching (replaces chokidar):
//   The `watch_repo` command starts a `notify` watcher on the given path
//   and emits a `repo:changed` event to the frontend on every file
//   modification. The watcher runs on a background thread.

use std::process::Command;
use std::sync::Mutex;
use std::path::Path;
use tauri::{Emitter, State};
use notify::{Watcher, RecursiveMode, RecommendedWatcher, Config};

/// Result of a git CLI invocation — serialised to JSON for IPC.
#[derive(serde::Serialize)]
pub struct GitCommandResult {
    pub ok: bool,
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
}

/// Run an arbitrary git command in the given repo.
/// Mirrors `api.git.raw(repoPath, args)` from the Electron version.
#[tauri::command]
pub fn git_raw(repo_path: String, args: Vec<String>) -> Result<GitCommandResult, String> {
    let mut cmd = Command::new("git");
    cmd.arg("-C").arg(&repo_path).args(&args);
    let output = cmd.output().map_err(|e| format!("git spawn failed: {}", e))?;
    let exit_code = output.status.code().unwrap_or(-1);
    let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
    let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
    let ok = output.status.success();
    Ok(GitCommandResult { ok, stdout, stderr, exit_code })
}

/// Run `git status --porcelain=v1 --branch` in the given repo and
/// return the raw porcelain output. The frontend parses this into the
/// same StatusResult shape the Electron version returns.
#[tauri::command]
pub fn git_status(repo_path: String) -> Result<GitCommandResult, String> {
    git_raw(repo_path, vec![
        "status".to_string(),
        "--porcelain=v1".to_string(),
        "--branch".to_string(),
        "-z".to_string(), // null-terminated entries (handles spaces in paths)
    ])
}

/// List local + remote branches.
#[tauri::command]
pub fn git_branches(repo_path: String) -> Result<GitCommandResult, String> {
    git_raw(repo_path, vec![
        "branch".to_string(),
        "--list".to_string(),
        "--all".to_string(),
        "--format=%(HEAD)%00%(refname:short)%00%(upstream:short)%00%(objectname:short)%00%(committerdate:short)".to_string(),
    ])
}

/// List tags.
#[tauri::command]
pub fn git_tags(repo_path: String) -> Result<GitCommandResult, String> {
    git_raw(repo_path, vec![
        "tag".to_string(),
        "--list".to_string(),
        "--format=%(refname:short)%00%(objectname:short)%00%(taggerdate:short)".to_string(),
    ])
}

/// List stashes.
#[tauri::command]
pub fn git_stash_list(repo_path: String) -> Result<GitCommandResult, String> {
    git_raw(repo_path, vec![
        "stash".to_string(),
        "list".to_string(),
        "--format=%gd%x00%H%x00%s%x00%cr".to_string(),
    ])
}

/// Commit log (graph format).
#[tauri::command]
pub fn git_log(repo_path: String, max_count: Option<u32>) -> Result<GitCommandResult, String> {
    let mut args = vec![
        "log".to_string(),
        "--format=%H%x00%h%x00%s%x00%an%x00%ae%x00%ad%x00%cn%x00%ce%x00%cd%x00%D".to_string(),
        "--date=iso8601".to_string(),
    ];
    if let Some(n) = max_count {
        args.push(format!("--max-count={}", n));
    }
    git_raw(repo_path, args)
}

/// Reflog.
#[tauri::command]
pub fn git_reflog(repo_path: String, ref_name: Option<String>, max_count: Option<u32>) -> Result<GitCommandResult, String> {
    let mut args = vec!["reflog".to_string()];
    if let Some(r) = ref_name { args.push(r); }
    if let Some(n) = max_count {
        args.push(format!("--max-count={}", n));
    }
    args.push("--format=%H%x00%gd%x00%gs%x00%cr".to_string());
    git_raw(repo_path, args)
}

/// File watcher state — one per-repo. Replaces chokidar from Electron.
#[derive(Default)]
pub struct WatcherState {
    pub watcher: Mutex<Option<FsEventWatcher>>,
}

/// Start watching a repo's working tree for file changes.
/// Emits a `repo:changed` event to all frontend windows on every
/// filesystem modification.
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
                // Emit a global event — the frontend's useFileWatcher
                // hook subscribes via `listen('repo:changed', ...)`.
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

/// Stop watching the repo.
#[tauri::command]
pub fn unwatch_repo(state: State<'_, WatcherState>) -> Result<(), String> {
    let mut guard = state.watcher.lock().map_err(|e| e.to_string())?;
    *guard = None;
    Ok(())
}

/// Open a native folder picker. Returns the selected path or null.
#[tauri::command]
pub async fn open_repo_picker(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let folder = app.dialog().file().blocking_pick_folder();
    Ok(folder.map(|f| f.to_string()))
}

/// Show a confirmation dialog (yes/no). Returns true if confirmed.
#[tauri::command]
pub async fn confirm_dialog(
    app: tauri::AppHandle,
    title: String,
    message: String,
) -> Result<bool, String> {
    use tauri_plugin_dialog::DialogExt;
    let confirmed = app.dialog()
        .message(message)
        .title(title)
        .show()
        .await;
    Ok(confirmed)
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
            git_raw,
            git_status,
            git_branches,
            git_tags,
            git_stash_list,
            git_log,
            git_reflog,
            watch_repo,
            unwatch_repo,
            open_repo_picker,
            confirm_dialog,
        ])
        .setup(|_app| {
            log::info!("PrismGit (Tauri) backend started");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running PrismGit Tauri application");
}
