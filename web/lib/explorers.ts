import { config } from './config';

const nearBase = () => (config.network === 'mainnet' ? 'https://nearblocks.io' : 'https://testnet.nearblocks.io');
export const nearTx = (hash: string) => `${nearBase()}/txns/${hash}`;
export const nearAccount = (id: string) => `${nearBase()}/address/${id}`;
export const sepoliaTx = (hash: string) => `https://sepolia.etherscan.io/tx/${hash}`;
export const sepoliaAddress = (a: string) => `https://sepolia.etherscan.io/address/${a}`;
