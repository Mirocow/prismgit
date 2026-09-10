/**
 * DeepLinkHandler — applies URL query parameters to the global selection store.
 *
 * Mounted next to DragDropHandler inside the Router (both the no-repo and the
 * repo layout). Whenever the location carries a query string, e.g.
 *
 *     #/history?file=src/App.tsx&branch=main
 *
 * the handler:
 *   1. parses the params (src/lib/deepLinks.ts — invalid values are dropped),
 *   2. applies them to selectionStore so EVERY tool reacts (History filter,
 *      Changes file selection, Toolbar branch badge, ...),
 *   3. if no repository is open yet, remembers the target page — when the user
 *      opens a repo, App navigates to it instead of the default /changes,
 *   4. strips the query from the URL (replace) so re-navigations don't re-apply
 *      stale params on top of the user's newer selections.
 */
import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useRepositoryStore } from '../stores/repositoryStore';
import {
  applyDeepLink,
  parseDeepLink,
  setPendingDeepLinkPage,
} from '../lib/deepLinks';

export function DeepLinkHandler() {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (!location.search) return;
    const params = parseDeepLink(location.search);
    if (params) {
      applyDeepLink(params);
      // No repo open → the target page cannot render yet (WelcomeScreen shows);
      // remember it so opening a repo lands on the deep-linked tool.
      if (!useRepositoryStore.getState().currentRepo) {
        setPendingDeepLinkPage(location.pathname);
      }
    }
    // Strip the query — selection now lives in the store.
    navigate(location.pathname, { replace: true });
  }, [location.search, location.pathname, navigate]);

  return null;
}
