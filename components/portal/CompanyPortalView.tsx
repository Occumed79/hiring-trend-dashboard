'use client';
import { useEffect, useState } from 'react';
import type { Portal } from '@/lib/portals';
import PortalLanding from './PortalLanding';
import UniversalCompanyDetail from './UniversalCompanyDetail';

export default function CompanyPortalView({ portal }: { portal: Portal }) {
  const [entities, setEntities] = useState<any[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setSelected(null);
    setLoading(true);
    fetch(`/api/entities?portal=${portal.id}`)
      .then(r => r.json())
      .then(data => {
        setEntities(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [portal.id]);

  function removed(id: string) {
    setEntities(prev => prev.filter(e => e.id !== id));
    setSelected(null);
  }

  if (selected) {
    return <UniversalCompanyDetail entity={selected} portal={portal} onBack={() => setSelected(null)} onRemoved={removed} />;
  }

  return <PortalLanding portal={portal} entities={entities} loading={loading} onSelectEntity={setSelected} onAddEntity={() => {}} />;
}
