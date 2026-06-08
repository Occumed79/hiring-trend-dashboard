'use client';
import type { Portal } from '@/lib/portals';
import { useState } from 'react';

const ATS_PROVIDERS = ['unknown','greenhouse','lever','workday','icims','taleo','smartrecruiters','bamboohr','jobvite','usajobs','other'];

export default function AddEntityModal({ portal, onClose, onAdded }: {
  portal: Portal;
  onClose: () => void;
  onAdded: (entity: any) => void;
}) {
  const [form, setForm] = useState({
    name: '',
    aliases: '',
    career_page_url: '',
    ats_provider: 'unknown',
    ats_board_id: '',
    industry: '',
    category: '',
    // county/city extras (stored in category field)
    geo_state: '',
    geo_county: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const isCountyCity = portal.id === 'counties_and_cities';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) { setError('Name is required'); return; }
    setLoading(true);
    setError('');

    // Build category string for county/city entities
    let category = form.category;
    if (isCountyCity) {
      const parts = [form.geo_county && `County: ${form.geo_county}`, form.geo_state && `State: ${form.geo_state}`].filter(Boolean);
      if (parts.length) category = parts.join(' | ');
    }

    try {
      const res = await fetch('/api/entities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          aliases: form.aliases ? form.aliases.split(',').map(s => s.trim()).filter(Boolean) : [],
          portal: portal.id,
          career_page_url: form.career_page_url || null,
          ats_provider: form.ats_provider,
          ats_board_id: form.ats_board_id || null,
          industry: form.industry || null,
          category: category || null,
        }),
      });
      if (!res.ok) throw new Error('Failed');
      const entity = await res.json();
      onAdded(entity);
    } catch {
      setError('Failed to create entity. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const f = (label: string, key: keyof typeof form, placeholder?: string, type = 'text') => (
    <div>
      <label className="block text-xs text-slate-400 mb-1">{label}</label>
      <input
        type={type}
        value={form[key]}
        onChange={e => setForm({ ...form, [key]: e.target.value })}
        placeholder={placeholder}
        className="w-full bg-white/5 border border-white/15 rounded-xl px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-blue-500/50"
      />
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative glass-card w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto scrollbar-glass">
        <h2 className="text-lg font-semibold text-slate-100 mb-1">
          Add to {portal.label}
        </h2>
        <p className="text-xs text-slate-500 mb-5">
          Hiring data ingestion starts automatically after adding.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          {f('Entity Name *', 'name', isCountyCity ? 'e.g. Cook County, City of Austin' : 'e.g. Acme Security Group')}
          {f('Known Aliases', 'aliases', 'Comma separated, e.g. Acme, ASG')}
          {f('Career / Hiring Website URL', 'career_page_url', 'https://careers.example.gov', 'url')}

          {/* County/City extras */}
          {isCountyCity && (
            <div className="grid grid-cols-2 gap-3">
              {f('County Name', 'geo_county', 'e.g. Cook County')}
              {f('State', 'geo_state', 'e.g. IL')}
            </div>
          )}

          {f('Industry / Category', 'industry', isCountyCity ? 'e.g. Municipal Government, Public Safety' : 'e.g. Defense, Healthcare')}

          <div>
            <label className="block text-xs text-slate-400 mb-1">ATS Provider</label>
            <select
              className="w-full bg-white/5 border border-white/15 rounded-xl px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-blue-500/50"
              value={form.ats_provider}
              onChange={e => setForm({ ...form, ats_provider: e.target.value })}
            >
              {ATS_PROVIDERS.map(p => (
                <option key={p} value={p} className="bg-slate-900">{p}</option>
              ))}
            </select>
          </div>

          {(form.ats_provider === 'greenhouse' || form.ats_provider === 'lever') && (
            <div>
              <label className="block text-xs text-slate-400 mb-1">
                {form.ats_provider === 'greenhouse' ? 'Greenhouse Board Token' : 'Lever Company ID'}
              </label>
              <input
                type="text"
                value={form.ats_board_id}
                onChange={e => setForm({ ...form, ats_board_id: e.target.value })}
                placeholder={form.ats_provider === 'greenhouse' ? 'e.g. acmecorp' : 'e.g. acme'}
                className="w-full bg-white/5 border border-white/15 rounded-xl px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-blue-500/50"
              />
            </div>
          )}

          {error && <p className="text-red-400 text-xs">{error}</p>}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 rounded-xl border border-white/15 text-slate-400 text-sm hover:border-white/25 transition-all">
              Cancel
            </button>
            <button type="submit" disabled={loading}
              className="flex-1 py-2.5 rounded-xl bg-blue-500/20 border border-blue-500/40 text-blue-300 text-sm hover:bg-blue-500/30 transition-all disabled:opacity-50">
              {loading ? 'Adding...' : 'Add Entity'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
