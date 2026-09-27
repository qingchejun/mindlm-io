import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const ROOT = fileURLToPath(new URL('../..', import.meta.url));

/**
 * The end-to-end tests run the real `dist/cli.js`, so `npm test` builds it
 * first — tsdown takes well under a second, which is cheaper than maintaining a
 * second way to start the CLI and the server.
 */
export default async function setup(): Promise<void> {
  await run('npm', ['run', '--silent', 'build'], { cwd: ROOT });
}
