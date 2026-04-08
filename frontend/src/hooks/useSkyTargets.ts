import { useEffect, useState } from 'react';
import { fetchTargets } from '../api/client';
import { useAppStore } from '../stores/useAppStore';
import type { Target } from '../types/target';

export function useSkyTargets() {
  const [targets, setTargets] = useState<Target[]>([]);
  const selectedTopic = useAppStore((s) => s.selectedTopic);
  const transitFilters = useAppStore((s) => s.transitFilters);

  useEffect(() => {
    let cancelled = false;

    if (!selectedTopic) {
      setTargets([]);
      return () => { cancelled = true; };
    }

    fetchTargets(
      selectedTopic,
      selectedTopic === 'exoplanet_transit' ? transitFilters : undefined
    )
      .then((nextTargets) => {
        if (!cancelled) setTargets(nextTargets);
      })
      .catch((error) => {
        if (!cancelled) {
          console.error('Failed to load targets', error);
          setTargets([]);
        }
      });

    return () => { cancelled = true; };
  }, [selectedTopic, transitFilters]);

  return { targets, selectedTopic };
}
