'use client';
import type { Portal } from '@/lib/portals';
import { useState } from 'react';

export default function UniversalAddEntityModal({ portal, onClose, onAdded }: {
  portal: Portal;
  onClose: () => void;
  onAdded: (entity: any) => void;
}) {
  const [name, setName] = useState('');
  const [aliases, setAliases] = useState('');
  const [industry, setIndustry] = useState('');
  const [careerUrl, setCareerUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError('Enter a company, agency, city, or county name.');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/entities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          aliases: aliases ? aliases.split(',').map(a => a.trim()).filter(Boolean) : [],
          portal: portal.id,
          career_page_url: careerUrl || null,
          ats_provider: 'unknown',
          ats_board_id: null,
          industry: industry || null,
          category: null,
        }),
      });
      if (!res.ok) throw new Error('create failed');
      onAdded(await res.json());
    } catch {
      setError('Could not start tracking this company. Try adding the career URL too.');
    } finally {
      setLoading(false);
    }
  }

  const inputClass = 'w-full bg-white/5 border border-white/15 rounded-xl px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-blue-500/50';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative glass-card w-full max-w-lg p-6">
        <h2 className="text-lg font-semibold text-slate-100 mb-1">Track Any Company</h2>
        <p className="text-xs text-slate-500 mb-5">
          Type a company or agency name. The app will try to find its hiring source and begin tracking activity.
        </p>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-xs text-slate-400 mb-1">Company / Agency Name *</label>
            <input className={inputClass} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Amentum, Amazon, Northrop Grumman" />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Aliases</label>
            <input className={inputClass} value={aliases} onChange={e => setAliases(e.target.value)} placeholder="Optional comma separated aliases" />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Industry</label>
            <input className={inputClass} value={industry} onChange={e => setIndustry(e.target.value)} placeholder="Optional — defense, healthcare, technology" />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Career URL</label>
            <input className={inputClass} value={careerUrl} onChange={e => setCareerUrl(e.target.value)} placeholder="Optional — helps when auto-discovery cannot find it" />
          </div>

          {error && <p className="text-red-400 text-xs">{error}</p>}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-white/15 text-slate-400 text-sm hover:border-white/25 transition-all">Cancel</button>
            <button type="submit" disabled={loading} className="flex-1 py-2.5 rounded-xl bg-blue-500/20 border border-blue-500/40 text-blue-300 text-sm hover:bg-blue-500/30 transition-all disabled:opacity-50">
              {loading ? 'Discovering...' : 'Start Tracking'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
