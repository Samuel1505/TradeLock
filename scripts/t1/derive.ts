/**
 * T1 derivation check: chainsig.js == v1.signer.derived_public_key, and (once deployed + fetched) == the address the
 * contract computed on-chain from the same view (D-013).
 */
import { deriveCrossChecked, nearRpcUrls, requireEnv } from '@tradelock/shared';
import { contractDerivedAddress } from './common.js';

const env = requireEnv('MPC_CONTRACT_ID', 'PROOF_CONTRACT_ID', 'PROOF_PATH');
const js = await deriveCrossChecked(nearRpcUrls(), env.MPC_CONTRACT_ID, env.PROOF_CONTRACT_ID, env.PROOF_PATH);
console.log(`chainsig.js == ${env.MPC_CONTRACT_ID}.derived_public_key : ${js}`);

let onContract: string | null = null;
let unavailable = false;
try {
  onContract = await contractDerivedAddress(env.PROOF_CONTRACT_ID);
} catch (e) {
  unavailable = true;
  console.log(`contract-side: not available (${e instanceof Error ? e.message.split('\n')[0] : e})`);
}
if (unavailable) {
  // no proof contract on the account (e.g. after the clean-state redeploy): JS == MPC view is the check
} else if (onContract === null) {
  console.log('contract-side: not fetched yet (call fetch_derived_address)');
} else if (onContract !== js) {
  console.error(`MISMATCH: contract stored ${onContract}, JS derived ${js}`);
  process.exit(1);
} else {
  console.log(`contract-side (${env.PROOF_CONTRACT_ID}.get_derived_address) : ${onContract}  ✓ match`);
}
