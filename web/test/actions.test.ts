import { describe, expect, it } from 'vitest';
import { availableActions, type ActionContext } from '@/lib/actions';
import { formatAmount, parseAmount } from '@/lib/format';
import { stateLabel } from '@/lib/labels';
import type { DealView, TitleFacts } from '@/lib/types';

const DERIVED = '0xdda5844e9c176a551df9a6fe10cd184d3fedca4c';
const BUYER_EVM = '0x6a7d2cf926879f23692ab6058258d1eb7c3e46ed';
const SUPPLIER_EVM = '0xefbc93fc249040e533d8191def10dc58d4108717';
const NOW = 1_800_000_000_000_000_000n;
const ctx: ActionContext = { now: NOW, acceptanceWindowNs: 604_800_000_000_000n };

const deal = (over: Partial<DealView> = {}): DealView => ({
  id: '0', buyer: 'b.testnet', supplier: 's.testnet', arbiter: 'a.testnet', token_id: 'nep141:tusd', amount: '1000000', order_hash: '00',
  payout: { Internal: { account: 's.testnet' } }, mode: 'ebl',
  ebl: { chain_id: 11155111, factory: '0x', registry: '0x4e95', token_id: '1', title_escrow: '0x9e54', buyer_evm: BUYER_EVM, supplier_evm: SUPPLIER_EVM,
    ship_by: (NOW + 1_000_000_000_000n).toString(), doc_acceptance_window_ns: '3600000000000', derived_address: DERIVED, derivation_path: 'tradelock/deal/0', accept_by: null },
  deliver_by: null, state: 'Created', accepted: false, created_at: NOW.toString(), cash_leg: 'Pending', title_leg: { status: 'NotApplicable' },
  disputed: false, votes: { buyer: null, supplier: null, arbiter: null }, open_fact: null, pending_confirmers: [], confirmations: [], redelivery: null, ...over,
});
const at = (a: string): TitleFacts => ({ minted: true, holder: a, beneficiary: a, block: '100' });
const ids = (xs: { id: string; disabledReason?: string }[]) => xs.map((x) => (x.disabledReason ? `${x.id}(disabled)` : x.id));

describe('availableActions', () => {
  it('Created: supplier accepts/declines; buyer deposits before funding', () => {
    expect(ids(availableActions(deal(), 'Supplier', null, ctx))).toEqual(['accept_deal', 'decline_deal']);
    const accepted = deal({ accepted: true });
    expect(ids(availableActions(accepted, 'Buyer', null, { ...ctx, buyerVerifierBalance: 0n }))).toEqual(['deposit_to_verifier', 'fund(disabled)', 'withdraw_deal']);
    expect(ids(availableActions(accepted, 'Buyer', null, { ...ctx, buyerVerifierBalance: 1_000_000n }))).toEqual(['fund', 'withdraw_deal']);
  });

  it('Funded eBL: hand-over needs the supplier EVM wallet; confirm held needs Sepolia proof', () => {
    const d = deal({ state: 'Funded', accepted: true });
    expect(ids(availableActions(d, 'Supplier', at(SUPPLIER_EVM), ctx))).toEqual(['hand_over(disabled)', 'confirm_title_held(disabled)', 'dispute']);
    expect(ids(availableActions(d, 'Supplier', at(SUPPLIER_EVM), { ...ctx, evmAccount: SUPPLIER_EVM }))[0]).toBe('hand_over');
    expect(ids(availableActions(d, 'Buyer', at(DERIVED), ctx))).toEqual(['confirm_title_held', 'dispute']);
    expect(ids(availableActions(d, 'Arbiter', at(DERIVED), ctx))).toEqual(['confirm_title_held']);
  });

  it('TitleHeld: buyer accepts/refuses before accept_by; anyone releases after (D-020)', () => {
    const acceptBy = (NOW + 10n).toString();
    const d = deal({ state: 'TitleHeld', accepted: true, ebl: { ...deal().ebl!, accept_by: acceptBy } });
    expect(ids(availableActions(d, 'Buyer', at(DERIVED), ctx))).toEqual(['accept_documents', 'refuse_documents', 'dispute']);
    expect(ids(availableActions(d, null, at(DERIVED), { ...ctx, now: NOW + 10n }))).toEqual(['release']);
  });

  it('Settling: recipient confirms only when Sepolia shows the title at the buyer', () => {
    const d = deal({ state: 'Settling', accepted: true, cash_leg: 'Done', title_leg: { status: 'Broadcast' } });
    expect(ids(availableActions(d, 'Buyer', at(DERIVED), ctx))).toEqual(['confirm_title_transferred(disabled)']);
    expect(ids(availableActions(d, 'Buyer', at(BUYER_EVM), ctx))).toEqual(['confirm_title_transferred']);
    expect(ids(availableActions({ ...d, cash_leg: 'Pending' }, null, null, ctx))).toEqual(['resume']);
  });

  it('Settled: title back at deal address → confirm, then redeliver by the buyer only', () => {
    const d = deal({ state: 'Settled', accepted: true, cash_leg: 'Done', title_leg: { status: 'Done' } });
    expect(ids(availableActions(d, 'Buyer', at(DERIVED), ctx))).toEqual(['confirm_title_at_deal_address']);
    const r = { ...d, redelivery: { leg: { status: 'Pending' as const }, requested: false, round: 1 } };
    expect(ids(availableActions(r, 'Buyer', at(DERIVED), ctx))).toEqual(['redeliver_title']);
    expect(ids(availableActions(r, 'Supplier', at(DERIVED), ctx))).toEqual([]);
  });

  it('escrow-only: buyer confirms delivery; refund after deliver_by', () => {
    const d = deal({ state: 'Funded', accepted: true, mode: 'escrow_only', ebl: null, deliver_by: (NOW + 5n).toString() });
    expect(ids(availableActions(d, 'Buyer', null, ctx))).toEqual(['confirm_delivery', 'dispute']);
    expect(ids(availableActions(d, 'Buyer', null, { ...ctx, now: NOW + 5n }))).toEqual(['claim_timeout', 'dispute']);
  });
});

