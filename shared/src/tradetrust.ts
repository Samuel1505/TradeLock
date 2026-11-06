import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Abi, Hex } from 'viem';

/** Artifacts from the installed @tradetrust-tt/token-registry@5.5.2 (bytecode pinned to that release, D-014). */
const pkgDist = dirname(createRequire(import.meta.url).resolve('@tradetrust-tt/token-registry'));
const load = (name: string) =>
  JSON.parse(readFileSync(join(pkgDist, 'artifacts', `${name}.sol`, `${name}.json`), 'utf8')) as { abi: Abi; bytecode: Hex };

export const TradeTrustTokenArtifact = load('TradeTrustToken');
export const TitleEscrowArtifact = load('TitleEscrow');
export const TitleEscrowFactoryArtifact = load('TitleEscrowFactory');

/** Official TradeTrust Sepolia TitleEscrowFactory (DECISIONS V-09, D-014). */
export const TRADETRUST_SEPOLIA_FACTORY = '0xfcafea839e576967b96ad1FBFB52b5CA26cd1D25' as const;

/** Selector of transferOwners(address,address,bytes) — must match contracts/tradelock-evm. */
export const TRANSFER_OWNERS_SELECTOR = '0x34427f61' as const;
