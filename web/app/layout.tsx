import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Ayxa Shared Space',
  description: 'Public shared files for Ayxa',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
