/**
 * TradeTrust v5.5.2 title flow on any EVM chain: deploy registry, mint eBL, hand title to a deal address,
 * read title state. Every step is idempotent: re-running checks chain state first and skips completed work.
 */
import {
  getAddress,
  isAddressEqual,
  keccak256,
  toHex,
  zeroAddress,
  type Account,
  type Address,
  type Chain,
  type Hash,
  type PublicClient,
  type Transport,
  type WalletClient,
} from 'viem';
import { NonRetryableError, TitleEscrowArtifact, TradeTrustTokenArtifact, waitForSuccess, withRetry } from '@tradelock/shared';

type Wallet = WalletClient<Transport, Chain, Account>;
const registryAbi = TradeTrustTokenArtifact.abi;
const escrowAbi = TitleEscrowArtifact.abi;
export const MINTER_ROLE = keccak256(toHex('MINTER_ROLE'));

export interface TitleState {
  registry: Address;
  tokenId: bigint;
  titleEscrow: Address;
  holder: Address;
  beneficiary: Address;
  nominee: Address;
  prevHolder: Address;
  prevBeneficiary: Address;
  active: boolean;
  holdingToken: boolean;
  blockNumber: bigint;
}

const hasCode = async (client: PublicClient, address: Address) => {
  const code = await withRetry(() => client.getCode({ address }), { label: `getCode ${address}` });
  return !!code && code !== '0x';
};

/** Deploy a standalone TradeTrustToken bound to `factory`. Skips if `existing` is a registry bound to that factory. */
export async function deployRegistry(
  pub: PublicClient,
  wallet: Wallet,
  opts: { name: string; symbol: string; factory: Address; existing?: Address },
): Promise<{ registry: Address; txHash?: Hash; reused: boolean }> {
  if (!(await hasCode(pub, opts.factory))) throw new NonRetryableError(`factory ${opts.factory} has no code on chain ${pub.chain?.id}`);
  if (opts.existing && (await hasCode(pub, opts.existing))) {
    const bound = (await pub.readContract({ address: opts.existing, abi: registryAbi, functionName: 'titleEscrowFactory' })) as Address;
    if (!isAddressEqual(bound, opts.factory)) throw new NonRetryableError(`registry ${opts.existing} is bound to ${bound}, expected ${opts.factory}`);
    return { registry: opts.existing, reused: true };
  }
  const txHash = await wallet.deployContract({
    abi: registryAbi,
    bytecode: TradeTrustTokenArtifact.bytecode,
    args: [opts.name, opts.symbol, opts.factory],
  });
  const receipt = await waitForSuccess(pub, txHash);
  if (!receipt.contractAddress) throw new NonRetryableError(`deploy ${txHash} produced no contract address`);
  const registry = getAddress(receipt.contractAddress);
  const isMinter = await pub.readContract({ address: registry, abi: registryAbi, functionName: 'hasRole', args: [MINTER_ROLE, wallet.account.address] });
  if (!isMinter) throw new NonRetryableError(`deployer ${wallet.account.address} lacks MINTER_ROLE on ${registry}`);
  return { registry, txHash, reused: false };
}

/** Read the full title state for (registry, tokenId). Throws if the token does not exist. */
export async function readTitle(pub: PublicClient, registry: Address, tokenId: bigint): Promise<TitleState> {
  return withRetry(
    async () => {
      const blockNumber = await pub.getBlockNumber();
      const at = { blockNumber };
      const titleEscrow = getAddress((await pub.readContract({ address: registry, abi: registryAbi, functionName: 'ownerOf', args: [tokenId], ...at })) as string);
      const read = (functionName: string) => pub.readContract({ address: titleEscrow, abi: escrowAbi, functionName, ...at });
      const [holder, beneficiary, nominee, prevHolder, prevBeneficiary, active, holdingToken] = await Promise.all([
        read('holder'), read('beneficiary'), read('nominee'), read('prevHolder'), read('prevBeneficiary'), read('active'), read('isHoldingToken'),
      ]);
      return {
        registry, tokenId, titleEscrow, blockNumber,
        holder: getAddress(holder as string), beneficiary: getAddress(beneficiary as string), nominee: getAddress(nominee as string),
        prevHolder: getAddress(prevHolder as string), prevBeneficiary: getAddress(prevBeneficiary as string),
        active: active as boolean, holdingToken: holdingToken as boolean,
      };
    },
    { label: `readTitle ${registry}#${tokenId}`, isRetryable: (e) => !(e instanceof NonRetryableError) && !String(e).includes('ERC721') && !String(e).includes('reverted') },
  );
}

