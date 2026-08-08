'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_HIRING_MAP_STYLE,
  getHiringBasemap,
  readHiringMapStyle,
  subscribeToHiringMapStyle,
  type HiringMapStyleId,
} from './arcgisBasemap';

export function useHiringBasemap() {
  const [styleId, setStyleId] = useState<HiringMapStyleId>(DEFAULT_HIRING_MAP_STYLE);

  useEffect(() => {
    setStyleId(readHiringMapStyle());
    return subscribeToHiringMapStyle(setStyleId);
  }, []);

  return useMemo(() => getHiringBasemap(styleId), [styleId]);
}
