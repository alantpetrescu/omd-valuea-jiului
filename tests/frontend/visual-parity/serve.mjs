/**
 * A static file server for the staged prototype.
 *
 *   node tests/frontend/visual-parity/serve.mjs
 *
 * The bash runner used `python -m http.server`, which meant the suite needed a
 * Python interpreter for one job Node already does — and on Windows `python3` is
 * usually the Microsoft Store stub, which exits without serving anything. The
 * suite then failed four steps later, at the first screenshot, with a connection
 * refused and no hint why.
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';

import { PROTO_PORT, PROTO_SERVE } from '../../shared/config.mjs';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

createServer((request, response) => {
  const path = decodeURIComponent(request.url.split('?')[0]);

  /*
   * `normalize` collapses `..` before anything touches the disk, and the result
   * is joined onto the docroot rather than resolved against it — a path that
   * tried to climb out lands harmlessly at the root instead.
   */
  const relative = normalize(path).replace(/^([/\\.]+)/, '');
  const file = join(PROTO_SERVE, relative === '' ? 'index.html' : relative);

  if (!existsSync(file) || !statSync(file).isFile()) {
    response.statusCode = 404;
    response.end('not found');
    return;
  }

  response.statusCode = 200;
  response.setHeader('Content-Type', TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream');
  createReadStream(file).pipe(response);
}).listen(PROTO_PORT, '127.0.0.1', () => {
  console.log(`prototip servit pe :${PROTO_PORT}`);
});
