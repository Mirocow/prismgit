import * as fs from 'node:fs';
const p = 'src/i18n/locales/domains/settings.ts';
let s = fs.readFileSync(p, 'utf8');
const adds = [
  ["'settings.sidebarFavTitle': 'Favorite tools',", [
    "'settings.sidebarFavMoveUp': 'Move up in favorites',",
    "'settings.sidebarFavMoveDown': 'Move down in favorites',",
  ]],
  ["'settings.sidebarFavTitle': 'Избранные инструменты',", [
    "'settings.sidebarFavMoveUp': 'Переместить выше в избранном',",
    "'settings.sidebarFavMoveDown': 'Переместить ниже в избранном',",
  ]],
  ["'settings.sidebarFavTitle': '收藏的工具',", [
    "'settings.sidebarFavMoveUp': '在收藏中上移',",
    "'settings.sidebarFavMoveDown': '在收藏中下移',",
  ]],
  ["'settings.sidebarFavTitle': 'Favoriten',", [
    "'settings.sidebarFavMoveUp': 'In Favoriten nach oben',",
    "'settings.sidebarFavMoveDown': 'In Favoriten nach unten',",
  ]],
];
for (const [anchor, lines] of adds) {
  if (s.includes(anchor) && !s.includes(lines[0])) {
    s = s.replace(anchor, anchor + '\n  ' + lines.join('\n  '));
    console.log('added for', anchor.slice(0, 45));
  }
}
fs.writeFileSync(p, s);
console.log('done');
