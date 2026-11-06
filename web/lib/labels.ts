import { formatTime } from './format';
import type { DealView, TitleLegView } from './types';

/** FRONTEND.md §6 copy (D-020 documents-against-payment). */
export function stateLabel(d: DealView): string {
  const ebl = d.mode === 'ebl';
  switch (d.state) {
    case 'Created':
      return d.accepted ? 'Waiting for buyer to fund' : 'Waiting for supplier to accept';
    case 'Funded':
      return ebl ? 'Funded — waiting for the bill of lading' : 'Funded — waiting for delivery';
    case 'TitleHeld':
      return d.ebl?.accept_by ? `Documents ready — accept by ${formatTime(d.ebl.accept_by)} to pay and receive the bill of lading` : 'Documents ready';
    case 'Settling':
      return 'Releasing payment and title';
    case 'Settled':
      return ebl ? 'Released: supplier paid, buyer owns the goods' : 'Released: supplier paid';
    case 'Disputed':
      return 'In dispute — 2 of 3 votes decide';
    case 'Refunding':
      return 'Returning payment and bill of lading';
    case 'Refunded':
      return ebl ? 'Returned: buyer refunded, supplier holds the bill of lading' : 'Returned: buyer refunded';
    case 'Cancelled':
      return 'Cancelled before funding';
  }
}

export function cashLabel(d: DealView): string {
  const toBuyer = d.state === 'Refunding' || d.state === 'Refunded';
  if (d.state === 'Created') return 'Not funded yet';
  if (['Funded', 'TitleHeld', 'Disputed'].includes(d.state)) return 'Held by the deal';
  if (d.cash_leg === 'Done') return toBuyer ? 'Returned to buyer' : 'Paid to supplier';
  if (d.cash_leg === 'TransferRequested') return toBuyer ? 'Returning to buyer…' : 'Paying supplier…';
  return toBuyer ? 'Refund pending (anyone can resume)' : 'Payout pending (anyone can resume)';
}

export function titleLegLabel(leg: TitleLegView, toBuyer: boolean): string {
  const who = toBuyer ? 'buyer' : 'supplier';
  switch (leg.status) {
    case 'NotApplicable':
      return 'No title transfer';
    case 'Pending':
      return `Ready to transfer to ${who}`;
    case 'SignatureRequested':
      return 'NEAR MPC signing the transfer…';
    case 'Signed':
      return `Transfer to ${who} signed by NEAR MPC — waiting for broadcast`;
    case 'Broadcast':
      return `Transfer to ${who} broadcast on Sepolia`;
    case 'Done':
      return `Transferred to ${who} ✓`;
  }
}

/** Contract error code → what happened and what to do (FRONTEND §6). */
export function explainError(message: string): string {
  const m = message;
  if (m.includes('AmountMismatch')) return "The amount sent doesn't match the deal. It was returned to you.";
  if (m.includes('DeadlinePassed')) return 'The deadline for this step has passed.';
  if (m.includes('DeadlineNotReached')) return 'Too early: the deadline for this step has not passed yet.';
  if (m.includes('Unauthorized')) return "Your account can't take this action on this deal. Switch to the right party's account.";
  if (m.includes('EvidenceMismatch')) return 'Sepolia does not show the title where this step expects it. Check the TitleEscrow and try again.';
  if (m.includes('InsufficientGas')) return 'Not enough gas attached. Try again.';
  if (m.includes('InvalidState')) return 'The deal moved on since this page loaded. It has been refreshed.';
  return m;
}
