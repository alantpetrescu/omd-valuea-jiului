/**
 * The three packages the browser tests need, resolved from `frontend/`.
 *
 * The suites live in `tests/`, which has no `node_modules` of its own — and it
 * should not get one. A second install means a second lockfile, a second set of
 * versions, and a day where the tests run one Playwright against an application
 * built with another.
 *
 * `createRequire` anchored at `frontend/package.json` resolves exactly what the
 * application resolves. Bare `import 'playwright'` cannot: ESM resolution walks
 * up from the importing file, and nothing above `tests/` has these.
 */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(new URL('../../frontend/package.json', import.meta.url));

export const { chromium } = require('playwright');
export const { PNG } = require('pngjs');

/*
 * `pixelmatch` is ESM-only, so `require` hands back the module namespace rather
 * than the function, and calling it fails with "pixelmatch is not a function" —
 * after the captures have already been taken, which is the expensive half.
 *
 * `require.resolve` still finds the file; importing it from there gives the
 * default export.
 */
const pixelmatchModule = await import(pathToFileURL(require.resolve('pixelmatch')).href);
export const pixelmatch = pixelmatchModule.default ?? pixelmatchModule;
