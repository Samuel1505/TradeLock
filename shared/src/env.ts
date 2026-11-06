import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { z } from 'zod';

config({ path: join(dirname(fileURLToPath(import.meta.url)), '..', '..', '.env'), quiet: true });

const hex32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'must be a 0x-prefixed 32-byte hex private key');
const addr = z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'must be a 0x-prefixed 20-byte address');

const schemas = {
  NEAR_RPC_URL: z.url(),
  NEAR_RPC_URL_FALLBACK: z.url().optional(),
  MPC_CONTRACT_ID: z.string().min(2),
  PROOF_CONTRACT_ID: z.string().min(2),
  PROOF_PATH: z.string().min(1),
  SEPOLIA_RPC_URL: z.url(),
  SEPOLIA_RPC_URL_FALLBACK: z.url().optional(),
  SEPOLIA_CARRIER_PK: hex32,
  SEPOLIA_SUPPLIER_PK: hex32,
  SEPOLIA_BUYER_ADDRESS: addr,
  TRADETRUST_FACTORY: addr,
  TRADETRUST_REGISTRY: addr,
  EBL_TOKEN_ID: z.string().regex(/^\d+$/, 'decimal uint256'),
  NEAR_NETWORK: z.enum(['testnet', 'mainnet']),
  TRADELOCK_CONTRACT_ID: z.string().min(2),
  VERIFIER_ID: z.string().min(2),
  TOKEN_CONTRACT_ID: z.string().min(2),
  DEMO_BUYER: z.string().min(2),
  DEMO_SUPPLIER: z.string().min(2),
  DEMO_ARBITER: z.string().min(2),
  DEMO_EXECUTOR: z.string().min(2),
  DEMO_AMOUNT: z.string().regex(/^\d+$/, 'token base units'),
} as const;
type Schemas = typeof schemas;
export type EnvKey = keyof Schemas;

/** Read only the variables a script needs; fails with every problem listed. */
export function requireEnv<K extends EnvKey>(...keys: K[]): { [P in K]: z.infer<Schemas[P]> } {
  const out: Record<string, unknown> = {};
  const problems: string[] = [];
  for (const k of keys) {
    const raw = process.env[k];
    const parsed = schemas[k].safeParse(raw === '' ? undefined : raw);
    if (parsed.success) out[k] = parsed.data;
    else problems.push(`${k}: ${parsed.error.issues.map((i) => i.message).join('; ')}`);
  }
  if (problems.length) throw new Error(`Missing/invalid env (see .env.example):\n  ${problems.join('\n  ')}`);
  return out as { [P in K]: z.infer<Schemas[P]> };
}

export const nearRpcUrls = (): string[] =>
  [process.env.NEAR_RPC_URL, process.env.NEAR_RPC_URL_FALLBACK].filter((u): u is string => !!u);
export const sepoliaRpcUrls = (): string[] =>
  [process.env.SEPOLIA_RPC_URL, process.env.SEPOLIA_RPC_URL_FALLBACK].filter((u): u is string => !!u);
