/**
 * Aggregated Russian dictionary — dynamic-import target.
 *
 * Merges core (seed) + all domain dictionaries per locale. Loaded on demand
 * by src/lib/i18n.ts so the startup bundle only carries English (fallback);
 * the selected non-English locale arrives as its own async chunk.
 */
import { ru as core } from '../core';
import { ru as shell } from '../domains/shell';
import { ru as changes } from '../domains/changes';
import { ru as history } from '../domains/history';
import { ru as diff } from '../domains/diff';
import { ru as branches } from '../domains/branches';
import { ru as stashes } from '../domains/stashes';
import { ru as tags } from '../domains/tags';
import { ru as remotes } from '../domains/remotes';
import { ru as dialogs } from '../domains/dialogs';
import { ru as pages } from '../domains/pages';
import { ru as settings } from '../domains/settings';
import { ru as vscode } from '../domains/vscode';
import { ru as search } from '../domains/search';
import { ru as tour } from '../domains/tour';
import { ru as aiassistant } from '../domains/aiassistant';
import { ru as toasts } from '../domains/toasts';
import { ru as actions } from '../domains/actions';
import { ru as contextMenus } from '../domains/contextMenus';
import { ru as banner } from '../domains/banner';
import { ru as conflict } from '../domains/conflict';
import { ru as iRebase } from '../domains/iRebase';
import { ru as nav } from '../domains/nav';
import { ru as errors } from '../domains/errors';

export const ru: Record<string, string> = {
  ...core,
  ...shell,
  ...changes,
  ...history,
  ...diff,
  ...branches,
  ...stashes,
  ...tags,
  ...remotes,
  ...dialogs,
  ...pages,
  ...settings,
  ...vscode,
  ...search,
  ...tour,
  ...aiassistant,
  ...toasts,
  ...actions,
  ...contextMenus,
  ...banner,
  ...conflict,
  ...iRebase,
  ...nav,
  ...errors,
};
