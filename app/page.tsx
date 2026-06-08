'use client';
import { useState } from 'react';
import Sidebar from '@/components/Sidebar';
import PortalView from '@/components/portal/PortalView';

export const PORTALS = [
  { id: 'current_clients',    label: 'Current Clients',  icon: '🏢', mapType: 'world' },
  { id: 'prospects',          label: 'Prospects',        icon: '🔭', mapType: 'world' },
  { id: 'private_companies',  label: 'Private Companies',icon: '🏗️', mapType: 'usa' },
  { id: 'federal_agencies',   label: 'Federal Agencies', icon: '🦅', mapType: 'usa' },
  { id: 'state_agencies',     label: 'State Agencies',   icon: '🏛️', mapType: 'usa' },
  { id: 'counties_and_cities',label: 'Counties & Cities',icon: '🏙️', mapType: 'usa' },
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
