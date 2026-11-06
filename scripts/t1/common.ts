import { getAddress, type Address, type Hex } from 'viem';
import { nearView, nearRpcUrls, requireEnv } from '@tradelock/shared';

export interface ProofConfig {
  mpc_contract: string;
  path: string;
  chain_id: number;
  title_escrow: string;
  destination: string;
  mpc_sign_deposit: string;
  mpc_sign_gas_tgas: number;
  callback_gas_tgas: number;
  max_fee_per_gas: string;
  max_priority_fee_per_gas: string;
  max_gas_limit: string;
}
export interface TxView {
  chain_id: number;
  nonce: string;
  max_priority_fee_per_gas: string;
  max_fee_per_gas: string;
  gas_limit: string;
  to: Address;
  value: string;
  data: Hex;
  unsigned_tx: Hex;
  payload: Hex;
}
export type LegView =
  | { status: 'Idle' }
  | { status: 'SignatureRequested'; tx: TxView }
  | { status: 'Signed'; tx: TxView; signature: { r: Hex; s: Hex; y_parity: number } };

export const proofEnv = () =>
  requireEnv('MPC_CONTRACT_ID', 'PROOF_CONTRACT_ID', 'PROOF_PATH', 'SEPOLIA_CARRIER_PK', 'SEPOLIA_BUYER_ADDRESS', 'TRADETRUST_REGISTRY', 'EBL_TOKEN_ID');

export const view = <T>(contract: string, method: string, args: unknown = {}) => nearView<T>(nearRpcUrls(), contract, method, args);

/** Contract-side derived address (stored by fetch_derived_address, D-013). Null until fetched. */
export async function contractDerivedAddress(contract: string): Promise<Address | null> {
  const a = await view<string | null>(contract, 'get_derived_address');
  return a ? getAddress(a) : null;
}

export const bigintJson = (o: unknown) => JSON.stringify(o, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2);
