import { useEffect, useState } from 'react';
import { fetchTarget, fetchObservations } from '../api/client';
import type { Target, Observation } from '../types/target';

interface UseLabDataResult {
  target: Target | null;
  observations: Observation[];
  error: string | null;
}

export function useLabData(targetId: string | undefined): UseLabDataResult {
  const [target, setTarget] = useState<Target | null>(null);
  const [observations, setObservations] = useState<Observation[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!targetId) return;

    const controller = new AbortController();

    Promise.all([
      fetchTarget(targetId),
      fetchObservations(targetId),
    ])
      .then(([detail, obs]) => {
        if (!controller.signal.aborted) {
          setTarget(detail.target);
          setObservations(obs);
        }
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          console.error('Failed to load lab data', err);
          setError('Failed to load target data.');
        }
      });

    return () => controller.abort();
  }, [targetId]);

  return { target, observations, error };
}
