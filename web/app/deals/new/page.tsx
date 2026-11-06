'use client';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { useWallet } from '@/components/wallet';
import { config, tokenId } from '@/lib/config';
import { parseAmount } from '@/lib/format';
import { explainError } from '@/lib/labels';
import { getDealsByAccount } from '@/lib/near';

const NS = 1_000_000n;
const toNs = (dateTime: string) => (BigInt(new Date(dateTime).getTime()) * NS).toString();
const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 16);

async function sha256Hex(file: File): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export default function NewDeal() {
  const w = useWallet();
  const router = useRouter();
  const [mode, setMode] = useState<'ebl' | 'escrow'>('ebl');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const f = new FormData(e.currentTarget);
    const s = (k: string) => String(f.get(k) ?? '').trim();
    try {
      if (!w.accountId) throw new Error('Connect the buyer account first');
      const doc = f.get('order') as File | null;
      if (!doc || doc.size === 0) throw new Error('Choose the order document (only its SHA-256 hash goes on-chain)');
      const order_hash = await sha256Hex(doc);
      const amount = parseAmount(s('amount'), config.tokenDecimals);
      const payoutAccount = s('payout_account') || s('supplier');
      const payout = s('payout') === 'withdraw' ? { Withdraw: { account: payoutAccount } } : { Internal: { account: payoutAccount } };
      const modeTerms =
        mode === 'ebl'
          ? {
              Ebl: {
                chain_id: 11155111,
                registry: s('registry'),
                token_id: s('ebl_token_id'),
                buyer_evm: s('buyer_evm'),
                supplier_evm: s('supplier_evm'),
                ship_by: toNs(s('ship_by')),
                doc_acceptance_window_ns: (BigInt(Math.round(Number(s('window_hours')) * 3600)) * 1_000_000_000n).toString(),
              },
            }
          : { EscrowOnly: { deliver_by: toNs(s('deliver_by')) } };
      const terms = { supplier: s('supplier'), arbiter: s('arbiter'), token_id: tokenId(), amount, order_hash, payout, mode: modeTerms };
      setBusy(true);
      // 0.1 NEAR covers storage; the contract refunds the excess.
      await w.call({ receiverId: config.tradelock, method: 'create_deal', args: { terms }, gasTgas: 100, deposit: (10n ** 23n).toString() });
      const mine = await getDealsByAccount(w.accountId);
      const latest = mine.at(-1);
      router.push(latest ? `/deals/${latest.id}` : '/deals');
    } catch (err) {
      setError(explainError(err instanceof Error ? err.message : String(err)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h1>Start a deal</h1>
      <p className="muted">You are the buyer. The supplier accepts, then you fund it from your NEAR Intents balance.</p>
      <form className="form sheet" onSubmit={(e) => void submit(e)}>
        <fieldset>
          <legend>Parties</legend>
          <label>Supplier NEAR account<input name="supplier" required placeholder="supplier.samuelowen.testnet" /></label>
          <label>Arbiter NEAR account<input name="arbiter" required placeholder="arbiter.samuelowen.testnet" /></label>
        </fieldset>
        <fieldset>
          <legend>Payment</legend>
          <label>Amount ({config.tokenSymbol})<input name="amount" required inputMode="decimal" defaultValue="1.00" /></label>
          <label>Supplier is paid
            <select name="payout" defaultValue="internal">
              <option value="internal">inside NEAR Intents (Verifier balance)</option>
              <option value="withdraw">as {config.tokenSymbol} to a NEAR account (account must be registered on the token)</option>
            </select>
          </label>
          <label>Payout account (default: supplier)<input name="payout_account" placeholder="supplier.samuelowen.testnet" /></label>
        </fieldset>
        <fieldset>
          <legend>Mode</legend>
          <label className="inline"><input type="radio" name="mode" checked={mode === 'ebl'} onChange={() => setMode('ebl')} /> Bill of lading (documents against payment)</label>
          <label className="inline"><input type="radio" name="mode" checked={mode === 'escrow'} onChange={() => setMode('escrow')} /> Escrow only (released on delivery)</label>
          {mode === 'ebl' ? (
            <>
              <label>TradeTrust registry (Sepolia)<input name="registry" required defaultValue={config.registry} className="mono" /></label>
              <label>eBL token id (uint256)<input name="ebl_token_id" required className="mono" /></label>
              <label>Your EVM address (receives the title)<input name="buyer_evm" required className="mono" placeholder="0x…" /></label>
              <label>Supplier EVM address (title returns here on refund)<input name="supplier_evm" required className="mono" placeholder="0x…" /></label>
              <label>Supplier hands over the title by<input name="ship_by" type="datetime-local" required defaultValue={inDays(7)} /></label>
              <label>Hours you have to accept or refuse the documents<input name="window_hours" type="number" min="0.02" step="0.01" required defaultValue="24" /></label>
            </>
          ) : (
            <label>Delivery deadline<input name="deliver_by" type="datetime-local" required defaultValue={inDays(14)} /></label>
          )}
        </fieldset>
        <fieldset>
          <legend>Order document</legend>
          <label>File (hashed in your browser; never uploaded)<input name="order" type="file" required /></label>
        </fieldset>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn btn-primary" disabled={busy || !w.accountId}>{busy ? 'Sending…' : w.accountId ? 'Create deal (0.1 NEAR storage deposit, excess refunded)' : 'Connect wallet to create'}</button>
      </form>
    </section>
  );
}
