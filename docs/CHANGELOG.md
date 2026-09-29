# Changelog

All notable changes to PrismGit are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.3.3] - 2026-09-29

### Fixed — Search tool: buttons were invisible until hover
- **Every remaining hover-only action button in the Search tool is now always visible** (resting at 60% opacity, full on hover): commit-result rows (open in browser, copy hash), file-result rows (Changes / Diff / Blame / History) and the content group headers (Diff / Blame / History) — v2.3.2 had converted only the «Commit»/«Changes» buttons and the per-match rows; the rest stayed `opacity-0` until the mouse happened to pass over them (found by the user "by accident")
- Verified live on the 20k-commit fixture: all 15 button kinds rest at opacity 0.6 with zero hover-only elements left; the «Commit» blame-lookup jump still lands on History with the file-filter chip
- Guarded by a source-pin test (no `opacity-0` left in the Search page)

## [2.3.2] - 2026-09-29

### Fixed — 3-way merge editor (live-tested on a real conflict)
- **The panes' splitters were dead**: a 1px-wide divider with height 0 inside its sticky wrapper — invisible, ungrabbable (mousedown landed on the neighbouring pane). Now a REAL 6px divider with a visible center grip, ±5px hit area and accent hover; drag verified live (panes resize, headers follow)
- **Pane headers misaligned with the body columns** as soon as a pane was resized (headers were fixed thirds); they now mirror leftPct/rightPct exactly
- The center pane's editing and highlight layers re-verified live on a real conflict fixture (typing, highlight follow, no foreign stripe)

### Added — background fetch PAUSE
- The sidebar's refresh spinner is now a fetch control: click the RUNNING spinner to stop the background fetch cycle; a Play button resumes it. A StatusBar «Фетч» Pause/Play toggle does the same from anywhere
- While paused, every poll cycle is skipped (timer, window-focus resume, initial check); manual «Check now» still works

### Added — VS Code-style panel collapse
- The console now collapses via a chevron in ITS OWN panel header (was: status-bar toggle only, with an ✕); the StatusBar toggle got the matching PanelBottomClose/PanelBottomOpen icons. Left sidebar and the History details pane keep their header-corner chevrons

### Added — Back/Forward remembers tool STATE
- Each history entry carries a snapshot of the global selection (commit, file, branch, tag, path filter). Back/Forward restores it, so returning to History re-selects the commit you were reading; cross-tool jumps mark themselves so the outgoing entry is not polluted with the incoming tool's state

### Added — Search: jump to THE COMMIT that made the change
- Every content hit has a «Коммит» button: blame-lookup finds the commit that introduced the found line, then opens History with that commit selected AND the graph pre-filtered to the file. The Blame/History/Diff buttons are now ALWAYS visible (were hover-only — invisible to the user)

### Added — Settings: favorites are sortable
- Settings → «Сайдбар и навигация» gained an «Избранные инструменты» block: ↑/↓ reorders the sidebar's Favorites section (persisted), ✕ removes an entry; the favorites list moved from Sidebar-local state into a store so Settings and the sidebar share it

### Improved — theme editor zones & text contrast
- Every swatch has a «!» hint explaining WHERE its color lands; hovering a swatch highlights that zone in the live preview
- Text tokens are contrast-checked against the main background: a warning chip with the ratio + a one-click «Читаемо» fix below 4.5:1
- The confusing «Панель» zone renamed to «Панели и консоль» (RU); the preview's button label now uses the same auto-computed readable-on-accent color the compiled theme applies (was the main background color — invisible on light accents)

### Changed — settings rows spacing
- The sidebar-navigation tool rows (and their favorites block) use wider spacing per the «расстояние между строками инструментов» request


## [2.3.1] - 2026-09-29

