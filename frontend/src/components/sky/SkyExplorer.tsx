import { useEffect, useRef, useState } from 'react';
import { AladinViewer, type AladinViewerHandle } from './AladinViewer';
import { TopicSidebar } from './TopicSidebar';
import { TargetPopup } from './TargetPopup';
import { useAppStore } from '../../stores/useAppStore';
import { useSkyTargets } from '../../hooks/useSkyTargets';
import type { Target } from '../../types/target';

export function SkyExplorer() {
  const { targets, loading, selectedTopic } = useSkyTargets();
  const [nameSearch, setNameSearch] = useState('');
  const [popupTarget, setPopupTarget] = useState<Target | null>(null);
  const [gotoMessage, setGotoMessage] = useState<string | null>(null);
  const [gotoMessageTone, setGotoMessageTone] = useState<'info' | 'error' | null>(null);
  const [gotoInProgress, setGotoInProgress] = useState(false);
  const [gotoReadyTargetId, setGotoReadyTargetId] = useState<string | null>(null);
  const setCurrentTarget = useAppStore((s) => s.setCurrentTarget);
  const viewerRef = useRef<AladinViewerHandle>(null);

  const q = nameSearch.trim().toLowerCase();
  const filteredTargets = q
    ? targets.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.id.toLowerCase().includes(q) ||
          t.constellation.toLowerCase().includes(q)
      )
    : targets;

  useEffect(() => {
    setPopupTarget(null);
    setGotoMessage(null);
    setGotoMessageTone(null);
    setGotoInProgress(false);
    setGotoReadyTargetId(null);
    setCurrentTarget(null);
    setNameSearch('');
  }, [selectedTopic]);

  const handleTargetClick = (target: Target) => {
    setPopupTarget(target);
    setGotoMessage(null);
    setGotoMessageTone(null);
    setGotoInProgress(false);
    // Unlock detail view immediately so users can navigate on first click
    setCurrentTarget(target);
    if (gotoReadyTargetId !== target.id) {
      setGotoReadyTargetId(target.id);
    }
  };

  const handleGoto = async () => {
    if (!popupTarget || !viewerRef.current) return;

    setGotoMessage(null);
    setGotoMessageTone(null);
    setGotoInProgress(true);

    try {
      const result = await viewerRef.current.gotoTarget(popupTarget);
      setCurrentTarget(popupTarget);
      setGotoReadyTargetId(popupTarget.id);
      if (result === 'already-there') {
        setGotoMessage('이미 대상에 와있다.');
        setGotoMessageTone('info');
      }
    } catch (error) {
      console.error('Failed to slew to target', error);
      setGotoMessage(
        error instanceof Error ? error.message : 'Failed to slew to target.'
      );
      setGotoMessageTone('error');
    } finally {
      setGotoInProgress(false);
    }
  };

  return (
    <div className="sky-explorer">
      <TopicSidebar />
      <div className="sky-map-area" style={{ flex: 1, position: 'relative' }}>
        <AladinViewer
          ref={viewerRef}
          targets={filteredTargets}
          onTargetClick={handleTargetClick}
        />

        {/* Search overlay */}
        <div className="sky-search-overlay">
          <input
            type="search"
            className="sky-search-input"
            placeholder="이름 / 별자리 검색…"
            value={nameSearch}
            onChange={(e) => setNameSearch(e.target.value)}
          />
          {q && (
            <span className="sky-search-count">
              {filteredTargets.length} / {targets.length}
            </span>
          )}
        </div>

        {loading && (
          <div className="sky-loading-overlay">
            <span className="sky-loading-spinner" />
            <span>대상 불러오는 중…</span>
          </div>
        )}
        {!loading && selectedTopic === 'exoplanet_transit' && targets.length === 0 && (
          <div className="transit-empty-state">
            No transit targets matched the current filters. Reset filters or lower Min Depth.
          </div>
        )}
        {popupTarget && (
          <TargetPopup
            gotoHint={gotoMessage}
            gotoHintTone={gotoMessageTone}
            gotoInProgress={gotoInProgress}
            gotoUnlocked={gotoReadyTargetId === popupTarget.id}
            onGoto={handleGoto}
            target={popupTarget}
            onClose={() => {
              setPopupTarget(null);
              setGotoMessage(null);
              setGotoMessageTone(null);
              setGotoInProgress(false);
            }}
          />
        )}
      </div>
    </div>
  );
}
