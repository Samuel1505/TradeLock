import { utils } from 'chainsig.js';
import { getAddress, keccak256, type Address, type Hex } from 'viem';
import { nearView } from './near.js';
import { NonRetryableError } from './retry.js';

/** MPC domain of the secp256k1 signing key on v1.signer (DECISIONS V-01). */
export const MPC_SECP256K1_DOMAIN_ID = 0;

export const dealPath = (dealId: bigint | number): string => `tradelock/deal/${dealId}`;
export const PROOF_PATH = 'tradelock/proof/0';

/** "secp256k1:<base58 of 64-byte x‖y>" → "04‖x‖y" hex (no 0x). Validates length. */
export function najToUncompressed(najKey: string): string {
  if (!najKey.startsWith('secp256k1:')) throw new NonRetryableError(`not a secp256k1 key: ${najKey}`);
  const hex = utils.cryptography.najToUncompressedPubKeySEC1(najKey as `secp256k1:${string}`);
  if (hex.length !== 2 + 128) throw new NonRetryableError(`expected 64-byte uncompressed key, got ${(hex.length - 2) / 2} bytes`);
  return hex;
}

/** EVM address = keccak256(x‖y)[12..]. Same computation the contract does with env::keccak256 (D-013). */
export function evmAddressFromUncompressed(uncompressed04: string): Address {
  const xy = `0x${uncompressed04.slice(2)}` as Hex;
  return getAddress(`0x${keccak256(xy).slice(-40)}`);
}

export const evmAddressFromNajKey = (najKey: string): Address => evmAddressFromUncompressed(najToUncompressed(najKey));

/** Client-side derivation with chainsig.js@1.1.16 (DECISIONS V-03). */
export function deriveEvmAddress(rootNajKey: string, predecessor: string, path: string): Address {
  const child = utils.cryptography.deriveChildPublicKey(najToUncompressed(rootNajKey) as `04${string}`, predecessor, path);
  return evmAddressFromUncompressed(child);
}

/** Root key read live from the MPC contract, so a key change fails loudly instead of silently diverging. */
export const fetchRootKey = (rpcUrls: string[], mpc: string) =>
  nearView<string>(rpcUrls, mpc, 'public_key', { domain_id: MPC_SECP256K1_DOMAIN_ID });

/** The MPC contract's own derivation — the contract-side reference (D-013). */
export async function fetchMpcDerivedAddress(rpcUrls: string[], mpc: string, predecessor: string, path: string): Promise<Address> {
  const naj = await nearView<string>(rpcUrls, mpc, 'derived_public_key', { path, predecessor, domain_id: MPC_SECP256K1_DOMAIN_ID });
  return evmAddressFromNajKey(naj);
}

/** Derive client-side and require agreement with v1.signer's view. Throws on mismatch. */
export async function deriveCrossChecked(rpcUrls: string[], mpc: string, predecessor: string, path: string): Promise<Address> {
  const [root, onchain] = await Promise.all([fetchRootKey(rpcUrls, mpc), fetchMpcDerivedAddress(rpcUrls, mpc, predecessor, path)]);
  const local = deriveEvmAddress(root, predecessor, path);
  if (local !== onchain) throw new NonRetryableError(`derivation mismatch for ${predecessor}/${path}: chainsig.js ${local} vs ${mpc} ${onchain}`);
  return local;
}
