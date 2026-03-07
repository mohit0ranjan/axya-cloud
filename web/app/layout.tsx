import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Axya Shared Space',
  description: 'Public shared files for Axya',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
