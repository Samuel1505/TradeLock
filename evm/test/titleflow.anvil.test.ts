/**
 * Runs the title flow against a local anvil chain with the real TradeTrust 5.5.2 bytecode (factory + registry).
 * The "deal address" here is an anvil key standing in for the MPC-derived address; on Sepolia it is signed by v1.signer.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPublicClient, createWalletClient, getAddress, http, type Address, type PublicClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';
import { TitleEscrowArtifact, TitleEscrowFactoryArtifact } from '@tradelock/shared';
import { deployRegistry, mintEbl, readTitle, transferTitle } from '../src/titleflow.js';

// anvil default dev keys (public, test-only)
const KEYS = [
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', // carrier
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d', // supplier
  '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a', // deal address stand-in
] as const;
const BUYER = getAddress('0x00000000000000000000000000000000000000b0');

let anvil: ChildProcess;
let pub: PublicClient;
let rpc: string;
const wallet = (k: `0x${string}`) => createWalletClient({ chain: foundry, transport: http(rpc), account: privateKeyToAccount(k) });

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const s = createServer();
    s.listen(0, () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => resolve(p));
    });
    s.on('error', reject);
  });

beforeAll(async () => {
  const port = await freePort();
  rpc = `http://127.0.0.1:${port}`;
  anvil = spawn('anvil', ['--port', String(port), '--block-time', '1', '--silent'], { stdio: 'ignore' });
  pub = createPublicClient({ chain: foundry, transport: http(rpc) }) as PublicClient;
  for (let i = 0; i < 50; i++) {
    try {
      await pub.getChainId();
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error('anvil did not start');
}, 20_000);

afterAll(() => anvil?.kill());

describe('TradeTrust 5.5.2 title flow (anvil)', () => {
  let factory: Address;
  let registry: Address;
  const tokenId = 0x1234n;

  it('deploys factory (test chain only) and registry; deploy is idempotent', async () => {
    const carrier = wallet(KEYS[0]);
    const h = await carrier.deployContract({ abi: TitleEscrowFactoryArtifact.abi, bytecode: TitleEscrowFactoryArtifact.bytecode });
    factory = getAddress((await pub.waitForTransactionReceipt({ hash: h })).contractAddress!);
    const first = await deployRegistry(pub, carrier, { name: 'T', symbol: 'T', factory });
    registry = first.registry;
    expect(first.reused).toBe(false);
    const again = await deployRegistry(pub, carrier, { name: 'T', symbol: 'T', factory, existing: registry });
    expect(again).toEqual({ registry, reused: true });
  });

  it('mints to supplier; re-mint is a no-op', async () => {
    const supplier = privateKeyToAccount(KEYS[1]).address;
    const m = await mintEbl(pub, wallet(KEYS[0]), { registry, tokenId, owner: supplier });
    expect(m.reused).toBe(false);
    expect(m.state.holder).toBe(supplier);
    expect(m.state.beneficiary).toBe(supplier);
    expect(m.state.titleEscrow).toBe(
      getAddress((await pub.readContract({ address: factory, abi: TitleEscrowFactoryArtifact.abi, functionName: 'getEscrowAddress', args: [registry, tokenId] })) as string),
    );
    expect((await mintEbl(pub, wallet(KEYS[0]), { registry, tokenId, owner: supplier })).reused).toBe(true);
  });

  it('supplier hands title to the deal address in one transferOwners call; repeat is a no-op', async () => {
    const deal = privateKeyToAccount(KEYS[2]).address;
    const t = await transferTitle(pub, wallet(KEYS[1]), { registry, tokenId, to: deal });
    expect(t.state.holder).toBe(deal);
    expect(t.state.beneficiary).toBe(deal);
    expect((await transferTitle(pub, wallet(KEYS[1]), { registry, tokenId, to: deal })).reused).toBe(true);
  });

  it('non-holder cannot move title', async () => {
    await expect(transferTitle(pub, wallet(KEYS[1]), { registry, tokenId, to: BUYER })).rejects.toThrow(/not holder\+beneficiary/);
  });

  it('deal address moves title to buyer in one call; recipient can reject back (T15 / D-015)', async () => {
    const deal = privateKeyToAccount(KEYS[2]).address;
    const t = await transferTitle(pub, wallet(KEYS[2]), { registry, tokenId, to: BUYER });
    expect(t.state.holder).toBe(BUYER);
    expect(t.state.beneficiary).toBe(BUYER);
    expect(t.state.prevHolder).toBe(deal);
    expect(t.state.prevBeneficiary).toBe(deal);

    // Simulate rejectTransferOwners from the buyer: it would return both roles to the deal address.
    await pub.request({ method: 'anvil_impersonateAccount' as never, params: [BUYER] as never });
    await pub.request({ method: 'anvil_setBalance' as never, params: [BUYER, '0xde0b6b3a7640000'] as never });
    const buyerWallet = createWalletClient({ chain: foundry, transport: http(rpc), account: BUYER });
    const h = await buyerWallet.writeContract({ address: t.state.titleEscrow, abi: TitleEscrowArtifact.abi, functionName: 'rejectTransferOwners', args: ['0x'] });
    await pub.waitForTransactionReceipt({ hash: h });
    const after = await readTitle(pub, registry, tokenId);
    expect(after.holder).toBe(deal);
    expect(after.beneficiary).toBe(deal);
  });
});
