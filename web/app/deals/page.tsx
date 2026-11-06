'use client';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useWallet } from '@/components/wallet';
import { config } from '@/lib/config';
import { formatAmount } from '@/lib/format';
import { stateLabel } from '@/lib/labels';
import { getDealsByAccount } from '@/lib/near';

export default function MyDeals() {
  const w = useWallet();
  const q = useQuery({ queryKey: ['mine', w.accountId], queryFn: () => getDealsByAccount(w.accountId!), enabled: !!w.accountId, refetchInterval: 10_000 });
  if (!w.accountId) return <p className="muted">Connect your NEAR wallet to see deals where you are buyer, supplier or arbiter.</p>;
  if (q.isLoading) return <p className="muted">Loading…</p>;
  if (q.error) return <p className="error">{String(q.error)}</p>;
  const deals = q.data ?? [];
  if (!deals.length) return <p>No deals yet. <Link href="/deals/new">Start a deal with a supplier.</Link></p>;
  return (
    <section>
      <h1>My deals</h1>
      <ul className="deal-list">
        {deals.map((d) => (
          <li key={d.id} className="sheet">
            <Link href={`/deals/${d.id}`}>Deal {d.id}</Link> · {formatAmount(d.amount, config.tokenDecimals)} {config.tokenSymbol} · {stateLabel(d)}
          </li>
        ))}
      </ul>
    </section>
  );
}
