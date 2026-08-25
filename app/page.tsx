'use client';
import { useState } from 'react';
import Sidebar from '@/components/Sidebar';
import CompanyPortalView from '@/components/portal/CompanyPortalView';
import SourceHealthView from '@/components/SourceHealthView';
import SourcesIntegrationsView from '@/components/SourcesIntegrationsView';
import GlobalJobSearch from '@/components/GlobalJobSearch';
import { PORTALS, type Portal } from '@/lib/portals';

type Workspace = 'portal' | 'search' | 'sources' | 'source_health';

export default function Home() {
  const [activePortal, setActivePortal] = useState<Portal>(PORTALS[0]);
  const [workspace, setWorkspace] = useState<Workspace>('portal');
  const [focusEntityId, setFocusEntityId] = useState<string | null>(null);
  const [activeEntity, setActiveEntity] = useState<any | null>(null);

  function selectPortal(portal: Portal) {
    setFocusEntityId(null);
    setActiveEntity(null);
    setActivePortal(portal);
    setWorkspace('portal');
  }

  function openEntityFromSearch(entity: any) {
    const portal = PORTALS.find(item => item.id === entity?.portal) || activePortal;
    setActivePortal(portal);
    setActiveEntity(entity || null);
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
        sourcesActive={workspace === 'sources'}
        onOpenSources={() => setWorkspace('sources')}
        sourceHealthActive={workspace === 'source_health'}
        onOpenSourceHealth={() => { setFocusEntityId(null); setWorkspace('source_health'); }}
      />
      <main className="relative z-0 flex-1 overflow-y-auto scrollbar-glass">
        {workspace === 'search'
          ? <GlobalJobSearch onOpenEntity={openEntityFromSearch} />
          : workspace === 'sources'
            ? <SourcesIntegrationsView entity={activeEntity} />
            : workspace === 'source_health'
              ? <SourceHealthView />
              : <CompanyPortalView
                  portal={activePortal}
                  focusEntityId={focusEntityId}
                  onFocusHandled={() => setFocusEntityId(null)}
                  onEntityChange={setActiveEntity}
                />}
      </main>
    </div>
  );
}