### Fixed — the «app lags on every tool» report (measured, then fixed)
- **All read-only git commands now execute in the dedicated git worker process** instead of the Electron main loop. The main process is the IPC broker for every renderer call — while it streamed git output, every tool's clicks and refreshes queued behind it. Measured on a 20k-commit/31-branch fixture: opening History blocked the main loop for 119ms on Linux (multiplied ×3-5 on macOS process spawns); after the router, no tool blocks it longer than 2.4ms. In-flight coalescing and the 1s meta TTL are unchanged; vitest keeps the in-process path, so all 2017 tests observe identical behaviour
- **Worker-origin git spawns are reported back to the Operations console** — the command log shows ALL git activity with durations regardless of which process ran it (39 of 47 commands on the fixture ran in the worker)
- `git remote -v` (the slowest command in the History-open burst, 384ms) is now 60s-cached — the remote set only changes through observed git writes
- **PR/Reviews GitLab projectId heal watchdog** backed off: a rejected token or unreachable GitLab used to retry the network every 1.5s for as long as the page was open (~40 requests/minute); failures now double the delay up to 30s, success resets it
- **Bisect page 3s polling** runs only while a bisect is actually in progress (was: every 3s whenever the tool was open)

### Added — Search results navigate to the commit that made the change
- Every content hit (git grep) row gained per-line actions: **Blame at that line** (scrolls to and flash-highlights the found line, shows who introduced it), **History of the file** (pre-filtered to it — «фильтровать сразу по файлу»), and **Diff**; the file-group header carries the full Changes/Diff/Blame/History set
- History-from-Search now filters the graph by the file (path-filter chip) and can pre-select the commit
- One-shot `blameFocusLine` in the selection store powers the focused blame jump (consumed once, cleared on repo switch)

