'use client';
import { useEffect, useState } from 'react';
import type { Portal } from '@/lib/portals';
import CompanyLanding from './CompanyLanding';
import UniversalAddEntityModal from './UniversalAddEntityModal';
import UniversalCompanyDetail from './UniversalCompanyDetail';

export default function CompanyPortalView({ portal, focusEntityId, onFocusHandled, onEntityChange }: {
  portal: Portal;
  focusEntityId?: string | null;
  onFocusHandled?: () => void;
  onEntityChange?: (entity: any | null) => void;
}) {
  const [entities, setEntities] = useState<any[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showAdd, setShowAdd] = useState(false);

  async function load(signal?: AbortSignal) {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/entities?portal=${encodeURIComponent(portal.id)}`, { signal, cache: 'no-store' });
      const data = await res.json().catch(() => []);
      if (!res.ok) throw new Error(data?.error || `Could not load tracked ${portal.label.toLowerCase()}.`);
      setEntities(Array.isArray(data) ? data : []);
    } catch (err) {
      if ((err as any)?.name === 'AbortError') return;
      setEntities([]);
      setError(err instanceof Error ? err.message : `Could not load tracked ${portal.label.toLowerCase()}.`);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    setSelected(null);
    onEntityChange?.(null);
    load(controller.signal);
    return () => controller.abort();
  }, [portal.id]);

  useEffect(() => {
    if (!focusEntityId || !entities.length) return;
    const match = entities.find(entity => String(entity.id) === String(focusEntityId));
    if (!match) return;
    setSelected(match);
    onEntityChange?.(match);
    onFocusHandled?.();
  }, [focusEntityId, entities, onFocusHandled, onEntityChange]);

  function selectEntity(entity: any) {
    setSelected(entity);
    onEntityChange?.(entity);
  }

  function added(entity: any) {
    setShowAdd(false);
    selectEntity(entity);
    load().catch(() => {});
  }

  function removed(id: string) {
    setEntities(prev => prev.filter(e => e.id !== id));
    setSelected(null);
    onEntityChange?.(null);
    load().catch(() => {});
  }

  function back() {
    setSelected(null);
    onEntityChange?.(null);
  }

  return (
    <>
      {selected ? (
        <UniversalCompanyDetail entity={selected} portal={portal} onBack={back} onRemoved={removed} />
      ) : (
        <CompanyLanding portal={portal} entities={entities} loading={loading} error={error} onSelectEntity={selectEntity} onAddEntity={() => setShowAdd(true)} />
      )}
      {showAdd && <UniversalAddEntityModal portal={portal} onClose={() => setShowAdd(false)} onAdded={added} />}
    </>
  );
}
