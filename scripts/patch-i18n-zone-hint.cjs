/**
 * Update the customThemeOverrides hint in all 4 locales to point users at
 * the v2.3 zone editor (the raw JSON path stays as the power-user escape
 * hatch). Small, one-shot, idempotent by exact-string replace.
 */
const fs = require('node:fs');
const path = require('node:path');
const FILE = path.join(__dirname, '..', 'src/i18n/locales/domains/settings.ts');
let src = fs.readFileSync(FILE, 'utf8');

const REPLACEMENTS = [
  [
    `'settings.customThemeOverridesHint': 'Override CSS variables for the active theme. JSON format: { "--accent": "#ff6b35", "--bg-primary": "#1a1a2e" }. Changes apply live.',`,
    `'settings.customThemeOverridesHint': 'Advanced: raw CSS variables in JSON ({ "--accent": "#ff6b35", "--diff-added-bg": "rgba(134,179,0,.2)" }). For zone colors use the Zone Colors editor above — it changes one area at a time. Applies live.',`,
  ],
  [
    `'settings.customThemeOverridesHint': 'Переопределить CSS-переменные для активной темы. Формат JSON: { "--accent": "#ff6b35", "--bg-primary": "#1a1a2e" }. Изменения применяются сразу.',`,
    `'settings.customThemeOverridesHint': 'Продвинутый режим: сырые CSS-переменные в JSON ({ "--accent": "#ff6b35", "--diff-added-bg": "rgba(134,179,0,.2)" }). Для цветов зон используйте редактор «Цвета зон» выше — он меняет одну область за раз. Применяется сразу.',`,
  ],
  [
    `'settings.customThemeOverridesHint': '覆盖活动主题的 CSS 变量。JSON 格式：{ "--accent": "#ff6b35", "--bg-primary": "#1a1a2e" }。更改实时生效。',`,
    `'settings.customThemeOverridesHint': '高级模式：JSON 格式的原始 CSS 变量（{ "--accent": "#ff6b35", "--diff-added-bg": "rgba(134,179,0,.2)" }）。区域颜色请使用上方的「区域颜色」编辑器——一次只改一个区域。实时生效。',`,
  ],
  [
    `'settings.customThemeOverridesHint': 'CSS-Variablen für das aktive Theme überschreiben. JSON-Format: { "--accent": "#ff6b35", "--bg-primary": "#1a1a2e" }. Änderungen gelten live.',`,
    `'settings.customThemeOverridesHint': 'Erweitert: rohe CSS-Variablen als JSON ({ "--accent": "#ff6b35", "--diff-added-bg": "rgba(134,179,0,.2)" }). Für Zonenfarben den Zonenfarben-Editor oben nutzen — ändert je genau einen Bereich. Gilt live.',`,
  ],
];

let n = 0;
for (const [from, to] of REPLACEMENTS) {
  if (src.includes(to)) continue; // idempotent
  if (!src.includes(from)) {
    console.error(`NOT FOUND: ${from.slice(0, 80)}…`);
    process.exitCode = 1;
    continue;
  }
  src = src.replace(from, to);
  n++;
}
fs.writeFileSync(FILE, src);
console.log(`hint updated in ${n} locales`);
