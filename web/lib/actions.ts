import type { DealView, Party, TitleFacts } from './types';

export type ActionId =
  | 'accept_deal' | 'decline_deal' | 'withdraw_deal' | 'claim_timeout' | 'deposit_to_verifier' | 'fund'
  | 'hand_over' | 'confirm_title_held' | 'accept_documents' | 'refuse_documents' | 'release' | 'confirm_delivery'
  | 'dispute' | 'vote_release' | 'vote_refund' | 'resume' | 'confirm_title_transferred'
  | 'confirm_title_at_deal_address' | 'redeliver_title';

export interface UiAction {
  id: ActionId;
  label: string;
  tone: 'primary' | 'neutral' | 'danger';
  /** Present when the action is shown but not possible yet; the UI explains why. */
  disabledReason?: string;
}

export interface ActionContext {
  now: bigint; // ns
  acceptanceWindowNs: bigint;
  /** Buyer's tUSD in the Verifier (base units); undefined if unknown. */
  buyerVerifierBalance?: bigint;
  /** Connected EVM account (supplier hand-over). */
  evmAccount?: string;
}

const eq = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
const at = (f: TitleFacts | null, addr?: string | null) => !!f?.minted && eq(f.holder, addr) && eq(f.beneficiary, addr);

/** Actions for the signed-in party (null = not a party: only permissionless actions). Pure; tested. */
export function availableActions(d: DealView, me: Party | null, facts: TitleFacts | null, ctx: ActionContext): UiAction[] {
  const out: UiAction[] = [];
  const ebl = d.ebl;
  const amount = BigInt(d.amount);
  switch (d.state) {
    case 'Created': {
      const expired = ctx.now >= BigInt(d.created_at) + ctx.acceptanceWindowNs;
      if (expired) out.push({ id: 'claim_timeout', label: 'Cancel expired deal', tone: 'neutral' });
      if (me === 'Supplier' && !d.accepted && !expired) {
        out.push(
          ebl && !ebl.derived_address
            ? { id: 'accept_deal', label: 'Accept deal', tone: 'primary', disabledReason: 'Waiting for the deal address from NEAR MPC' }
            : { id: 'accept_deal', label: 'Accept deal', tone: 'primary' },
        );
        out.push({ id: 'decline_deal', label: 'Decline', tone: 'danger' });
      }
      if (me === 'Buyer') {
        if (d.accepted && !expired) {
          if (ctx.buyerVerifierBalance !== undefined && ctx.buyerVerifierBalance < amount) {
            out.push({ id: 'deposit_to_verifier', label: 'Deposit to NEAR Intents', tone: 'primary' });
            out.push({ id: 'fund', label: 'Fund deal', tone: 'primary', disabledReason: 'Deposit the amount to NEAR Intents first' });
          } else {
            out.push({ id: 'fund', label: 'Fund deal', tone: 'primary' });
          }
        }
        out.push({ id: 'withdraw_deal', label: 'Withdraw deal', tone: 'danger' });
      }
      break;
    }
    case 'Funded': {
      const deadline = ebl ? BigInt(ebl.ship_by) : BigInt(d.deliver_by ?? '0');
      if (ebl) {
        const held = at(facts, ebl.derived_address);
        if (me === 'Supplier' && at(facts, ebl.supplier_evm)) {
          out.push(
            eq(ctx.evmAccount, ebl.supplier_evm)
              ? { id: 'hand_over', label: 'Hand over bill of lading', tone: 'primary' }
              : { id: 'hand_over', label: 'Hand over bill of lading', tone: 'primary', disabledReason: `Connect the EVM wallet ${ebl.supplier_evm}` },
          );
        }
        if (me && ctx.now < deadline) {
          const label = me === 'Buyer' ? 'Confirm bill of lading held' : 'Co-confirm bill of lading held';
          out.push(held ? { id: 'confirm_title_held', label, tone: 'primary' } : { id: 'confirm_title_held', label, tone: 'primary', disabledReason: 'Sepolia does not show the deal address as holder and beneficiary yet' });
        }
      } else if (me === 'Buyer' && ctx.now < deadline) {
        out.push({ id: 'confirm_delivery', label: 'Confirm delivery', tone: 'primary' });
      }
      if (me === 'Buyer' && ctx.now >= deadline) out.push({ id: 'claim_timeout', label: 'Claim refund', tone: 'neutral' });
      if ((me === 'Buyer' || me === 'Supplier') && !d.disputed) out.push({ id: 'dispute', label: 'Open dispute', tone: 'danger' });
      break;
    }
    case 'TitleHeld': {
      const acceptBy = BigInt(ebl?.accept_by ?? '0');
      if (ctx.now < acceptBy) {
        if (me === 'Buyer') {
          out.push({ id: 'accept_documents', label: 'Accept documents', tone: 'primary' });
          out.push({ id: 'refuse_documents', label: 'Refuse documents', tone: 'danger' });
        }
      } else {
        out.push({ id: 'release', label: 'Release payment', tone: 'primary' });
      }
      if ((me === 'Buyer' || me === 'Supplier') && !d.disputed) out.push({ id: 'dispute', label: 'Open dispute', tone: 'danger' });
      break;
    }
    case 'Disputed':
      if (me) {
        const mine = me === 'Buyer' ? d.votes.buyer : me === 'Supplier' ? d.votes.supplier : d.votes.arbiter;
        const releaseBlocked = d.mode === 'ebl' && !d.confirmations.some((c) => c.fact === 'TitleHeld' && c.accepted);
        out.push(
          releaseBlocked
            ? { id: 'vote_release', label: 'Vote to release', tone: 'primary', disabledReason: 'The deal never held the title' }
            : { id: 'vote_release', label: mine === 'Release' ? 'Voted to release ✓' : 'Vote to release', tone: 'primary' },
        );
        out.push({ id: 'vote_refund', label: mine === 'Refund' ? 'Voted to refund ✓' : 'Vote to refund', tone: 'danger' });
      }
      break;
    case 'Settling':
    case 'Refunding': {
      if (d.cash_leg === 'Pending') out.push({ id: 'resume', label: 'Resume payment', tone: 'neutral' });
      const toBuyer = d.state === 'Settling';
      const dest = toBuyer ? ebl?.buyer_evm : ebl?.supplier_evm;
      const recipient: Party = toBuyer ? 'Buyer' : 'Supplier';
      if (ebl && me && d.title_leg.status !== 'Done' && d.title_leg.status !== 'NotApplicable') {
        const label = me === recipient ? 'Confirm title received' : 'Co-confirm title received';
        out.push(at(facts, dest) ? { id: 'confirm_title_transferred', label, tone: 'primary' } : { id: 'confirm_title_transferred', label, tone: 'primary', disabledReason: 'Sepolia does not show the title at its destination yet' });
      }
      break;
    }
    case 'Settled':
    case 'Refunded': {
      if (!ebl || !me) break;
      const entitled: Party = d.state === 'Settled' ? 'Buyer' : 'Supplier';
      const r = d.redelivery;
      const backAtDeal = at(facts, ebl.derived_address);
      if ((!r || r.leg.status === 'Done') && backAtDeal) {
        out.push({ id: 'confirm_title_at_deal_address', label: me === entitled ? 'Confirm title is back at the deal address' : 'Co-confirm title is back at the deal address', tone: 'neutral' });
      }
      if (r && !r.requested && r.leg.status !== 'Done' && me === entitled) out.push({ id: 'redeliver_title', label: 'Return bill of lading again', tone: 'primary' });
      if (r && r.requested && r.leg.status !== 'Done') {
        const dest = d.state === 'Settled' ? ebl.buyer_evm : ebl.supplier_evm;
        if (at(facts, dest)) out.push({ id: 'confirm_title_transferred', label: me === entitled ? 'Confirm title received' : 'Co-confirm title received', tone: 'primary' });
      }
      break;
    }
    case 'Cancelled':
      break;
  }
  return out;
}
