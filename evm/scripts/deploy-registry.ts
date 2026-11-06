/** Deploy our TradeTrustToken registry (5.5.2 artifact) bound to TradeTrust's official Sepolia factory (D-014). */
import { privateKeyToAccount } from 'viem/accounts';
import { etherscanAddress, etherscanTx, requireEnv, sepoliaPublicClient, sepoliaRpcUrls, sepoliaWalletClient, upsertEnv } from '@tradelock/shared';
import { deployRegistry } from '../src/titleflow.js';

const env = requireEnv('SEPOLIA_CARRIER_PK', 'TRADETRUST_FACTORY');
const urls = sepoliaRpcUrls();
const carrier = privateKeyToAccount(env.SEPOLIA_CARRIER_PK as `0x${string}`);
const pub = sepoliaPublicClient(urls);
const existing = process.env.TRADETRUST_REGISTRY || undefined;

const res = await deployRegistry(pub, sepoliaWalletClient(urls, carrier), {
  name: 'Tradelock Demo Carrier eBL',
  symbol: 'TLEBL',
  factory: env.TRADETRUST_FACTORY as `0x${string}`,
  existing: existing as `0x${string}` | undefined,
});
upsertEnv('TRADETRUST_REGISTRY', res.registry);
console.log(JSON.stringify({ step: 'deploy-registry', ...res, carrier: carrier.address, factory: env.TRADETRUST_FACTORY }, null, 2));
console.log(`registry: ${etherscanAddress(res.registry)}`);
if (res.txHash) console.log(`deploy tx: ${etherscanTx(res.txHash)}`);
