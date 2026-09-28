# Changelog

Alle nennenswerten Änderungen an PrismGit werden in dieser Datei dokumentiert.

Das Format basiert auf [Keep a Changelog](https://keepachangelog.com/de/1.1.0/),
das Projekt folgt [Semantic Versioning](https://semver.org/lang/de/).

**Andere Sprachen:** [English](CHANGELOG.md) · [Русский](CHANGELOG.ru.md) · [中文](CHANGELOG.zh.md)

## [2.3.0] - 2026-09-29

### Hinzugefügt — Browser-artige Zurück/Vorwärts-Navigation
- **Zurück/Vorwärts-Knöpfe in der Werkzeugleiste** + Alt+← / Alt+→. Ein eigener Verlaufs-Stack notiert nur die Spur des Nutzers; ein neuer Sprung kürzt den Vorwärts-Schwanz wie im Browser
- In der Tastenkürzel-Übersicht eingetragen (Gruppe „Navigation“)

### Hinzugefügt — einklappbare Panels im VS-Code-Stil
- **Linke Seitenleiste** klappt zu einer 48px-Symbolleiste zusammen (Tool-Icons + Live-Änderungszähler + Theme/Einstellungen unten); ein Klick auf den Pfeil stellt die alte Breite wieder her. Persistiert
- **Commit-Detailpanel in History** (rechte Leiste) klappt zu einem 24px-Streifen zusammen — der Graph nutzt die volle Breite

### Hinzugefügt — eigene Themes + kuratierte Auswahl
- **Theme-Auswahl auf 6 kuratiert** (Ayu Light, One Dark, Simple, Material, Discord, Hell+Fenster-dunkle-Seitenleiste); gespeicherte Alt-Auswahlen wandern automatisch zum kuratierten Ersatz
- **Visueller Theme-Editor** («Theme erstellen…»): 15 Farbeingaben (Flächen, TEXTFARBEN, Akzent, Rahmen, Statusfarben, Seitenleisten-Hintergrund) + Hell/Dunkel-Schalter + Live-Vorschau. Eigene Themes greifen über ihren eigenen `data-theme="custom-*"`-Selektor mit abgeleiteten Schattierungen — Textfarben ändern sich in jedem Tool
- Das Feld „Seitenleiste“ baut den Look „dunkle Leiste + helles Fenster“ (VS-Code-Stil); lesbare Leisten-Schrift wird automatisch berechnet
- Ersetzt die JSON-Textbox „Theme-Overrides“ (nur für Power-User)

### Hinzugefügt — Hotkeys für jedes Tool + konfigurierbare Reihenfolge
- Jedes Tool hat genau eine Taste: Ctrl+1..9 (Alltags-Tools) + Alt+1..9 (die übrigen — früher duplizierten Alt+1..6 bloß Ctrl+1..6)
- **Einstellungen → Oberfläche → „Seitenleiste & Navigation“**: Tools umsortieren (↑/↓, persistiert), jede Taste aus freien Slots neu zuweisen („—“ löst die Bindung; eine gestohlene Kombination rückt beim Vorbesitzer raus), Reset
- Tool-Hotkeys funktionieren jetzt auch aus Eingabefeldern (browser-artig)

### Hinzugefügt — Commit-Kontext in History
- **„Branches mit diesem Commit“** — Branch-Plaketten in der Commit-Karte (`git branch --contains` + `-r`, pro SHA gecacht); Klick auf einen lokalen Branch zeigt dessen Verlauf
- **Autor-Filter mit einem Klick** — Klick auf den Autorennamen filtert den Graphen; die Kopier-Schaltfläche liefert „Name <E-Mail>“ auf einen Streich

### Behoben — Zähler, zweite Runde
- **Branches-Übersicht** zeigt repo-weite Totale (unter aktiver Suche schrumpften die Zahlen und widersprachen Tags/Stashes)
- **History „Markiert (N)“-Chip** wird über die gefilterte Menge berechnet — bei aktivem Text-/Autor-/Datumsfilter entspricht die Zahl exakt den Zeilen, die der Filter zeigt
- **Repo-Info-Dialog** listet lokale UND Remote-Branches getrennt; der Statistik-Job zählt jetzt auch `git branch -r`
- Tote Loader aus History entfernt (Stash/Reflog luden bei jedem Refresh für längst entfernte Sektionen)

### Behoben — 401-Toast-Bombardement von toten Integrationen
- Ein abgewiesener GitHub-Token (401 Bad credentials) auf der Pull-Requests-Seite ist jetzt ein AUTorisierungs-Problem, kein Ladefehler: null Fehler-Toasts, stattdessen das In-Page-Anmelde-Gate; weitere Aufrufe schicken keine Requests mehr (einer statt 3+)
- In-flight/last-key-Wächter auf loadPRs — das zweimalige Umkippen von `loading` bei der Provider-Erkennung feuert die Abfrage nicht erneut; der Refresh-Knopf ist der explizite Wiederholungsweg

### Geändert — Einstellungen entdupliziert und erklärt
- **Zwei „Externe Tools“-Panels zu einem vereint** (diff.tool/merge.tool-Namensfelder stehen jetzt neben den Befehlen, die sie konfigurieren)
- **Zeilen-Guides**: tote numerische Felder entfernt — der Selektor in „Befehle“ ist der alleinige Eigentümer
- **„!“-Hinweisboxen** (Hover-Erklärungen) bei den wirklich verwirrenden Einstellungen: Intervall + Umfang der Hintergrundprüfung, Reflog-Limit, Kontrast, Seitenleiste & Navigation
- Hartkodierte englische Zwischenüberschriften im KI-Panel lokalisiert

## [2.2.0] - 2026-09-28

### Hinzugefügt — jede konfliktbehaftete Operation REAGIERT jetzt
- **Einheitliche Konflikt-Reaktionsmatrix** — Pull (Merge/Rebase/ff-only-Strategien), Merge, Rebase, Cherry-Pick, Revert, Stash Pop/Apply, Git-Flow-Finish (×4 Flows), Squash-to-Branch, 3-Way-Patch und der KI-Auto-Stash-Pop springen ALLE in den Konfliktlöser der Änderungsseite mit Banner für die laufende Operation («Слияние/Rebase/Применяется» + Fortsetzen / Überspringen / Abbrechen), einem Konfliktbereich und einer operationsspezifischen Warnung
- **Git-Flow setzt NIE über einen Konflikt hinweg fort** — Finish-Flows stoppen bei einem Konflikt-Merge: kein Tag, kein Branch-Löschen, kein Push im Konfliktzustand
- **Ehrlicher Stash Pop/Apply** — simple-git wertet konfliktierte `git stash pop|apply` als Erfolg; eine Post-Statusprüfung erkennt jetzt die Konfliktform, wirft einen typisierten Fehler mit `.conflicts`, behält den Stash-Eintrag bei und öffnet den Löser (vorher: Erfolgs-Toast + geleerte Auswahl, während der Baum mit Markern volllief)
- Live verifiziert: `scripts/verify-conflict-reactions.mjs` — 17/17 in der laufenden App (RU)

### Hinzugefügt — Wiederherstellung nach Push-Ablehnung (Remote-Konflikte)
- **PushRejectionDialog** — von git abgelehnte Pushes öffnen einen nach Ursache klassifizierten Dialog mit ursachenspezifischer Wiederherstellung: Non-Fast-Forward → «Стянуть и слить» + automatischer Push-Wiederholungsversuch; veralteter Force-with-Lease → Fetch + Re-Lease-Wiederholung; geschützter Branch → MR/PR erstellen; Richtlinien-Blockaden mit Erklärung. In alle Push-Fehlerstellen eingebunden (Toolbar Push/Sync/Push-To, Commit & Push, Git-Flow-Finish)
- **IPC-Fehlerfilter behoben** — wrap() in `electron/ipc/git.ts` behielt nur `error:/fatal:`-Zeilen: `! [rejected]`- und `remote: GitLab:`-Zeilen wurden VOR dem Renderer entfernt, daher konnte sich kein Dialog jemals öffnen. Jetzt passieren rejected]/remote:/hint:-Zeilen
- **PR/MR-Konflikt-Badges** — GitLab `merge_status` / GitHub `mergeable` als Zeilen-Badges und im Review-Kopf; Merge-Button bei Nicht-Mergbarkeit deaktiviert mit Tooltip
- Live verifiziert: `scripts/verify-push-rejections.mjs` — 16/16 in der laufenden App (Non-FF-Dialog + Pull-Merge-Autoretry, Force-with-Lease, Fetch-Retry bei veraltetem Lease)

### Hinzugefügt — Squash einer Commit-Gruppe auf einen anderen Branch
- Wählen Sie einen Commit-Bereich im Verlauf (oder eine PR/MR-Gruppe aus Pull Requests/Reviews) und landen Sie ihn als EINEM Commit auf einem anderen Branch — bestehend oder NEU, mit vollständiger Konfliktbehandlung im Dialog
- Die alte Squash-API-Suite wurde durch eine konfliktbewusste ersetzt; der Ganz-PR-Squash-E2E bleibt kompatibel

### Hinzugefügt — Secrets-Manager (Einstellungen → Sicherheit)
- **Abschnitt gespeicherte Secrets** — jeder Eintrag des verschlüsselten Tresors wird aufgelistet (nur Metadaten: Namespace, Name, Verschlüsselungsflag), gruppiert nach Kategorie: Zugriffstokens, Repository-/Remote-Passwörter, KI-Anbieter-Schlüssel, GitHub, SSH-Passphrasen
- **Kopieren / Ersetzen / Löschen pro Eintrag** — Werte werden nie gerendert; „Kopieren“ legt einen einzelnen Wert direkt in die Zwischenablage, „Ersetzen“ speichert einen neuen Wert, „Löschen“ entfernt den Eintrag (mit Bestätigung)
- **Secret hinzufügen** — manuell ein Secret registrieren (Token, Remote-Passwort für Repo-Pfad + Remote-Name usw.), das ab dem ersten Byte verschlüsselt gespeichert wird
- Neue IPC: `credentials:list` / `credentials:set` / `credentials:delete` / `credentials:reveal`

### Hinzugefügt — Standard-Commit-Autor (Einstellungen → Git)
- **„Standard-Commit-Autor“** (gitUserName / gitUserEmail) unter Einstellungen → Projekt → Git mit „Auf aktuelles Repository anwenden“-Button
- Neue, mit PrismGit erstellte oder geklonte Repositories bekommen die Identität automatisch in ihr lokales `user.name` / `user.email` geschrieben — kein „Please tell me who you are“ mehr beim ersten Commit
- `commit()` wiederholt einmal mit der Standard-Identität als `-c`-Overrides, wenn git den Commit mangels konfigurierter Identität verweigert; andernfalls erklärt der Fehler, wo sie zu setzen ist

### Behoben — Zähler (Audit sichtbarer Zahlen)
- **«Tagged (N)»-Chip im Verlauf** — N ist jetzt die Zahl der MARKIERTEN COMMITS IN DER ANSICHT (exakt das, was der Filter für die aktuelle Branch-Auswahl zeigt); der Tooltip führt beide Zahlen (Ansicht + repo-weit). Vorher: allTags.length — ein Tag auf einem Branch außerhalb der Ansicht ließ den Chip mit den Zeilen divergieren
- **«Теги на этом коммите (N)» pro Commit** — zählt nur die Tags, die auf den Commit zeigen (zwei Tags auf einem Commit → (2), Namen aufgelistet)
- **Russische Grammatik der Branches-Zusammenfassung** — neue optionale Plural-Pipe-Syntax in t(): `{name|one|few|many}` wählt eine CLDR-Pluralform («1 локальная · 2 локальные · 5 локальных · 6 тегов»); en/zh/de behalten einfache Platzhalter und rendern byte-identisch
- **Seitenleiste folgt der Startsprache** — Navigations-Beschriftungen waren zur Ladezeit des Moduls eingefroren, daher zeigte der erste Start eines RU-Profils eine englische Seitenleiste bis zur manuellen Aktualisierung; NAV_ITEMS wird jetzt pro Render ausgewertet (Seitenleiste, Befehlspalette, Hilfe-Banner)
- Zähler-Synchronisation über Tools: Ein Tag, das in Tags gelöscht wird, aktualisiert den Verlaufs-Chip sofort
- Live verifiziert: `scripts/verify-counters.mjs` — 17/17 in der laufenden App gegen den git-CLI-Referenzwert

### Behoben — „Einstellungen konnten nicht gespeichert werden“ (gpg.program)
- Repository-Einstellungen → Signieren ließ sich nicht speichern: simple-git blockiert `git config gpg.program` (und andere „unsichere“ Schlüssel), sofern `allowUnsafeGpgProgram` nicht aktiviert ist. `configSet` / `configUnset` erkennen jetzt die Plugin-Ablehnung und wiederholen den Schreibvorgang auf einer Instanz mit aktivierten Schreibflags — explizite Benutzerbearbeitungen in einem GUI-Client sind Absicht
- Der Signieren-Tab schreibt `gpg.program` nicht mehr bedingungslos: leere Felder werden aus `.git/config` ENTFERNT statt geschrieben (behebt auch den nicht löschbaren user.signingkey und den gefährlichen `user.name=""`-Write, der jeden Commit mit „empty ident name not allowed“ brechen würde)

### Behoben — GitLab / PR-Oberflächen
- **MR aus einem GitLab-Repo erstellen funktioniert jetzt** — der Create-Dialog der Pull Requests rief selbst für GitLab-Repos die GitHub-REST-API auf (garantiertes Scheitern, während das README „Erstellen“ für beide Provider versprach); jetzt angebunden an den längst existierenden `gitlab:createMergeRequest`-IPC — live verifiziert durch das Anlegen des v2.2.0-Release-MRs in der App
- **GitLab apiJson folgt 3xx-Redirects** — umbenannte/verschobene Projekte (gitclient → prismgit) brachen die MR-Liste mit stillen 404ern
- **Pull-Requests-Zeilen-Aktionen sichtbar und verständlich** — Hover-aufgedeckte kryptische Icons → dauerhaft sichtbare beschriftete Buttons + Rechtsklick-Menü (In Reviews öffnen / Browser / Squash / Gruppe kopieren)

### Behoben — Installation / Paketierung
- **`make install` übersteht eine 404 des lokalen npm-Mirrors** — `scripts/npm-install-with-retry.sh` umschließt npm install/ci, liest das Ergebnis aus npms eigener Ausgabe (tee verschluckt Exit-Codes) und wiederholt bei E404 automatisch einmal mit `--registry=https://registry.npmjs.org`; EBADENGINE erhält einen freundlichen Node-Upgrade-Hinweis; ein abgeschossener Lauf kann keinen Erfolg fälschen
- deb-Paketierungs-Metadaten + produktiver Paket-Smoke-E2E — Paketierung, die auf realen Maschinen überlebt

### Behoben — Stabilität
- **Beende-Watchdog** — Schließen kann nicht mehr hängen: 3 s harter Watchdog, Worker-Kindprozesse werden nie zu Waisen
- **Repo-Wechsel-Freeze beseitigt** — Status, Workdir-Watch und Raw-Reads laufen im Git-Worker; Dichte-Fix (v3.6)
- **Remote-Status-Fetch-Sturm** — Boost-Schleife aufgebrochen, hängende Fetches getötet, Polling von der Vordergrund-Warteschlange entkoppelt; Remote-Status-Fetch in einen dedizierten Utility-Prozess verlagert
- **Rendering-Isolation** — Re-Renders auf Tasten-/Token-/Frame-Ebene isoliert; der 5-Sekunden-Vollbaum-Re-Render-Sturm durch Status-Refreshs entfernt
- **i18n-Layout** — die Oberfläche bricht nicht mehr an RU/DE-Stringlängen

### Geändert — Leistung: langsame Git-Operationen nach LFS-Problemen
- Netzwerkbefehle (Fetch / Pull / Push / ls-remote) laufen nicht mehr auf der geteilten Per-Repo-simple-git-Instanz (`maxConcurrentProcesses: 2`), die jede lokale Operation nutzt — ein langsamer oder hängender Netzwerkbefehl (unerreichbarer LFS-Server, auf Eingabe wartender Credential-Dialog, riesiger Fetch) belegte die 2 Warteschlangen-Slots und blockierte ALLE Git-Operationen des Repositorys
- Alle Netzwerkbefehle laufen mit `GIT_TERMINAL_PROMPT=0` — eine unbeantwortete Credential-Anfrage scheitert schnell mit klarem Fehler statt unsichtbar zu hängen (wie im Push-Pfad)

### Geändert — Abhängigkeiten (alle aktuell)
- **simple-git 3 → 4** — Migration auf benannte Imports; die neue Umgebungs-Wache gezähmt (`allowEnvironment`-Vertrag für GIT_*-Schlüssel, empirisch per Sonde fixiert)
- vite 8.3, vitest 5, @types/node 26, @tauri-apps/* 2.12 (React 19 / Electron 44 / TypeScript 7 / Tailwind 4 waren bereits aktuell)

### Tests
- **1963 bestanden** (bei 2.1.0: 1009) / 0 fehlgeschlagen / 34 umgebungsabhängige Übersprünge; tsc fehlerfrei
- Neue Schichten: Konfliktreaktions-Integrationssuite (echtes Bare-Remote, echte Divergenz), Push-Ablehnungs-Szenarien (Non-FF, veralteter Lease, pre-receive-Schutz-Emulation), Zähler-E2E, i18n-Plural-Engine, konfliktbewusste Squash-API, Enterprise-QA-Perf-Suite (Monster-Repo-Generator, CDP Memory/DOM/FPS + Zombie-Audit)
- `tests/integration/gitService.identityConfig.test.ts` — gpg.program Set/Unset, Identität bei Init, Commit-Fallback, Fehlermeldung ohne Identität
- `scripts/secrets-smoke.cjs` um Secrets-Manager-Roundtrip-Checks erweitert (reine Metadaten-Liste, Set+Reveal, Delete)

---

## Frühere Versionen

| Version | Datum | Kurz |
|--------|------|------|
| [2.1.0] | 2026-09-13 | KI-Assistent-Überholung (12 Anbieter, Gedächtnis, Streaming), Lazy-History, Onboarding-Tour — [vollständig auf Englisch](CHANGELOG.md#210---2026-09-13) |
| [2.0.1] | 2026-09-13 | Tour-Overlay-Positionierung gefixt — [EN](CHANGELOG.md#201---2026-09-13) |
| [4.1.0] / [4.0.0] | 2026-09-09 | KI-Tool-Konfiguration, Tool-Limits — [EN](CHANGELOG.md) |
| [3.1.0] / [3.0.0] | 2026-09-09 | Frühe Arbeitsversionen der Tools — [EN](CHANGELOG.md) |
| [2.0.0] | 2026-09-09 | Basis-Client: Verlauf, Änderungen, Branches — [EN](CHANGELOG.md#200---2026-09-09) |
| [1.0.0] | 2026-09-09 | Erstrelease — [EN](CHANGELOG.md#100---2026-09-09) |
