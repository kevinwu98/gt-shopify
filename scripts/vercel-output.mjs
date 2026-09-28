// Packages the Hydrogen worker build (dist/) as Vercel Build Output API v3:
// static assets are served from the CDN, everything else hits one Edge Function.
import {cp, mkdir, rm, writeFile} from 'node:fs/promises';

const out = '.vercel/output';
const fn = `${out}/functions/index.func`;

await rm(out, {recursive: true, force: true});
await mkdir(fn, {recursive: true});
await cp('dist/client', `${out}/static`, {recursive: true});
await cp('dist/server/index.js', `${fn}/server.js`);

await writeFile(
  `${fn}/index.js`,
  `import worker from './server.js';

export default function handler(request, context) {
  return worker.fetch(request, process.env, {
    waitUntil: (promise) => context.waitUntil(promise),
    passThroughOnException() {},
  });
}
`,
);
await writeFile(
  `${fn}/.vc-config.json`,
  JSON.stringify({runtime: 'edge', entrypoint: 'index.js'}, null, 2),
);
await writeFile(
  `${out}/config.json`,
  JSON.stringify(
    {
      version: 3,
      routes: [
        {
          src: '^/assets/(.*)$',
          headers: {'cache-control': 'public, max-age=31536000, immutable'},
          continue: true,
        },
        {handle: 'filesystem'},
        {src: '/(.*)', dest: '/index'},
      ],
    },
    null,
    2,
  ),
);
console.log(`Vercel output written to ${out}`);
