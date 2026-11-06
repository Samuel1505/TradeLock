/**
 * T1 executor, step 2: read the MPC signature stored by the contract, rebuild the tx with viem, verify it is exactly
 * what the contract signed and that it recovers to the derived address, broadcast, and confirm holder/beneficiary.
 */
import { isAddressEqual, keccak256, recoverTransactionAddress, serializeTransaction, type Address, type Hash, type TransactionSerializableEIP1559 } from 'viem';
import { NonRetryableError, etherscanAddress, etherscanTx, sepoliaPublicClient, sepoliaRpcUrls, waitForSuccess, withRetry } from '@tradelock/shared';
import { readTitle } from '@tradelock/evm';
import { contractDerivedAddress, proofEnv, view, type LegView, type ProofConfig } from './common.js';

const env = proofEnv();
const pub = sepoliaPublicClient(sepoliaRpcUrls());
const contract = env.PROOF_CONTRACT_ID;
const cfg = await view<ProofConfig>(contract, 'get_config');
const derived = await contractDerivedAddress(contract);
if (!derived) throw new NonRetryableError('contract has no derived address');
const dest = cfg.destination as Address;

const before = await readTitle(pub, env.TRADETRUST_REGISTRY as Address, BigInt(env.EBL_TOKEN_ID));
if (isAddressEqual(before.holder, dest) && isAddressEqual(before.beneficiary, dest)) {
  console.log(`Title already held by destination ${dest}. Done.`);
  process.exit(0);
}

const leg = await view<LegView>(contract, 'get_leg');
if (leg.status !== 'Signed') throw new NonRetryableError(`leg is ${leg.status}; expected Signed`);
const { tx, signature } = leg;

const unsigned: TransactionSerializableEIP1559 = {
  type: 'eip1559',
  chainId: tx.chain_id,
  nonce: Number(tx.nonce),
  maxPriorityFeePerGas: BigInt(tx.max_priority_fee_per_gas),
  maxFeePerGas: BigInt(tx.max_fee_per_gas),
  gas: BigInt(tx.gas_limit),
  to: tx.to,
  value: BigInt(tx.value),
  data: tx.data,
  accessList: [],
};
// 1. viem's encoding of the stored fields must equal what the contract hashed.
const viemUnsigned = serializeTransaction(unsigned);
if (viemUnsigned !== tx.unsigned_tx) throw new NonRetryableError(`unsigned tx mismatch:\n viem     ${viemUnsigned}\n contract ${tx.unsigned_tx}`);
if (keccak256(viemUnsigned) !== tx.payload) throw new NonRetryableError('payload mismatch');

// 2. Signed tx must recover to the derived address.
const signed = serializeTransaction(unsigned, { r: signature.r, s: signature.s, yParity: signature.y_parity });
const signer = await recoverTransactionAddress({ serializedTransaction: signed as `0x02${string}` });
if (!isAddressEqual(signer, derived)) throw new NonRetryableError(`signed tx recovers to ${signer}, expected derived ${derived}`);
const hash = keccak256(signed) as Hash;
console.log(`signed tx ${hash} from ${signer} (nonce ${tx.nonce})`);

// 3. Nonce reconciliation: if consumed by something else, stop (contract must re-sign with a new nonce).
const latestNonce = await pub.getTransactionCount({ address: derived, blockTag: 'latest' });
const existing = await pub.getTransactionReceipt({ hash }).catch(() => null);
if (!existing && latestNonce > Number(tx.nonce)) {
  throw new NonRetryableError(`nonce ${tx.nonce} already consumed by another tx (latest nonce ${latestNonce}); request a new signature`);
}

// 4. Broadcast (idempotent: "already known" / existing receipt are success paths).
if (!existing) {
  await withRetry(
    async () => {
      try {
        await pub.sendRawTransaction({ serializedTransaction: signed });
      } catch (e) {
        const m = String(e).toLowerCase();
        if (m.includes('already known') || m.includes('known transaction')) return;
        if (m.includes('insufficient funds')) throw new NonRetryableError(`derived address lacks gas: run pnpm t1:prepare to top up (${m.split('\n')[0]})`);
        if (m.includes('nonce too low')) throw new NonRetryableError('nonce too low: consumed elsewhere; re-sign');
        throw e;
      }
    },
    { label: 'sendRawTransaction' },
  );
  console.log(`broadcast: ${etherscanTx(hash)}`);
}
const receipt = await waitForSuccess(pub, hash, 2);

// 5. Attested-style check: final on-chain state, not "tx sent".
const after = await readTitle(pub, env.TRADETRUST_REGISTRY as Address, BigInt(env.EBL_TOKEN_ID));
const ok = isAddressEqual(after.holder, dest) && isAddressEqual(after.beneficiary, dest);
console.log(JSON.stringify({
  step: 't1-broadcast', ok, txHash: hash, block: receipt.blockNumber.toString(), signer,
  titleEscrow: after.titleEscrow, holder: after.holder, beneficiary: after.beneficiary, readAtBlock: after.blockNumber.toString(),
}, null, 2));
console.log(`TitleEscrow: ${etherscanAddress(after.titleEscrow)}`);
if (!ok) process.exit(1);
