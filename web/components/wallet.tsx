'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { NearConnector } from '@hot-labs/near-connect';
import { config } from '@/lib/config';

interface CallInput {
  receiverId: string;
  method: string;
  args: object;
  gasTgas: number;
  /** yoctoNEAR as a decimal string */
  deposit: string;
}

interface WalletState {
  accountId: string | null;
  ready: boolean;
  /** Set when the wallet connector could not load; the app stays usable read-only. */
  unavailable: string | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  /** Signs and sends one function call; returns the NEAR tx hash. */
  call: (c: CallInput) => Promise<string>;
}

const Ctx = createContext<WalletState | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const connector = useRef<NearConnector | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [unavailable, setUnavailable] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { NearConnector } = await import('@hot-labs/near-connect');
        const c = new NearConnector({ network: config.network, providers: { [config.network]: [config.nearRpc] } });
        connector.current = c;
        c.on('wallet:signIn', (t) => setAccountId(t.accounts[0]?.accountId ?? null));
        c.on('wallet:signOut', () => setAccountId(null));
        // Restore an earlier session in the background: with no previous session this may never settle,
        // so it must not hold up the Connect button.
        c.getConnectedWallet()
          .then(({ accounts }) => !cancelled && setAccountId(accounts[0]?.accountId ?? null))
          .catch(() => undefined);
      } catch (e) {
        // Read-only mode: everything except signing keeps working.
        if (!cancelled) setUnavailable(e instanceof Error ? e.message : String(e));
      }
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
      connector.current?.removeAllListeners();
    };
  }, []);

  const connect = useCallback(async () => {
    await connector.current?.connect();
  }, []);
  const disconnect = useCallback(async () => {
    await connector.current?.disconnect();
    setAccountId(null);
  }, []);
  const call = useCallback(
    async (c: CallInput) => {
      if (!connector.current || !accountId) throw new Error('Connect a NEAR wallet first');
      const wallet = await connector.current.wallet();
      const outcome = await wallet.signAndSendTransaction({
        network: config.network,
        signerId: accountId,
        receiverId: c.receiverId,
        actions: [{ type: 'FunctionCall', params: { methodName: c.method, args: c.args, gas: (BigInt(c.gasTgas) * 10n ** 12n).toString(), deposit: c.deposit } }],
      });
      const status = outcome.status as { Failure?: unknown } | string;
      if (typeof status === 'object' && status && 'Failure' in status) throw new Error(JSON.stringify(status.Failure));
      return outcome.transaction_outcome.id;
    },
    [accountId],
  );

  const value = useMemo(() => ({ accountId, ready, unavailable, connect, disconnect, call }), [accountId, ready, unavailable, connect, disconnect, call]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWallet(): WalletState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useWallet outside WalletProvider');
  return v;
}

export function WalletButton() {
  const w = useWallet();
  if (!w.ready) return <button className="btn btn-quiet" disabled>Wallet…</button>;
  if (w.unavailable) return <span className="muted small" title={w.unavailable}>Read-only (wallet unavailable)</span>;
  return w.accountId ? (
    <button className="btn btn-quiet" onClick={() => void w.disconnect()} title="Sign out">
      <span className="mono">{w.accountId}</span>
    </button>
  ) : (
    <button className="btn" onClick={() => void w.connect()}>Connect NEAR wallet</button>
  );
}
