/**
 * NEAR transactions through the `near` CLI (near-cli-rs 0.30.1) with keys from the OS keychain, the same
 * signing path the human approves interactively. No shell: arguments are passed as an array.
 */
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { NonRetryableError } from '@tradelock/shared';

const NEAR_BIN = process.env.NEAR_CLI ?? join(homedir(), '.cargo', 'bin', 'near');

export interface CallSpec {
  signer: string;
  contract: string;
  method: string;
  args: unknown;
  gasTgas: number;
  /** e.g. "1 yoctoNEAR", "0.1 NEAR", "0 NEAR" */
  deposit: string;
  network: string;
}

export interface CallResult {
  txId: string;
  value: unknown;
}

const quote = (s: string) => (/^[\w.\-/:@]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);

export function cliArgs(c: CallSpec): string[] {
  return [
    'contract', 'call-function', 'as-transaction', c.contract, c.method,
    'json-args', JSON.stringify(c.args),
    'prepaid-gas', `${c.gasTgas.toFixed(1)} Tgas`,
    'attached-deposit', c.deposit,
    'sign-as', c.signer,
    'network-config', c.network,
    'sign-with-keychain', 'send',
  ];
}

/** The exact command, printable for the human. */
export const commandLine = (c: CallSpec) => ['near', ...cliArgs(c)].map(quote).join(' ');

export async function callNear(c: CallSpec, timeoutMs = 180_000): Promise<CallResult> {
  const { code, stdout, stderr } = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const p = spawn(NEAR_BIN, cliArgs(c), { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const t = setTimeout(() => {
      p.kill('SIGTERM');
      reject(new Error(`near CLI timed out after ${timeoutMs} ms (${c.method}); re-run the demo to resume from chain state`));
    }, timeoutMs);
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('error', (e) => {
      clearTimeout(t);
      reject(new NonRetryableError(`cannot start ${NEAR_BIN}: ${e.message}`));
    });
    p.on('close', (code) => {
      clearTimeout(t);
      resolve({ code, stdout: out, stderr: err });
    });
  });
  const txId = /Transaction ID:\s*([1-9A-HJ-NP-Za-km-z]{43,44})/.exec(stderr)?.[1];
  const failed = code !== 0 || /\bError\b|Failure|failed/i.test(stderr.replace(/new update available[\s\S]*?self-update/i, ''));
  if (failed) {
    const tail = stderr.trim().split('\n').slice(-12).join('\n');
    throw new NonRetryableError(`${c.contract}.${c.method} failed${txId ? ` (tx ${txId})` : ''}:\n${tail}`);
  }
  if (!txId) throw new NonRetryableError(`${c.contract}.${c.method}: no transaction id in CLI output`);
  const trimmed = stdout.trim();
  let value: unknown = null;
  if (trimmed) {
    try {
      value = JSON.parse(trimmed);
    } catch {
      value = trimmed;
    }
  }
  return { txId, value };
}
