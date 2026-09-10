import type { RemoteInfo } from './api';
import type { ContextMenuItem } from './useContextMenu';

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
    { label: `Fetch '${remote.name}' (with prune)`, clickId: 'fetch', enabled: !state.busy },
    {
      label: state.expanded ? 'Hide remote refs' : 'Preview remote refs (ls-remote)',
      clickId: 'preview',
    },
    { label: 'Copy fetch URL', clickId: 'copy-fetch' },
    ...(hasSeparatePushUrl
      ? [{ label: 'Copy push URL', clickId: 'copy-push' } as ContextMenuItem]
      : []),
    { type: 'separator' },
    { label: 'Browse branches', clickId: 'branches' },
    { label: `Edit '${remote.name}'...`, clickId: 'edit' },
    { label: `Rename '${remote.name}'...`, clickId: 'rename' },
    { type: 'separator' },
    {
      label: 'Perform background Poll or Fetch',
      type: 'checkbox',
      checked: state.backgroundFetch,
      clickId: 'toggle-background',
    },
    { label: 'Repository Settings...', clickId: 'repo-settings' },
    { type: 'separator' },
    { label: `Remove remote '${remote.name}'...`, clickId: 'remove' },
  ];
}
