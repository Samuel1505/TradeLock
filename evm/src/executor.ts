/**
 * Title-leg executor for any party (untrusted, D-019/ARCHITECTURE §2.3): prepare nonce/fees/gas within the
 * contract's bounds, rebuild + verify the MPC-signed tx, broadcast idempotently.
 */
import {
  encodeFunctionData,
  isAddressEqual,
  keccak256,
  recoverTransactionAddress,
  serializeTransaction,
  type Address,
  type Hash,
  type Hex,
  type PublicClient,
  type TransactionSerializableEIP1559,
} from 'viem';
import { NonRetryableError, TitleEscrowArtifact, withRetry } from '@tradelock/shared';

export interface FeeBounds {
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  maxGasLimit: bigint;
}

export interface TitleTxParams {
  nonce: number;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  gasLimit: bigint;
  /** Worst-case cost gasLimit × maxFee, wei. */
  worstCase: bigint;
}

/** Same shape as tradelock's TxView. */
export interface ContractTxView {
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

export interface ContractSigView {
  r: Hex;
  s: Hex;
  y_parity: number;
}

/** Nonce, fees and gas for transferOwners(dest, dest, 0x) from `from`, clamped to the contract's bounds. */
export async function prepareTitleTx(pub: PublicClient, from: Address, escrow: Address, dest: Address, bounds: FeeBounds): Promise<TitleTxParams> {
  const data = encodeFunctionData({ abi: TitleEscrowArtifact.abi, functionName: 'transferOwners', args: [dest, dest, '0x'] });
  const estimated = await withRetry(() => pub.estimateGas({ account: from, to: escrow, data, value: 0n }), { label: 'estimateGas' });
  const gasLimit = (estimated * 130n) / 100n;
  const fees = await withRetry(() => pub.estimateFeesPerGas({ type: 'eip1559', chain: null }), { label: 'fees' });
  const maxPriorityFeePerGas = fees.maxPriorityFeePerGas < 1_000_000_000n ? 1_000_000_000n : fees.maxPriorityFeePerGas;
  let maxFeePerGas = fees.maxFeePerGas * 2n > maxPriorityFeePerGas ? fees.maxFeePerGas * 2n : maxPriorityFeePerGas * 2n;
  if (maxFeePerGas > bounds.maxFeePerGas) maxFeePerGas = bounds.maxFeePerGas;
  if (maxPriorityFeePerGas > bounds.maxPriorityFeePerGas || maxPriorityFeePerGas > maxFeePerGas || gasLimit > bounds.maxGasLimit) {
    throw new NonRetryableError(`fees/gas outside contract bounds: priority ${maxPriorityFeePerGas}, maxFee ${maxFeePerGas}, gas ${gasLimit}`);
  }
  const nonce = await withRetry(() => pub.getTransactionCount({ address: from, blockTag: 'pending' }), { label: 'nonce' });
  return { nonce, maxFeePerGas, maxPriorityFeePerGas, gasLimit, worstCase: gasLimit * maxFeePerGas };
}

/** Rebuild the tx from the contract's stored fields; require identical bytes and the expected signer. */
export async function assembleSignedTitleTx(tx: ContractTxView, sig: ContractSigView, expectedSigner: Address): Promise<{ signed: Hex; hash: Hash; nonce: number }> {
  const unsigned: TransactionSerializableEIP1559 = {
    type: 'eip1559',
    chainId: tx.chain_id,
    nonce: Number(tx.nonce),
    maxPriorityFeePerGas: BigInt(tx.max_priority_fee_per_gas),
    maxFeePerGas: BigInt(tx.max_fee_per_gas),
    gas: BigInt(tx.gas_limit),
    to: tx.to,
    value: BigInt(tx.value),
    data: tx.data,
    accessList: [],
  };
  const viemUnsigned = serializeTransaction(unsigned);
  if (viemUnsigned !== tx.unsigned_tx) throw new NonRetryableError(`unsigned tx mismatch:\n viem     ${viemUnsigned}\n contract ${tx.unsigned_tx}`);
  if (keccak256(viemUnsigned) !== tx.payload) throw new NonRetryableError('payload mismatch');
  const signed = serializeTransaction(unsigned, { r: sig.r, s: sig.s, yParity: sig.y_parity });
  const signer = await recoverTransactionAddress({ serializedTransaction: signed as `0x02${string}` });
  if (!isAddressEqual(signer, expectedSigner)) throw new NonRetryableError(`signed tx recovers to ${signer}, expected ${expectedSigner}`);
  return { signed, hash: keccak256(signed), nonce: Number(tx.nonce) };
}

/**
 * Broadcast unless already known/mined. Throws NonRetryableError if the nonce was consumed by another tx
 * (the caller requests a new signature with the current nonce, D-021).
 */
export async function broadcastIdempotent(pub: PublicClient, signed: Hex, hash: Hash, from: Address, nonce: number): Promise<'sent' | 'already'> {
  const existing = await pub.getTransactionReceipt({ hash }).catch(() => null);
  if (existing) return 'already';
  const latest = await pub.getTransactionCount({ address: from, blockTag: 'latest' });
  if (latest > nonce) throw new NonRetryableError(`nonce ${nonce} already consumed (latest ${latest}); request a new signature`);
  let result: 'sent' | 'already' = 'sent';
  await withRetry(
    async () => {
      try {
        await pub.sendRawTransaction({ serializedTransaction: signed });
      } catch (e) {
        const m = String(e).toLowerCase();
        if (m.includes('already known') || m.includes('known transaction')) {
          result = 'already';
          return;
        }
        if (m.includes('insufficient funds')) throw new NonRetryableError(`${from} lacks Sepolia gas`);
        if (m.includes('nonce too low')) throw new NonRetryableError('nonce too low: consumed elsewhere; request a new signature');
        throw e;
      }
    },
    { label: 'sendRawTransaction' },
  );
  return result;
}
