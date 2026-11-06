/**
 * Pure next-step decision for the demo runner. Input: the contract's deal view + what Sepolia shows.
 * The runner executes one step, re-reads chain state, and calls this again, so every run is resumable.
 */

/**
 * settle: buyer accepts documents. refund: buyer refuses. escrow: escrow-only, buyer confirms delivery.
 * dispute: title held; the buyer disputes ("documents don't match order"). Votes: buyer Refund, supplier Release,
 * arbiter Release → 2-of-3 Release → Settling. The buyer does not confirm receipt, so supplier + arbiter confirm
 * the title reached the buyer (D-019 two-party path). (A merely silent buyer needs no dispute: release after
 * accept_by, D-020.)
 */
export type Flow = 'settle' | 'refund' | 'escrow' | 'dispute';
export type Party = 'buyer' | 'supplier' | 'arbiter';

export interface TitleLegView {
  status: 'NotApplicable' | 'Pending' | 'SignatureRequested' | 'Signed' | 'Broadcast' | 'Done';
  tx?: Record<string, unknown>;
  signature?: Record<string, unknown>;
  tx_hash?: string;
}

export interface DealView {
  id: string;
  state: 'Created' | 'Funded' | 'TitleHeld' | 'Settling' | 'Settled' | 'Disputed' | 'Refunding' | 'Refunded' | 'Cancelled';
  accepted: boolean;
  mode: 'ebl' | 'escrow_only';
  disputed: boolean;
  votes: { buyer: 'Release' | 'Refund' | null; supplier: 'Release' | 'Refund' | null; arbiter: 'Release' | 'Refund' | null };
  pending_confirmers: ('Buyer' | 'Supplier' | 'Arbiter')[];
  cash_leg: 'Pending' | 'TransferRequested' | 'Done';
  title_leg: TitleLegView;
  ebl: null | {
    derived_address: string | null;
    title_escrow: string;
    registry: string;
    token_id: string;
    buyer_evm: string;
    supplier_evm: string;
    accept_by: string | null;
    derivation_path: string;
  };
}

/** What the runner read on Sepolia for this deal's TitleEscrow (eBL only). */
export interface SepoliaFacts {
  /** The eBL token exists in the registry. */
  minted: boolean;
  holder?: string;
  beneficiary?: string;
}

export type Step =
  | { kind: 'wait'; reason: string }
  | { kind: 'refresh_derived_address' }
  | { kind: 'accept_deal' }
  | { kind: 'fund' }
  | { kind: 'mint_ebl' }
  | { kind: 'hand_over' }
  | { kind: 'confirm_title_held' }
  | { kind: 'accept_documents' }
  | { kind: 'refuse_documents' }
  | { kind: 'confirm_delivery' }
  | { kind: 'resume_cash' }
  | { kind: 'request_signature' }
  | { kind: 'broadcast' }
  | { kind: 'dispute'; by: Party }
  | { kind: 'vote'; by: Party; decision: 'Release' | 'Refund' }
  | { kind: 'confirm_title_transferred'; by: Party }
  | { kind: 'done' }
  | { kind: 'stuck'; reason: string };

const eq = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

export function nextStep(deal: DealView, flow: Flow, sepolia: SepoliaFacts | null): Step {
  const ebl = deal.ebl;
  switch (deal.state) {
    case 'Cancelled':
      return { kind: 'stuck', reason: 'deal was cancelled' };
    case 'Disputed': {
      if (flow !== 'dispute') return { kind: 'stuck', reason: 'deal is disputed; parties must vote (use the dispute flow)' };
      // Scripted disagreement: buyer Refund, supplier Release, then the arbiter breaks the tie with Release.
      if (deal.votes.buyer !== 'Refund') return { kind: 'vote', by: 'buyer', decision: 'Refund' };
      if (deal.votes.supplier !== 'Release') return { kind: 'vote', by: 'supplier', decision: 'Release' };
      if (deal.votes.arbiter !== 'Release') return { kind: 'vote', by: 'arbiter', decision: 'Release' };
      return { kind: 'wait', reason: 'threshold reached; settlement starting' };
    }
    case 'Settled':
    case 'Refunded':
      return { kind: 'done' };
    case 'Created':
      if (ebl && !ebl.derived_address) return { kind: 'refresh_derived_address' };
      if (!deal.accepted) return { kind: 'accept_deal' };
      return { kind: 'fund' };
    case 'Funded': {
      if (!ebl) return { kind: 'confirm_delivery' };
      if (!sepolia) return { kind: 'stuck', reason: 'Sepolia state not read' };
      if (!sepolia.minted) return { kind: 'mint_ebl' };
      if (eq(sepolia.holder, ebl.derived_address) && eq(sepolia.beneficiary, ebl.derived_address)) return { kind: 'confirm_title_held' };
      if (eq(sepolia.holder, ebl.supplier_evm) && eq(sepolia.beneficiary, ebl.supplier_evm)) return { kind: 'hand_over' };
      return { kind: 'stuck', reason: `title is with ${sepolia.holder}/${sepolia.beneficiary}, neither supplier nor deal address` };
    }
    case 'TitleHeld':
      if (flow === 'refund') return { kind: 'refuse_documents' };
      if (flow === 'dispute') return deal.disputed ? { kind: 'wait', reason: 'dispute recorded' } : { kind: 'dispute', by: 'buyer' };
      return { kind: 'accept_documents' };
    case 'Settling':
    case 'Refunding': {
      if (deal.cash_leg === 'Pending') return { kind: 'resume_cash' };
      const tl = deal.title_leg.status;
      if (tl === 'NotApplicable' || tl === 'Done') {
        return deal.cash_leg === 'TransferRequested' ? { kind: 'wait', reason: 'cash transfer callback in flight' } : { kind: 'wait', reason: 'finalizing' };
      }
      if (tl === 'Pending') return { kind: 'request_signature' };
      if (tl === 'SignatureRequested') return { kind: 'wait', reason: 'MPC signature in flight' };
      // Signed | Broadcast
      if (!ebl || !sepolia) return { kind: 'stuck', reason: 'Sepolia state not read' };
      const dest = deal.state === 'Settling' ? ebl.buyer_evm : ebl.supplier_evm;
      if (eq(sepolia.holder, dest) && eq(sepolia.beneficiary, dest)) {
        if (flow === 'dispute' && deal.state === 'Settling') {
          // The buyer (who disputed) does not confirm receipt: the other two confirm together (D-019).
          return { kind: 'confirm_title_transferred', by: deal.pending_confirmers.includes('Supplier') ? 'arbiter' : 'supplier' };
        }
        return { kind: 'confirm_title_transferred', by: deal.state === 'Settling' ? 'buyer' : 'supplier' };
      }
      return { kind: 'broadcast' };
    }
  }
}
