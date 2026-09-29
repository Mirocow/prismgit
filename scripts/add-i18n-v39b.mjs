import * as fs from 'node:fs';
const p = 'src/i18n/locales/domains/settings.ts';
let s = fs.readFileSync(p, 'utf8');
const adds = [
  ["'settings.sidebarNavTitle': 'Sidebar & Navigation',", [
    "'settings.sidebarFavTitle': 'Favorite tools',",
    "'settings.sidebarFavHint': 'The starred tools render as the sidebar\\u2019s top Favorites section. Arrows reorder them; \\u2715 removes a tool (re-add it with the star next to the item in the sidebar).',",
    "'settings.sidebarFavEmpty': 'No favorites yet \\u2014 star tools in the sidebar to pin them here.',",
    "'settings.sidebarFavRemove': 'Remove from favorites',",
  ]],
  ["'settings.sidebarNavTitle': 'Сайдбар и навигация',", [
    "'settings.sidebarFavTitle': 'Избранные инструменты',",
    "'settings.sidebarFavHint': 'Раздел «Избранные» вверху сайдбара. Порядок задаётся стрелками (\\u2191/\\u2193), \\u2715 убирает инструмент из избранных (вернуть можно звёздочкой у пункта в сайдбаре).',",
    "'settings.sidebarFavEmpty': 'Нет избранных \\u2014 отметьте инструменты звёздочкой в сайдбаре.',",
    "'settings.sidebarFavRemove': 'Убрать из избранных',",
  ]],
  ["'settings.sidebarNavTitle': '侧边栏与导航',", [
    "'settings.sidebarFavTitle': '收藏的工具',",
    "'settings.sidebarFavHint': '加星标的工具显示在侧边栏顶部的「收藏」区。箭头调整顺序；\\u2715 移除（在侧边栏中重新点星标即可加回）。',",
    "'settings.sidebarFavEmpty': '暂无收藏 \\u2014 在侧边栏中给工具加星标。',",
    "'settings.sidebarFavRemove': '从收藏中移除',",
  ]],
  ["'settings.sidebarNavTitle': 'Seitenleiste & Navigation',", [
    "'settings.sidebarFavTitle': 'Favoriten',",
    "'settings.sidebarFavHint': 'Die markierten Werkzeuge erscheinen oben in der Seitenleiste als Favoriten. Pfeile \\u00e4ndern die Reihenfolge; \\u2715 entfernt ein Werkzeug (mit dem Stern neben dem Eintrag wieder hinzuf\\u00fcgen).',",
    "'settings.sidebarFavEmpty': 'Noch keine Favoriten \\u2014 Werkzeuge in der Seitenleiste markieren.',",
    "'settings.sidebarFavRemove': 'Aus Favoriten entfernen',",
  ]],
];
for (const [anchor, lines] of adds) {
  if (s.includes(anchor) && !s.includes(lines[0])) {
    s = s.replace(anchor, anchor + '\n  ' + lines.join('\n  '));
    console.log('added for', anchor.slice(0, 40));
  }
}
fs.writeFileSync(p, s);
console.log('done');
