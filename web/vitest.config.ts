import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
  test: { include: ['test/**/*.test.ts'], env: {
    NEXT_PUBLIC_NEAR_RPC: 'https://rpc.testnet.fastnear.com', NEXT_PUBLIC_TRADELOCK: 'tradelock.samuelowen.testnet',
    NEXT_PUBLIC_VERIFIER: 'intents.samuelowen.testnet', NEXT_PUBLIC_TOKEN: 'tusd.samuelowen.testnet',
    NEXT_PUBLIC_SEPOLIA_RPC: 'https://ethereum-sepolia-rpc.publicnode.com', NEXT_PUBLIC_REGISTRY: '0x4e95A0b956d5CADeD0864Df2D26a508257BeC811',
  } },
});
