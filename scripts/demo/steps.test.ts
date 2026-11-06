import { describe, expect, it } from 'vitest';
import { nextStep, type DealView, type SepoliaFacts } from './steps.js';

const DERIVED = '0xdda5844e9c176a551df9a6fe10cd184d3fedca4c';
const BUYER = '0x6a7d2cf926879f23692ab6058258d1eb7c3e46ed';
const SUPPLIER = '0xefbc93fc249040e533d8191def10dc58d4108717';

const ebl = (over: Partial<DealView> = {}): DealView => ({
  id: '0',
  state: 'Created',
  accepted: false,
  mode: 'ebl',
  disputed: false,
  votes: { buyer: null, supplier: null, arbiter: null },
  pending_confirmers: [],
  cash_leg: 'Pending',
  title_leg: { status: 'NotApplicable' },
  ebl: { derived_address: DERIVED, title_escrow: '0x9e54', registry: '0x4e95', token_id: '1', buyer_evm: BUYER, supplier_evm: SUPPLIER, accept_by: null, derivation_path: 'tradelock/deal/0' },
  ...over,
});
const at = (a: string): SepoliaFacts => ({ minted: true, holder: a, beneficiary: a });

describe('nextStep', () => {
  it('Created: derived address → accept → fund', () => {
    expect(nextStep(ebl({ ebl: { ...ebl().ebl!, derived_address: null } }), 'settle', null).kind).toBe('refresh_derived_address');
    expect(nextStep(ebl(), 'settle', null).kind).toBe('accept_deal');
    expect(nextStep(ebl({ accepted: true }), 'settle', null).kind).toBe('fund');
  });

  it('Funded eBL: mint → hand over → confirm held, from Sepolia state', () => {
    const d = ebl({ state: 'Funded', accepted: true });
    expect(nextStep(d, 'settle', { minted: false }).kind).toBe('mint_ebl');
    expect(nextStep(d, 'settle', at(SUPPLIER)).kind).toBe('hand_over');
    expect(nextStep(d, 'settle', at(DERIVED)).kind).toBe('confirm_title_held');
    expect(nextStep(d, 'settle', { minted: true, holder: DERIVED, beneficiary: SUPPLIER }).kind).toBe('stuck');
  });

  it('TitleHeld: flow decides accept vs refuse (D-020)', () => {
    const d = ebl({ state: 'TitleHeld', accepted: true });
    expect(nextStep(d, 'settle', at(DERIVED)).kind).toBe('accept_documents');
    expect(nextStep(d, 'refund', at(DERIVED)).kind).toBe('refuse_documents');
  });

  it('Settling: cash resume, sign, wait, broadcast, then buyer confirms', () => {
    const s = (cash: DealView['cash_leg'], tl: DealView['title_leg']['status']) => ebl({ state: 'Settling', accepted: true, cash_leg: cash, title_leg: { status: tl } });
    expect(nextStep(s('Pending', 'Pending'), 'settle', at(DERIVED)).kind).toBe('resume_cash');
    expect(nextStep(s('Done', 'Pending'), 'settle', at(DERIVED)).kind).toBe('request_signature');
    expect(nextStep(s('Done', 'SignatureRequested'), 'settle', at(DERIVED)).kind).toBe('wait');
    expect(nextStep(s('Done', 'Signed'), 'settle', at(DERIVED)).kind).toBe('broadcast');
    expect(nextStep(s('Done', 'Broadcast'), 'settle', at(BUYER))).toEqual({ kind: 'confirm_title_transferred', by: 'buyer' });
  });

  it('Refunding: supplier confirms title back', () => {
    const d = ebl({ state: 'Refunding', accepted: true, cash_leg: 'Done', title_leg: { status: 'Broadcast' } });
    expect(nextStep(d, 'refund', at(SUPPLIER))).toEqual({ kind: 'confirm_title_transferred', by: 'supplier' });
    expect(nextStep(d, 'refund', at(DERIVED)).kind).toBe('broadcast');
  });

  it('escrow-only: buyer confirms delivery; terminal states are done', () => {
    const d: DealView = { ...ebl({ state: 'Funded', accepted: true }), mode: 'escrow_only', ebl: null };
    expect(nextStep(d, 'escrow', null).kind).toBe('confirm_delivery');
    expect(nextStep({ ...d, state: 'Settled' }, 'escrow', null).kind).toBe('done');
    expect(nextStep({ ...d, state: 'Disputed' }, 'escrow', null).kind).toBe('stuck');
  });

  it('dispute: supplier disputes at TitleHeld, then supplier + arbiter vote Release', () => {
    const held = ebl({ state: 'TitleHeld', accepted: true });
    expect(nextStep(held, 'dispute', at(DERIVED))).toEqual({ kind: 'dispute' });
    const d = ebl({ state: 'Disputed', accepted: true, disputed: true });
    expect(nextStep(d, 'dispute', at(DERIVED))).toEqual({ kind: 'vote', by: 'supplier', decision: 'Release' });
    expect(nextStep({ ...d, votes: { buyer: null, supplier: 'Release', arbiter: null } }, 'dispute', at(DERIVED))).toEqual({ kind: 'vote', by: 'arbiter', decision: 'Release' });
    expect(nextStep(d, 'settle', at(DERIVED)).kind).toBe('stuck');
  });

  it('dispute: silent buyer, so supplier then arbiter confirm the title reached the buyer (D-019)', () => {
    const s = ebl({ state: 'Settling', accepted: true, disputed: true, cash_leg: 'Done', title_leg: { status: 'Broadcast' } });
    expect(nextStep(s, 'dispute', at(BUYER))).toEqual({ kind: 'confirm_title_transferred', by: 'supplier' });
    expect(nextStep({ ...s, pending_confirmers: ['Supplier'] }, 'dispute', at(BUYER))).toEqual({ kind: 'confirm_title_transferred', by: 'arbiter' });
    expect(nextStep(s, 'dispute', at(DERIVED)).kind).toBe('broadcast');
  });
});
