import { describe, expect, it } from 'vitest';
import { redact, secretValues } from '../src/redact.js';

const KEY = '0x' + 'ab'.repeat(32);
const TX = '0x' + 'cd'.repeat(32);
const env = { SEPOLIA_CARRIER_PK: KEY, SEPOLIA_SUPPLIER_PK: '0x_placeholder', NEAR_RPC_URL: 'https://rpc.testnet.fastnear.com', DEMO_BUYER: 'buyer.samuelowen.testnet' };

describe('redact', () => {
  const secrets = secretValues(env);
  it('collects only secret-named, non-placeholder values', () => {
    expect(secrets).toEqual([KEY, KEY.slice(2)]);
  });
  it('masks the key with and without 0x, in any case', () => {
    expect(redact(`pk=${KEY}`, secrets)).toBe('pk=[REDACTED]');
    expect(redact(`raw ${KEY.slice(2).toUpperCase()} end`, secrets)).toBe('raw [REDACTED] end');
  });
  it('keeps tx hashes, accounts and NEAR public keys visible', () => {
    // Public-key-shaped (32 bytes ≈ 44 base58 chars), synthetic.
    const pub = 'ed25519:' + '2'.repeat(44);
    const line = `tx ${TX} by buyer.samuelowen.testnet public ${pub}`;
    expect(redact(line, secrets)).toBe(line);
  });
  it('masks anything shaped like a NEAR ed25519 secret key', () => {
    const sk = 'ed25519:' + '3'.repeat(88);
    expect(redact(`secret ${sk}`, secrets)).toBe('secret ed25519:[REDACTED-SECRET-KEY]');
  });
});