describe('copy and amounts', () => {
  it('labels follow FRONTEND §6', () => {
    expect(stateLabel(deal())).toBe('Waiting for supplier to accept');
    expect(stateLabel(deal({ state: 'Settled' }))).toBe('Released: supplier paid, buyer owns the goods');
    expect(stateLabel(deal({ state: 'Funded', mode: 'escrow_only', ebl: null }))).toBe('Funded — waiting for delivery');
  });
  it('amount round-trip at 6 decimals', () => {
    expect(parseAmount('1.00', 6)).toBe('1000000');
    expect(formatAmount('1250000', 6)).toBe('1.25');
    expect(() => parseAmount('0', 6)).toThrow();
    expect(() => parseAmount('1.0000001', 6)).toThrow();
  });
});

import { timeline } from '@/lib/timeline';
describe('timeline follows the actual path', () => {
  const labels = (d: DealView) => timeline(d).map((t) => `${t.label}:${t.status}`);
  it('settle path', () => {
    expect(labels(deal({ state: 'Settled', title_leg: { status: 'Done' } }))).toEqual(['Created:done', 'Funded:done', 'Title held:done', 'Documents accepted:done', 'Settled:current']);
  });
  it('refused documents never show Documents accepted / Settled', () => {
    const d = deal({ state: 'Refunded', title_leg: { status: 'Done' } });
    expect(labels(d)).toEqual(['Created:done', 'Funded:done', 'Title held:done', 'Returned:current']);
  });
  it('ship_by refund without title skips Title held', () => {
    expect(labels(deal({ state: 'Refunding', title_leg: { status: 'NotApplicable' } }))).toEqual(['Created:done', 'Funded:done', 'Returning:current']);
  });
  it('escrow-only settle', () => {
    expect(labels(deal({ state: 'Settled', mode: 'escrow_only', ebl: null }))).toEqual(['Created:done', 'Funded:done', 'Delivered:done', 'Settled:current']);
  });
  it('dispute settled by vote shows the vote, never Documents accepted', () => {
    const d = deal({ state: 'Settled', disputed: true, title_leg: { status: 'Done' } });
    expect(labels(d)).toEqual(['Created:done', 'Funded:done', 'Title held:done', 'Disputed: 2-of-3 Release:done', 'Settled:current']);
  });
  it('dispute refunded by vote', () => {
    expect(labels(deal({ state: 'Refunded', disputed: true, title_leg: { status: 'Done' } }))).toEqual(['Created:done', 'Funded:done', 'Title held:done', 'Disputed: 2-of-3 Refund:done', 'Returned:current']);
  });
});
