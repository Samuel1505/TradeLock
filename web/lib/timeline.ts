import type { DealView } from './types';

export interface TimelineStep {
  label: string;
  status: 'done' | 'current' | 'todo';
  tone?: 'returned';
}

/** Steps for the path this deal is actually on (settle, refund, dispute, cancel). Pure; tested. */
export function timeline(d: DealView): TimelineStep[] {
  const ebl = d.mode === 'ebl';
  const titleWasHeld = ebl && (d.title_leg.status !== 'NotApplicable' || d.confirmations.some((c) => c.fact === 'TitleHeld' && c.accepted));
  const mk = (labels: string[], currentIdx: number, tone?: 'returned'): TimelineStep[] =>
    labels.map((label, i) => ({ label, status: i < currentIdx ? 'done' : i === currentIdx ? 'current' : 'todo', ...(tone && i >= currentIdx ? { tone } : {}) }));

  switch (d.state) {
    case 'Cancelled':
      return mk(['Created', 'Cancelled'], 1, 'returned');
    case 'Refunding':
    case 'Refunded': {
      const head = ['Created', 'Funded', ...(titleWasHeld ? ['Title held'] : [])];
      const labels = [...head, d.state === 'Refunding' ? 'Returning' : 'Returned'];
      return mk(labels, labels.length - 1, 'returned');
    }
    case 'Disputed': {
      const labels = ['Created', 'Funded', ...(d.disputed && titleWasHeld ? ['Title held'] : []), 'In dispute'];
      return mk(labels, labels.length - 1, 'returned');
    }
    default: {
      const labels = ebl ? ['Created', 'Funded', 'Title held', 'Documents accepted', 'Settled'] : ['Created', 'Funded', 'Delivered', 'Settled'];
      const idx: Record<string, number> = ebl
        ? { Created: 0, Funded: 1, TitleHeld: 2, Settling: 3, Settled: 4 }
        : { Created: 0, Funded: 1, Settling: 2, Settled: 3 };
      return mk(labels, idx[d.state] ?? 0);
    }
  }
}
