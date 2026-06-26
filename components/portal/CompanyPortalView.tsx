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
  const [error, setError] = useState('');
  const [showAdd, setShowAdd] = useState(false);

  async function load(signal?: AbortSignal) {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/entities?portal=${encodeURIComponent(portal.id)}`, { signal });
      const data = await res.json().catch(() => []);
      if (!res.ok) throw new Error(data?.error || 'Could not load tracked companies.');
      setEntities(Array.isArray(data) ? data : []);
    } catch (err) {
      if ((err as any)?.name === 'AbortError') return;
      setEntities([]);
      setError(err instanceof Error ? err.message : 'Could not load tracked companies.');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    setSelected(null);
    load(controller.signal);
    return () => controller.abort();
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
        <CompanyLanding portal={portal} entities={entities} loading={loading} error={error} onSelectEntity={setSelected} onAddEntity={() => setShowAdd(true)} />
      )}
      {showAdd && <UniversalAddEntityModal portal={portal} onClose={() => setShowAdd(false)} onAdded={added} />}
    </>
  );
}
