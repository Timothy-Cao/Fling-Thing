import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Ball Launch',
  description: 'Build a contraption and launch the ball as far as possible!',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full">
      <body className="h-full overflow-hidden">
        {children}
        <nav
          aria-label="Legal links"
          className="fixed bottom-2 right-3 z-[1000] flex gap-2 rounded bg-black/35 px-2 py-1 text-[11px] text-white/60 backdrop-blur-sm"
        >
          <a className="hover:text-white" href="/privacy">Privacy</a>
          <a className="hover:text-white" href="mailto:timcao.support@gmail.com">Contact</a>
        </nav>
      </body>
    </html>
  );
}
