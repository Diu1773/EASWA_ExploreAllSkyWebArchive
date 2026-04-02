import { useEffect, useRef, useState } from 'react';
import { AladinViewer, type AladinViewerHandle } from './AladinViewer';
import { TopicSidebar } from './TopicSidebar';
import { TargetPopup } from './TargetPopup';
import { fetchTargets } from '../../api/client';
import { useAppStore } from '../../stores/useAppStore';
import type { Target } from '../../types/target';

export function SkyExplorer() {
  const [targets, setTargets] = useState<Target[]>([]);
  const [popupTarget, setPopupTarget] = useState<Target | null>(null);
  const [gotoMessage, setGotoMessage] = useState<string | null>(null);
  const [gotoMessageTone, setGotoMessageTone] = useState<'info' | 'error' | null>(null);
  const [gotoInProgress, setGotoInProgress] = useState(false);
  const [gotoReadyTargetId, setGotoReadyTargetId] = useState<string | null>(null);
  const selectedTopic = useAppStore((s) => s.selectedTopic);
  const transitFilters = useAppStore((s) => s.transitFilters);
  const setCurrentTarget = useAppStore((s) => s.setCurrentTarget);
  const viewerRef = useRef<AladinViewerHandle>(null);

  useEffect(() => {
    let cancelled = false;

    setPopupTarget(null);
    setGotoMessage(null);
    setGotoMessageTone(null);
    setGotoInProgress(false);
    setGotoReadyTargetId(null);
    setCurrentTarget(null);

    if (!selectedTopic) {
      setTargets([]);
      return () => {
        cancelled = true;
      };
    }

    fetchTargets(
      selectedTopic ?? undefined,
      selectedTopic === 'exoplanet_transit' ? transitFilters : undefined
    )
      .then((nextTargets) => {
        if (!cancelled) {
          setTargets(nextTargets);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          console.error('Failed to load targets', error);
          setTargets([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedTopic, transitFilters]);

  const handleTargetClick = (target: Target) => {
    setPopupTarget(target);
    setGotoMessage(null);
    setGotoMessageTone(null);
    setGotoInProgress(false);
    if (gotoReadyTargetId !== target.id) {
      setGotoReadyTargetId(null);
      setCurrentTarget(null);
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
      <div className="sky-map-area">
        <AladinViewer
          ref={viewerRef}
          targets={targets}
          onTargetClick={handleTargetClick}
        />
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
