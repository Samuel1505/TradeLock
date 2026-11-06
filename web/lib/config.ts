const req = (name: string, v: string | undefined) => {
  if (!v) throw new Error(`Missing ${name} (see web/.env.example)`);
  return v;
};

export const config = {
  network: (process.env.NEXT_PUBLIC_NEAR_NETWORK ?? 'testnet') as 'testnet' | 'mainnet',
  nearRpc: req('NEXT_PUBLIC_NEAR_RPC', process.env.NEXT_PUBLIC_NEAR_RPC),
  tradelock: req('NEXT_PUBLIC_TRADELOCK', process.env.NEXT_PUBLIC_TRADELOCK),
  verifier: req('NEXT_PUBLIC_VERIFIER', process.env.NEXT_PUBLIC_VERIFIER),
  token: req('NEXT_PUBLIC_TOKEN', process.env.NEXT_PUBLIC_TOKEN),
  tokenSymbol: process.env.NEXT_PUBLIC_TOKEN_SYMBOL ?? 'tUSD',
  tokenDecimals: Number(process.env.NEXT_PUBLIC_TOKEN_DECIMALS ?? 6),
  sepoliaRpc: req('NEXT_PUBLIC_SEPOLIA_RPC', process.env.NEXT_PUBLIC_SEPOLIA_RPC),
  sepoliaRpcFallback: process.env.NEXT_PUBLIC_SEPOLIA_RPC_FALLBACK ?? '',
  registry: req('NEXT_PUBLIC_REGISTRY', process.env.NEXT_PUBLIC_REGISTRY),
  demoDeals: (process.env.NEXT_PUBLIC_DEMO_DEALS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
};

export const tokenId = () => `nep141:${config.token}`;
