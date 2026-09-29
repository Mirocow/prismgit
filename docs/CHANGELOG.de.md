# Changelog

Alle nennenswerten Änderungen an PrismGit werden in dieser Datei dokumentiert.

Das Format basiert auf [Keep a Changelog](https://keepachangelog.com/de/1.1.0/),
das Projekt folgt [Semantic Versioning](https://semver.org/lang/de/).

**Andere Sprachen:** [English](CHANGELOG.md) · [Русский](CHANGELOG.ru.md) · [中文](CHANGELOG.zh.md)

## [2.3.7] - 2026-09-29

### Geändert — Sidebar-Collapse-Schalter entsprechen jetzt exakt der VS-Code-Referenz
- Der Nutzer verwies auf das Hero-Bild der VS-Code-Dokumentation («вот посмотри как должны выглядеть кнопки сворачивания сайдбаров справа на картике»): dessen obere rechte Reihe sind die **Layout-Toggles** der Titelleiste — codicon-artige abgerundete Kästchen, deren Panel-Streifen **gefüllt ist, solange das Panel offen ist**, und hohl (nur Trennlinie), solange es eingeklappt ist. Eine Pixel-Forensik der Referenz bestätigte die exakten Icons (`layout-sidebar-left`, `layout-panel`, `layout-sidebar-right-off`, `layout`)
- Die Schalter in der Header-Ecke von PrismGit (linke Sidebar / rechtes Detail-Panel, rechts von «Symbolleiste anpassen») nutzten bisher lucide-artige Panel-Icons mit Falt-Pfeilen — jetzt rendern sie die **exakten Pfaddaten der Original-Codicons** (microsoft/vscode-codicons, 16×16, fill) in der Codicon-Größe 16px mit denselben Zustands-Semantiken: offen → gefüllter Streifen, eingeklappt → hohl. Die In-Panel-Chevrons (Sidebar-Rail, History-Pane) behalten ihr Aussehen

## [2.3.6] - 2026-09-29

### Behoben — 3-Wege: Streifen auf der Mittelpane bei Klick oder Fokus
- Die Fortsetzung: «полоса появляется при клике на среднюю панель» — sobald man in die Ergebnis-Pane klickt (oder sie fokussiert), erscheint ein heller vertikaler Streifen an den Pane-Kanten und verschwindet beim Verlassen des Fokus. Ursache (live bewiesen via computed-style + Pixel-Diff): Die Ergebnis-Pane ist eine **textarea in Panegröße**, und die globalen Fokusregeln malten einen 2px-Akzentring um sie herum — Chromium matcht `:focus-visible` bei Texteingaben **auch bei Mausklick**, der Ring feuerte also bei jedem Klick
- Schlimmer noch: dieselbe globale Regel setzte `position: relative` und kaperte damit das `absolute` des Overlays — die textarea **fiel auf ihre inhärente `cols`-Breite zusammen (385→201px)**, und der Klick setzte den Cursor an das falsche Zeichen
- Fix: In einem Code-Editor ist der **Cursor der Fokusindikator** (VS Code zeichnet auch keinen Ring) — Ring/Rahmen/Schatten werden für den Merge-Editor über die dedizierte Klasse `merge-editor-input` unterdrückt, plus inline `outline: none` / `position: absolute`, die keine künftige globale Regel überstimmen kann. Die Tastatur-Fokusringe überall sonst (Buttons, Felder, Dialoge) bleiben unangetastet

## [2.3.5] - 2026-09-29

### Behoben — 3-Wege: der „Streifen in der Mittelpane“ waren die Konfliktmarker
- Die `<<<<<<<` / `=======` / `>>>>>>>`-Markierungszeilen trugen eine rote 35 %-Bande über die volle Breite — bei einem Konflikt mitten in der Datei las sich das genau als „Streifen in der Mitte der Mittelpane“ (und Rot suggeriert FEHLER). Marker sind strukturelles Rauschen, kein Inhalt: jetzt neutraler Hintergrund + gedämpfter Text; die ours/theirs-INHALTSzeilen behalten ihr Grün/Blau — auf 20 % abgeschwächt, sodass der Block als eine ruhige Region statt als aggressive Streifen wirkt

### Geändert — Zurück/Vorwär gilt pro Projekt, Tiefe einstellbar
- Das Wechseln des Repos löscht den Navigationsstapel (die History reicht nie mehr projektübergreifend)
- Der Stapel hält **standardmäßig 10 Schritte** (vorher unbegrenzt 60); die Anzahl ist konfigurierbar unter Einstellungen → „Seitenleiste & Navigation“ → „Schritte in Zurück/Vorwärts-History“ (5–100); die ältesten Einträge fallen über dem Limit hinaus

### Behoben — Historie: Autor/Datum-Filter laufen jetzt SERVER-SEITIG
- Der Bericht: Autor eingeben, Aktualisieren — nichts änderte sich; die Commits erschienen erst nach dem Durchscrollen der gesamten Historie. Ursache: Autor-/Datumsfilter liefen CLIENT-SEITIG über die erste geladene 100-Commit-Seite. Jetzt läuft `git log --author=<muster> --since/--until` beim Refresh selbst (groß/klein-unabhängig, gegen „Name <email>“), das Paging behält die Filter, und der Filter greift 300 ms nach der Eingabe automatisch (entprellt — ein Rev-Walk, nicht einer pro Taste)
- Nebenbei ein latenter Argumentreihenfolge-Bug behoben: `--grep`/`--author`/`--since`/`--until` werden jetzt immer VOR dem `-- <datei>`-Trennzeichen gesetzt (Optionen nach `--` gelten als Pfade — Autor+Datei- und grep+Datei-Kombinationen liefen vorher ins Leere)

## [2.3.4] - 2026-09-29

### Behoben — der Abstands-Bug, der drei Runden „mehr Abstand“ unsichtbar machte
- **Ursache (Kaskaden-Bug): Das app-eigene Reset `* { margin: 0; padding: 0 }` landete beim Kompilieren in `@layer utilities` NACH Tailwinds `space-y-*`-Regeln** — v4 erzeugt Space-Utilities über `:where()` (Spezifität 0), deshalb hat das Reset ALLE `space-y-*`/`space-x-*`-Utilities app-weit lautlos geschlagen: Abstände zwischen Geschwistern wurden nie gerendert. Deshalb änderte sich der Abstand in Settings/Dialogen in v2.3.1–v2.3.3 sichtbar nie, egal wie hoch die Klassen erhöht wurden. Das redundante Reset ist entfernt (Tailwinds Preflight nullt Margins bereits in `@layer base`) — jetzt rendert jede `space-*`-Klasse wie vorgesehen, in jedem Tool und Dialog
- Zusätzlich Abstände in Settings verbreitert: Haupt-Panels `space-y-8` (32px), sekundäre 6/5, Sortierlisten 2.5

### Behoben — „!“-Hinweise zeigten nie ihren Inhalt
- Der InfoHint-Tooltip erschien buchstäblich nie: Die gestapelte Variante `group-hover:group-focus:block` verlangt Hover UND Fokus gleichzeitig (und der Button schluckt das Mousedown, Fokus kam nie an) — ersetzt durch `group-hover:block group-focus-within:block`. Die „!“-Marker zeigen ihren Erklärungstext jetzt bei Hover und Tastaturfokus

### Hinzugefügt — VS-Code-artige Einklapp-Schalter in der Toolbar-Ecke
- Zwei Layout-Schalter RECHTS der „Symbolleiste anpassen“-Taste: linke Seitenleiste (48px-Icon-Rail) und rechtes Commit-Details-Panel ein-/ausklappen. Beide Flags liegen jetzt im gemeinsamen `uiLayoutStore` (dieselben localStorage-Keys — gespeicherter Zustand bleibt); Toolbar, Rail und History-Panel bleiben synchron

### Behoben — LFS-Tool-Schaltflächen nur bei Hover sichtbar
- „Datei-Historie“ und Sperr-Schaltflächen der Dateizeilen ruhen jetzt bei 60 % Deckkraft (stets sichtbar), wie der Search-Fix aus v2.3.3

### Hinzugefügt — der AI-Assistent kann JEDES Tool nutzen (18/18)
- 10 neue Tool-Engines registriert (41 gesamt): `get_reflog` (Reflog), `list_submodules` + `submodule_update` (Submodules), `lfs_overview` + `lfs_sync` (LFS), `bisect` (die komplette Zustandsmaschine: status/start/good/bad/skip/reset/log), `gitflow_overview` (Flow-Konfiguration + Zweige je Typ + Rolle des aktuellen Zweigs), `recyclable_commits` (verlorene Commits), `list_reviews` (verteilte Review-Threads aus Git-Notes), `list_pull_requests` (GitHub-PRs / GitLab-MRs mit Provider-Erkennung + Token-Hinweis)
- Der System-Prompt lehrt das Modell, wann welche Engine zu greifen ist (Regeln 24–27), inklusive der Bisect-Schleife („Kandidat testen, dann good/bad antworten“)

## [2.3.3] - 2026-09-29

### Behoben — Suche-Tool: Schaltflächen waren bis zum Hovern unsichtbar
- **Alle verbleibenden hover-only Aktionsschaltflächen des Suche-Tools sind jetzt stets sichtbar** (Ruhezustand 60 % Deckkraft, bei Hover 100 %): Commit-Ergebniszeilen (im Browser öffnen, Hash kopieren), Datei-Ergebniszeilen (Änderungen / Diff / Blame / Historie) und die Datei-Gruppenköpfe der Inhaltsresultate (Diff / Blame / Historie) — in v2.3.2 waren nur die «Commit»/«Änderungen»-Schaltflächen und die Schaltflächen der Trefferzeilen umgestellt; der Rest blieb `opacity-0`, bis der Mauszeiger zufällig darüber stand (vom Benutzer „zufällig" entdeckt)
- Live am 20k-Commit-Fixture verifiziert: alle 15 Schaltflächenarten bei opacity 0.6 im Ruhezustand, keine hover-only Elemente mehr; der «Commit»-Sprung (Blame-Lookup) landet weiterhin in History mit dem Datei-Filter-Chip
- Durch einen Source-Pin-Test abgesichert (kein `opacity-0` mehr auf der Suchseite)

## [2.3.2] - 2026-09-29

### Behoben — 3-Wege-Merge-Editor (an echtem Konflikt getestet)
- **Die Pane-Splitter waren tot**: ein 1px breiter Trenner mit Höhe 0 im Sticky-Wrapper — unsichtbar, nicht greifbar (Mousedown traf die Nachbarpane). Jetzt ein echter 6px-Trenner mit sichtbarem Mittelgriff, ±5px-Trefffläche und Akzent-Hover; Ziehen live verifiziert (Panes ändern die Breite, Header folgen)
- **Pane-Header liefen aus dem Ruder**, sobald eine Pane breiter gezogen wurde (feste Drittel); sie spiegeln jetzt exakt leftPct/rightPct
- Bearbeitung und Hervorhebungs-Layer der Mittelpane live auf einem echten Konflikt verifiziert (Tippen, Sync, kein fremder Streifen)

### Hinzugefügt — Hintergrund-Fetch PAUSE
- Der Aktualisierungs-Spinner der Seitenleiste ist jetzt eine Fetch-Steuerung: Klick auf den LAUFENDEN Spinner stoppt den Hintergrundzyklus; ein Play-Button setzt fort. Ein „Fetch“-Pause/Play-Schalter in der Statusleiste macht dasselbe von überall
- Während der Pause wird jeder Zyklus übersprungen (Timer, Fokus-Wiederaufnahme, Erstcheck); manuelles „Jetzt prüfen“ funktioniert weiterhin

### Hinzugefügt — VS Code-artiges Panel-Einklappen
- Die Konsole klappt jetzt über einen Chevron in IHREM eigenen Panel-Header zu (zuvor nur Statusleisten-Schalter mit ✕); der Statusleisten-Schalter erhielt PanelBottomClose/PanelBottomOpen-Icons. Linke Seitenleiste und Commit-Details-Pane behalten ihre Header-Chevrons

### Hinzugefügt — Zurück/Vorwärts merkt sich den WERKZEUGZUSTAND
- Jeder Verlaufseintrag trägt einen Snapshot der globalen Auswahl (Commit, Datei, Branch, Tag, Pfadfilter). Zurück/Vorwärms stellt ihn wieder her; Cross-Tool-Sprünge markieren sich, damit der Austrittseintrag nicht verschmutzt wird

### Hinzugefügt — aus der Suche zum Commit, der die Änderung einbrachte
- Jeder Treffer hat einen „Commit“-Button: Blame-Lookup findet den einführenden Commit und öffnet History mit ausgewähltem Commit UND nach Datei vorgefiltertem Graphen. Blame/History/Diff-Buttons sind jetzt IMMER sichtbar (zuvor nur bei Hover)

### Hinzugefügt — Favoriten sortierbar in den Einstellungen
- Einstellungen → „Seitenleiste & Navigation“ hat einen Favoriten-Block: ↑/↓ sortiert die Favoriten-Sektion der Seitenleiste (persistent), ✕ entfernt Einträge; die Favoritenliste zog aus dem Sidebar-Lokalzustand in einen Store

### Verbessert — Theme-Editor-Zonen & Textkontrast
- Jede Farbfläche hat einen «!»-Hinweis, WO die Farbe wirkt; Hover hebt die Zone in der Vorschau hervor
- Textfarben werden auf Kontrast geprüft: Warnung mit Verhältnis + Ein-Klick „Lesbar“ unter 4.5:1
- Die verwirrende Zone „Panel“ heißt jetzt „Panels und Konsole“ (RU); der Button-Text der Vorschau nutzt die gleiche Auto-Farbe wie das kompilierte Theme

### Geändert — Zeilenabstände in den Einstellungen
- Navigations-Werkzeugzeilen (und der Favoriten-Block) weiter auseinander


## [2.3.1] - 2026-09-29

### Behoben — der Bericht «App hängt in jedem Werkzeug» (gemessen, dann behoben)
- **Alle schreibgeschützten git-Befehle laufen jetzt im dedizierten git-worker-Prozess** statt im Electron-Main-Loop. Der Main-Prozess ist der IPC-Broker jedes Renderer-Aufrufs — während er git-Ausgaben pumpte, warteten Klicks und Refreshes aller Werkzeuge. Gemessen an einem 20k-Commit/31-Branch-Fixture: History-Öffnen blockierte den Main-Loop 119ms (auf macOS ×3-5 teurer); nach dem Router blockiert kein Werkzeug länger als 2.4ms. In-Flight-Coalescing und 1s-Meta-TTL unverändert; vitest läuft weiter in-process — alle 2017 Tests beobachten identisches Verhalten
- **Worker-seitige git-Spawns werden an die Operations-Konsole gemeldet** — das Befehlsprotokoll zeigt ALLE git-Aktivitäten mit Dauer (39 von 47 Befehlen liefen im Worker)
- `git remote -v` (langsamster Befehl im History-Öffnungs-Burst, 384ms) ist jetzt 60s gecacht
- **GitLab-projectId-Heal-Watchdog (PR/Reviews)** mit Backoff: abgelehnter Token oder unerreichbares GitLab wiederholte zuvor alle 1,5s (~40 Anfragen/Minute); Ausfälle verdoppeln die Verzögerung bis 30s
- **Bisect-3s-Polling** läuft nur während einer aktiven Bisect-Sitzung

### Hinzugefügt — von der Suche zum Commit, der die Änderung einbrachte
- Jede Trefferzeile (git grep) erhielt Aktionen: **Blame an dieser Zeile** (scrollt + blinkt, zeigt wer es einbrachte), **History der Datei** (bereits darauf gefiltert), **Diff**; der Dateigruppen-Kopf bietet Changes/Diff/Blame/History komplett
- Der History-Sprung aus der Suche filtert den Graphen nach der Datei (Pfad-Filter-Chip) und kann den Commit vorauswählen
- Einmaliges `blameFocusLine` im Selection-Store treibt den fokussierten Sprung

### Hinzugefügt — der KI-Assistent beherrscht Search und Blame
- Neue Tools `search_code` (git grep — die Inhalts-Engine des Search-Werkzeugs) und `blame_file` (zeilenannotierter Blame, gruppiert in Commit-Blöcke) mit Auswahlhinweisen

### Behoben — History-Filter vs. Suche
- Aktivierung eines Chip/Autor/Datum-Filters bei aktiver Textsuche **löscht jetzt die Suche** — der Filter wirkt auf ALLE Commits
- Jedes Filterfeld (History, Branches, Changes) hat einen **✕-Löschen-Button** + Esc

### Geändert — Luft in Dialogen und Einstellungen
- Dialog-Formulargruppen und Einstellungs-/Listenzeilen mit größerem Abstand


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
