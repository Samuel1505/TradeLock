'use client';
import Link from 'next/link';
import { useQueries } from '@tanstack/react-query';
import { config } from '@/lib/config';
import { stateLabel } from '@/lib/labels';
import { getDeal } from '@/lib/near';

const T1 = [
  ['Mint eBL (TitleEscrow created by TradeTrust’s official factory)', 'https://sepolia.etherscan.io/tx/0x4be2fc58d490f8fd9e01616c6c3bbffd1c9afdf645d75e80e5663afbb63acc94'],
  ['Supplier hands the eBL to the MPC-derived address', 'https://sepolia.etherscan.io/tx/0x8e5f9579061fa63c011d4fceb899c8f78f6d0cd3c316d6ace4c08d61f2037bba'],
  ['NEAR contract requests the MPC signature (ecrecover-checked)', 'https://testnet.nearblocks.io/txns/HJyWxZri6st1SkKoJiJmFFM4qFQeHbfZG4uWu5KeGmWN'],
  ['MPC-signed title transfer accepted by Sepolia', 'https://sepolia.etherscan.io/tx/0x0430ac7a831670fbd34cbea42b1759552977cbb1ad43ef7ab5ccf782fc84cd5d'],
] as const;

export default function Demo() {
  const deals = useQueries({ queries: config.demoDeals.map((id) => ({ queryKey: ['deal', id], queryFn: () => getDeal(id) })) });
  return (
    <section>
      <h1>Demo</h1>
      <h2>Title-leg proof (T1)</h2>
      <ol className="steps">
        {T1.map(([label, href]) => (
          <li key={href}><a href={href}>{label} ↗</a></li>
        ))}
      </ol>
      <h2>Recorded deals</h2>
      {config.demoDeals.length === 0 ? (
        <p className="muted">No recorded demo run yet. It is added here after the run (docs/DEPLOYMENTS.md).</p>
      ) : (
        <ul className="deal-list">
          {deals.map((q, i) => (
            <li key={config.demoDeals[i]} className="sheet">
              <Link href={`/deals/${config.demoDeals[i]}`}>Deal {config.demoDeals[i]}</Link> · {q.data ? stateLabel(q.data) : q.isLoading ? 'loading…' : 'not found'}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
