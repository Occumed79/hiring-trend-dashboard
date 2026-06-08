'use client';
import { useState } from 'react';

const ATS_PROVIDERS = ['unknown','greenhouse','lever','workday','icims','taleo','smartrecruiters','bamboohr','jobvite','usajobs','other'];

export default function AddEntityModal({ portal, onClose, onAdded }: {
  portal: any;
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
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) { setError('Name is required'); return; }
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/entities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          portal: portal.id,
          aliases: form.aliases ? form.aliases.split(',').map(s => s.trim()).filter(Boolean) : [],
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative glass-card w-full max-w-lg p-6">
        <h2 className="text-lg font-semibold text-slate-100 mb-1">
          Add to {portal.label}
        </h2>
        <p className="text-xs text-slate-500 mb-5">
          Hiring data will be automatically ingested after adding.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label="Entity Name *" value={form.name} onChange={v => setForm({...form, name: v})} placeholder="e.g. Acme Security Group" />
          <Field label="Known Aliases" value={form.aliases} onChange={v => setForm({...form, aliases: v})} placeholder="Comma separated, e.g. Acme, ASG" />
          <Field label="Career Page URL" value={form.career_page_url} onChange={v => setForm({...form, career_page_url: v})} placeholder="https://careers.acme.com" type="url" />
          <Field label="Industry / Category" value={form.industry} onChange={v => setForm({...form, industry: v})} placeholder="e.g. Defense, Healthcare, Logistics" />

          <div>
            <label className="block text-xs text-slate-400 mb-1">ATS Provider</label>
            <select
              className="w-full bg-white/5 border border-white/15 rounded-xl px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-blue-500/50"
              value={form.ats_provider}
              onChange={e => setForm({...form, ats_provider: e.target.value})}
            >
              {ATS_PROVIDERS.map(p => (
                <option key={p} value={p} className="bg-slate-900">{p}</option>
              ))}
            </select>
          </div>

          {(form.ats_provider === 'greenhouse' || form.ats_provider === 'lever') && (
            <Field
              label={form.ats_provider === 'greenhouse' ? 'Greenhouse Board Token' : 'Lever Company ID'}
              value={form.ats_board_id}
              onChange={v => setForm({...form, ats_board_id: v})}
              placeholder={form.ats_provider === 'greenhouse' ? 'e.g. acmecorp' : 'e.g. acme'}
            />
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

function Field({ label, value, onChange, placeholder, type = 'text' }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string;
}) {
  return (
    <div>
      <label className="block text-xs text-slate-400 mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-white/5 border border-white/15 rounded-xl px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-blue-500/50"
      />
    </div>
  );
}
