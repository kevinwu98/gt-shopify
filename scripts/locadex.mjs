import {existsSync, mkdtempSync, writeFileSync, chmodSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

if (existsSync('.env.locadex')) process.loadEnvFile('.env.locadex');
const core = process.env.LOCADEX_CORE_DIR;
const agent = process.env.LOCADEX_AGENT ?? 'openai';
const command = process.argv[2] ?? 'check';
const keyPresent = Boolean(process.env.LOCADEX_SESSION_TOKEN ||
  (agent === 'anthropic' ? process.env.ANTHROPIC_API_KEY : process.env.OPENAI_API_KEY));
const cli = core ? resolve(core, 'src/cli.ts') : '';
const loader = core ? resolve(core, 'node_modules/tsx/dist/loader.mjs') : '';
const ready = Boolean(core && existsSync(cli) && existsSync(loader) && keyPresent);
if (command === 'check' || !ready) {
  console.log(`Locadex source: ${core && existsSync(cli) ? 'available' : 'configure LOCADEX_CORE_DIR'}`);
  console.log(`TypeScript runner: ${loader && existsSync(loader) ? 'available' : 'install Locadex core workspace dependencies'}`);
  console.log(`Agent credentials: ${keyPresent ? 'configured' : 'not configured'}`);
  console.log(`Actual Locadex run: ${ready ? 'ready' : 'not started'}`);
  if (!ready) console.log('See docs/LOCADEX.md. Credentials belong in ignored .env.locadex.');
  process.exit(ready || command === 'check' ? 0 : 1);
}
if (!['auto', 'i18n'].includes(command)) throw new Error('Expected check, auto, or i18n');
const bin = mkdtempSync(join(tmpdir(), 'gt-shopify-locadex-'));
const wrapper = join(bin, 'locadex-mcp');
const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
writeFileSync(wrapper, `#!/bin/sh\nexec ${quote(process.execPath)} --import ${quote(loader)} ${quote(resolve(core, 'src/mcp-stdio.ts'))} "$@"\n`);
chmodSync(wrapper, 0o700);
try {
  const args = ['--import', loader, cli, command, '--framework', 'react-router',
    '--agent', agent, '--package-manager', 'npm', '--local-translations',
    '--max-concurrency', '1', ...process.argv.slice(3)];
  const result = spawnSync(process.execPath, args, {
    stdio: 'inherit',
    env: {...process.env, PATH: `${bin}:${process.env.PATH ?? ''}`},
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(bin, {recursive: true, force: true});
}
