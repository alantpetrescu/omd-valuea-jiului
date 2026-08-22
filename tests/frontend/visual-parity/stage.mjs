/**
 * Stages the prototype so it can be served over HTTP.
 *
 *   node tests/frontend/visual-parity/stage.mjs
 *
 * Copies the v13.3 page, its importer, and the four demo packages into a docroot
 * the parity runner then serves. Both halves of the comparison have to come from
 * the same seeds, or the diff measures the data rather than the rendering.
 */
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { basename, resolve } from 'node:path';

import { IMPORTER_JS, PROTOTYPE_HTML, PROTO_SERVE, SEEDS } from '../../shared/config.mjs';

mkdirSync(PROTO_SERVE, { recursive: true });

copyFileSync(PROTOTYPE_HTML, resolve(PROTO_SERVE, 'index.html'));
copyFileSync(IMPORTER_JS, resolve(PROTO_SERVE, basename(IMPORTER_JS)));

/*
 * The seeds go in twice, and both places are needed.
 *
 * `omd_import_packages_v1.js` fetches them from `../04_DEMO_SEEDS/`, relative to
 * the page — the layout of the delivered package, not of this staging directory.
 * Copying them only next to index.html left every fetch at 404, the prototype
 * booted with zero campaigns, and the capture step timed out waiting for six.
 *
 * Inside the docroot, not beside it: index.html is served from `/`, and a browser
 * clamps `..` at the root, so `../04_DEMO_SEEDS/x.json` is requested as
 * `/04_DEMO_SEEDS/x.json`.
 */
const sibling = resolve(PROTO_SERVE, '04_DEMO_SEEDS');
mkdirSync(sibling, { recursive: true });

let copied = 0;
for (const name of readdirSync(SEEDS)) {
  if (!name.endsWith('.json')) continue;
  copyFileSync(resolve(SEEDS, name), resolve(PROTO_SERVE, name));
  copyFileSync(resolve(SEEDS, name), resolve(sibling, name));
  copied += 1;
}

console.log(`prototip pregătit în ${PROTO_SERVE} (${copied} pachete)`);
