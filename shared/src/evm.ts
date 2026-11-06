import { createPublicClient, createWalletClient, fallback, http, type Account, type Hash, type PublicClient, type TransactionReceipt } from 'viem';
import { sepolia } from 'viem/chains';
import { withRetry, NonRetryableError } from './retry.js';

const transport = (urls: string[]) => {
  if (urls.length === 0) throw new NonRetryableError('no Sepolia RPC URL configured');
  return fallback(urls.map((u) => http(u, { retryCount: 3, retryDelay: 400, timeout: 20_000 })), { rank: false });
};

export const sepoliaPublicClient = (urls: string[]): PublicClient =>
  createPublicClient({ chain: sepolia, transport: transport(urls) }) as PublicClient;

export const sepoliaWalletClient = (urls: string[], account: Account) =>
  createWalletClient({ chain: sepolia, transport: transport(urls), account });

/** Wait for inclusion with retries; throws NonRetryableError if the tx reverted. */
export async function waitForSuccess(client: PublicClient, hash: Hash, confirmations = 2): Promise<TransactionReceipt> {
  const receipt = await withRetry(() => client.waitForTransactionReceipt({ hash, confirmations, timeout: 180_000 }), {
    label: `receipt ${hash}`,
    attempts: 4,
  });
  if (receipt.status !== 'success') throw new NonRetryableError(`tx ${hash} reverted (block ${receipt.blockNumber})`);
  return receipt;
}
