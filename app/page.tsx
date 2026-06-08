'use client';
import { useState } from 'react';
import Sidebar from '@/components/Sidebar';
import PortalView from '@/components/portal/PortalView';

const PORTALS = [
  { id: 'current_clients', label: 'Current Clients', icon: '🏢' },
  { id: 'prospects', label: 'Prospects', icon: '🔭' },
  { id: 'private_companies', label: 'Private Companies', icon: '🏗️' },
  { id: 'federal_agencies', label: 'Federal Agencies', icon: '🦅' },
  { id: 'state_agencies', label: 'State Agencies', icon: '🏛️' },
  { id: 'city_municipal_agencies', label: 'City & Municipal', icon: '🏙️' },
];

export default function Home() {
  const [activePortal, setActivePortal] = useState(PORTALS[0]);

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar portals={PORTALS} activePortal={activePortal} onSelect={setActivePortal} />
      <main className="flex-1 overflow-y-auto scrollbar-glass">
        <PortalView portal={activePortal} />
      </main>
    </div>
  );
}
