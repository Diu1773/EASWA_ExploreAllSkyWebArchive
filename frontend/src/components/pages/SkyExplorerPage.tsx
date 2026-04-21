import { useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { SkyExplorer } from '../sky/SkyExplorer';
import { useAppStore } from '../../stores/useAppStore';
import {
  alignExplorerContext,
  buildExplorerContextSearchParams,
  getExplorerContext,
} from '../../utils/explorerNavigation';

const DEFAULT_TOPIC = 'exoplanet_transit';

export function SkyExplorerPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedTopic = useAppStore((s) => s.selectedTopic);
  const setTopic = useAppStore((s) => s.setTopic);

  // Memoize context so it only changes when URL params actually change,
  // preventing unnecessary effect re-runs.
  const context = useMemo(
    () => getExplorerContext(searchParams, { moduleId: 'tess', topicId: DEFAULT_TOPIC }),
    [searchParams],
  );

  // Initialize store from URL on mount only.
  // Using empty deps intentionally: we only want to hydrate the store once
  // from the URL. After that, the store is the source of truth and drives the URL.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setTopic(context.topicId ?? DEFAULT_TOPIC); }, []);

  // Keep URL in sync when the store topic changes (e.g., user clicks TopicSidebar).
  // This must NOT run in response to its own setSearchParams call — the memoized
  // context prevents that: once the URL matches selectedTopic, next===searchParams.
  useEffect(() => {
    if (!selectedTopic) return;
    const next = buildExplorerContextSearchParams(
      alignExplorerContext(context, selectedTopic),
    );
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
  }, [selectedTopic, context, searchParams, setSearchParams]);

  return <SkyExplorer />;
}
