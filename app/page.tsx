'use client';
import { useState } from 'react';
import Sidebar from '@/components/Sidebar';
import CompanyPortalView from '@/components/portal/CompanyPortalView';
import SourceHealthView from '@/components/SourceHealthView';
import { PORTALS, type Portal } from '@/lib/portals';

export default function Home() {
  const [activePortal, setActivePortal] = useState<Portal>(PORTALS[0]);
  const [workspace, setWorkspace] = useState<'portal' | 'source_health'>('portal');

  function selectPortal(portal: Portal) {
    setActivePortal(portal);
    setWorkspace('portal');
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        portals={[...PORTALS]}
        activePortal={activePortal}
        onSelect={selectPortal}
        sourceHealthActive={workspace === 'source_health'}
        onOpenSourceHealth={() => setWorkspace('source_health')}
      />
      <main className="relative z-0 flex-1 overflow-y-auto scrollbar-glass">
        {workspace === 'source_health' ? <SourceHealthView /> : <CompanyPortalView portal={activePortal} />}
      </main>
    </div>
  );
}
