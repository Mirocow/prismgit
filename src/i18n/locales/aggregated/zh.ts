/**
 * Aggregated Chinese dictionary — dynamic-import target (see aggregated/ru.ts).
 */
import { zh as core } from '../core';
import { zh as shell } from '../domains/shell';
import { zh as changes } from '../domains/changes';
import { zh as history } from '../domains/history';
import { zh as diff } from '../domains/diff';
import { zh as branches } from '../domains/branches';
import { zh as stashes } from '../domains/stashes';
import { zh as tags } from '../domains/tags';
import { zh as remotes } from '../domains/remotes';
import { zh as dialogs } from '../domains/dialogs';
import { zh as pages } from '../domains/pages';
import { zh as settings } from '../domains/settings';
import { zh as vscode } from '../domains/vscode';
import { zh as search } from '../domains/search';
import { zh as tour } from '../domains/tour';

export const zh: Record<string, string> = {
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
};
