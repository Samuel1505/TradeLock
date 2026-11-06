'use client';
import { createPublicClient, createWalletClient, custom, fallback, getAddress, http, type Address, type EIP1193Provider } from 'viem';
import { sepolia } from 'viem/chains';
import { config } from './config';
import type { TitleFacts } from './types';

/** Minimal TradeTrust 5.5.2 ABI subset (DECISIONS V-09). */
const registryAbi = [{ type: 'function', name: 'ownerOf', stateMutability: 'view', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ type: 'address' }] }] as const;
const escrowAbi = [
  { type: 'function', name: 'holder', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'beneficiary', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  {
    type: 'function', name: 'transferOwners', stateMutability: 'nonpayable',
    inputs: [{ name: '_nominee', type: 'address' }, { name: 'newHolder', type: 'address' }, { name: '_remark', type: 'bytes' }], outputs: [],
  },
] as const;

// Reads go through the app's own /api/sepolia proxy (same origin, no CORS); direct RPCs only as a last resort.
const rpcs = ['/api/sepolia', config.sepoliaRpc, config.sepoliaRpcFallback].filter(Boolean);
const pub = createPublicClient({ chain: sepolia, transport: fallback(rpcs.map((u) => http(u, { retryCount: 1, timeout: 12_000 }))) });

/** Live title state, read at one block so holder/beneficiary are consistent. */
export async function readTitleFacts(registry: string, tokenId: string): Promise<TitleFacts> {
  const blockNumber = await pub.getBlockNumber();
  let escrow: Address;
  try {
    escrow = await pub.readContract({ address: getAddress(registry), abi: registryAbi, functionName: 'ownerOf', args: [BigInt(tokenId)], blockNumber });
  } catch {
    return { minted: false, block: blockNumber.toString() };
  }
  const [holder, beneficiary] = await Promise.all([
    pub.readContract({ address: escrow, abi: escrowAbi, functionName: 'holder', blockNumber }),
    pub.readContract({ address: escrow, abi: escrowAbi, functionName: 'beneficiary', blockNumber }),
  ]);
  return { minted: true, titleEscrow: escrow, holder, beneficiary, block: blockNumber.toString() };
}

type Eth = EIP1193Provider & { request: EIP1193Provider['request'] };
const injected = (): Eth | undefined => (typeof window !== 'undefined' ? (window as unknown as { ethereum?: Eth }).ethereum : undefined);

export async function connectEvm(): Promise<Address> {
  const eth = injected();
  if (!eth) throw new Error('No EVM wallet found. Install one to hand over the bill of lading.');
  const [account] = (await eth.request({ method: 'eth_requestAccounts' })) as Address[];
  if (!account) throw new Error('No EVM account selected');
  return getAddress(account);
}

/** Supplier hands the eBL to the deal address: transferOwners(deal, deal, 0x) from the supplier's wallet. */
export async function handOverTitle(escrow: string, dealAddress: string, from: Address): Promise<`0x${string}`> {
  const eth = injected();
  if (!eth) throw new Error('No EVM wallet found');
  const wallet = createWalletClient({ chain: sepolia, transport: custom(eth), account: from });
  await wallet.switchChain({ id: sepolia.id }).catch(() => undefined);
  const deal = getAddress(dealAddress);
  const { request } = await pub.simulateContract({ account: from, address: getAddress(escrow), abi: escrowAbi, functionName: 'transferOwners', args: [deal, deal, '0x'] });
  const hash = await wallet.writeContract(request);
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error(`Hand-over reverted: ${hash}`);
  return hash;
}
