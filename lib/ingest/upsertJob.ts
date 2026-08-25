import { query } from '@/db/client';
import { classifyRole } from '@/lib/roleClassifier';
import { inferPoint } from '@/lib/geo/locationLookup';
import { extractLocationCandidates, sanitizeDisplayLocation } from '@/lib/geo/locationSignals';
import { geocodeLocationCandidates } from '@/lib/geo/geocode';
import { normalizeApplyUrl } from './jobIdentity';
import { assessJobQuality } from './jobQuality';

type Bounds = { minLat: number; maxLat: number; minLng: number; maxLng: number };

const COUNTRY_BOUNDS: Record<string, Bounds> = {
  KW: { minLat: 27, maxLat: 31.5, minLng: 45, maxLng: 49.5 },
  QA: { minLat: 23.5, maxLat: 27, minLng: 49.5, maxLng: 53 },
  BH: { minLat: 24.5, maxLat: 27.5, minLng: 49, maxLng: 52 },
  AE: { minLat: 21.5, maxLat: 27.5, minLng: 50, maxLng: 57 },
  SA: { minLat: 15, maxLat: 34, minLng: 33, maxLng: 57 },
  IQ: { minLat: 28, maxLat: 39, minLng: 37, maxLng: 50 },
  DE: { minLat: 46.5, maxLat: 56, minLng: 4, maxLng: 16.5 },
  PL: { minLat: 48, maxLat: 56, minLng: 13, maxLng: 25 },
  GB: { minLat: 48, maxLat: 62, minLng: -11, maxLng: 4 },
  ES: { minLat: 26, maxLat: 45, minLng: -20, maxLng: 5 },
  IT: { minLat: 34, maxLat: 48, minLng: 5, maxLng: 20 },
  GR: { minLat: 33, maxLat: 43, minLng: 18, maxLng: 30 },
  NL: { minLat: 49.5, maxLat: 54, minLng: 2, maxLng: 8 },
  BE: { minLat: 48.5, maxLat: 52, minLng: 2, maxLng: 7 },
  JP: { minLat: 23, maxLat: 47, minLng: 122, maxLng: 154 },
  KR: { minLat: 32, maxLat: 40, minLng: 124, maxLng: 132 },
  MX: { minLat: 13, maxLat: 34, minLng: -119, maxLng: -85 },
  AU: { minLat: -45, maxLat: -9, minLng: 110, maxLng: 155 },
};

const US_STATE_CODES = new Set('AL AK AZ AR CA CO CT DC DE FL GA HI IA ID IL IN KS KY LA MA MD ME MI MN MO MS MT NC ND NE NH NJ NM NV NY OH OK OR PA RI SC SD TN TX UT VA VT WA WI WV WY'.split(' '));

