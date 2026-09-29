/**
 * Pure builder for the custom-theme-override <style> content (v2.3).
 *
 * Extracted from App.tsx so the selector strategy is unit-testable:
 * zone overrides must beat BOTH the base palette (:root/.dark) and the
 * per-theme [data-theme] blocks — including the dim-sidebar themes that
 * scope their dark sidebar to <aside>.
 */
export interface ZoneElementRule {
  /** Element-scoped selector for tokens that live on a concrete element. */
  selector: string;
  /** Token names routed through that selector. */
  vars: string[];
}

/**
 * Tokens that need an element-scoped rule to win against theme blocks:
 * the dim-sidebar themes define `--zone-sidebar-bg` on <aside> with
 * specificity (0,1,1); `html .sidebar-root` ties that and wins by source
 * order (the injected <style> is the LAST sheet in <head>).
 */
export const ZONE_ELEMENT_RULES: ZoneElementRule[] = [
  { selector: 'html .sidebar-root', vars: ['--zone-sidebar-bg'] },
];

/** All tokens managed by an element-scoped rule (flat set). */
export const ZONE_ELEMENT_VARS: Set<string> = new Set(
  ZONE_ELEMENT_RULES.flatMap((r) => r.vars),
);

/**
 * Build the stylesheet text for the given overrides.
 * - Root rule emits every override on `:root, html[data-theme]` (the
 *   attribute selector (0,1,1) beats [data-theme='x'] (0,1,0)).
 * - Element rules additionally re-emit their tokens scoped to the element,
 *   so element-level theme definitions cannot shadow the user override.
 * Returns '' when overrides is empty (caller removes the <style> tag).
 */
export function buildThemeOverrideCss(
  overrides: Record<string, string> | undefined | null,
): string {
  if (!overrides || Object.keys(overrides).length === 0) return '';
  const rootVars = Object.entries(overrides)
    .map(([k, v]) => `  ${k}: ${v};`)
    .join('\n');
  const scoped = ZONE_ELEMENT_RULES.map((rule) => {
    const body = rule.vars
      .filter((v) => overrides[v])
      .map((v) => `  ${v}: ${overrides[v]};`)
      .join('\n');
    return body ? `${rule.selector} {\n${body}\n}` : '';
  })
    .filter(Boolean)
    .join('\n');
  return `:root, html[data-theme] {\n${rootVars}\n}${scoped ? '\n' + scoped : ''}`;
}