### Added — AI assistant learned the Search and Blame tools
- New `search_code` tool (git grep — the Search tool's content engine) and `blame_file` tool (line-annotated blame grouped into commit blocks) — registered in the chat toolset with selection guidance («кто внёс эту строку?» → blame_file; «где используется X?» → search_code → read_file)

### Fixed — History filters vs. search interplay
- Activating a chip/author/date filter while a text search is active now **clears the search** — the filter operates over ALL commits instead of intersecting with the found subset («нет возможности отфильтровать за все коммиты»)
- Every filter input (History, Branches, Changes) gained a **✕ clear button** + Esc-to-clear — the search no longer feels stuck

### Changed — breathing room in dialogs and settings
- Dialog form groups and settings rows/list rows use wider spacing (space-y-4, taller list rows)


## [2.3.0] - 2026-09-29

### Added — Browser-style Back/Forward navigation
- **Back/Forward buttons in the toolbar** + Alt+Left / Alt+Right keyboard navigation. A dedicated nav-history stack records the user's trail only (app-internal auto-jumps like repo-open are recorded too — they are part of what Back should undo), with forward-tail truncation like a real browser
- Listed in the Keyboard Shortcuts overlay (Navigation group)

### Added — VS Code-style panel collapse
- **Left sidebar** folds into a 48px icon rail (tool icons + live Changes count bubble + theme/settings pinned to the bottom); one click on the expand arrow restores the previous width. Persisted across restarts
- **History commit-details pane** (right sidebar) collapses to a 24px strip so the commit graph takes the full width

### Added — Custom themes + curated theme set
- **Theme picker curated to 6** (Ayu Light, One Dark, Simple, Material, Discord, Light+dark-sidebar) — the 21 other themes are gone; saved picks migrate automatically to their curated replacement
- **Visual Custom Theme editor** («Создать тему…»): 15 color inputs (surfaces, TEXT colors, accent, borders, status colors, sidebar background) + light/dark flag + live pseudo-window preview. Custom themes apply via their own `data-theme="custom-*"` CSS with derived hover/inverse/border shades — text colors change in every tool
- The sidebar-background token is how the «dark sidebar + light main window» look is built (VS Code-style), readable sidebar text computed automatically
- Replaces the raw-JSON «Custom Theme Overrides» textarea (power-user only) — the old settings key is ignored harmlessly

### Added — Hotkeys for every sidebar tool + configurable order
- Every tool now has exactly one hotkey: Ctrl+1..9 (daily drivers) + Alt+1..9 (the rest — previously Alt+1..6 just duplicated Ctrl+1..6)
- **Settings → Interface → «Sidebar & Navigation»**: reorder tools (↑/↓, persisted), reassign any hotkey from a dropdown of free slots ('—' unbinds; a stolen combo bumps its previous owner), reset to defaults
- Hotkeys work from text inputs now (browser-like — Ctrl+number never types a digit)

### Added — Commit context in History
- **«Ветки, содержащие коммит»** — branch badges in the commit detail card (`git branch --contains` + `-r`, cached per SHA); clicking a local badge walks that branch
- **Author click-to-filter** — click the author name in the detail card to filter the graph by that author; a copy button gives «Name <email>» in one click

### Fixed — Counters, take two
- **Branches summary** now shows repo-wide totals (search-filtered counts disagreed with the Tags/Stashes tools while a filter was active)
- **History «С тегами (N)» chip** is computed over the filtered set — with an active text/author/date filter the chip equals exactly what the Tagged filter will show (was: whole-pool count)
- **Repo info dialog** lists local AND remote branch counts separately («Локальные ветки: N / Удалённые: M») — `git branch -r` count added to the stats job
- Dead loaders removed from History (stashes/reflog state loaded on every history refresh for sections that no longer exist — one wasted `git stash list` spawn per refresh)

### Fixed — 401 toast barrage from stale integrations
- A rejected GitHub token (401 Bad credentials) on the Pull Requests page is now an AUTH problem, not a load failure: zero error toasts, the in-page sign-in gate renders, and subsequent mounts early-return (one request per session instead of 3+)
- In-flight/last-key guard on loadPRs — provider detection flipping `loading` twice no longer re-fires the fetch; the Refresh button is the explicit retry (force)

### Changed — Settings de-duplicated and explained
- **Two «External Tools» panels merged into one** (the diff.tool/merge.tool name inputs moved next to the commands they configure)
- **Commit line guides**: the dead numeric inputs (commitLineLimit1/2) removed — the Commands select is the single owner
- **«!» info hitboxes** (hover tooltips) on the settings users actually get confused by: background-check interval + scope, reflog limit, contrast, sidebar & navigation
- Hardcoded EN sub-headers in the AI panel localized (Context size / Tool limits / AI guard)

## [2.2.0] - 2026-09-28

### Added — Every conflicted operation now REACTS
- **Uniform conflict reaction matrix** — pull (merge/rebase/ff-only strategies), merge, rebase, cherry-pick, revert, stash pop/apply, git-flow finish (×4 flows), squash-to-branch, patch 3-way merge and the AI auto-stash pop ALL navigate to the Changes conflict resolver with the in-progress banner («Слияние/Rebase/Применяется» + Continue / Skip / Abort), a Conflicts section and an operation-specific warning toast
- **Git-Flow never continues past a conflict** — finish flows stop at a conflicted merge: no tag, no branch delete, no push while conflicted
- **Stash pop/apply is honest** — simple-git resolves conflicted `git stash pop|apply` as success; a post-op status check now detects the conflicted shape, throws a typed error with `.conflicts`, keeps the stash entry and surfaces the resolver (was: success toast + cleared selection while the tree filled with markers)
- Live-verified: `scripts/verify-conflict-reactions.mjs` — 17/17 checks in the running app (RU)

### Added — Push rejection recovery (remote conflicts)
- **PushRejectionDialog** — pushes that git rejects open a dialog classified by cause, with per-cause recovery: non-fast-forward → «Стянуть и слить» + automatic push retry; stale force-with-lease → fetch + re-lease retry; protected branch → create MR/PR; policy blocks explained. Wired into all push catch sites (toolbar push/sync/Push-To, Changes commit&push, git-flow finish)
- **IPC error filter fixed** — the wrap() in `electron/ipc/git.ts` kept only `error:/fatal:` lines: `! [rejected]` and `remote: GitLab:` lines were STRIPPED before the renderer, so no dialog could ever open. Now rejected]/remote:/hint: lines pass through
- **PR/MR conflict badges** — GitLab `merge_status` / GitHub `mergeable` shown as row badges and in the review header; Merge button disabled with tooltip when unmergeable
- Live-verified: `scripts/verify-push-rejections.mjs` — 16/16 in the running app (non-FF dialog + pull-merge auto-retry, force-with-lease, stale-lease fetch-retry)

### Added — Squash a group of commits to another branch
- Select a commit range in History (or a PR/MR group from Pull Requests/Reviews) and land it on another branch as ONE commit — existing branch or NEW branch, with full conflict handling in the dialog
- Supersedes the old-API squash suite with a conflict-aware one; whole-PR squash E2E kept compatible

