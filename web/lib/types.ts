/** Mirrors tradelock's DealView JSON (contracts/tradelock/src/types.rs). */
export type DealState = 'Created' | 'Funded' | 'TitleHeld' | 'Settling' | 'Settled' | 'Disputed' | 'Refunding' | 'Refunded' | 'Cancelled';
export type Party = 'Buyer' | 'Supplier' | 'Arbiter';
export type Decision = 'Release' | 'Refund';

export interface TxView {
  chain_id: number;
  nonce: string;
  to: string;
  data: string;
  payload: string;
}

export interface TitleLegView {
  status: 'NotApplicable' | 'Pending' | 'SignatureRequested' | 'Signed' | 'Broadcast' | 'Done';
  tx?: TxView;
  tx_hash?: string;
}

export interface Evidence {
  holder: string;
  beneficiary: string;
  block_number: string;
  tx_hash: string | null;
}

export interface ConfirmationRecord {
  fact: 'TitleHeld' | 'TitleTransferred' | 'TitleAtDealAddress';
  party: Party;
  evidence: Evidence;
  at: string;
  accepted: boolean;
}

export interface DealView {
  id: string;
  buyer: string;
  supplier: string;
  arbiter: string;
  token_id: string;
  amount: string;
  order_hash: string;
  payout: { Internal: { account: string } } | { Withdraw: { account: string } };
  mode: 'ebl' | 'escrow_only';
  ebl: null | {
    chain_id: number;
    factory: string;
    registry: string;
    token_id: string;
    title_escrow: string;
    buyer_evm: string;
    supplier_evm: string;
    ship_by: string;
    doc_acceptance_window_ns: string;
    derived_address: string | null;
    derivation_path: string;
    accept_by: string | null;
  };
  deliver_by: string | null;
  state: DealState;
  accepted: boolean;
  created_at: string;
  cash_leg: 'Pending' | 'TransferRequested' | 'Done';
  title_leg: TitleLegView;
  disputed: boolean;
  votes: { buyer: Decision | null; supplier: Decision | null; arbiter: Decision | null };
  open_fact: ConfirmationRecord['fact'] | null;
  pending_confirmers: Party[];
  confirmations: ConfirmationRecord[];
  redelivery: null | { leg: TitleLegView; requested: boolean; round: number };
}

/** Live Sepolia read of the deal's TitleEscrow. */
export interface TitleFacts {
  minted: boolean;
  titleEscrow?: string;
  holder?: string;
  beneficiary?: string;
  block?: string;
}

export const TERMINAL: DealState[] = ['Settled', 'Refunded', 'Cancelled'];
