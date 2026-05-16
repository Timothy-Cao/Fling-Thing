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
      <body className="h-full overflow-hidden">{children}</body>
    </html>
  );
}
