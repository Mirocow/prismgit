/**
 * Locale aggregation.
 *
 * Each domain module (core + ./domains/*) exports four flat dictionaries
 * (en/ru/zh/de). Only the ENGLISH merge is static — it is the fallback and
 * must be available synchronously (and stays in the startup bundle). The
 * ru/zh/de merges live in ./aggregated/* and are loaded on demand via
 * `loadLocaleDict()` (see src/lib/i18n.ts), so the startup bundle carries
 * one locale instead of four.
 *
 * `t()` in src/lib/i18n.ts falls back to English when a key is missing in
 * the active locale — but the unit tests assert exact key parity, so every
 * domain must provide all four languages for every key.
 */
import * as core from './core';
import * as shell from './domains/shell';
import * as changes from './domains/changes';
import * as history from './domains/history';
import * as diff from './domains/diff';
import * as branches from './domains/branches';
import * as stashes from './domains/stashes';
import * as tags from './domains/tags';
import * as remotes from './domains/remotes';
import * as dialogs from './domains/dialogs';
import * as pages from './domains/pages';
import * as settings from './domains/settings';
import * as vscode from './domains/vscode';

/** All domain modules — used by the parity tests to walk every dictionary. */
export const DOMAINS: Record<string, { en: Record<string, string>; ru: Record<string, string>; zh: Record<string, string>; de: Record<string, string> }> = {
  core,
  shell,
  changes,
  history,
  diff,
  branches,
  stashes,
  tags,
  remotes,
  dialogs,
  pages,
  settings,
  vscode,
};

/** Static English merge — synchronous fallback for the whole app. */
export const en: Record<string, string> = Object.values(DOMAINS).reduce((acc, d) => ({ ...acc, ...d.en }), {});

/** Locales whose dictionaries load asynchronously (non-fallback languages). */
export type AsyncLocale = 'ru' | 'zh' | 'de';

/**
 * Load the aggregated dictionary for a non-English locale. Returns undefined
 * for 'en' (already static) or unknown ids.
 */
export function loadLocaleDict(locale: string): Promise<Record<string, string> | undefined> {
  switch (locale) {
    case 'ru':
      return import('./aggregated/ru').then((m) => m.ru);
    case 'zh':
      return import('./aggregated/zh').then((m) => m.zh);
    case 'de':
      return import('./aggregated/de').then((m) => m.de);
    default:
      return Promise.resolve(undefined);
  }
}
