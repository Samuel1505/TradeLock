import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { getAddress } from 'viem';
import { deriveEvmAddress, evmAddressFromNajKey, fetchMpcDerivedAddress, nearView } from '../src/index.js';

const vectors = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../contracts/tradelock-proof/tests/vectors/derived_address.json'), 'utf8'),
) as { root_key_domain_0: string; vectors: { predecessor: string; path: string; derived_public_key: string; address: string }[] };

describe('derivation (offline vectors)', () => {
  for (const v of vectors.vectors) {
    it(`${v.predecessor} / ${v.path}`, () => {
      // chainsig.js from root key == address of v1.signer's derived key (both recorded by gen:vectors)
      expect(deriveEvmAddress(vectors.root_key_domain_0, v.predecessor, v.path)).toBe(getAddress(v.address));
      expect(evmAddressFromNajKey(v.derived_public_key)).toBe(getAddress(v.address));
    });
  }
  it('rejects a compressed (33-byte) key', () => {
    expect(() => evmAddressFromNajKey('secp256k1:' + 'z'.repeat(45))).toThrow(/64-byte|base58|Non-base58/i);
  });
});

const network = process.env.RUN_NETWORK_TESTS === '1';
import '../src/env.js';
const rpc = [process.env.NEAR_RPC_URL ?? 'https://rpc.testnet.fastnear.com'];
const mpc = process.env.MPC_CONTRACT_ID ?? 'v1.signer-prod.testnet';
describe.runIf(network)('derivation (live network)', () => {
  it('root key unchanged and v1.signer view matches vectors', async () => {
    expect(await nearView<string>(rpc, mpc, 'public_key', { domain_id: 0 })).toBe(vectors.root_key_domain_0);
    for (const v of vectors.vectors) expect(await fetchMpcDerivedAddress(rpc, mpc, v.predecessor, v.path)).toBe(getAddress(v.address));
  });
  it.runIf(!!process.env.PROOF_CONTRACT_ID)('every eBL deal: tradelock-stored derived address == JS derivation (D-013)', async (ctx) => {
    const id = process.env.PROOF_CONTRACT_ID!;
    let next: string;
    try {
      next = await nearView<string>(rpc, id, 'get_next_deal_id', {});
    } catch (e) {
      if (/NO_CONTRACT_CODE|CodeDoesNotExist|MethodNotFound/i.test(String(e))) return ctx.skip(`${id} runs no tradelock contract`);
      throw e;
    }
    if (Number(next) === 0) return ctx.skip('no deals yet');
    for (let d = 0; d < Number(next); d++) {
      const deal = await nearView<{ ebl: { derived_address: string | null; derivation_path: string } | null }>(rpc, id, 'get_deal', { deal_id: String(d) });
      if (!deal.ebl?.derived_address) continue;
      expect(getAddress(deal.ebl.derived_address)).toBe(deriveEvmAddress(vectors.root_key_domain_0, id, deal.ebl.derivation_path));
    }
  });
});
