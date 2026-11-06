/** Supplier hands the eBL to the MPC-derived address of PROOF_CONTRACT_ID/PROOF_PATH (cross-checked against v1.signer). */
import { parseEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  deriveCrossChecked, etherscanAddress, etherscanTx, nearRpcUrls, requireEnv, sepoliaPublicClient, sepoliaRpcUrls, sepoliaWalletClient,
} from '@tradelock/shared';
import { ensureGas, transferTitle } from '../src/titleflow.js';

const env = requireEnv('SEPOLIA_CARRIER_PK', 'SEPOLIA_SUPPLIER_PK', 'TRADETRUST_REGISTRY', 'EBL_TOKEN_ID', 'MPC_CONTRACT_ID', 'PROOF_CONTRACT_ID', 'PROOF_PATH');
const urls = sepoliaRpcUrls();
const pub = sepoliaPublicClient(urls);
const supplier = privateKeyToAccount(env.SEPOLIA_SUPPLIER_PK as `0x${string}`);
const funder = sepoliaWalletClient(urls, privateKeyToAccount(env.SEPOLIA_CARRIER_PK as `0x${string}`));

const dealAddress = await deriveCrossChecked(nearRpcUrls(), env.MPC_CONTRACT_ID, env.PROOF_CONTRACT_ID, env.PROOF_PATH);
console.log(`derived address (${env.PROOF_CONTRACT_ID}, ${env.PROOF_PATH}) = ${dealAddress}  [chainsig.js == ${env.MPC_CONTRACT_ID}.derived_public_key]`);

const gas = await ensureGas(pub, funder, { to: supplier.address, min: parseEther('0.002'), target: parseEther('0.005') });
if (gas.txHash) console.log(`funded supplier: ${etherscanTx(gas.txHash)}`);

const res = await transferTitle(pub, sepoliaWalletClient(urls, supplier), {
  registry: env.TRADETRUST_REGISTRY as `0x${string}`,
  tokenId: BigInt(env.EBL_TOKEN_ID),
  to: dealAddress,
});
console.log(JSON.stringify({ step: 'hand-over', reused: res.reused, txHash: res.txHash, ...res.state }, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2));
console.log(`TitleEscrow: ${etherscanAddress(res.state.titleEscrow)}`);
if (res.txHash) console.log(`hand-over tx: ${etherscanTx(res.txHash)}`);
