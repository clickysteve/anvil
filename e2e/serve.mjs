// Static server for browser tests: the /anvil/ build at /anvil/ and the relative build at /.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const port = Number(process.env.PORT || 4321);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff': 'font/woff', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.json': 'application/json' };

createServer(async (req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  const [root, rel] = url.startsWith('/anvil/') || url === '/anvil' ? ['dist-e2e/anvil', url.slice('/anvil'.length)] : ['dist-e2e/root', url];
  let file = normalize(join(root, rel || '/'));
  if (!file.startsWith(normalize(root))) return void res.writeHead(403).end();
  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(port, () => console.log(`serving on ${port}`));
