import './globals.css';

import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'SAIF: Safe AI Factory',
  description: 'Zero-trust orchestrator for containerized AI swarms.',
  icons: {
    icon: '/saif-icon-green.svg',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-[#0F0F0F] text-white font-sans selection:bg-[#00FF66] selection:text-black`}
      >
        {children}
      </body>
    </html>
  );
}
