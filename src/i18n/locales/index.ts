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
 * domain must provide all four languages for every key. The parity tests
 * import DOMAINS from `tests/i18n-domains.ts` (NOT from here) so the
 * ru/zh/de dictionaries from each domain stay out of the production bundle.
 *
 * IMPORTANT: do NOT re-export DOMAINS from this file. Doing so pulls the
 * ru/zh/de dictionaries of every domain into the startup bundle (~180 KB
 * gzipped of dead weight, because Rollup cannot prove they are unused).
 */
import { en as coreEn } from './core';
import { en as shellEn } from './domains/shell';
import { en as changesEn } from './domains/changes';
import { en as historyEn } from './domains/history';
import { en as diffEn } from './domains/diff';
import { en as branchesEn } from './domains/branches';
import { en as stashesEn } from './domains/stashes';
import { en as tagsEn } from './domains/tags';
import { en as remotesEn } from './domains/remotes';
import { en as dialogsEn } from './domains/dialogs';
import { en as pagesEn } from './domains/pages';
import { en as settingsEn } from './domains/settings';
import { en as vscodeEn } from './domains/vscode';
import { en as searchEn } from './domains/search';
import { en as tourEn } from './domains/tour';
import { en as aiassistantEn } from './domains/aiassistant';
import { en as toastsEn } from './domains/toasts';
import { en as actionsEn } from './domains/actions';
import { en as contextMenusEn } from './domains/contextMenus';
import { en as bannerEn } from './domains/banner';
import { en as conflictEn } from './domains/conflict';
import { en as iRebaseEn } from './domains/iRebase';
import { en as navEn } from './domains/nav';
import { en as errorsEn } from './domains/errors';

/** Static English merge — synchronous fallback for the whole app.
 *
 * Built by spreading each domain's `en` dictionary directly (not by walking
 * a runtime `DOMAINS` object) so Rollup can tree-shake the ru/zh/de exports
 * of each domain module out of the production startup bundle.
 */
export const en: Record<string, string> = {
  ...coreEn,
  ...shellEn,
  ...changesEn,
  ...historyEn,
  ...diffEn,
  ...branchesEn,
  ...stashesEn,
  ...tagsEn,
  ...remotesEn,
  ...dialogsEn,
  ...pagesEn,
  ...settingsEn,
  ...vscodeEn,
  ...searchEn,
  ...tourEn,
  ...aiassistantEn,
  ...toastsEn,
  ...actionsEn,
  ...contextMenusEn,
  ...bannerEn,
  ...conflictEn,
  ...iRebaseEn,
  ...navEn,
  ...errorsEn,
};

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