async function tokenExists(pub: PublicClient, registry: Address, tokenId: bigint): Promise<boolean> {
  try {
    await pub.readContract({ address: registry, abi: registryAbi, functionName: 'ownerOf', args: [tokenId] });
    return true;
  } catch (e) {
    if (String(e).includes('reverted') || String(e).includes('ERC721')) return false;
    throw e;
  }
}

/** Mint an eBL with beneficiary = holder = `owner`. Idempotent: an existing token is returned if it belongs to `owner`. */
export async function mintEbl(
  pub: PublicClient,
  carrier: Wallet,
  opts: { registry: Address; tokenId: bigint; owner: Address },
): Promise<{ state: TitleState; txHash?: Hash; reused: boolean }> {
  if (await tokenExists(pub, opts.registry, opts.tokenId)) {
    const state = await readTitle(pub, opts.registry, opts.tokenId);
    return { state, reused: true };
  }
  if (await pub.readContract({ address: opts.registry, abi: registryAbi, functionName: 'paused' })) throw new NonRetryableError(`registry ${opts.registry} is paused`);
  const { request } = await pub.simulateContract({
    account: carrier.account,
    address: opts.registry,
    abi: registryAbi,
    functionName: 'mint',
    args: [opts.owner, opts.owner, opts.tokenId, '0x'],
  });
  const txHash = await carrier.writeContract(request);
  await waitForSuccess(pub, txHash);
  const state = await readTitle(pub, opts.registry, opts.tokenId);
  if (!isAddressEqual(state.holder, opts.owner) || !isAddressEqual(state.beneficiary, opts.owner)) {
    throw new NonRetryableError(`post-mint state wrong: holder ${state.holder}, beneficiary ${state.beneficiary}`);
  }
  return { state, txHash, reused: false };
}

/**
 * Current holder+beneficiary moves both roles to `to` with one `transferOwners(to, to, 0x)` (DECISIONS V-10).
 * Idempotent: no-op if `to` already holds both roles.
 */
export async function transferTitle(
  pub: PublicClient,
  from: Wallet,
  opts: { registry: Address; tokenId: bigint; to: Address },
): Promise<{ state: TitleState; txHash?: Hash; reused: boolean }> {
  const before = await readTitle(pub, opts.registry, opts.tokenId);
  if (isAddressEqual(before.holder, opts.to) && isAddressEqual(before.beneficiary, opts.to)) return { state: before, reused: true };
  const me = from.account.address;
  if (!isAddressEqual(before.holder, me) || !isAddressEqual(before.beneficiary, me)) {
    throw new NonRetryableError(`${me} is not holder+beneficiary (holder ${before.holder}, beneficiary ${before.beneficiary})`);
  }
  if (isAddressEqual(opts.to, zeroAddress)) throw new NonRetryableError('refusing transfer to zero address');
  const { request } = await pub.simulateContract({
    account: from.account,
    address: before.titleEscrow,
    abi: escrowAbi,
    functionName: 'transferOwners',
    args: [opts.to, opts.to, '0x'],
  });
  const txHash = await from.writeContract(request);
  await waitForSuccess(pub, txHash);
  const state = await readTitle(pub, opts.registry, opts.tokenId);
  if (!isAddressEqual(state.holder, opts.to) || !isAddressEqual(state.beneficiary, opts.to)) {
    throw new NonRetryableError(`post-transfer state wrong: holder ${state.holder}, beneficiary ${state.beneficiary}`);
  }
  return { state, txHash, reused: false };
}

/** Top `to` up to `target` wei if below `min`. Idempotent by balance check. The single funder links addresses (THREAT_MODEL T13). */
export async function ensureGas(
  pub: PublicClient,
  funder: Wallet,
  opts: { to: Address; min: bigint; target: bigint },
): Promise<{ balance: bigint; txHash?: Hash }> {
  const balance = await withRetry(() => pub.getBalance({ address: opts.to }), { label: `balance ${opts.to}` });
  if (balance >= opts.min) return { balance };
  const amount = opts.target - balance;
  const funderBal = await pub.getBalance({ address: funder.account.address });
  if (funderBal < amount) throw new NonRetryableError(`funder ${funder.account.address} has ${funderBal} wei, needs ${amount}`);
  const txHash = await funder.sendTransaction({ to: opts.to, value: amount });
  await waitForSuccess(pub, txHash, 1);
  return { balance: await pub.getBalance({ address: opts.to }), txHash };
}
