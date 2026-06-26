import type { Metadata } from 'next';
import 'leaflet/dist/leaflet.css';
import './globals.css';
import './luminous.css';

export const metadata: Metadata = {
  title: 'Hiring Trend Dashboard',
  description: 'Real-time hiring intelligence across companies and agencies',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-[#04070f] text-slate-100 overflow-x-hidden">
        <div className="orb orb-1" />
        <div className="orb orb-2" />
        <div className="orb orb-3" />
        <div className="orb orb-4" />
        <div className="relative z-10 min-h-screen">
          {children}
        </div>
      </body>
    </html>
  );
}
