import type { Metadata } from 'next';
import { Plus_Jakarta_Sans, DM_Sans, JetBrains_Mono } from 'next/font/google';
import './globals.css';

const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['500', '600', '700', '800'],
  variable: '--font-jakarta',
  display: 'swap',
});

const dmSans = DM_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-dm-sans',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-jetbrains',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Framely — Zero-Knowledge Telegram Photo Vault',
  description:
    'Private, client-only Google Photos desktop clone backed by your own Telegram Channel over direct MTProto WebSockets with AES-256-GCM encryption.',
  openGraph: {
    title: 'Framely — Zero-Knowledge Telegram Photo Vault',
    description:
      'Unlimited original-quality photo storage in your own private Telegram Channel. Direct MTProto WSS, zero relay servers, optional AES-256-GCM encryption.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Framely — Zero-Knowledge Telegram Photo Vault',
    description:
      'Your private photos, in your own Telegram. Bit-for-bit original quality with zero middleman servers.',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${jakarta.variable} ${dmSans.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      <body
        suppressHydrationWarning
        className="min-h-screen antialiased selection:bg-[#d3e3fd] selection:text-[#0b57d0] dark:selection:bg-[#004a77] dark:selection:text-[#c2e7ff]"
      >
        {children}
      </body>
    </html>
  );
}
