/**
 * Aggregated German dictionary — dynamic-import target (see aggregated/ru.ts).
 */
import { de as core } from '../core';
import { de as shell } from '../domains/shell';
import { de as changes } from '../domains/changes';
import { de as history } from '../domains/history';
import { de as diff } from '../domains/diff';
import { de as branches } from '../domains/branches';
import { de as stashes } from '../domains/stashes';
import { de as tags } from '../domains/tags';
import { de as remotes } from '../domains/remotes';
import { de as dialogs } from '../domains/dialogs';
import { de as pages } from '../domains/pages';
import { de as settings } from '../domains/settings';
import { de as vscode } from '../domains/vscode';
import { de as search } from '../domains/search';
import { de as tour } from '../domains/tour';
import { de as aiassistant } from '../domains/aiassistant';
import { de as toasts } from '../domains/toasts';
import { de as actions } from '../domains/actions';
import { de as contextMenus } from '../domains/contextMenus';
import { de as banner } from '../domains/banner';
import { de as conflict } from '../domains/conflict';
import { de as iRebase } from '../domains/iRebase';
import { de as nav } from '../domains/nav';

export const de: Record<string, string> = {
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
};
