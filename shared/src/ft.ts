import { nearView } from './near.js';
import { NonRetryableError } from './retry.js';

/** NEP-145 storage_balance_of. null = not registered on the token. */
export const ftStorageBalance = (rpcUrls: string[], token: string, account: string) =>
  nearView<{ total: string; available: string } | null>(rpcUrls, token, 'storage_balance_of', { account_id: account });

/**
 * Fails with one clear error listing every account not registered on `token`. Call before any step whose
 * payout uses ft_withdraw: the Verifier's ft_transfer to an unregistered receiver fails and the cash leg
 * stays Pending until the receiver registers (CONTRACTS §5).
 */
export async function assertFtRegistered(rpcUrls: string[], token: string, accounts: string[]): Promise<void> {
  const missing: string[] = [];
  for (const a of accounts) if ((await ftStorageBalance(rpcUrls, token, a)) === null) missing.push(a);
  if (missing.length) {
    throw new NonRetryableError(
      `not registered on ${token}: ${missing.join(', ')}. Register each with:\n` +
        missing.map((a) => `  near contract call-function as-transaction ${token} storage_deposit json-args '{"account_id":"${a}"}' prepaid-gas '30.0 Tgas' attached-deposit '0.00125 NEAR' sign-as samuelowen.testnet network-config testnet sign-with-keychain send`).join('\n'),
    );
  }
}
