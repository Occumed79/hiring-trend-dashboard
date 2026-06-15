'use client';
import { useEffect, useState } from 'react';
import type { Portal } from '@/lib/portals';
import CompanyLanding from './CompanyLanding';
import UniversalAddEntityModal from './UniversalAddEntityModal';
import UniversalCompanyDetail from './UniversalCompanyDetail';

export default function CompanyPortalView({ portal }: { portal: Portal }) {
  const [entities, setEntities] = useState<any[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);

  async function load() {
    setLoading(true);
    const res = await fetch(`/api/entities?portal=${portal.id}`);
    const data = await res.json();
    setEntities(Array.isArray(data) ? data : []);
    setLoading(false);
  }

  useEffect(() => {
    setSelected(null);
    load().catch(() => setLoading(false));
  }, [portal.id]);

  function added(entity: any) {
    setShowAdd(false);
    setSelected(entity);
    load().catch(() => {});
  }

  function removed(id: string) {
    setEntities(prev => prev.filter(e => e.id !== id));
    setSelected(null);
    load().catch(() => {});
  }

  return (
    <>
      {selected ? (
        <UniversalCompanyDetail entity={selected} portal={portal} onBack={() => setSelected(null)} onRemoved={removed} />
      ) : (
        <CompanyLanding portal={portal} entities={entities} loading={loading} onSelectEntity={setSelected} onAddEntity={() => setShowAdd(true)} />
      )}
      {showAdd && <UniversalAddEntityModal portal={portal} onClose={() => setShowAdd(false)} onAdded={added} />}
    </>
  );
}
