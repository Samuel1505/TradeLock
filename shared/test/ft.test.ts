import { describe, expect, it } from 'vitest';
import '../src/env.js';
import { assertFtRegistered, ftStorageBalance } from '../src/index.js';

const rpc = [process.env.NEAR_RPC_URL ?? 'https://rpc.testnet.fastnear.com'];
const TOKEN = 'tusd.samuelowen.testnet';

describe.runIf(process.env.RUN_NETWORK_TESTS === '1')('tUSD registration check (live testnet)', () => {
  it('owner is registered (NEP-145)', async () => {
    expect(await ftStorageBalance(rpc, TOKEN, 'samuelowen.testnet')).not.toBeNull();
  });
  it('fails clearly, naming every unregistered recipient and the fix', async () => {
    const ghost = 'nobody-registered-here.testnet';
    await expect(assertFtRegistered(rpc, TOKEN, ['samuelowen.testnet', ghost])).rejects.toThrow(
      new RegExp(`not registered on ${TOKEN}: ${ghost}[\\s\\S]*storage_deposit`),
    );
  });
});
