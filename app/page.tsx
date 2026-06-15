'use client';
import { useState } from 'react';
import Sidebar from '@/components/Sidebar';
import CompanyPortalView from '@/components/portal/CompanyPortalView';
import { PORTALS, type Portal } from '@/lib/portals';

export default function Home() {
  const [activePortal, setActivePortal] = useState<Portal>(PORTALS[0]);

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar portals={[...PORTALS]} activePortal={activePortal} onSelect={setActivePortal} />
      <main className="flex-1 overflow-y-auto scrollbar-glass">
        <CompanyPortalView portal={activePortal} />
      </main>
    </div>
  );
}
