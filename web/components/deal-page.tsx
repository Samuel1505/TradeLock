'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { availableActions, type ActionId, type UiAction } from '@/lib/actions';
import { config, tokenId } from '@/lib/config';
import { nearAccount, nearTx, sepoliaAddress, sepoliaTx } from '@/lib/explorers';
import { formatAmount, formatTime, short } from '@/lib/format';
import { cashLabel, explainError, stateLabel, titleLegLabel } from '@/lib/labels';
import { getDeal, verifierBalance, view } from '@/lib/near';
import { connectEvm, handOverTitle, readTitleFacts } from '@/lib/sepolia';
import { TERMINAL, type DealView, type Party, type TitleFacts } from '@/lib/types';
import { timeline } from '@/lib/timeline';
import { useWallet } from './wallet';

const TGAS = { small: 30, cash: 150, fund: 300 } as const;
const YOCTO_1 = '1';

export function DealPage({ id }: { id: string }) {
  const w = useWallet();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<ActionId | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string; href?: string } | null>(null);
  const [evm, setEvm] = useState<string | undefined>();

  const deal = useQuery({
    queryKey: ['deal', id],
    queryFn: () => getDeal(id),
    refetchInterval: (q) => (q.state.data && TERMINAL.includes(q.state.data.state) ? false : 5_000),
  });
  const d = deal.data;
  const facts = useQuery({
    queryKey: ['title', d?.ebl?.registry, d?.ebl?.token_id],
    queryFn: () => readTitleFacts(d!.ebl!.registry, d!.ebl!.token_id),
    enabled: !!d?.ebl,
    refetchInterval: 8_000,
  });
  const cfg = useQuery({ queryKey: ['config'], queryFn: () => view<{ acceptance_window_ns: string }>(config.tradelock, 'get_config'), staleTime: 60_000 });
  const me: Party | null = !d || !w.accountId ? null : w.accountId === d.buyer ? 'Buyer' : w.accountId === d.supplier ? 'Supplier' : w.accountId === d.arbiter ? 'Arbiter' : null;
  const buyerBal = useQuery({
    queryKey: ['vbal', d?.buyer],
    queryFn: () => verifierBalance(d!.buyer, tokenId()),
    enabled: !!d && me === 'Buyer' && d.state === 'Created',
    refetchInterval: 6_000,
  });

  if (deal.isLoading) return <p className="muted">Loading deal {id}…</p>;
  if (deal.error) return <p className="error">Could not load deal {id}: {String(deal.error)}</p>;
  if (!d) return <p className="muted">No deal {id} on {config.tradelock}.</p>;

  const f: TitleFacts | null = facts.data ?? null;
  const actions = availableActions(d, me, f, {
    now: BigInt(Date.now()) * 1_000_000n,
    acceptanceWindowNs: BigInt(cfg.data?.acceptance_window_ns ?? '604800000000000'),
    buyerVerifierBalance: buyerBal.data !== undefined ? BigInt(buyerBal.data) : undefined,
    evmAccount: evm,
  });
  const toBuyer = d.state !== 'Refunding' && d.state !== 'Refunded';
  const released = d.state === 'Settled';
  const amount = `${formatAmount(d.amount, config.tokenDecimals)} ${config.tokenSymbol}`;

  async function run(a: UiAction) {
    if (!d) return;
    setBusy(a.id);
    setMessage(null);
    try {
      const dealArgs = { deal_id: d.id };
      const evidence = f && { holder: f.holder, beneficiary: f.beneficiary, block_number: f.block, tx_hash: null };
      const C = config.tradelock;
      let hash: string;
      let isSepolia = false;
      switch (a.id) {
        case 'hand_over': {
          const from = (evm ?? (await connectEvm())) as `0x${string}`;
          setEvm(from);
          hash = await handOverTitle(d.ebl!.title_escrow, d.ebl!.derived_address!, from);
          isSepolia = true;
          break;
        }
        case 'deposit_to_verifier':
          hash = await w.call({ receiverId: config.token, method: 'ft_transfer_call', args: { receiver_id: config.verifier, amount: d.amount, msg: '' }, gasTgas: 100, deposit: YOCTO_1 });
          break;
        case 'fund':
          hash = await w.call({ receiverId: config.verifier, method: 'mt_transfer_call', args: { receiver_id: C, token_id: d.token_id, amount: d.amount, msg: JSON.stringify({ deal_id: Number(d.id) }) }, gasTgas: TGAS.fund, deposit: YOCTO_1 });
          break;
        case 'confirm_title_held':
        case 'confirm_title_transferred':
        case 'confirm_title_at_deal_address':
          if (!evidence) throw new Error('Sepolia state not loaded yet');
          hash = await w.call({ receiverId: C, method: a.id, args: { ...dealArgs, evidence }, gasTgas: TGAS.small, deposit: '0' });
          break;
        case 'vote_release':
        case 'vote_refund':
          hash = await w.call({ receiverId: C, method: 'vote', args: { ...dealArgs, decision: a.id === 'vote_release' ? 'Release' : 'Refund' }, gasTgas: TGAS.cash, deposit: '0' });
          break;
        case 'dispute':
        case 'refuse_documents':
          hash = await w.call({ receiverId: C, method: a.id, args: { ...dealArgs, reason_hash: null }, gasTgas: TGAS.cash, deposit: '0' });
          break;
        case 'accept_documents':
        case 'release':
        case 'confirm_delivery':
        case 'claim_timeout':
        case 'resume':
          hash = await w.call({ receiverId: C, method: a.id, args: dealArgs, gasTgas: TGAS.cash, deposit: '0' });
          break;
        default:
          hash = await w.call({ receiverId: C, method: a.id, args: dealArgs, gasTgas: TGAS.small, deposit: '0' });
      }
      setMessage({ kind: 'ok', text: `${a.label}: sent`, href: isSepolia ? sepoliaTx(hash) : nearTx(hash) });
    } catch (e) {
      setMessage({ kind: 'err', text: explainError(e instanceof Error ? e.message : String(e)) });
    } finally {
      setBusy(null);
      await qc.invalidateQueries();
    }
  }

  return (
    <article className="deal">
      <header className="deal-head">
        <p className="muted mono">Deal {d.id} · {d.mode === 'ebl' ? 'Documents against payment' : 'Escrow only'}</p>
        <h1>{stateLabel(d)}</h1>
        <p className="muted">
          Buyer <a href={nearAccount(d.buyer)} className="mono">{d.buyer}</a> · Supplier <a href={nearAccount(d.supplier)} className="mono">{d.supplier}</a> · Arbiter{' '}
          <a href={nearAccount(d.arbiter)} className="mono">{d.arbiter}</a>
          {me && <> · you are the <strong>{me.toLowerCase()}</strong></>}
        </p>
      </header>

      <ol className="timeline" aria-label="Deal progress">
        {timeline(d).map((t) => (
          <li key={t.label} className={[t.status === 'todo' ? '' : t.status, t.tone ?? ''].join(' ').trim()} aria-current={t.status === 'current' ? 'step' : undefined}>
            {t.label}
          </li>
        ))}
      </ol>

      <section className="legs">
        <div className="leg sheet">
          <h2>Cash</h2>
          <p className="amount">{amount}</p>
          <p>{cashLabel(d)}</p>
          <p className="muted small">Held in NEAR Intents (Verifier <span className="mono">{config.verifier}</span>), token <span className="mono">{d.token_id}</span></p>
        </div>

        <div className={`seal ${released ? 'stamped' : ''}`} aria-live="polite">
          <span>{released ? 'RELEASED' : d.state === 'Refunded' ? 'RETURNED' : 'LOCKED'}</span>
        </div>

        <div className="leg sheet">
          <h2>Title</h2>
          {d.ebl ? (
            <>
              <p>
                Bill of lading <span className="mono">#{short(d.ebl.token_id)}</span> on Sepolia
              </p>
              <p>{titleLegLabel(d.title_leg, toBuyer)}</p>
              <dl className="facts">
                <dt>TitleEscrow</dt>
                <dd><a className="mono" href={sepoliaAddress(d.ebl.title_escrow)}>{short(d.ebl.title_escrow)}</a></dd>
                <dt>Deal address</dt>
                <dd>{d.ebl.derived_address ? <a className="mono" href={sepoliaAddress(d.ebl.derived_address)}>{short(d.ebl.derived_address)}</a> : 'from NEAR MPC…'}</dd>
                <dt>Holder (live)</dt>
                <dd className="mono">{f?.minted ? short(f.holder!) : f ? 'not minted' : facts.isError ? 'unavailable' : '…'}</dd>
                <dt>Beneficiary (live)</dt>
                <dd className="mono">{f?.minted ? short(f.beneficiary!) : f ? 'not minted' : facts.isError ? 'unavailable' : '…'}</dd>
                {f?.block && <><dt>Read at block</dt><dd className="mono">{f.block}</dd></>}
              </dl>
              {facts.isError && <p className="error small" role="status">Sepolia read failed: {String(facts.error).slice(0, 160)}. Retrying…</p>}
              {d.title_leg.tx_hash && <p><a href={sepoliaTx(d.title_leg.tx_hash)}>Title transfer on Etherscan ↗</a></p>}
              {d.ebl.accept_by && d.state === 'TitleHeld' && <p className="muted small">Accept or refuse by {formatTime(d.ebl.accept_by)}; after that anyone can release.</p>}
            </>
          ) : (
            <p className="muted">No bill of lading in this deal.</p>
          )}
        </div>
      </section>

      {!w.accountId && (
        <p className="muted small readonly-note">Read-only view. Everything above is read live from NEAR testnet and Sepolia; connect the buyer, supplier or arbiter account to act.</p>
      )}
      {w.accountId && actions.length > 0 && (
        <section className="actions" aria-label="Actions">
          {actions.map((a) => (
            <span key={a.id} className="action">
              <button className={`btn btn-${a.tone}`} disabled={!!a.disabledReason || busy !== null} onClick={() => void run(a)}>
                {busy === a.id ? 'Sending…' : a.label}
              </button>
              {a.disabledReason && <small className="muted">{a.disabledReason}</small>}
            </span>
          ))}
        </section>
      )}
      {d.ebl && (d.title_leg.status === 'Pending' || d.title_leg.status === 'Signed') && (
        <p className="muted small">
          Signing and broadcasting the title transfer is permissionless: <span className="mono">pnpm demo {d.state === 'Refunding' ? 'refund' : 'settle'} --deal {d.id} --yes</span>
        </p>
      )}
      {message && (
        <p className={message.kind === 'ok' ? 'ok' : 'error'} role="status">
          {message.text} {message.href && <a href={message.href}>view transaction ↗</a>}
        </p>
      )}

      {d.confirmations.length > 0 && (
        <section>
          <h2>Confirmations</h2>
          <p className="muted small">Each one is re-checkable on Sepolia at the stated block (TitleEscrow holder() / beneficiary()).</p>
          <table className="records">
            <thead>
              <tr><th>Fact</th><th>By</th><th>Holder = beneficiary</th><th>Sepolia block</th><th>Accepted</th></tr>
            </thead>
            <tbody>
              {d.confirmations.map((c, i) => (
                <tr key={i}>
                  <td>{c.fact}</td>
                  <td>{c.party}</td>
                  <td className="mono">{short(c.evidence.holder)}</td>
                  <td className="mono">{c.evidence.block_number}</td>
                  <td>{c.accepted ? 'yes' : 'waiting for second party'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </article>
  );
}
