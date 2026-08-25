'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_HIRING_MAP_STYLE,
  getHiringBasemap,
  readHiringMapStyle,
  subscribeToHiringMapStyle,
  type HiringMapStyleId,
} from './maptilerBasemap';

export function useHiringBasemap() {
  const [styleId, setStyleId] = useState<HiringMapStyleId>(DEFAULT_HIRING_MAP_STYLE);
  const [mapTilerKey, setMapTilerKey] = useState(String(process.env.NEXT_PUBLIC_MAPTILER_API_KEY || '').trim());

  useEffect(() => {
    setStyleId(readHiringMapStyle());
    return subscribeToHiringMapStyle(setStyleId);
  }, []);

  useEffect(() => {
    if (mapTilerKey) return;
    const controller = new AbortController();
    fetch('/api/map/config', { signal: controller.signal, cache: 'no-store' })
      .then(response => response.ok ? response.json() : null)
      .then(body => {
        const key = String(body?.maptiler_key || '').trim();
        if (key) setMapTilerKey(key);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [mapTilerKey]);

  return useMemo(() => getHiringBasemap(styleId, mapTilerKey), [styleId, mapTilerKey]);
}
