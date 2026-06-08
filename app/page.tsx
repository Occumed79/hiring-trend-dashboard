'use client';
import { useState } from 'react';
import Sidebar from '@/components/Sidebar';
import PortalView from '@/components/portal/PortalView';
import { PORTALS } from '@/lib/portals';

export default function Home() {
  const [activePortal, setActivePortal] = useState(PORTALS[0]);

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar portals={[...PORTALS]} activePortal={activePortal} onSelect={setActivePortal} />
      <main className="flex-1 overflow-y-auto scrollbar-glass">
        <PortalView portal={activePortal} />
      </main>
    </div>
  );
}
