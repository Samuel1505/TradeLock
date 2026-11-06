import type { Metadata } from 'next';
import { IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Providers } from '@/components/providers';
import { WalletButton } from '@/components/wallet';
import './globals.css';

const sans = IBM_Plex_Sans({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-sans' });
const mono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-mono' });

export const metadata: Metadata = {
  title: 'Tradelock',
  description: 'The buyer only gets the goods when the seller gets paid — and no bank is needed. NEAR testnet + Sepolia.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>
        <Providers>
          <header className="site">
            <Link href="/" className="brand">Tradelock</Link>
            <nav>
              <Link href="/deals">My deals</Link>
              <Link href="/deals/new">Start a deal</Link>
              <Link href="/demo">Demo</Link>
            </nav>
            <WalletButton />
          </header>
          <main>{children}</main>
          <footer className="site muted small">NEAR testnet + Sepolia. Test token with no value. No mainnet deployment.</footer>
        </Providers>
      </body>
    </html>
  );
}
