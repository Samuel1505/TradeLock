/** Carrier mints an eBL to the supplier (holder = beneficiary = supplier). Token id recorded in .env. */
import { randomBytes } from 'node:crypto';
import { privateKeyToAccount } from 'viem/accounts';
import { etherscanAddress, etherscanTx, requireEnv, sepoliaPublicClient, sepoliaRpcUrls, sepoliaWalletClient, upsertEnv } from '@tradelock/shared';
import { mintEbl } from '../src/titleflow.js';

const env = requireEnv('SEPOLIA_CARRIER_PK', 'SEPOLIA_SUPPLIER_PK', 'TRADETRUST_REGISTRY');
const urls = sepoliaRpcUrls();
const carrier = privateKeyToAccount(env.SEPOLIA_CARRIER_PK as `0x${string}`);
const supplier = privateKeyToAccount(env.SEPOLIA_SUPPLIER_PK as `0x${string}`).address;
// TradeTrust token ids are document hashes; we use a random 256-bit id for a synthetic document (S-04).
const tokenId = process.env.EBL_TOKEN_ID ? BigInt(process.env.EBL_TOKEN_ID) : BigInt(`0x${randomBytes(32).toString('hex')}`);
upsertEnv('EBL_TOKEN_ID', tokenId.toString());

const pub = sepoliaPublicClient(urls);
const res = await mintEbl(pub, sepoliaWalletClient(urls, carrier), { registry: env.TRADETRUST_REGISTRY as `0x${string}`, tokenId, owner: supplier });
console.log(JSON.stringify({ step: 'mint', reused: res.reused, txHash: res.txHash, ...res.state }, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2));
console.log(`TitleEscrow: ${etherscanAddress(res.state.titleEscrow)}`);
if (res.txHash) console.log(`mint tx: ${etherscanTx(res.txHash)}`);
