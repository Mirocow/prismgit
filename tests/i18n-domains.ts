/**
 * Test-only registry of all i18n domain modules.
 *
 * Production code in `src/i18n/locales/index.ts` builds the static English
 * fallback by directly merging domain modules — it never exports the full
 * DOMAINS map, because doing so would pull ru/zh/de dictionaries from every
 * domain into the startup bundle (~711 KB / ~180 KB gzipped of dead weight).
 *
 * The parity tests, however, need to walk every domain's en/ru/zh/de
 * dictionaries to assert key-set equality. They import from here instead.
 *
 * Vite/Rollup exclude this file from the production bundle because it is
 * only reachable from `tests/` (which are not part of the build graph).
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
import * as vscode from '../src/i18n/locales/domains/vscode';
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

export type DomainDict = { en: Record<string, string>; ru: Record<string, string>; zh: Record<string, string>; de: Record<string, string> };

export const DOMAINS: Record<string, DomainDict> = {
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
  search,
  tour,
  aiassistant,
  toasts,
  actions,
  contextMenus,
  banner,
  conflict,
  iRebase,
  nav,
  errors,
};