export async function upsertIngestedJob(entity: any, item: any): Promise<boolean> {
  if (!item.external_id || !item.source || !item.title) return false;
  const quality = assessJobQuality(item);
  if (!quality.ok) return false;

  const externalId = String(item.external_id).trim();
  const source = String(item.source).trim();
  const title = String(item.title).trim();
  if (!externalId || !source || !title) return false;

  const isRemote = toBoolean(item.is_remote) || /\b(remote|work from home|wfh|virtual)\b/i.test(`${title} ${item.location || ''}`);
  const originalCountry = normalizeCountry(item.country);
  let country = originalCountry;
  if (source === 'career_page' && country === 'US' && !hasExplicitUsEvidence(item)) country = null;

  const locationCandidates = extractLocationCandidates({ ...item, country, entity_name: entity.name });
  const inferred = inferPoint({ ...item, country, entity_name: entity.name, is_remote: isRemote, location_candidates: locationCandidates });
  const inferredQuality = inferred?.note || null;
  const inferredIsFallback = !!inferredQuality && inferredQuality.includes('fallback');
  const parsedSourceLat = toNumber(item.lat);
  const parsedSourceLng = toNumber(item.lng);
  const zeroZeroPlaceholder = parsedSourceLat === 0 && parsedSourceLng === 0;
  const hasCompleteSourceCoordinates = parsedSourceLat !== null && parsedSourceLng !== null;
  const sourceCoordinateRejection = hasCompleteSourceCoordinates && !zeroZeroPlaceholder
    ? coordinateRejectionReason(country, parsedSourceLat!, parsedSourceLng!)
    : hasCompleteSourceCoordinates ? 'zero-zero placeholder' : null;
  const sourceCoordinatesAccepted = hasCompleteSourceCoordinates && !sourceCoordinateRejection;
  const sourceLat = sourceCoordinatesAccepted ? parsedSourceLat : null;
  const sourceLng = sourceCoordinatesAccepted ? parsedSourceLng : null;

  const shouldGeocode = !isRemote && (sourceLat === null || sourceLng === null) && (!inferred || inferredIsFallback);
  const geocoded = shouldGeocode ? await geocodeLocationCandidates(locationCandidates) : null;

  const city = nullableString(item.city) || (!inferredIsFallback ? inferred?.city || null : null) || geocoded?.city || null;
  const state = normalizeState(nullableString(item.state) || (!inferredIsFallback ? inferred?.state || null : null) || geocoded?.state || null);
  const inferredCountry = !inferredIsFallback ? normalizeCountry(inferred?.country) : null;
  const geocodedCountry = normalizeCountry(geocoded?.country);
  country = reconcileCountry(country, state, inferredCountry, geocodedCountry);

  // Validate source coordinates again after country reconciliation. This catches
  // contradictory records such as Chantilly, VA paired with a GB country code.
  const reconciledCoordinateRejection = sourceLat !== null && sourceLng !== null
    ? coordinateRejectionReason(country, sourceLat, sourceLng)
    : null;
  const trustedSourceLat = reconciledCoordinateRejection ? null : sourceLat;
  const trustedSourceLng = reconciledCoordinateRejection ? null : sourceLng;

  const lat = trustedSourceLat ?? (!inferredIsFallback ? inferred?.lat ?? null : null) ?? geocoded?.lat ?? null;
  const lng = trustedSourceLng ?? (!inferredIsFallback ? inferred?.lng ?? null : null) ?? geocoded?.lng ?? null;
  const normalizedApplyUrl = normalizeApplyUrl(item);
  const displayLocation = isRemote
    ? 'Remote'
    : sanitizeDisplayLocation(item.location) || [city, state, country].filter(Boolean).join(', ') || null;
  const locationQuality = trustedSourceLat !== null && trustedSourceLng !== null
    ? 'source coordinates'
    : (!inferredIsFallback && inferred?.lat !== undefined && inferred?.lng !== undefined)
      ? inferredQuality || 'normalized job location'
      : geocoded?.note || (inferredIsFallback ? 'unmapped_no_job_location' : null);
  const rejectedCoordinateReason = sourceCoordinateRejection || reconciledCoordinateRejection;
  const countryReconciled = Boolean(originalCountry && country && originalCountry !== country);

  const normalizedRawData = {
    ...(item.raw_data || {}),
    normalized_apply_url: normalizedApplyUrl || item.raw_data?.normalized_apply_url || null,
    normalized_seen_at: new Date().toISOString(),
    normalized_location_candidates: locationCandidates,
    normalized_location_quality: locationQuality,
    normalized_location_original: nullableString(item.location),
    normalized_location_display: displayLocation,
    normalized_fallback_point: inferredIsFallback ? inferred : null,
    normalized_geocoded: !!geocoded,
    normalized_zero_zero_coordinate_rejected: zeroZeroPlaceholder,
    normalized_source_coordinate_rejected: Boolean(rejectedCoordinateReason),
    normalized_source_coordinate_rejection_reason: rejectedCoordinateReason,
    normalized_rejected_source_coordinates: rejectedCoordinateReason ? { lat: parsedSourceLat, lng: parsedSourceLng, country: originalCountry } : null,
    normalized_original_country: originalCountry,
    normalized_country_reconciled: countryReconciled,
    normalized_country_reconciled_to: countryReconciled ? country : null,
    normalized_job_quality: 'accepted',
  };

  const roleCategory = classifyRole(title, displayLocation);
  const existing = await query(`SELECT id FROM jobs WHERE entity_id = $1 AND external_id = $2 AND source = $3`, [entity.id, externalId, source]);

  await query(
    `INSERT INTO jobs (entity_id, external_id, source, title, department, role_category,
      location, city, state, country, lat, lng, is_remote, is_overseas, posted_at, raw_data)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     ON CONFLICT (entity_id, external_id, source) DO UPDATE SET
      title = EXCLUDED.title, department = EXCLUDED.department, role_category = EXCLUDED.role_category,
      location = EXCLUDED.location, city = EXCLUDED.city, state = EXCLUDED.state, country = EXCLUDED.country,
      lat = EXCLUDED.lat, lng = EXCLUDED.lng, is_remote = EXCLUDED.is_remote, is_overseas = EXCLUDED.is_overseas,
      posted_at = COALESCE(EXCLUDED.posted_at, jobs.posted_at), raw_data = EXCLUDED.raw_data,
      is_active = true, closed_at = NULL, updated_at = NOW()`,
    [entity.id, externalId, source, title, nullableString(item.department), roleCategory,
      displayLocation, city, state, country, lat, lng, isRemote,
      toBoolean(item.is_overseas) || (country !== null && country !== 'US'),
      normalizeDate(item.posted_at), JSON.stringify(normalizedRawData)]
  );

  return existing.length === 0;
}

