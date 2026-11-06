export const SEPOLIA_CHAIN_ID = 11155111;
export const etherscanTx = (hash: string) => `https://sepolia.etherscan.io/tx/${hash}`;
export const etherscanAddress = (addr: string) => `https://sepolia.etherscan.io/address/${addr}`;
export const etherscanToken = (registry: string, tokenId: bigint | string) => `https://sepolia.etherscan.io/token/${registry}?a=${tokenId}`;
const nearExplorer = () => (process.env.NEAR_NETWORK === 'mainnet' ? 'https://nearblocks.io' : 'https://testnet.nearblocks.io');
export const nearTx = (hash: string) => `${nearExplorer()}/txns/${hash}`;
export const nearAccount = (id: string) => `${nearExplorer()}/address/${id}`;
