#!/usr/bin/env node
/**
 * i18n length-ratio audit: find keys where ru/de strings are dramatically
 * longer than the English reference (layout-breakage candidates).
 *
 * Usage: npx tsx scripts/audit-i18n-lengths.mts
 */
import * as core from '../src/i18n/locales/core';
import * as shell from '../src/i18n/locales/domains/shell';
import * as changes from '../src/i18n/locales/domains/changes';
import * as history from '../src/i18n/locales/domains/history';
import * as diff from '../src/i18n/locales/domains/diff';
import * as branches from '../src/i18n/locales/domains/branches';
import * as stashes from '../src/i18n/locales/domains/stashes';
import * as tags from '../src/i18n/locales/domains/tags';
import * as remotes from '../src/i18n/locales/domains/remotes';
import * as dialogs from '../src/i18n/locales/domains/dialogs';
import * as pages from '../src/i18n/locales/domains/pages';
import * as settings from '../src/i18n/locales/domains/settings';
import * as search from '../src/i18n/locales/domains/search';
import * as tour from '../src/i18n/locales/domains/tour';
import * as aiassistant from '../src/i18n/locales/domains/aiassistant';
import * as toasts from '../src/i18n/locales/domains/toasts';
import * as actions from '../src/i18n/locales/domains/actions';
import * as contextMenus from '../src/i18n/locales/domains/contextMenus';
import * as banner from '../src/i18n/locales/domains/banner';
import * as conflict from '../src/i18n/locales/domains/conflict';
import * as iRebase from '../src/i18n/locales/domains/iRebase';
import * as nav from '../src/i18n/locales/domains/nav';
import * as errors from '../src/i18n/locales/domains/errors';
import * as vscode from '../src/i18n/locales/domains/vscode';

const DOMAINS: Record<string, Record<string, Record<string, string>>> = {
  core, shell, changes, history, diff, branches, stashes, tags, remotes,
  dialogs, pages, settings, search, tour, aiassistant, toasts, actions,
  contextMenus, banner, conflict, iRebase, nav, errors, vscode,
};

const en: Record<string, string> = {};
const ru: Record<string, string> = {};
const de: Record<string, string> = {};
const zh: Record<string, string> = {};
for (const d of Object.values(DOMAINS)) {
  Object.assign(en, d.en);
  Object.assign(ru, d.ru);
  Object.assign(de, d.de);
  Object.assign(zh, d.zh);
}

interface Row { key: string; en: string; ru: string; de: string; ruRatio: number; deRatio: number; maxLen: number }

const rows: Row[] = [];
for (const [key, enVal] of Object.entries(en)) {
  const ruVal = ru[key] ?? '';
  const deVal = de[key] ?? '';
  const ruRatio = enVal.length ? ruVal.length / enVal.length : 0;
  const deRatio = enVal.length ? deVal.length / enVal.length : 0;
  rows.push({ key, en: enVal, ru: ruVal, de: deVal, ruRatio, deRatio, maxLen: Math.max(enVal.length, ruVal.length, deVal.length) });
}

const RATIO_ALERT = 1.55;

// Short/medium UI chrome (buttons, labels, tabs, menu items) — the strings
// that live inside fixed-width chrome and cannot wrap: the real "interface
// slides" candidates. Filter by EN length <= 28 (single-line chrome).
const chrome = rows.filter(r => r.en.length <= 28);
const flagged = chrome.filter(r => (r.ruRatio >= RATIO_ALERT && r.ru.length >= 10) || (r.deRatio >= RATIO_ALERT && r.de.length >= 10));

console.log(`total keys: ${rows.length}`);
console.log(`\n== CHROME strings (EN<=28 chars) with ru/de >= ${RATIO_ALERT}x EN == (${flagged.length})`);
for (const r of flagged.sort((a, b) => Math.max(b.ruRatio, b.deRatio) - Math.max(a.ruRatio, a.deRatio))) {
  console.log(`${r.key}  [en ${r.en} / ru ${r.ru.length} / de ${r.de.length}]`);
  console.log(`   en: "${r.en}"`);
  console.log(`   ru: "${r.ru}" (${r.ruRatio.toFixed(2)}x)   de: "${r.de}" (${r.deRatio.toFixed(2)}x)`);
}

const ratios = rows.map(r => r.ruRatio).filter(x => x > 0).sort((a, b) => a - b);
const pct = (p: number) => ratios[Math.floor(ratios.length * p)]?.toFixed(2);
console.log(`\nru/en ratio distribution: p50=${pct(0.5)} p75=${pct(0.75)} p90=${pct(0.9)} p99=${pct(0.99)} max=${ratios[ratios.length - 1]?.toFixed(2)}`);

// worst absolute chrome strings in ru
const worstRu = chrome.filter(r => r.ru.length > 0).sort((a, b) => b.ru.length - a.ru.length).slice(0, 25);
console.log(`\n== longest ru chrome strings ==`);
for (const r of worstRu) console.log(`${r.key}  ru(${r.ru.length}) vs en(${r.en.length}): "${r.ru}"`);
