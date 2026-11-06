/**
 * Demo runner: drives one deal through a flow on NEAR testnet + Sepolia, one step at a time, from chain state.
 *
 *   pnpm demo settle [--deal N] [--yes]     eBL: documents accepted → Settled
 *   pnpm demo refund [--deal N] [--yes]     eBL: documents refused → Refunded
 *   pnpm demo escrow [--deal N] [--yes]     escrow-only: delivery confirmed, ft_withdraw payout → Settled
 *   pnpm demo dispute [--deal N] [--yes]    eBL: buyer silent; supplier disputes, supplier + arbiter vote Release
 *                                           (2-of-3), supplier + arbiter confirm title receipt (D-019) → Settled
 *
 * Without --yes or --step it prints the next command and stops (nothing is sent). With --yes it runs steps until
 * the deal is terminal. With --step it sends exactly one state-changing step, then prints the next and stops
 * (for recording). Re-running with --deal N resumes from on-chain state; every step is idempotent.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAddress, keccak256, parseEther, toHex, type Address, type PublicClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  NonRetryableError, assertFtRegistered, etherscanAddress, etherscanTx, nearRpcUrls, nearTx, nearView, requireEnv,
  sepoliaPublicClient, sepoliaRpcUrls, sepoliaWalletClient, waitForSuccess,
} from '@tradelock/shared';
import { assembleSignedTitleTx, broadcastIdempotent, ensureGas, mintEbl, prepareTitleTx, readTitle, transferTitle, type ContractSigView, type ContractTxView } from '@tradelock/evm';
import { callNear, commandLine, type CallSpec } from './near-cli.js';
import { nextStep, type DealView, type Flow, type SepoliaFacts, type Step } from './steps.js';

const env = requireEnv(
  'NEAR_NETWORK', 'TRADELOCK_CONTRACT_ID', 'VERIFIER_ID', 'TOKEN_CONTRACT_ID', 'DEMO_BUYER', 'DEMO_SUPPLIER', 'DEMO_ARBITER',
  'DEMO_EXECUTOR', 'DEMO_AMOUNT', 'SEPOLIA_CARRIER_PK', 'SEPOLIA_SUPPLIER_PK', 'SEPOLIA_BUYER_ADDRESS', 'TRADETRUST_REGISTRY',
);
const argv = process.argv.slice(2);
const flow = argv[0] as Flow;
if (!['settle', 'refund', 'escrow', 'dispute'].includes(flow)) {
  console.error('usage: pnpm demo <settle|refund|escrow|dispute> [--deal N] [--yes | --step] [--max-steps N]');
  process.exit(2);
}
const flag = (name: string) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const YES = argv.includes('--yes');
const STEP = argv.includes('--step');
if (YES && STEP) {
  console.error('use either --yes (run to the end) or --step (one step), not both');
  process.exit(2);
}
/** Set after the one step allowed by --step has been sent. */
let stepUsed = false;
const MAX_STEPS = Number(flag('--max-steps') ?? 40);
const C = env.TRADELOCK_CONTRACT_ID;
const TOKEN_ID = `nep141:${env.TOKEN_CONTRACT_ID}`;
const AMOUNT = env.DEMO_AMOUNT;
const near = nearRpcUrls();
const pub = sepoliaPublicClient(sepoliaRpcUrls()) as PublicClient;
const carrier = sepoliaWalletClient(sepoliaRpcUrls(), privateKeyToAccount(env.SEPOLIA_CARRIER_PK as `0x${string}`));
const supplierEvm = sepoliaWalletClient(sepoliaRpcUrls(), privateKeyToAccount(env.SEPOLIA_SUPPLIER_PK as `0x${string}`));
const links: { step: string; url: string }[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class DryRunStop extends Error {}
class StepDone extends Error {}

/** Every state change goes through here: print the exact action; send only with --yes, or once with --step. */
async function gate(description: string, command?: string): Promise<void> {
  if (STEP && stepUsed) throw new StepDone();
  console.log(`\n▶ ${description}`);
  if (command) console.log(`  ${command}`);
  if (STEP) {
    stepUsed = true;
    return;
  }
  if (!YES) throw new DryRunStop();
}

async function nearCall(step: string, spec: Omit<CallSpec, 'network'>): Promise<unknown> {
  const full: CallSpec = { ...spec, network: env.NEAR_NETWORK };
  await gate(step, commandLine(full));
  const r = await callNear(full);
  links.push({ step, url: nearTx(r.txId) });
  console.log(`  ✓ ${nearTx(r.txId)}`);
  return r.value;
}

const view = <T>(method: string, args: unknown = {}) => nearView<T>(near, C, method, args);
const getDeal = (id: string) => view<DealView | null>('get_deal', { deal_id: id });

/** Demo eBL token id: deterministic per contract and deal id, so a re-run finds the same eBL. */
const demoTokenId = (dealId: string) => BigInt(keccak256(toHex(`tradelock-demo:${C}:deal:${dealId}`))).toString();

async function sepoliaFacts(deal: DealView): Promise<SepoliaFacts | null> {
  if (!deal.ebl) return null;
  try {
    const t = await readTitle(pub, getAddress(deal.ebl.registry), BigInt(deal.ebl.token_id));
    if (getAddress(t.titleEscrow) !== getAddress(deal.ebl.title_escrow)) {
      throw new NonRetryableError(`registry.ownerOf = ${t.titleEscrow} but the contract computed ${deal.ebl.title_escrow} (D-021)`);
    }
    return { minted: true, holder: t.holder, beneficiary: t.beneficiary };
  } catch (e) {
    if (e instanceof NonRetryableError) throw e;
    if (/ERC721|nonexistent|reverted/i.test(String(e))) return { minted: false };
    throw e;
  }
}

async function evidenceNow(deal: DealView) {
  const t = await readTitle(pub, getAddress(deal.ebl!.registry), BigInt(deal.ebl!.token_id));
  return { holder: t.holder, beneficiary: t.beneficiary, block_number: t.blockNumber.toString(), tx_hash: null };
}

async function createDeal(): Promise<string> {
  const id = await view<string>('get_next_deal_id');
  const now = BigInt(Date.now()) * 1_000_000n;
  const day = 86_400n * 1_000_000_000n;
  const supplierAddr = supplierEvm.account.address;
  // dispute uses an eBL deal like settle/refund.
  const mode =
    flow === 'escrow'
      ? { EscrowOnly: { deliver_by: (now + 7n * day).toString() } }
      : {
          Ebl: {
            chain_id: 11155111,
            registry: env.TRADETRUST_REGISTRY,
            token_id: demoTokenId(id),
            buyer_evm: env.SEPOLIA_BUYER_ADDRESS,
            supplier_evm: supplierAddr,
            ship_by: (now + 7n * day).toString(),
            doc_acceptance_window_ns: (3_600n * 1_000_000_000n).toString(),
          },
        };
  const payout = flow === 'escrow' ? { Withdraw: { account: env.DEMO_SUPPLIER } } : { Internal: { account: env.DEMO_SUPPLIER } };
  if (flow === 'escrow') await assertFtRegistered(near, env.TOKEN_CONTRACT_ID, [env.DEMO_SUPPLIER]);
  const terms = {
    supplier: env.DEMO_SUPPLIER,
    arbiter: env.DEMO_ARBITER,
    token_id: TOKEN_ID,
    amount: AMOUNT,
    // Synthetic order document (S-04): only its hash goes on-chain.
    order_hash: keccak256(toHex(`SAMPLE ORDER — tradelock demo ${flow} deal ${id}`)).slice(2),
    payout,
    mode,
  };
  const ret = await nearCall(`create_deal (${flow}) as buyer — expected deal id ${id}`, {
    signer: env.DEMO_BUYER, contract: C, method: 'create_deal', args: { terms }, gasTgas: 100, deposit: '0.1 NEAR',
  });
  const got = String(ret);
  if (got !== id) console.warn(`  note: contract returned deal id ${got} (expected ${id})`);
  return got;
}

async function fund(deal: DealView): Promise<void> {
  await assertFtRegistered(near, env.TOKEN_CONTRACT_ID, [env.VERIFIER_ID, env.DEMO_BUYER]);
  const inVerifier = BigInt(await nearView<string>(near, env.VERIFIER_ID, 'mt_balance_of', { account_id: env.DEMO_BUYER, token_id: TOKEN_ID }));
  if (inVerifier < BigInt(AMOUNT)) {
    const ftBal = BigInt(await nearView<string>(near, env.TOKEN_CONTRACT_ID, 'ft_balance_of', { account_id: env.DEMO_BUYER }));
    if (ftBal < BigInt(AMOUNT)) {
      await nearCall(`top up buyer with ${AMOUNT} tUSD base units (token owner → buyer)`, {
        signer: env.DEMO_EXECUTOR, contract: env.TOKEN_CONTRACT_ID, method: 'ft_transfer',
        args: { receiver_id: env.DEMO_BUYER, amount: AMOUNT, memo: 'tradelock demo top-up (testnet, no value)' }, gasTgas: 30, deposit: '1 yoctoNEAR',
      });
      return;
    }
    await nearCall('buyer deposits tUSD into its own Verifier balance (ft_transfer_call, msg = "")', {
      signer: env.DEMO_BUYER, contract: env.TOKEN_CONTRACT_ID, method: 'ft_transfer_call',
      args: { receiver_id: env.VERIFIER_ID, amount: AMOUNT, msg: '' }, gasTgas: 100, deposit: '1 yoctoNEAR',
    });
    return;
  }
  await nearCall(`buyer funds deal ${deal.id} (Verifier mt_transfer_call → tradelock.mt_on_transfer)`, {
    signer: env.DEMO_BUYER, contract: env.VERIFIER_ID, method: 'mt_transfer_call',
    args: { receiver_id: C, token_id: TOKEN_ID, amount: AMOUNT, msg: JSON.stringify({ deal_id: Number(deal.id) }) }, gasTgas: 300, deposit: '1 yoctoNEAR',
  });
}

async function execute(step: Step, deal: DealView): Promise<void> {
  const id = deal.id;
  const ebl = deal.ebl;
  switch (step.kind) {
    case 'refresh_derived_address':
      await nearCall('refresh_derived_address (MPC view for the deal address)', { signer: env.DEMO_EXECUTOR, contract: C, method: 'refresh_derived_address', args: { deal_id: id }, gasTgas: 50, deposit: '0 NEAR' });
      return;
    case 'accept_deal':
      await nearCall('supplier accepts the deal', { signer: env.DEMO_SUPPLIER, contract: C, method: 'accept_deal', args: { deal_id: id }, gasTgas: 30, deposit: '0 NEAR' });
      return;
    case 'fund':
      return fund(deal);
    case 'mint_ebl': {
      await gate(`Sepolia: carrier mints eBL ${ebl!.token_id} to supplier ${supplierEvm.account.address} on registry ${ebl!.registry}`);
      const r = await mintEbl(pub, carrier, { registry: getAddress(ebl!.registry), tokenId: BigInt(ebl!.token_id), owner: supplierEvm.account.address });
      if (r.txHash) links.push({ step: 'mint eBL', url: etherscanTx(r.txHash) });
      console.log(`  ✓ TitleEscrow ${etherscanAddress(r.state.titleEscrow)}`);
      return;
    }
    case 'hand_over': {
      await gate(`Sepolia: supplier hands the eBL to the deal address ${ebl!.derived_address} (transferOwners); tops up supplier gas from carrier if needed`);
      const g = await ensureGas(pub, carrier, { to: supplierEvm.account.address, min: parseEther('0.002'), target: parseEther('0.005') });
      if (g.txHash) links.push({ step: 'supplier gas top-up', url: etherscanTx(g.txHash) });
      const r = await transferTitle(pub, supplierEvm, { registry: getAddress(ebl!.registry), tokenId: BigInt(ebl!.token_id), to: getAddress(ebl!.derived_address!) });
      if (r.txHash) links.push({ step: 'hand-over to deal address', url: etherscanTx(r.txHash) });
      return;
    }
    case 'confirm_title_held': {
      const evidence = await evidenceNow(deal);
      await nearCall('buyer confirms title held (checked on Sepolia)', { signer: env.DEMO_BUYER, contract: C, method: 'confirm_title_held', args: { deal_id: id, evidence }, gasTgas: 30, deposit: '0 NEAR' });
      return;
    }
    case 'accept_documents':
      await nearCall('buyer accepts the documents (pay against title, D-020)', { signer: env.DEMO_BUYER, contract: C, method: 'accept_documents', args: { deal_id: id }, gasTgas: 150, deposit: '0 NEAR' });
      return;
    case 'refuse_documents':
      await nearCall('buyer refuses the documents (cash back, title back)', { signer: env.DEMO_BUYER, contract: C, method: 'refuse_documents', args: { deal_id: id, reason_hash: null }, gasTgas: 150, deposit: '0 NEAR' });
      return;
    case 'confirm_delivery':
      await assertFtRegistered(near, env.TOKEN_CONTRACT_ID, [env.DEMO_SUPPLIER]);
      await nearCall('buyer confirms delivery (escrow-only)', { signer: env.DEMO_BUYER, contract: C, method: 'confirm_delivery', args: { deal_id: id }, gasTgas: 150, deposit: '0 NEAR' });
      return;
    case 'resume_cash':
      await nearCall('resume the cash transfer', { signer: env.DEMO_EXECUTOR, contract: C, method: 'resume', args: { deal_id: id }, gasTgas: 150, deposit: '0 NEAR' });
      return;
    case 'request_signature': {
      const cfg = await view<{ max_fee_per_gas: string; max_priority_fee_per_gas: string; max_gas_limit: string; mpc_sign_deposit: string }>('get_config');
      const derived = getAddress(ebl!.derived_address!);
      const dest = getAddress(deal.state === 'Settling' ? ebl!.buyer_evm : ebl!.supplier_evm);
      const p = await prepareTitleTx(pub, derived, getAddress(ebl!.title_escrow), dest, {
        maxFeePerGas: BigInt(cfg.max_fee_per_gas), maxPriorityFeePerGas: BigInt(cfg.max_priority_fee_per_gas), maxGasLimit: BigInt(cfg.max_gas_limit),
      });
      const bal = await pub.getBalance({ address: derived });
      if (bal < p.worstCase) {
        await gate(`Sepolia: carrier tops up deal address ${derived} with gas (worst case ${p.worstCase} wei + 0.001 ETH buffer)`);
        const g = await ensureGas(pub, carrier, { to: derived, min: p.worstCase, target: p.worstCase + parseEther('0.001') });
        if (g.txHash) links.push({ step: 'deal address gas top-up', url: etherscanTx(g.txHash) });
      }
      await nearCall(`request MPC signature: transferOwners(${dest}) from ${derived}, nonce ${p.nonce}`, {
        signer: env.DEMO_EXECUTOR, contract: C, method: 'request_title_signature',
        args: { deal_id: id, nonce: String(p.nonce), max_fee_per_gas: p.maxFeePerGas.toString(), max_priority_fee_per_gas: p.maxPriorityFeePerGas.toString(), gas_limit: p.gasLimit.toString() },
        gasTgas: 100, deposit: `${cfg.mpc_sign_deposit} yoctoNEAR`,
      });
      return;
    }
    case 'broadcast': {
      const leg = deal.title_leg as unknown as { tx: ContractTxView; signature: ContractSigView };
      const derived = getAddress(ebl!.derived_address!);
      const { signed, hash, nonce } = await assembleSignedTitleTx(leg.tx, leg.signature, derived);
      await gate(`Sepolia: broadcast MPC-signed title transfer ${hash} (rebuilt with viem, recovers to ${derived})`);
      const how = await broadcastIdempotent(pub, signed, hash, derived, nonce);
      await waitForSuccess(pub, hash, 2);
      links.push({ step: `title transfer (${how})`, url: etherscanTx(hash) });
      console.log(`  ✓ ${etherscanTx(hash)}`);
      await nearCall('report_broadcast (informational)', { signer: env.DEMO_EXECUTOR, contract: C, method: 'report_broadcast', args: { deal_id: id, tx_hash: hash }, gasTgas: 30, deposit: '0 NEAR' });
      return;
    }
    case 'dispute':
      await nearCall('supplier opens a dispute (buyer silent after the documents were presented)', {
        signer: env.DEMO_SUPPLIER, contract: C, method: 'dispute',
        args: { deal_id: id, reason_hash: keccak256(toHex(`SAMPLE dispute — buyer silent — deal ${id}`)).slice(2) }, gasTgas: 30, deposit: '0 NEAR',
      });
      return;
    case 'vote': {
      const signer = { buyer: env.DEMO_BUYER, supplier: env.DEMO_SUPPLIER, arbiter: env.DEMO_ARBITER }[step.by];
      await nearCall(`${step.by} votes ${step.decision} (2-of-3)`, { signer, contract: C, method: 'vote', args: { deal_id: id, decision: step.decision }, gasTgas: 150, deposit: '0 NEAR' });
      return;
    }
    case 'confirm_title_transferred': {
      const evidence = await evidenceNow(deal);
      const signer = { buyer: env.DEMO_BUYER, supplier: env.DEMO_SUPPLIER, arbiter: env.DEMO_ARBITER }[step.by];
      await nearCall(`${step.by} confirms the title arrived (checked on Sepolia)`, { signer, contract: C, method: 'confirm_title_transferred', args: { deal_id: id, evidence }, gasTgas: 30, deposit: '0 NEAR' });
      return;
    }
    case 'wait':
      console.log(`  … ${step.reason}`);
      await sleep(4_000);
      return;
    case 'done':
    case 'stuck':
      return;
  }
}

async function main() {
  console.log(`Tradelock demo — flow ${flow} on ${env.NEAR_NETWORK} (${C}) + Sepolia. ${YES ? 'SENDING (--yes).' : STEP ? 'STEP: sends one step, then stops.' : 'Dry run: prints the next action only.'}`);
  let id = flag('--deal');
  try {
    if (!id) id = await createDeal();
    for (let i = 0; i < MAX_STEPS; i++) {
      const deal = await getDeal(id);
      if (!deal) throw new NonRetryableError(`deal ${id} not found on ${C}`);
      const step = nextStep(deal, flow, await sepoliaFacts(deal));
      console.log(`\n[deal ${id}] state ${deal.state} · cash ${deal.cash_leg} · title ${deal.title_leg.status} → ${step.kind}${'by' in step ? ` (${step.by})` : ''}`);
      if (step.kind === 'done') return finish(deal);
      if (step.kind === 'stuck') throw new NonRetryableError(step.reason);
      await execute(step, deal);
    }
    throw new NonRetryableError(`deal ${id} not terminal after ${MAX_STEPS} steps; re-run with --deal ${id} to resume`);
  } catch (e) {
    if (e instanceof StepDone) {
      console.log(`\nStep done. Next: pnpm demo ${flow} --deal ${id} --step`);
      return;
    }
    if (e instanceof DryRunStop) {
      console.log(`\nDry run stopped before sending. Re-run with --yes${id ? ` --deal ${id}` : ''} to execute.`);
      return;
    }
    console.error(`\n✗ ${e instanceof Error ? e.message : e}${id ? `\n  Resume: pnpm demo ${flow} --deal ${id} --yes` : ''}`);
    process.exitCode = 1;
  }
}

function finish(deal: DealView) {
  console.log(`\n✓ deal ${deal.id} is ${deal.state}`);
  if (deal.ebl) console.log(`  Verify title yourself: ${etherscanAddress(deal.ebl.title_escrow)}  (holder() / beneficiary())`);
  for (const l of links) console.log(`  ${l.step}: ${l.url}`);
  const dir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs', 'demo-runs');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${flow}-deal-${deal.id}.json`);
  writeFileSync(file, JSON.stringify({ flow, contract: C, deal: deal.id, state: deal.state, title_escrow: deal.ebl?.title_escrow ?? null, links, at: new Date().toISOString() }, null, 2) + '\n');
  console.log(`  record: ${file}`);
}

await main();
