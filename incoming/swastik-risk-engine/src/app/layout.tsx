import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Cognitia | EVM Risk & Signature Analyzer',
  description: 'Deterministic EVM calldata & signature risk engine with isolated simulation',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