### Added — Secrets manager (Settings → Security)
- **Stored secrets section** — every entry of the encrypted vault is listed (metadata only: namespace, name, encrypted flag) grouped by category: access tokens, repository/remote passwords, AI provider keys, GitHub, SSH passphrases
- **Copy / Replace / Delete per entry** — values are never rendered; "copy" reveals a single value straight to the clipboard, "replace" stores a new value, "delete" removes the entry (with confirmation)
- **Add secret** — manually register a secret (token, remote password for a repo path + remote name, etc.) that is stored encrypted from the first byte
- New IPC: `credentials:list` / `credentials:set` / `credentials:delete` / `credentials:reveal`

### Added — Default commit author (Settings → Git)
- **"Default commit author"** (gitUserName / gitUserEmail) in Settings → Project → Git, with "Apply to current repository" button
- New repositories created or cloned with PrismGit automatically get the identity written into their local `user.name` / `user.email` — no more "Please tell me who you are" on the first commit
- `commit()` retries once with the default identity as `-c` overrides when git refuses the commit because no identity is configured anywhere; the error otherwise explains where to set it

### Fixed — Counters (user-visible numbers audit)
- **History «Tagged (N)» chip** — N is now the TAGGED-COMMITS-IN-VIEW count (exactly what the filter shows for the current branch selection); the tooltip carries both numbers (in-view + repo-wide). Was: allTags.length — a tag on a branch outside the view made the chip disagree with the rows
- **Per-commit «Теги на этом коммите (N)»** — counts only the tags pointing at the commit (two tags on one commit → (2), names listed)
- **Branches summary Russian grammar** — new opt-in plural pipe in t(): `{name|one|few|many}` picks a CLDR plural form («1 локальная · 2 локальные · 5 локальных · 6 тегов»); en/zh/de keep plain placeholders and render byte-identically
- **Sidebar follows the startup locale** — nav labels/groups were frozen at module-load time, so a RU profile first launch showed an English sidebar until a manual refresh; NAV_ITEMS is now evaluated per render (sidebar, command palette, help banners)
- Cross-tool counter sync: deleting a tag in Tags updates the History chip immediately
- Live-verified: `scripts/verify-counters.mjs` — 17/17 in the running app vs git CLI ground truth

### Fixed — "Failed to save settings" (gpg.program)
- Repository Settings → Signing could not be saved: simple-git blocks `git config gpg.program` (and other "unsafe" keys) unless `allowUnsafeGpgProgram` is enabled. `configSet` / `configUnset` now detect the plugin rejection and retry the write on an instance with config-write flags enabled — explicit user edits in a GUI client are intent
- The Signing tab no longer writes `gpg.program` unconditionally: empty fields are UNSET from `.git/config` instead of written (also fixes un-cleareable user.signingkey and the dangerous `user.name=""` write that would break every commit with "empty ident name not allowed")

### Fixed — GitLab / PR surfaces
- **Create MR from a GitLab repo now works** — the Pull Requests create dialog called the GitHub REST API even for GitLab repos (guaranteed failure while the README promised «create» for both providers); it is now wired to the long-existing `gitlab:createMergeRequest` IPC — verified live by creating the v2.2.0 release MR through the app
- **GitLab apiJson follows 3xx redirects** — renamed/moved projects (gitclient → prismgit) broke the MR list with silent 404s
- **Pull Requests row actions are visible and understandable** — hover-revealed cryptic icons → always-visible labeled buttons + right-click menu (Open in Reviews / browser / Squash / Copy group)

### Fixed — Install / packaging
- **`make install` survives a local npm mirror 404** — `scripts/npm-install-with-retry.sh` wraps npm install/ci, reads the outcome from npm's own output (tee eats exit codes), and on E404 auto-retries once with `--registry=https://registry.npmjs.org`; EBADENGINE gets a friendly Node-upgrade hint; a killed run can never fake success
- deb-packaging metadata + production-package smoke E2E — packaging that survives real-world machines

