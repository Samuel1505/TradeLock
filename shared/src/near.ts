import { NonRetryableError, withRetry } from './retry.js';

/**
 * Read-only NEAR view call. Tries each RPC URL in order per attempt; network/HTTP/RPC-transport errors
 * are retried, contract execution errors are not.
 */
export async function nearView<T>(rpcUrls: string[], contractId: string, method: string, args: unknown): Promise<T> {
  if (rpcUrls.length === 0) throw new NonRetryableError('no NEAR RPC URL configured');
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 'tradelock',
    method: 'query',
    params: {
      request_type: 'call_function',
      finality: 'final',
      account_id: contractId,
      method_name: method,
      args_base64: Buffer.from(JSON.stringify(args)).toString('base64'),
    },
  });
  return withRetry(
    async (attempt) => {
      const url = rpcUrls[(attempt - 1) % rpcUrls.length]!;
      const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body, signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`${url} HTTP ${res.status}`);
      const json = (await res.json()) as {
        result?: { result?: number[]; error?: string };
        error?: { cause?: { name?: string }; message?: string; data?: unknown };
      };
      if (json.error) {
        const name = json.error.cause?.name ?? '';
        // Account/contract/method problems are permanent; everything else (timeouts, unavailable shards) is retried.
        const permanent = ['UNKNOWN_ACCOUNT', 'NO_CONTRACT_CODE', 'CONTRACT_EXECUTION_ERROR', 'PARSE_ERROR'].includes(name);
        const msg = `${contractId}.${method}: RPC error ${name || ''} ${JSON.stringify(json.error.data ?? json.error.message)}`;
        throw permanent ? new NonRetryableError(msg) : new Error(msg);
      }
      if (json.result?.error) throw new NonRetryableError(`${contractId}.${method}: ${json.result.error}`);
      if (!json.result?.result) throw new Error(`${contractId}.${method}: empty result from ${url}`);
      return JSON.parse(Buffer.from(json.result.result).toString('utf8')) as T;
    },
    { label: `${contractId}.${method}` },
  );
}
