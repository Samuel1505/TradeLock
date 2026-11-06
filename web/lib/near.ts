import { config } from './config';
import type { DealView } from './types';

/** Read-only NEAR view call (JSON-RPC). Contract errors throw with the RPC message. */
export async function view<T>(contract: string, method: string, args: unknown = {}): Promise<T> {
  const res = await fetch(config.nearRpc, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'tradelock-web',
      method: 'query',
      params: { request_type: 'call_function', finality: 'final', account_id: contract, method_name: method, args_base64: btoa(JSON.stringify(args)) },
    }),
  });
  if (!res.ok) throw new Error(`NEAR RPC HTTP ${res.status}`);
  const json = (await res.json()) as { result?: { result?: number[]; error?: string }; error?: { message?: string; data?: unknown } };
  if (json.error) throw new Error(`${method}: ${JSON.stringify(json.error.data ?? json.error.message)}`);
  if (json.result?.error) throw new Error(`${method}: ${json.result.error}`);
  return JSON.parse(new TextDecoder().decode(new Uint8Array(json.result?.result ?? []))) as T;
}

export const getDeal = (id: string) => view<DealView | null>(config.tradelock, 'get_deal', { deal_id: id });
export const getDealsByAccount = (account: string) => view<DealView[]>(config.tradelock, 'get_deals_by_account', { account_id: account });
export const getNextDealId = () => view<string>(config.tradelock, 'get_next_deal_id');
export const verifierBalance = (account: string, tokenId: string) =>
  view<string>(config.verifier, 'mt_balance_of', { account_id: account, token_id: tokenId });
export const ftBalance = (account: string) => view<string>(config.token, 'ft_balance_of', { account_id: account });
export const ftRegistered = async (account: string) => (await view<unknown>(config.token, 'storage_balance_of', { account_id: account })) !== null;
