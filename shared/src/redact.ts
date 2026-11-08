/**
 * Defence in depth for script output: mask secrets before anything reaches the terminal (or a screen recording).
 * Masks (1) the exact values of env vars whose names look secret, with and without 0x, any case; (2) anything
 * shaped like a NEAR ed25519 *secret* key (64 bytes → 80+ base58 chars; public keys are ~44 and stay visible).
 * Tx hashes and addresses are not secrets and are left alone.
 */
const SECRET_NAME = /(_PK|PRIVATE_KEY|SECRET|MNEMONIC|SEED)/i;
const NEAR_ED25519_SECRET = /ed25519:[1-9A-HJ-NP-Za-km-z]{80,}/g;

export function secretValues(env: NodeJS.ProcessEnv = process.env): string[] {
  const out = new Set<string>();
  for (const [name, value] of Object.entries(env)) {
    if (!value || !SECRET_NAME.test(name) || value.length < 16 || /placeholder/i.test(value)) continue;
    out.add(value);
    if (/^0x[0-9a-fA-F]+$/.test(value)) out.add(value.slice(2));
  }
  // Longest first so "0x…" is replaced before its bare-hex suffix.
  return [...out].sort((a, b) => b.length - a.length);
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function redact(text: string, secrets: string[] = secretValues()): string {
  let out = text;
  for (const s of secrets) out = out.replace(new RegExp(escape(s), 'gi'), '[REDACTED]');
  return out.replace(NEAR_ED25519_SECRET, 'ed25519:[REDACTED-SECRET-KEY]');
}

let installed = false;

/** Patch console.* and uncaught-error output so every line printed by this process is redacted. */
export function installRedaction(): void {
  if (installed) return;
  installed = true;
  const secrets = secretValues();
  const fmt = (args: unknown[]) =>
    args.map((a) => (typeof a === 'string' ? redact(a, secrets) : a instanceof Error ? redact(a.stack ?? a.message, secrets) : redact(JSON.stringify(a) ?? String(a), secrets)));
  for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    const orig = console[m].bind(console);
    console[m] = (...args: unknown[]) => orig(...fmt(args));
  }
  const fatal = (e: unknown) => {
    console.error(e instanceof Error ? e : String(e));
    process.exit(1);
  };
  process.on('uncaughtException', fatal);
  process.on('unhandledRejection', fatal);
}
