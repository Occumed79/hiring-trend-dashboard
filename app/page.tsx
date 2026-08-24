'use client';
import { useState } from 'react';
import Sidebar from '@/components/Sidebar';
import CompanyPortalView from '@/components/portal/CompanyPortalView';
import SourceHealthView from '@/components/SourceHealthView';
import GlobalJobSearch from '@/components/GlobalJobSearch';
import { PORTALS, type Portal } from '@/lib/portals';

export default function Home() {
  const [activePortal, setActivePortal] = useState<Portal>(PORTALS[0]);
  const [workspace, setWorkspace] = useState<'portal' | 'search' | 'source_health'>('portal');
  const [focusEntityId, setFocusEntityId] = useState<string | null>(null);

  function selectPortal(portal: Portal) {
    setFocusEntityId(null);
    setActivePortal(portal);
    setWorkspace('portal');
  }

  function openEntityFromSearch(entity: any) {
    const portal = PORTALS.find(item => item.id === entity?.portal) || activePortal;
    setActivePortal(portal);
    setFocusEntityId(String(entity?.id || ''));
    setWorkspace('portal');
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        portals={[...PORTALS]}
        activePortal={activePortal}
        onSelect={selectPortal}
        searchActive={workspace === 'search'}
        onOpenSearch={() => { setFocusEntityId(null); setWorkspace('search'); }}
        sourceHealthActive={workspace === 'source_health'}
        onOpenSourceHealth={() => { setFocusEntityId(null); setWorkspace('source_health'); }}
      />
      <main className="relative z-0 flex-1 overflow-y-auto scrollbar-glass">
        {workspace === 'search'
          ? <GlobalJobSearch onOpenEntity={openEntityFromSearch} />
          : workspace === 'source_health'
            ? <SourceHealthView />
            : <CompanyPortalView portal={activePortal} focusEntityId={focusEntityId} onFocusHandled={() => setFocusEntityId(null)} />}
      </main>
    </div>
  );
}