function reconcileCountry(original: string | null, state: string | null, inferred: string | null, geocoded: string | null) {
  if (state && US_STATE_CODES.has(state)) return 'US';
  if (geocoded && original && geocoded !== original) return geocoded;
  if (inferred && original && inferred !== original) return inferred;
  return original || geocoded || inferred || null;
}

function normalizeState(value: string | null) {
  if (!value) return null;
  const text = value.trim();
  return /^[A-Za-z]{2}$/.test(text) ? text.toUpperCase() : text;
}

function coordinateRejectionReason(country: string | null, lat: number, lng: number) {
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return 'outside valid latitude/longitude range';
  if (country && country !== 'AQ' && lat < -60) return `latitude is in Antarctica but stated country is ${country}`;
  const bounds = country ? COUNTRY_BOUNDS[country] : null;
  if (bounds && (lat < bounds.minLat || lat > bounds.maxLat || lng < bounds.minLng || lng > bounds.maxLng)) {
    return `coordinates fall outside coarse ${country} bounds`;
  }
  return null;
}

function hasExplicitUsEvidence(item: any) {
  const raw = item?.raw_data || {};
  const text = [item.location, item.city, item.state, raw.location, raw.job_location, raw.detail_location_candidates]
    .flat().filter(Boolean).join(' ');
  if (/\b(?:united states|usa|u\.s\.)\b/i.test(text)) return true;
  return /\b[A-Z][A-Za-z .'-]+,\s*(?:AL|AK|AZ|AR|CA|CO|CT|DC|DE|FL|GA|HI|IA|ID|IL|IN|KS|KY|LA|MA|MD|ME|MI|MN|MO|MS|MT|NC|ND|NE|NH|NJ|NM|NV|NY|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VA|VT|WA|WI|WV|WY)\b/.test(text);
}
function nullableString(value: unknown) { if (value === undefined || value === null) return null; const text = String(value).trim(); return text || null; }
function normalizeCountry(value: unknown): string | null {
  const raw = nullableString(value); if (!raw) return null; const text = raw.toLowerCase();
  const mapped: Record<string, string> = {
    us: 'US', usa: 'US', 'u.s.': 'US', 'u.s.a.': 'US', 'united states': 'US', 'united states of america': 'US',
    ca: 'CA', canada: 'CA', gb: 'GB', uk: 'GB', 'united kingdom': 'GB', 'great britain': 'GB', england: 'GB',
    de: 'DE', germany: 'DE', kw: 'KW', kuwait: 'KW', qa: 'QA', qatar: 'QA', bh: 'BH', bahrain: 'BH', iq: 'IQ', iraq: 'IQ',
    pl: 'PL', poland: 'PL', au: 'AU', australia: 'AU', jp: 'JP', japan: 'JP', kr: 'KR', korea: 'KR', 'south korea': 'KR',
    mx: 'MX', mexico: 'MX', es: 'ES', spain: 'ES', it: 'IT', italy: 'IT', gr: 'GR', greece: 'GR', fr: 'FR', france: 'FR',
    nl: 'NL', netherlands: 'NL', be: 'BE', belgium: 'BE', ae: 'AE', uae: 'AE', 'united arab emirates': 'AE', sa: 'SA', 'saudi arabia': 'SA',
  };
  if (mapped[text]) return mapped[text];
  if (/^[a-z]{2}$/i.test(text)) return text.toUpperCase();
  return null;
}
function toNumber(value: unknown) { if (value === undefined || value === null || value === '') return null; const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
function toBoolean(value: unknown) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') { const normalized = value.trim().toLowerCase(); if (['true','1','yes','y'].includes(normalized)) return true; if (['false','0','no','n'].includes(normalized)) return false; }
  return false;
}
function normalizeDate(value: unknown) { if (value === undefined || value === null || value === '') return null; const date = new Date(String(value)); return Number.isNaN(date.getTime()) ? null : date.toISOString(); }
