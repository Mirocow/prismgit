import type { RemoteInfo } from './api';
import type { ContextMenuItem } from './useContextMenu';
import { t as i18nT } from './i18n';

/**
 * State snapshot needed to build the Remotes tool's right-click menu.
 * The menu mirrors the native context menu used in the sidebar repository
 * list (useContextMenu) and exposes the same actions as the row buttons.
 */
export interface RemoteMenuState {
  /** A git fetch for this remote is currently running */
  busy: boolean;
  /** ls-remote preview is expanded */
  expanded: boolean;
  /** "Perform background Poll or Fetch" is enabled for this remote */
  backgroundFetch: boolean;
}

/**
 * Build the native context menu items for one remote row in the Remotes tool.
 * Pure function so the item list is unit-testable (native Electron menus
 * cannot be driven by Playwright e2e).
 */
export function buildRemoteContextMenu(
  remote: RemoteInfo,
  state: RemoteMenuState
): ContextMenuItem[] {
  const hasSeparatePushUrl = Boolean(remote.refs.push) && remote.refs.push !== remote.refs.fetch;
  return [
    { label: i18nT('ctx.remote.fetchWithPrune').replace('{name}', remote.name), clickId: 'fetch', enabled: !state.busy },
    {
      label: state.expanded
        ? i18nT('ctx.remote.hideRemoteRefs')
        : i18nT('ctx.remote.previewRemoteRefs'),
      clickId: 'preview',
    },
    { label: i18nT('ctx.remote.copyFetchUrl'), clickId: 'copy-fetch' },
    ...(hasSeparatePushUrl
      ? [{ label: i18nT('ctx.remote.copyPushUrl'), clickId: 'copy-push' } as ContextMenuItem]
      : []),
    { type: 'separator' },
    { label: i18nT('ctx.remote.browseBranches'), clickId: 'branches' },
    { label: i18nT('ctx.remote.edit').replace('{name}', remote.name), clickId: 'edit' },
    { label: i18nT('ctx.remote.rename').replace('{name}', remote.name), clickId: 'rename' },
    { type: 'separator' },
    {
      label: i18nT('ctx.remote.backgroundPollOrFetch'),
      type: 'checkbox',
      checked: state.backgroundFetch,
      clickId: 'toggle-background',
    },
    { label: i18nT('ctx.remote.repositorySettings'), clickId: 'repo-settings' },
    { type: 'separator' },
    { label: i18nT('ctx.remote.removeRemote').replace('{name}', remote.name), clickId: 'remove' },
  ];
}
