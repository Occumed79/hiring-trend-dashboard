'use client';
import type { Portal } from '@/lib/portals';
import { useEffect, useState } from 'react';

type Copy = {
  title: string;
  description: string;
  nameLabel: string;
  namePlaceholder: string;
  contextLabel: string;
  contextPlaceholder: string;
  careerLabel: string;
  careerPlaceholder: string;
  submit: string;
  errorNoun: string;
};

type RegistryOption = {
  id: string;
  name: string;
  type?: string | null;
  state?: string | null;
  county?: string | null;
  fips?: string | null;
  website?: string | null;
};

const COPY: Record<string, Copy> = {
  current_clients: {
    title: 'Track Client',
    description: 'Add a client and the app will resolve its authoritative hiring source and begin tracking open roles.',
    nameLabel: 'Client name *',
    namePlaceholder: 'e.g. Amentum, V2X, IDS International',
    contextLabel: 'Industry / business area',
    contextPlaceholder: 'Optional — defense, healthcare, technology',
    careerLabel: 'Official careers URL',
    careerPlaceholder: 'Optional — helps when auto-discovery cannot find it',
    submit: 'Track Client',
    errorNoun: 'client',
  },
  prospects: {
    title: 'Track Prospect',
    description: 'Add a prospect and monitor verified hiring activity as an account signal.',
    nameLabel: 'Prospect name *',
    namePlaceholder: 'e.g. Fluor, KBR, Leidos',
    contextLabel: 'Industry / business area',
    contextPlaceholder: 'Optional — defense, logistics, healthcare',
    careerLabel: 'Official careers URL',
    careerPlaceholder: 'Optional — employer or ATS career page',
    submit: 'Track Prospect',
    errorNoun: 'prospect',
  },
  private_companies: {
    title: 'Track Private Company',
    description: 'Add a company and track verified openings from its ATS, career site, NLx, or employer-verified discovery sources.',
    nameLabel: 'Company name *',
    namePlaceholder: 'e.g. Amazon, Northrop Grumman, Boeing',
    contextLabel: 'Industry',
    contextPlaceholder: 'Optional — aerospace, technology, healthcare',
    careerLabel: 'Official careers URL',
    careerPlaceholder: 'Optional — employer or ATS career page',
    submit: 'Track Company',
    errorNoun: 'company',
  },
  federal_agencies: {
    title: 'Track Federal Agency',
    description: 'The app will resolve the agency’s USAJOBS organization code and ingest the complete verified federal inventory.',
    nameLabel: 'Federal agency name *',
    namePlaceholder: 'e.g. Department of Veterans Affairs',
    contextLabel: 'Agency / mission area',
    contextPlaceholder: 'Optional — healthcare, defense, transportation',
    careerLabel: 'Official hiring URL',
    careerPlaceholder: 'Optional — USAJOBS or agency employment page',
    submit: 'Track Agency',
    errorNoun: 'federal agency',
  },
  state_agencies: {
    title: 'Track State Agency',
    description: 'The app checks the agency’s official hiring system plus NLx and verified public-sector sources when available.',
    nameLabel: 'State agency name *',
    namePlaceholder: 'e.g. California Department of Public Health',
    contextLabel: 'State / function',
    contextPlaceholder: 'Optional — California, public health',
    careerLabel: 'Official hiring URL',
    careerPlaceholder: 'Optional — .gov, GovernmentJobs, Workday, etc.',
    submit: 'Track Agency',
    errorNoun: 'state agency',
  },
  counties_and_cities: {
    title: 'Track County or City',
    description: 'Match the government against the Census registry, then check its official hiring system, authorized NEOGOV/GovernmentJobs, NLx, NACo, ICMA, and other verified sources.',
    nameLabel: 'County or city name *',
    namePlaceholder: 'e.g. Fresno County, CA or City of San Diego',
    contextLabel: 'State / jurisdiction',
    contextPlaceholder: 'Optional — California, county government',
    careerLabel: 'Official hiring URL',
    careerPlaceholder: 'Optional — GovernmentJobs/NEOGOV or official .gov careers page',
    submit: 'Track County / City',
    errorNoun: 'county or city',
  },
};

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
  const [registryOptions, setRegistryOptions] = useState<RegistryOption[]>([]);
  const [registryLoading, setRegistryLoading] = useState(false);
  const [selectedRegistry, setSelectedRegistry] = useState<RegistryOption | null>(null);
  const copy = COPY[portal.id] ?? COPY.private_companies;
  const useRegistryPicker = portal.id === 'counties_and_cities';

  useEffect(() => {
    if (!useRegistryPicker || selectedRegistry || name.trim().length < 2) {
      setRegistryOptions([]);
      setRegistryLoading(false);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setRegistryLoading(true);
      fetch(`/api/government-registry?q=${encodeURIComponent(name.trim())}&portal=counties_and_cities`, { signal: controller.signal })
        .then(response => response.ok ? response.json() : [])
        .then(data => setRegistryOptions(Array.isArray(data) ? data : []))
        .catch(err => { if (err?.name !== 'AbortError') setRegistryOptions([]); })
        .finally(() => { if (!controller.signal.aborted) setRegistryLoading(false); });
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [name, selectedRegistry, useRegistryPicker]);

  function changeName(value: string) {
    setName(value);
    setSelectedRegistry(null);
  }

  function chooseRegistry(option: RegistryOption) {
    setSelectedRegistry(option);
    setName(option.name);
    setRegistryOptions([]);
    if (!industry && option.state) setIndustry(`${option.state} · ${formatType(option.type)}`);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError(`Enter a ${copy.errorNoun} name.`);
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
          government_registry_id: selectedRegistry?.id || null,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error || 'create failed');
      onAdded(body);
    } catch (err) {
      const detail = err instanceof Error && err.message !== 'create failed' ? ` ${err.message}` : '';
      setError(`Could not start tracking this ${copy.errorNoun}.${detail}`);
    } finally {
      setLoading(false);
    }
  }

  const inputClass = 'w-full bg-white/5 border border-white/15 rounded-xl px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-blue-500/50';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative glass-card w-full max-w-lg p-6">
        <h2 className="text-lg font-semibold text-slate-100 mb-1">{copy.title}</h2>
        <p className="text-xs text-slate-500 mb-5">{copy.description}</p>

        <form onSubmit={submit} className="space-y-4">
          <div className="relative">
            <label className="block text-xs text-slate-400 mb-1">{copy.nameLabel}</label>
            <input className={inputClass} value={name} onChange={e => changeName(e.target.value)} placeholder={copy.namePlaceholder} autoComplete="off" />
            {selectedRegistry && (
              <div className="mt-2 flex items-center justify-between gap-3 rounded-xl border border-cyan-300/20 bg-cyan-400/[0.055] px-3 py-2">
                <div className="min-w-0"><p className="text-[10px] font-medium text-cyan-100 truncate">Census government match</p><p className="text-[9px] text-slate-500 truncate">{[formatType(selectedRegistry.type), selectedRegistry.state, selectedRegistry.fips ? `FIPS ${selectedRegistry.fips}` : null].filter(Boolean).join(' · ')}</p></div>
                <button type="button" onClick={() => setSelectedRegistry(null)} className="text-[9px] text-slate-500 hover:text-slate-200">Change</button>
              </div>
            )}
            {!selectedRegistry && (registryLoading || registryOptions.length > 0) && (
              <div className="absolute z-30 left-0 right-0 top-full mt-1.5 max-h-56 overflow-y-auto rounded-xl border border-white/12 bg-slate-950/95 p-1.5 shadow-2xl backdrop-blur-xl scrollbar-glass">
                {registryLoading && !registryOptions.length ? <p className="px-3 py-2 text-[10px] text-slate-500">Searching Census government registry…</p> : registryOptions.map(option => (
                  <button key={option.id} type="button" onClick={() => chooseRegistry(option)} className="w-full rounded-lg px-3 py-2 text-left hover:bg-blue-500/10 transition-colors">
                    <p className="text-[11px] font-medium text-slate-200">{option.name}</p>
                    <p className="mt-0.5 text-[9px] text-slate-500">{[formatType(option.type), option.state, option.county, option.fips ? `FIPS ${option.fips}` : null].filter(Boolean).join(' · ')}</p>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Aliases</label>
            <input className={inputClass} value={aliases} onChange={e => setAliases(e.target.value)} placeholder="Optional comma-separated aliases" />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">{copy.contextLabel}</label>
            <input className={inputClass} value={industry} onChange={e => setIndustry(e.target.value)} placeholder={copy.contextPlaceholder} />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">{copy.careerLabel}</label>
            <input className={inputClass} value={careerUrl} onChange={e => setCareerUrl(e.target.value)} placeholder={copy.careerPlaceholder} />
          </div>

          {error && <p className="text-red-400 text-xs">{error}</p>}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-white/15 text-slate-400 text-sm hover:border-white/25 transition-all">Cancel</button>
            <button type="submit" disabled={loading} className="flex-1 py-2.5 rounded-xl bg-blue-500/20 border border-blue-500/40 text-blue-300 text-sm hover:bg-blue-500/30 transition-all disabled:opacity-50">
              {loading ? 'Resolving sources…' : copy.submit}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function formatType(value?: string | null) { return String(value || 'government').replace(/_/g, ' ').replace(/\b\w/g, character => character.toUpperCase()); }
