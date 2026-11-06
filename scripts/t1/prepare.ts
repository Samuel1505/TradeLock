/**
 * T1 executor, step 1 (read-only on NEAR): verify title is held by the derived address, fund its gas, compute nonce,
 * fees and gas limit within the contract's bounds, and PRINT the request_signature command. Sends nothing to NEAR.
 */
import { encodeFunctionData, formatEther, isAddressEqual, parseEther, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { NonRetryableError, TitleEscrowArtifact, sepoliaPublicClient, sepoliaRpcUrls, sepoliaWalletClient, withRetry } from '@tradelock/shared';
import { ensureGas, readTitle } from '@tradelock/evm';
import { bigintJson, contractDerivedAddress, proofEnv, view, type LegView, type ProofConfig } from './common.js';

const env = proofEnv();
const urls = sepoliaRpcUrls();
const pub = sepoliaPublicClient(urls);
const contract = env.PROOF_CONTRACT_ID;

const cfg = await view<ProofConfig>(contract, 'get_config');
const derived = await contractDerivedAddress(contract);
if (!derived) throw new NonRetryableError('contract has no derived address; run fetch_derived_address first');
const leg = await view<LegView>(contract, 'get_leg');
if (leg.status === 'SignatureRequested') throw new NonRetryableError('a signature request is in flight; wait for its callback');

const title = await readTitle(pub, env.TRADETRUST_REGISTRY as Address, BigInt(env.EBL_TOKEN_ID));
const checks = {
  chain_id: cfg.chain_id === (await pub.getChainId()),
  escrow_matches_contract: isAddressEqual(title.titleEscrow, cfg.title_escrow as Address),
  destination_is_buyer: isAddressEqual(cfg.destination as Address, env.SEPOLIA_BUYER_ADDRESS as Address),
  holder_is_derived: isAddressEqual(title.holder, derived),
  beneficiary_is_derived: isAddressEqual(title.beneficiary, derived),
  registry_active: title.active && title.holdingToken,
};
console.log('checks', checks);
if (isAddressEqual(title.holder, cfg.destination as Address) && isAddressEqual(title.beneficiary, cfg.destination as Address)) {
  console.log('Title already at destination: nothing to sign.');
  process.exit(0);
}
if (!Object.values(checks).every(Boolean)) throw new NonRetryableError('pre-sign checks failed (see above)');

const data = encodeFunctionData({ abi: TitleEscrowArtifact.abi, functionName: 'transferOwners', args: [cfg.destination as Address, cfg.destination as Address, '0x'] });
const estimated = await withRetry(() => pub.estimateGas({ account: derived, to: title.titleEscrow, data, value: 0n }), { label: 'estimateGas' });
const gasLimit = (estimated * 130n) / 100n; // 30% headroom
const fees = await withRetry(() => pub.estimateFeesPerGas({ type: 'eip1559', chain: null }), { label: 'fees' });
const priority = fees.maxPriorityFeePerGas < 1_000_000_000n ? 1_000_000_000n : fees.maxPriorityFeePerGas;
let maxFee = fees.maxFeePerGas * 2n > priority ? fees.maxFeePerGas * 2n : priority * 2n;
if (maxFee > BigInt(cfg.max_fee_per_gas)) maxFee = BigInt(cfg.max_fee_per_gas);
if (priority > BigInt(cfg.max_priority_fee_per_gas) || priority > maxFee || gasLimit > BigInt(cfg.max_gas_limit)) {
  throw new NonRetryableError(`fees/gas outside contract bounds: priority ${priority}, maxFee ${maxFee}, gas ${gasLimit}; bounds ${bigintJson(cfg)}`);
}
const nonce = await withRetry(() => pub.getTransactionCount({ address: derived, blockTag: 'pending' }), { label: 'nonce' });

/**
 * Extra ETH sent on top of the worst-case cost (gasLimit × maxFee), so a fee bump on the same nonce
 * (re-sign with higher fees) does not need a second top-up. Top-up only happens when balance < worst case.
 */
const DERIVED_GAS_BUFFER_WEI = parseEther('0.001');
// Derived address pays its own gas: worst case gasLimit * maxFee.
const need = gasLimit * maxFee;
const funderAccount = privateKeyToAccount(env.SEPOLIA_CARRIER_PK as `0x${string}`);
const dryRun = process.argv.includes('--dry-run');
if (dryRun) {
  const bal = await pub.getBalance({ address: derived });
  const top = bal >= need ? 0n : need + DERIVED_GAS_BUFFER_WEI - bal;
  console.log(`[dry-run] derived ${derived} balance ${formatEther(bal)} ETH; worst case ${formatEther(need)} ETH (gasLimit ${gasLimit} × maxFee ${maxFee}) + buffer ${formatEther(DERIVED_GAS_BUFFER_WEI)} ETH`);
  console.log(top > 0n ? `[dry-run] WOULD SEND ${formatEther(top)} Sepolia ETH from ${funderAccount.address} to ${derived}` : '[dry-run] no top-up needed');
} else {
  const gas = await ensureGas(pub, sepoliaWalletClient(urls, funderAccount), { to: derived, min: need, target: need + DERIVED_GAS_BUFFER_WEI });
  if (gas.txHash) console.log(`funded derived address: https://sepolia.etherscan.io/tx/${gas.txHash}`);
}

const args = { nonce: String(nonce), max_fee_per_gas: maxFee.toString(), max_priority_fee_per_gas: priority.toString(), gas_limit: gasLimit.toString() };
const preview = await view(contract, 'preview_tx', args);
console.log('preview_tx (what will be signed):', bigintJson(preview));
const deposit = cfg.mpc_sign_deposit;
console.log(`
${(process.env.NEAR_NETWORK ?? 'testnet').toUpperCase()} — run only after confirmation. Signs one MPC request (deposit ${deposit} yoctoNEAR + gas):

near contract call-function as-transaction ${contract} request_signature \\
  json-args '${JSON.stringify(args)}' \\
  prepaid-gas '100.0 Tgas' attached-deposit '${deposit} yoctoNEAR' \\
  sign-as ${contract} network-config ${process.env.NEAR_NETWORK ?? 'testnet'} sign-with-keychain send
`);
