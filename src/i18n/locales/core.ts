/**
 * Core dictionary — app-wide shared strings (common actions, navigation,
 * sidebar, toolbar, settings chrome, toasts). Seeded before the domain sweep;
 * per-domain strings live in ./domains/<domain>.ts.
 *
 * Each `en`/`ru`/`zh`/`de` export is sourced from its own flat file so
 * bundlers can tree-shake: code that only imports `en` (the static English
 * fallback in `./index.ts`) does NOT pull `ru.ts`/`zh.ts`/`de.ts` into the
 * startup bundle. The lazy `aggregated/ru.ts` chunk separately imports
 * `ru` from here, which is what pulls the Russian flat file into its chunk.
 */
export { en } from './en';
export { ru } from './ru';
export { zh } from './zh';
export { de } from './de';
