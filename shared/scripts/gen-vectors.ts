/**
 * Generates reference vectors consumed by contracts/tradelock-proof unit tests.
 *  - title_tx.json: viem serializeTransaction + keccak256 for TitleEscrow.transferOwners txs. Calldata comes from
 *    the TradeTrust 5.5.2 ABI (encodeFunctionData), independent of the Rust encoder.
 *  - derived_address.json: v1.signer.derived_public_key (live mainnet) + chainsig.js address for known paths.
 * Re-run: `pnpm gen:vectors`. Output is committed; tests never hit the network.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeFunctionData, getAddress, keccak256, serializeTransaction, type Address } from 'viem';
import { TitleEscrowArtifact } from '../src/tradetrust.js';
import { deriveEvmAddress, evmAddressFromNajKey, fetchRootKey } from '../src/derive.js';
import { nearView } from '../src/near.js';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'contracts', 'tradelock-proof', 'tests', 'vectors');
mkdirSync(outDir, { recursive: true });

interface TxCase {
  name: string;
  chainId: number;
  nonce: number;
  maxPriorityFeePerGas: bigint;
  maxFeePerGas: bigint;
  gas: bigint;
  to: Address;
  destination: Address;
}

const cases: TxCase[] = [
  {
    name: 'sepolia_typical',
    chainId: 11155111,
    nonce: 0,
    maxPriorityFeePerGas: 1_500_000_000n,
    maxFeePerGas: 30_000_000_000n,
    gas: 120_000n,
    to: getAddress('0x3781bd0bbd15bf5e45c7296115821933d47362be'),
    destination: getAddress('0x4abc235f7325d7a378ac01d05a1b122b78e2d7c3'),
  },
  {
    name: 'zero_priority_fee_mainnet_chain',
    chainId: 1,
    nonce: 7,
    maxPriorityFeePerGas: 0n,
    maxFeePerGas: 1n,
    gas: 21_000n,
    to: getAddress('0x00000000000000000000000000000000000000ff'),
    destination: getAddress('0xffffffffffffffffffffffffffffffffffffffff'),
  },
  {
    name: 'large_values',
    chainId: 11155111,
    nonce: 4_294_967_301, // > u32
    maxPriorityFeePerGas: 18_446_744_073_709_551_616n, // 2^64, > u64
    maxFeePerGas: 340_282_366_920_938_463_463_374_607_431_768_211_455n, // u128::MAX
    gas: 30_000_000n,
    to: getAddress('0x1000000000000000000000000000000000000001'),
    destination: getAddress('0x0000000000000000000000000000000000000001'),
  },
];

const txVectors = cases.map((c) => {
  const data = encodeFunctionData({ abi: TitleEscrowArtifact.abi, functionName: 'transferOwners', args: [c.destination, c.destination, '0x'] });
  const unsigned = serializeTransaction({
    type: 'eip1559',
    chainId: c.chainId,
    nonce: c.nonce,
    maxPriorityFeePerGas: c.maxPriorityFeePerGas,
    maxFeePerGas: c.maxFeePerGas,
    gas: c.gas,
    to: c.to,
    value: 0n,
    data,
    accessList: [],
  });
  return {
    name: c.name,
    chain_id: c.chainId,
    nonce: String(c.nonce),
    max_priority_fee_per_gas: c.maxPriorityFeePerGas.toString(),
    max_fee_per_gas: c.maxFeePerGas.toString(),
    gas_limit: c.gas.toString(),
    to: c.to.toLowerCase(),
    destination: c.destination.toLowerCase(),
    data,
    unsigned_tx: unsigned,
    payload: keccak256(unsigned),
  };
});
writeFileSync(join(outDir, 'title_tx.json'), JSON.stringify({ generator: 'viem@2.57.16 serializeTransaction + keccak256', vectors: txVectors }, null, 2) + '\n');
console.log(`title_tx.json: ${txVectors.length} vectors`);

// Network from .env (D-018: testnet). Vectors record which MPC contract produced them.
import '../src/env.js';
const rpc = [process.env.NEAR_RPC_URL ?? 'https://rpc.testnet.fastnear.com'];
const mpc = process.env.MPC_CONTRACT_ID ?? 'v1.signer-prod.testnet';
const contractAccount = process.env.PROOF_CONTRACT_ID ?? 'tradelock.samuelowen.testnet';
const root = await fetchRootKey(rpc, mpc);
const pairs: [string, string][] = [
  [contractAccount, 'tradelock/proof/0'],
  [contractAccount, 'tradelock/deal/0'],
  [contractAccount, 'tradelock/deal/1'],
];
const addrVectors = [];
for (const [predecessor, path] of pairs) {
  const naj = await nearView<string>(rpc, mpc, 'derived_public_key', { path, predecessor, domain_id: 0 });
  const fromView = evmAddressFromNajKey(naj);
  const fromChainsig = deriveEvmAddress(root, predecessor, path);
  if (fromView !== fromChainsig) throw new Error(`mismatch ${predecessor}/${path}: view ${fromView} chainsig ${fromChainsig}`);
  addrVectors.push({ predecessor, path, derived_public_key: naj, address: fromChainsig.toLowerCase() });
}
writeFileSync(
  join(outDir, 'derived_address.json'),
  JSON.stringify({ mpc, rpc: rpc[0], root_key_domain_0: root, generated: new Date().toISOString().slice(0, 10), vectors: addrVectors }, null, 2) + '\n',
);
console.log(`derived_address.json: ${addrVectors.length} vectors (chainsig.js == v1.signer view)`);