### Fixed — Stability
- **Quit watchdog** — close can no longer hang: 3 s hard watchdog, worker children never orphaned
- **Repo switch freeze killed** — status, workdir watch and raw reads run in the git worker; density fix (v3.6)
- **Remote-check fetch storm** — boost loop broken, hung fetches killed, poll decoupled from the foreground queue; remote-status fetch moved to a dedicated utilityProcess
- **Render isolation** — per-keystroke/per-token/per-frame re-renders isolated; the 5 s full-tree re-render storm from status refreshes removed
- **i18n layout** — interface no longer breaks on RU/DE string lengths

### Changed — Performance: slow git operations after LFS problems
- Network commands (fetch / pull / push / ls-remote) no longer run on the shared per-repo simple-git instance (`maxConcurrentProcesses: 2`) that every local operation uses — a slow or hung network command (unreachable LFS-enabled server, credential dialog waiting for input, huge fetch) used to occupy the 2 queue slots and stall ALL git operations of the repository
- All network commands run with `GIT_TERMINAL_PROMPT=0` — an unanswered credential prompt fails fast with a clear error instead of hanging invisibly (matches the push path)

### Changed — Dependencies (all at latest)
- **simple-git 3 → 4** — named-import migration; the new environment guard tamed (`allowEnvironment` contract for GIT_* keys, empirically pinned by probe)
- vite 8.3, vitest 5, @types/node 26, @tauri-apps/* 2.12 (React 19 / Electron 44 / TypeScript 7 / Tailwind 4 were already current)

### Tests
- **1963 passing** (was 1009 at 2.1.0) / 0 failed / 34 environment-dependent skips; tsc clean
- New layers: conflict reaction integration suite (real bare remote, true divergence), push-rejection scenarios (non-FF, stale lease, pre-receive protected emulation), counters E2E, i18n plural engine, squash-to-branch conflict-aware API, enterprise QA perf suite (monster-repo generator, CDP memory/DOM/FPS + zombie audit)
- `tests/integration/gitService.identityConfig.test.ts` — gpg.program set/unset, identity on init, commit fallback, no-identity error message
- `scripts/secrets-smoke.cjs` extended with secrets-manager round-trip checks (list metadata-only, set+reveal, delete)

## [2.1.0] - 2026-09-13

### Added — AI Assistant overhaul
- **12 LLM providers** — OpenAI, Anthropic, Z.ai (GLM-4-Flash free), OpenRouter (free aggregator), Groq (ultra-fast), Cerebras (1M free tokens/day), Google Gemini, Hugging Face, Mistral, GitHub Models, Ollama (local), Custom
- **Conversation memory** — AI remembers previous messages in the same chat session (priorHistory parameter)
- **Context compression** — old messages auto-compressed into a summary when history exceeds 20 messages, keeping the context window manageable
- **Token usage display** — shows input/output/context token counts after each LLM response; warns when context > 50K tokens
- **Stop button** — aborts the in-flight LLM call instantly via AbortSignal + Promise.race
- **LM Studio-style model picker** for Ollama — search, metadata (params, size, quantization, family), "loaded" badge via /api/ps, keep-alive via /api/generate
- **Provider presets** — auto-fills URL + model + API-key hint when selecting a provider
- **AI tools: discard_changes, sync_with_remote, abort_operation** — atomic stash+pull+pop, reset to origin, abort merge/rebase
- **Pull with auto-stash** — `pull --rebase` with automatic stash/unstash
- **get_log collapsed by default** — summary + last 5 commits; verbose=true for full list
- **get_status summary mode** — counts by category + first 10 files; verbose=true for full list
- **get_diff stat mode** — file names + line counts by default; full=true for content
- **Export chat log** as Markdown — full conversation for debugging/sharing
- **Markdown rendering** in assistant answers — code blocks, inline code, bold, lists
- **Copy buttons** on tool results and assistant messages
- **Tool results collapsed by default** — expandable with chevron + line-count badge
- **Starter prompt chips** — one-click common questions ("What changed?", "Pull latest", etc.)
- **Configurable AI request timeout** (default 300s) in Settings → AI
- **Streaming AI responses** (SSE parser for OpenAI/Anthropic/Ollama)
- **AI Branch Name Suggester** in New Branch dialog

### Added — History page
- **Lazy-loading commits** — infinite scroll, no hard cap, reach the first commit
- **Head+Upstream default filter** — shows only current branch + origin (was --all)
- **Sync indicator** — PlugZap icon when in sync, ArrowUp/Down when ahead/behind
- **Faster first paint** — PAGE_SIZE=50, parallel rev-list, non-blocking incoming-hash computation

### Added — Changes page
- **Instant file grid on folder switch** — scroll reset + fixed useMemo deps
- **Instant right-click context menu** — default index flags, no IPC wait
- **Diff tool async read + 1.5s cache** — parallel git show + fs.promises.readFile
- **Auto-stash pull** — stash → pull --rebase → pop (no "unstaged changes" error)

### Added — Tour / Onboarding
- **Tour "Don't show again" checkbox** — persists to settings store (survives localStorage wipes)
- **Configurable AI request timeout** — 300s default, user-adjustable

### Added — i18n
- **2 new domains**: toasts (110 keys) + actions (50 keys) — ~140 hardcoded strings localized
- **4 locales**: English, Russian, Chinese, German — full parity

### Fixed
- **Tour re-shows on every launch** — flag now persisted in settings store, not just localStorage
- **'no submodule mapping found' console spam** — git:raw IPC filters benign errors
- **Diff tool slow on large files** — async readFile + 1MB cap + 1.5s cache
- **History limited to 500 commits** — now lazy-loads indefinitely
- **Right-click context menu slow** — show menu immediately with default flags
- **'Detecting renames...' spinner** — removed; detection runs silently in background
- **File grid stale on folder switch** — scroll reset + fixed useMemo deps

### Performance
- **Diff cache** — 1.5s LRU cache (64 entries) on git diff results
- **History PAGE_SIZE** reduced from 100→50 for faster first paint
- **Submodule count** via `git config --file .gitmodules` instead of `git submodule status`
- **Context menu** — 10s LRU cache on index flags + instant menu with defaults

## [2.0.1] - 2026-09-13

### Fixed
- **History/Reflog вечный рефреш** — watcher → lastRefresh → loadHistory loop
- **tauri.conf.json** — removed `digestHashingAlgorithm` (Tauri v2 schema violation)
- **CSP** — added sha256 hash for inline boot-screen script
- **Merge in progress** — `blockedByRepoState` with inline Abort button
- **Tags in History** — RefBadges max=5 + "Tagged" quick-filter chip
- **E0255** — moved `#[tauri::command]` functions to `commands` submodule (tauri-apps/tauri#10340 workaround)
- **notify v6 API** — `notify::recommended()` → `RecommendedWatcher::new()`
- **tauri-plugin-dialog v2.7** — `.blocking_confirm()` → `.show(callback)` + mpsc channel
- **Missing icons** — created 32×32 / 128×128 / 256×256 / 512×512 PNG + ICO
- **CSS comment** — PostCSS parser broke on backtick with `*/` in globals.css
- **`require('electron')`** — replaced with preload bridge for Vite ESM compatibility
- **operationLogStore dynamic/static import mismatch** — converted to static import
- **FsEventWatcher** — replaced with `RecommendedWatcher` in WatcherState struct

### Added
- **PR search filter** — title / #number / head/base branch / author
- **Tauri parity: 41 git methods** — add/commit/push/pull/fetch/checkout/branch/remote/reset/diff/commitFiles/trackedFiles/settings
- **Bundle optimization** — lazy-load 8 rarely-used components (CommandPalette, GlobalSearch, AiAssistant, TourOverlay, KeyboardShortcutsOverlay, RefActionDialog, FindObjectDialog, CommandLogPanel)
- **manualChunks** — tauri-vendor, git-utils (shared diffParser+gitGraph)
- **DataGrid in RecyclablePage** — sortable + resizable columns

### Changed
- Main bundle: 726 KB → 672 KB (-7.4%, gzip 218 → 203 KB)
- Tauri coverage: 11 → 41 git API methods

## [4.1.0] - 2026-09-09

### Added
- **Annotate view** — inline commit annotations with overlap analysis (SmartGit 24)
- **Distributed Reviews** — offline code review stored in git notes (SmartGit add-on)
  - Add/delete/resolve comments per commit
  - Severity levels: info, suggestion, warning, critical
  - Push/fetch reviews to share with team
- **Smart Views** — preset filters for Graph (All, Current Branch, My Commits, Recent 7d, Unpushed, Merged, Tagged)
- **Overlap Column** — visualization of related commits by shared files
- **Test suite** — 161 tests with Vitest + Testing Library
  - Unit tests: utils, gitflow, conflictParser, diffParser, languageDetection, stores
  - Integration tests: gitService with mocked simple-git
  - Component tests: DiffViewer, ToastContainer, WelcomeScreen
- **Documentation** — README, ARCHITECTURE.md, API.md, CONTRIBUTING.md, CHANGELOG.md, TESTING.md
- `make test`, `make test:watch`, `make test:coverage` targets

### Changed
- README rewritten with comprehensive feature list and links to docs
- Coverage thresholds configured (60% statements, 50% branches)

## [4.0.0] - 2026-09-09

### Added — P0 (Critical)
- **File Watcher** — auto-refresh Git status on `.git/HEAD`, `index`, `MERGE_HEAD`, `refs/` changes
- **Window State Persistence** — saves position, size, maximized, fullscreen state
- **Context Menus** — native right-click menus via Electron Menu API
- **Diff Viewer Rewrite** — side-by-side (split) view, Apply Selection, syntax highlighting (10 languages)
- **Conflict Solver Fix** — uses `git show :1/:2/:3` for real 3-way merge, 4 layout modes

### Added — P1 (Important)
- **Pull Request UI** — list open/closed/all, create PR, open in browser
- **Split Commit** — interactive rebase with edit action
- **Search/Filter in Changes** — file path filter
- **Stage/Unstage Lines** — `git:stageLines` / `git:unstageLines` IPC

### Added — P2 (Polish)
- **Three Window Styles** — Standard, Log, Working Tree (Ctrl+Shift+1/2/3)
- **Drag & Drop** — files between staged/unstaged sections
- **External Tools Config** — diff/merge tool commands with $LOCAL/$REMOTE/$BASE/$MERGED
- **Git LFS Support** — install, pull, push, fetch, track, list
- **Spell Check** — native spellcheck in commit message

## [3.1.0] - 2026-09-09

### Added
- **Git-Flow** — Feature/Release/Hotfix with start/finish workflows
- **Interactive Rebase Editor** — visual todo with pick/reword/edit/squash/fixup/drop
- **Conflict Solver** — 3-pane view (Ours/Working/Theirs)
- **Makefile** — 25+ targets for dev, build, test, docker, clean

## [3.0.0] - 2026-09-09

### Added
- **Docker multi-platform builds** — Linux, Windows (via Wine), macOS
- **Two themes** — Ayu Dark (default) and Ayu Light (Ollama-code palette)
- **Investigate** — file history with rename following
- **Journal** — operation history with filters
- **Find Object** — search branch/tag/remote refs (Ctrl+F)
- **Tolerant Clone URL** — strips "git clone " prefix, auto-derives folder name

## [2.0.0] - 2026-09-09

### Changed — Lightweight Optimizations
- Removed: lucide-react (~1MB), monaco-editor (~40MB), @electron/remote, diff library
- Added: custom SVG icons.tsx (15KB, tree-shakeable)
- All pages lazy-loaded via React.lazy + Suspense
- Main bundle reduced from 294KB to 211KB (-30%)

### Added
- **Ollama-code design** — Ayu Dark palette
- **RebasePanel** — auto-shows during rebase with conflict list
- **MergePanel** — merge with options and conflict resolution
- Auto-refresh status every 30s
- `prefers-reduced-motion` support

## [1.0.0] - 2026-09-09

### Added
- Initial release
- Electron 32 + React 18 + TypeScript 5.6 + Vite 5
- 13 pages: Changes, History, Blame, Branches, Tags, Stashes, Submodules, Worktrees, Reflog, Settings
- Git operations via simple-git: status, add, commit, push, pull, fetch, log, branches, merge, diff, stash, tags, submodules, clone, init
- Cherry Pick, Revert, Edit Commit Message, Reset
- Repository state detection: Merge, Rebase, Cherry-Pick, Revert, Bisect
- GitHub integration: PAT auth, repository browser
- Cross-platform: Windows, macOS, Linux
