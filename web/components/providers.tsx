'use client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { WalletProvider } from './wallet';

export function Providers({ children }: { children: ReactNode }) {
  const [qc] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: 2, refetchOnWindowFocus: false } } }));
  return (
    <QueryClientProvider client={qc}>
      <WalletProvider>{children}</WalletProvider>
    </QueryClientProvider>
  );
}
