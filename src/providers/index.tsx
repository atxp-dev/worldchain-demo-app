'use client';
import { MiniKitProvider } from '@worldcoin/minikit-js/minikit-provider';
import { Session } from 'next-auth';
import { SessionProvider } from 'next-auth/react';
import dynamic from 'next/dynamic';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { wagmiConfig } from "@/lib/wagmi";
import { useState, useEffect } from "react";
import { Buffer } from 'buffer';

// Install Buffer globally and add base64url support
if (typeof window !== 'undefined') {
  (window as any).global = window;
  (globalThis as any).Buffer = Buffer;

  console.log('Installing base64url polyfill...');

  const originalFrom = Buffer.from;
  const originalToString = Buffer.prototype.toString;

  // Override Buffer.from to handle base64url
  Buffer.from = function(this: any, value: any, encoding?: any) {
    console.log('Buffer.from called with encoding:', encoding);
    if (encoding === 'base64url' && typeof value === 'string') {
      console.log('Converting base64url to base64:', value);
      // Convert base64url to base64
      let base64 = value.replace(/-/g, '+').replace(/_/g, '/');
      // Add padding
      while (base64.length % 4) {
        base64 += '=';
      }
      console.log('Converted to base64:', base64);
      return originalFrom(base64, 'base64');
    }
    return originalFrom(value, encoding);
  } as any;

  // Override Buffer.prototype.toString to handle base64url
  Buffer.prototype.toString = function(encoding?: any, start?: number, end?: number) {
    console.log('Buffer.toString called with encoding:', encoding);
    if (encoding === 'base64url') {
      const base64 = originalToString.call(this, 'base64', start, end);
      const result = base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      console.log('Converted base64 to base64url:', base64, '->', result);
      return result;
    }
    return originalToString.call(this, encoding, start, end);
  };

  console.log('✅ Base64url polyfill installed for Buffer');
}

const ErudaProvider = dynamic(
  () => import('@/providers/Eruda').then((c) => c.ErudaProvider),
  { ssr: false },
);

// Define props for ClientProviders
interface ClientProvidersProps {
  children: ReactNode;
  session: Session | null; // Use the appropriate type for session from next-auth
}

/**
 * ClientProvider wraps the app with essential context providers.
 *
 * - ErudaProvider:
 *     - Should be used only in development.
 *     - Enables an in-browser console for logging and debugging.
 *
 * - MiniKitProvider:
 *     - Required for MiniKit functionality.
 *
 * - WagmiProvider:
 *     - Required for wagmi/web3 functionality.
 *
 * This component ensures both providers are available to all child components.
 */
export default function ClientProviders({
  children,
  session,
}: ClientProvidersProps) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60 * 1000,
      },
    },
  }));

  return (
    <ErudaProvider>
      <MiniKitProvider>
        <WagmiProvider config={wagmiConfig}>
          <QueryClientProvider client={queryClient}>
            <SessionProvider session={session}>{children}</SessionProvider>
          </QueryClientProvider>
        </WagmiProvider>
      </MiniKitProvider>
    </ErudaProvider>
  );
}
