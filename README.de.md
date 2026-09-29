# PrismGit

[English](README.md) | [Русский](README.ru.md) | [中文](README.zh.md) | **Deutsch**

Ein moderner, plattformübergreifender Git-Client auf Basis von Electron + React + TypeScript, inspiriert von SmartGit 20–24, mit dem **Ollama-code**-Design (Ayu Dark/Light-Paletten).

![PrismGit — Verlauf, Ayu Dark](docs/screenshots/history-dark.png)

[![Version](https://img.shields.io/badge/version-2.2.0-blue)](#) [![Tests](https://img.shields.io/badge/tests-1963%20passing-brightgreen)](tests/) [![Lizenz](https://img.shields.io/badge/license-MIT-green)](LICENSE) [![KI](https://img.shields.io/badge/KI%20Assistent-12%20Anbieter-purple)](#) [![Sprachen](https://img.shields.io/badge/Sprachen-EN%20%7C%20RU%20%7C%20ZH%20%7C%20DE-orange)](#)

## Schnellstart

```bash
# Klonen und installieren
git clone <repo-url>
cd prismgit-electron
make install        # übersteht eine 404 des lokalen npm-Mirrors — automatischer Wiederholungsversuch über registry.npmjs.org

# Entwicklung
make dev

# Build für die aktuelle Plattform
make package

# Tests ausführen
make test

# Plattformübergreifender Build über Docker
make docker-all
```

## Screenshots

| | |
|:---:|:---:|
| ![Verlauf](docs/screenshots/history-dark.png) | ![Änderungen](docs/screenshots/changes-dark.png) |
| **Verlauf** — Graph aller Branches, Lazy Loading, Filter | **Änderungen** — Staged/Unstaged-Gruppen, Drag & Drop |
| ![Branches](docs/screenshots/branches.png) | ![Pull Requests](docs/screenshots/pulls.png) |
| **Branches** — lokal/remote, Sync-Indikatoren | **Pull Requests** — GitHub PRs + GitLab MRs |
| ![Reviews](docs/screenshots/reviews.png) | ![KI-Assistent](docs/screenshots/ai-chat.png) |
| **Reviews** — 4-Tabige Code-Review-Oberfläche | **KI-Assistent** — 12+ Anbieter, 24+ Git-Tools |
| ![Einstellungen](docs/screenshots/settings.png) | ![Verlauf — Hell](docs/screenshots/history-light.png) |
| **Einstellungen** — 20+ Themes, 4 Sprachen | **Verlauf — Helles Theme** (Ayu Light) |

## Neu in 2.2.0

- **Jede konfliktbehaftete Operation REAGIERT jetzt** — Pull (Merge/Rebase/ff-only), Merge, Rebase, Cherry-Pick, Revert, Stash Pop/Apply, Git-Flow-Finish, Squash-to-Branch und 3-Way-Patch springen in den Konfliktlöser mit Banner für die laufende Operation (Fortsetzen / Überspringen / Abbrechen) und passender Warnung. Git-Flow setzt NIE über einen Konflikt hinweg fort; Stash Pop meldet keinen Scheinerfolg mehr.
- **Wiederherstellung nach Push-Ablehnung** — Non-Fast-Forward, veralteter Force-with-Lease, geschützte Branches und Richtlinien-Ablehnungen öffnen einen nach Ursache klassifizierten Dialog: «Pullen und mergen» (+ automatischer Push-Wiederholungsversuch), Force-with-Lease, «Fetch und wiederholen», Merge Request erstellen. PR/MR-Listen zeigen Konflikt-Badges des Providers.
- **Eine Gruppe von Commits auf einen anderen Branch squashen** — aus dem Verlauf oder aus Pull Requests/Reviews, auf einen bestehenden oder NEUEN Branch, konfliktbewusst.
- **Zähler-Audit** — Der «Tagged (N)»-Chip im Verlauf zählt jetzt die markierten Commits *in der Ansicht* (genau das, was der Filter zeigt), Commit-Tag-Zähler sind exakt, die Branches-Zusammenfassung dekliniert korrekt auf Russisch (`1 локальная · 2 локальные · 5 локальных`), die Seitenleiste folgt der beim Start wiederhergestellten Sprache.
- **Secrets-Manager** (Einstellungen → Sicherheit) — Auflisten/Kopieren/Ersetzen/Löschen jedes verschlüsselten Tresor-Eintrags, nur Metadaten.
- **Alle Abhängigkeiten aktuell** — simple-git 4, Vite 8, Vitest 5, Tailwind 4, React 19, Electron 44 — plus ein `make install`, das eine 404 des lokalen npm-Mirrors selbst heilt.
- **Leistung & Stabilität** — 3 s Watchdog beim Beenden ohne Waisenprozesse, Repo-Wechsel und Status-Refresh im Git-Worker, Rendering-Isolation auf Tastenschlagebene, deb-Paketierung + produktiver Smoke-E2E.

Vollständige Historie: [docs/CHANGELOG.de.md](docs/CHANGELOG.de.md)

## Funktionen

### Working Tree
- **Änderungen** — Stagen/Entstagen/Wiederherstellen/Ignorieren/Löschen/Anzeigen mit Drag & Drop; konfigurierbares Commit-Journal (`git log -N`-Rhythmus und -Anzahl in den Einstellungen)
- **Diff** — Lazy Loading mit 20-Einträge-LRU-Cache, 150 ms Debounce, editierbar (im externen Editor öffnen → zum Stagen anbieten)
- **Verlauf** — Commit-Log mit Graph-Visualisierung, Suche, Dateibaum pro Commit, Autor/Datum/Pfad-Filter, Multi-Branch-Auswahl, Filter für markierte Commits
- **Annotate** — Inline-Annotationen mit Überlappungsanalyse (SmartGit 24)
- **Investigate** — Dateihistorie mit Verfolgung von Umbenennungen
- **Blame** — Zeilenweise Autorenschaft mit Commit-Farben

### Konfliktbehandlung
- **Konfliktlöser** — 3-Panel-Ansicht (Base | Ours | Theirs) mit 4 Layouts; Ours/Theirs pro Datei übernehmen; editierbares Mittelfeld
- **Einheitliche Konflikt-Reaktionsmatrix** — JEDE konfliktbehaftete Operation (Pull Merge/Rebase, Merge, Rebase, Cherry-Pick, Revert, Stash Pop/Apply, Git-Flow-Finish, Squash-to-Branch, 3-Way-Patch, KI-Auto-Stash-Pop) navigiert zum Löser mit Banner (Fortsetzen/Überspringen/Abbrechen) + Konfliktbereich + operationsspezifischem Toast
- **Push-Ablehnungs-Dialog** — Non-Fast-Forward → «Pullen und mergen» + automatischer Push-Wiederholungsversuch; veralteter Lease → Fetch + Wiederholung; geschützter Branch → MR/PR erstellen; Richtlinien-Blockaden mit Erklärung
- **PR/MR-Konflikt-Badges** — GitLab `merge_status` / GitHub `mergeable` in Listen und Review-Kopf; Merge-Button bei Nicht-Mergbarkeit deaktiviert mit Tooltip
- **Ehrliche Push-Verifikation** — Post-Push-`ls-remote`-Prüfung entlarvt stille serverseitige Ablehnungen (Hooks, Proxies, falscher Branch)

### Workflows
- **Git-Flow** — Feature/Release/Hotfix/Fix/Support mit Start/Finish-Workflows; AVH-artige Präfix-Konfiguration; Init-Banner; Finish-Flows stoppen bei einem Konflikt-Merge (nie taggen/löschen/pushen über einen Konflikt hinweg)
- **Pull Requests** — einheitliche GitHub-PR- + GitLab-MR-Verwaltung (Liste, Erstellen, Öffnen, Genehmigen, Mergen, Schließen); beschriftete Zeilen-Aktionen + Rechtsklick-Menü; Gruppen-Squash auf einen Branch
- **Reviews** — vollständige Code-Review-Oberfläche für den ausgewählten PR/MR mit 4 Tabs:
  - **Übersicht** — Beschreibung (Markdown), Zusammenfassung (Dateien/Commits/Kommentare)
  - **Commits** — Commit-Liste des PRs: SHA, Nachricht, Autor, Datum
  - **Dateien** — geänderte Dateien mit Status-Badges, +/- Zählern, Unified-Diff-Viewer
  - **Diskussion** — Kommentare im Issue-Stil + Eingabefeld (Cmd/Ctrl+Enter zum Posten)
- **Verteilte Reviews** — Offline-Code-Review in Git-Notes (`refs/notes/reviews`), Push/Fetch für Team-Sharing
- **Squash auf Branch** — wählen Sie eine Commit-Gruppe im Verlauf (oder einen PR) und landen Sie sie als EINEM Commit auf einem anderen Branch — bestehend oder neu, konfliktbewusst

### Provider-Integration
- **Einheitlicher Provider-Store** — eine gemeinsame Auswahl zwischen Pull Requests und Reviews
- **GitHub** — PAT-Authentifizierung, Liste/Erstellen/Mergen/Schließen von PRs, PR-Details/Dateien/Commits/Kommentare
- **GitLab** — PAT (Cloud + self-hosted), Liste/Erstellen/Mergen von MRs, Details/Änderungen/Notizen/Commits; direkte Projekt-Auflösung über path_with_namespace; folgt 3xx-Redirects (umbenannte Projekte)
- **Provider-Chip** — Dropdown-Umschalter in Seiten-Köpfen (KI-Assistent-Stil); Auto-Erkennung über die Remote-URL; manuelle Überschreibung bleibt erhalten
- **API-Aufruf-Logging** — alle GitHub/GitLab-HTTP-Anfragen im Output-Panel sichtbar: Methode, Pfad, Statuscode, Dauer

### Refs
- **Branches** — lokal/remote, Checkout, Erstellen, Umbenennen, Löschen, Mergen, Push; Warn-Indikatoren (gone, nur lokal, dirty); Branch auf einen anderen ziehen zum Mergen
- **Tags** — annotated/lightweight, Erstellen, Löschen, Push; Gruppierung per RegEx; vollständige Tag-Verwaltung AN einem Commit — Erstellen, Löschen UND Bearbeiten, verlustfrei
- **Remotes** — Hinzufügen/Entfernen/Bearbeiten, Credential-Verwaltung, optionaler Hintergrund-Fetch pro Remote
- **Worktrees** — Hinzufügen, Entfernen, Aufräumen (aus dem Branch-Kontextmenü)
- **Reflog** — Anzeigen, Einträge löschen, Cherry-Pick/Reset-Aktionen, Filter nach Aktionstyp
- **Stashes** — Push, Pop, Apply, Drop, Branch, Umbenennen; Pop/Apply-Konflikte öffnen den Löser (der Stash bleibt erhalten)
- **Submodules** — Init, Update, Sync, Deinit, Add
- **Git LFS** — Install, Pull, Push, Fetch, Track, List, Lock/Unlock, Fsck, Untrack
- **Wiederherstellbar** — unerreichbare Commits vor Ablauf (90 Tage) wiederherstellen

### SmartGit-24-Funktionen
- **Interaktives Rebase** — visueller Todo-Editor (Pick/Reword/Edit/Squash/Fixup/Drop)
- **Konfliktlöser** — 3-Panel-Ansicht (Base | Ours | Theirs), 4 Layouts
- **Smart Views** — Voreingestellte Filter für den Graphen (Alle, Aktueller Branch, Meine Commits, Aktuelle usw.)
- **Überlappungs-Spalte** — Visualisierung verwandter Commits
- **Objekt finden** — Suche nach Branch/Tag/Remote (Ctrl+F)
- **Commit aufteilen** — über interaktives Rebase
- **Commit-Nachricht bearbeiten** — Inline-Editor
- **Cherry Pick / Revert** — mit Konflikterkennung und Zustandsverwaltung
- **Tolerante Clone-URL** — entfernt das Präfix „git clone “, leitet den Ordnernamen ab

### KI-Assistent
- **12+ LLM-Anbieter** — Z.ai (GLM-4-Flash kostenlos), OpenRouter (kostenlose Modelle), Groq (ultraschnell), Cerebras (1 Mio. kostenlose Tokens/Tag), Google Gemini, Hugging Face, Mistral, OpenAI, Anthropic, GitHub Models, Ollama (lokal), LM Studio, vLLM, Custom OpenAI-kompatibel
- **Unbegrenzte Provider-Registry** — beliebig viele Instanzen jedes Anbietertyps
- **Provider-Umschalter** — Wechsel mitten im Gespräch; Historie bleibt erhalten
- **Gesprächsgedächtnis** — die KI erinnert sich an vorherige Nachrichten derselben Sitzung
- **Kontext-Komprimierung** — alte Nachrichten werden automatisch komprimiert (konfigurierbares Maximum)
- **Token-Anzeige** — Input/Output/Context-Zähler nach jeder Antwort
- **Stopp-Button** — bricht den laufenden LLM-Aufruf sofort ab
- **KI-Guard** — konfigurierbar Allow/Confirm/Deny für destruktive Git-Aktionen (reset --hard, force push, clean, amend, stash drop)
- **Tool-Limits** — konfigurierbare Maxima (Log-Commits, Diff-Dateien, Kontextgröße, Request-Timeout)
- **Tool-Use-Agent-Loop** — 24+ Tools: get_status, get_log, get_diff, stage, commit, push, pull, checkout, merge, stash, discard_changes, sync_with_remote, abort_operation, list_repos, clone_repo, init_repo, open_repo, read_file, list_files und mehr
- **Chat-Log als Markdown exportieren**
- **Markdown-Rendering** in Antworten — Codeblöcke, Inline-Code, Fett, Listen
- **Starter-Prompt-Chips** — häufige Fragen mit einem Klick
- **KI-Commit-Nachrichten** — `@ai`-Platzhalter in der Commit-Nachricht → KI-generiert
- **KI-Branch-Namen-Vorschläge** — kebab-case aus geänderten Dateien
- **Streaming-KI-Antworten** — SSE-Parser für alle 3 Anbieterfamilien
- **Favoriten** — Teile von Gesprächen speichern und wiederverwenden

### Sicherheit
- **Verschlüsselter Credential-Tresor** — Tokens, Remote-Passwörter, KI-Schlüssel, SSH-Passphrasen über `safeStorage`
- **Secrets-Manager** (Einstellungen → Sicherheit) — reine Metadaten-Liste jedes Tresor-Eintrags; Kopieren / Ersetzen / Löschen pro Eintrag; Secret manuell hinzufügen
- **Standard-Commit-Autor** (Einstellungen → Git) — gilt für neue Clones/Inits; `commit()` nutzt ihn als Fallback
- **KI-Guard** — Bestätigungsschranke für destruktive Aktionen

### Drei Fensterstile
- **Standard** — volle Seitenleiste + alle Seiten
- **Log** — Verlaufsfokussiert (Seitenleiste ausgeblendet)
- **Working Tree** — Änderungen-fokussiert

Umschalten mit Ctrl+Shift+1/2/3 oder Toolbar-Button.

### Themes (20+ Paletten)
- **Ayu** Dark/Light (Standard), GitHub Light/Dark, Dracula, Monokai, Solarized, Nord, Tokyo Night, Catppuccin Mocha, One Dark, Gruvbox, Slack Dark, Discord, Material, Designer Light, Purple, Simple Light

Umschalten mit Ctrl+Shift+T. Auto Hell/Dunkel folgt dem Farbschema des Betriebssystems.

### Leistung & Einstellungen
- **Git-Leistung** — `feature.manyFiles`, `core.fsmonitor`, `fetch.writeCommitGraph` konfigurierbar unter Einstellungen → Git (via GIT-CONFIG-Override, ohne globale Konfigurationsänderungen)
- **Konfigurierbares Journal** — Commit-Journal-Anzahl (5–100) und Aktualisierungsintervall (0–300 s)
- **Auto-Refresh des Verlaufs** — optionaler periodischer `git log` (min. 30 s)
- **Auto-Push** — optionales periodisches Pushen ausgehender Commits
- **Hintergrund-Fetch pro Remote** — optional über Checkbox in den Repository-Einstellungen
- **Adaptives Polling** — Boost-Modus (30 s) nach Git-Mutationen, sonst Basis (120 s); pausiert bei unfokussiertem Fenster; Remote-Status-Fetch in einem dedizierten Utility-Prozess
- **Repo-Wechsel im Git-Worker** — Status, Workdir-Watch und Raw-Reads abseits des UI-Threads; 3 s Watchdog ohne Waisen

## Internationalisierung

4 Sprachen mit vollständiger Parität über alle i18n-Domänen:
- **English** (en) — Standard
- **Русский** (ru) — mit korrekten russischen Pluralformen (`{n|one|few|many}`-Engine: «1 локальная · 2 локальные · 5 локальных»)
- **中文** (zh)
- **Deutsch** (de)

Der i18n-Paritätstest (`tests/unit/i18nParity.test.ts`) erzwingt identische Schlüsselmengen in allen 4 Sprachen; die Plural-Engine rendert en/zh/de byte-identisch zum alten Platzhalter-Verhalten. Seitenleiste, Befehlspalette und Hilfe-Banner folgen der beim Start wiederhergestellten Sprache.

## Output-Panel

Das Output-Panel (Befehlslog) erfasst:
- **Git-Befehle** — jeder `git <args>`-Kindprozess mit stdout/stderr, Exit-Code, Dauer
- **API-Aufrufe** — GitHub/GitLab-HTTP-Anfragen als synthetische Einträge (`api gitlab GET /projects/12/merge_requests/5`)
- **Benutzer- vs. System-Filter** — standardmäßig nur benutzerinitiierte Befehle
- **Suche** — Filter nach Befehlstext, stdout oder stderr

## Tech-Stack

- Electron 44, React 19, TypeScript 7, Vite 8
- Tailwind CSS 4, Zustand 5, simple-git 4, electron-store
- Eigene SVG-Icons (ohne Icon-Bibliothek)
- Vitest 5 + Testing Library — 1963 Tests (Unit / Integration mit echtem Git / Komponenten)
- Live-E2E-Harnesses — Konfliktreaktionen, Push-Ablehnungen, Zähler-Audit (laufende App + verifizierte Screenshots)
- Docker + Wine für plattformübergreifende Builds

## Dokumentation

- [Changelog](docs/CHANGELOG.de.md) · [EN](docs/CHANGELOG.md) · [RU](docs/CHANGELOG.ru.md) · [ZH](docs/CHANGELOG.zh.md)
- [Architektur](docs/ARCHITECTURE.md) (EN) — Systemdesign und Datenfluss
- [API-Referenz](docs/API.md) (EN) — alle Git-Operationen und IPC-Kanäle
- [Beitragen](docs/CONTRIBUTING.md) (EN) — Entwicklungs-Setup und Richtlinien
- [Docker-Build](docs/DOCKER-BUILD.md) (EN) — Multi-Plattform-Build-Anleitung
- [Tests](docs/TESTING.md) (EN) — Test-Suite-Dokumentation

## Projektstruktur

```
├── electron/                 # Hauptprozess
│   ├── main.ts               # Einstieg, Fensterzustand, Kontextmenü
│   ├── preload.ts            # Context-Bridge-API
│   ├── menu.ts               # Anwendungsmenü
│   ├── ipc/                  # IPC-Handler
│   ├── services/             # Geschäftslogik
│   │   ├── git.ts            # Git-Operationen (simple-git, 6900+ Zeilen)
│   │   ├── github.ts         # GitHub-API-Client
│   │   ├── gitlab.ts         # GitLab-API-Client (self-hosted + Cloud)
│   │   ├── commandLog.ts     # Git-Befehls- + API-Aufruf-Logger
│   │   ├── storage.ts        # Persistente Einstellungen
│   │   └── watcher.ts        # Datei-Watcher für Auto-Refresh
│   └── types/                # TypeScript-API-Verträge
├── src/                      # Renderer-Prozess
│   ├── App.tsx               # Wurzel mit Lazy Routes + Hotkeys
│   ├── components/           # UI-Komponenten (55+ Dateien)
│   ├── pages/                # Lazy geladene Seiten
│   ├── stores/               # Zustand-State-Management (12 Stores)
│   ├── lib/                  # Utilities und Geschäftslogik
│   └── styles/               # Ayu Dark/Light + 20 Themes
├── tests/                    # Vitest-Test-Suite (1963 Tests)
│   ├── unit/                 # Unit-Tests (i18n-Parität, Gitflow usw.)
│   ├── integration/          # Service-Integrationstests (echtes Git)
│   └── components/           # React-Komponenten-Tests
├── scripts/                  # Build + Utility + Live-E2E-Skripte
├── Dockerfile                # Multi-Plattform-Docker-Build
├── docker-compose.yml        # 4 Build-Services
├── Makefile                  # All-in-One-Task-Runner
└── vitest.config.mts         # Test-Konfiguration
```

## Tastenkürzel

| Kürzel | Aktion |
|----------|--------|
| Ctrl+O | Repository öffnen |
| Ctrl+Shift+O | Repository klonen |
| Ctrl+Enter | Commit |
| Ctrl+Shift+P | Push |
| Ctrl+Shift+L | Pull |
| Ctrl+Shift+F | Fetch / Globale Suche |
| Ctrl+Shift+G | Git-Flow-Dialog |
| Ctrl+Shift+R | Interaktives Rebase |
| Ctrl+Shift+N | Neuer Branch |
| Ctrl+Alt+S | Stash |
| Ctrl+Shift+T | Theme umschalten |
| Ctrl+Shift+A | KI-Assistent umschalten |
| Ctrl+Shift+1/2/3 | Fensterstil (Standard/Log/Working Tree) |
| Ctrl+F | Objekt finden |
| Ctrl+K | Befehlspalette |
| Esc | Dialog schließen |

## Docker-Build

Alle Builds laufen in Docker-Containern:

```bash
make docker-all          # Alle Plattformen
make docker-linux        # Nur Linux
make docker-win          # Windows (über Wine)
make docker-mac          # macOS Intel
make docker-mac-arm64    # macOS Apple Silicon
```

Details: [docs/DOCKER-BUILD.md](docs/DOCKER-BUILD.md).

## Lizenz

MIT
