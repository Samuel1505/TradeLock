import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ENV_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '.env');

/** Set KEY=value in the repo's .env (gitignored) and process.env. Used to record deploy outputs for idempotent re-runs. */
export function upsertEnv(key: string, value: string): void {
  const lines = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, 'utf8').split('\n') : [];
  const i = lines.findIndex((l) => l.startsWith(`${key}=`));
  if (i >= 0) lines[i] = `${key}=${value}`;
  else lines.push(`${key}=${value}`);
  writeFileSync(ENV_PATH, lines.join('\n').replace(/\n*$/, '\n'));
  process.env[key] = value;
}
