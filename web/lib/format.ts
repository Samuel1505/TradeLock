export function formatAmount(base: string, decimals: number): string {
  const v = BigInt(base);
  const d = 10n ** BigInt(decimals);
  const whole = v / d;
  const frac = (v % d).toString().padStart(decimals, '0').slice(0, 2);
  return `${whole.toLocaleString('en-US')}.${frac}`;
}

export function parseAmount(input: string, decimals: number): string {
  const m = /^(\d+)(?:\.(\d*))?$/.exec(input.trim());
  if (!m) throw new Error('Enter an amount like 1.00');
  const frac = (m[2] ?? '').padEnd(decimals, '0');
  if (frac.length > decimals) throw new Error(`At most ${decimals} decimals`);
  const v = BigInt(m[1]!) * 10n ** BigInt(decimals) + BigInt(frac || '0');
  if (v === 0n) throw new Error('Amount must be greater than zero');
  return v.toString();
}

/** ns timestamp → readable local time. */
export const formatTime = (ns: string) => new Date(Number(BigInt(ns) / 1_000_000n)).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

export const short = (a: string) => (a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);
