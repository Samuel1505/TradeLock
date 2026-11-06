/**
 * Same-origin Sepolia JSON-RPC proxy for the browser's live title reads (no CORS dependency on public RPCs).
 * Read-only allowlist; tries each configured RPC in order. Writes never pass through here: the supplier's
 * hand-over is sent by their own wallet.
 */
const ALLOWED = new Set([
  'eth_call', 'eth_blockNumber', 'eth_chainId', 'eth_getCode', 'eth_getTransactionReceipt', 'eth_getTransactionByHash',
  'eth_getBlockByNumber', 'eth_estimateGas', 'eth_gasPrice', 'eth_maxPriorityFeePerGas', 'eth_feeHistory', 'eth_getTransactionCount',
]);
const UPSTREAMS = [process.env.SEPOLIA_RPC_SERVER, process.env.NEXT_PUBLIC_SEPOLIA_RPC, process.env.NEXT_PUBLIC_SEPOLIA_RPC_FALLBACK].filter((u): u is string => !!u);

type RpcReq = { jsonrpc: '2.0'; id: unknown; method: string; params?: unknown[] };

export async function POST(req: Request): Promise<Response> {
  let body: RpcReq | RpcReq[];
  try {
    body = (await req.json()) as RpcReq | RpcReq[];
  } catch {
    return Response.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }, { status: 400 });
  }
  const calls = Array.isArray(body) ? body : [body];
  if (calls.length === 0 || calls.length > 20) return Response.json({ error: 'batch size 1–20' }, { status: 400 });
  const denied = calls.find((c) => !ALLOWED.has(c?.method));
  if (denied) return Response.json({ jsonrpc: '2.0', id: denied?.id ?? null, error: { code: -32601, message: `method not allowed: ${denied?.method}` } }, { status: 403 });

  let lastError = 'no upstream configured';
  for (const url of UPSTREAMS) {
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000), cache: 'no-store' });
      if (!r.ok) {
        lastError = `${new URL(url).host} HTTP ${r.status}`;
        continue;
      }
      return new Response(await r.text(), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
    } catch (e) {
      lastError = `${new URL(url).host}: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  return Response.json({ jsonrpc: '2.0', id: Array.isArray(body) ? null : body.id, error: { code: -32603, message: `all Sepolia RPCs failed (${lastError})` } }, { status: 502 });
}
