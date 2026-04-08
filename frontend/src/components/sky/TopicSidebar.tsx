import { useEffect, useRef, useState } from 'react';
import { fetchTopics } from '../../api/client';
import { DEFAULT_TRANSIT_FILTERS, useAppStore } from '../../stores/useAppStore';
import type { Topic, TransitTargetFilters } from '../../types/target';

const TOPIC_CODES: Record<string, string> = {
  eclipsing_binary: 'EB',
  variable_star: 'VAR',
  exoplanet_transit: 'Exoplanet Transit',
};

function GearIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

export function TopicSidebar() {
  const [topics, setTopics] = useState<Topic[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsPanelRef = useRef<HTMLDivElement>(null);
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const selectedTopic = useAppStore((s) => s.selectedTopic);
  const transitFilters = useAppStore((s) => s.transitFilters);
  const setTopic = useAppStore((s) => s.setTopic);
  const setTransitFilters = useAppStore((s) => s.setTransitFilters);
  const [draftFilters, setDraftFilters] = useState<TransitTargetFilters>(transitFilters);

  useEffect(() => {
    fetchTopics().then(setTopics);
  }, []);

  useEffect(() => {
    setDraftFilters(transitFilters);
  }, [transitFilters]);

  // Close settings when clicking outside
  useEffect(() => {
    if (!settingsOpen) return;
    const handle = (e: MouseEvent) => {
      if (settingsPanelRef.current && !settingsPanelRef.current.contains(e.target as Node)) {
        setSettingsOpen(false);
      }
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [settingsOpen]);

  const updateDraft = (patch: Partial<TransitTargetFilters>) => {
    setDraftFilters((current) => ({ ...current, ...patch }));
  };

  return (
    <div className={`topic-bar ${sidebarCollapsed ? 'collapsed' : ''}`}>
      {!sidebarCollapsed && (
        <>
          <div className="topic-bar-cards">
            {topics.map((t) => (
              <div key={t.id} className="topic-bar-card-wrap">
                <button
                  className={`topic-bar-card ${selectedTopic === t.id ? 'active' : ''}`}
                  onClick={() => setTopic(t.id)}
                  type="button"
                >
                  <div className="topic-bar-preview">
                    {t.preview_image_url && (
                      <img src={t.preview_image_url} alt={`${t.name} preview`} />
                    )}
                    <div className="topic-bar-preview-overlay">
                      <span className="topic-bar-code">{TOPIC_CODES[t.id] ?? t.icon}</span>
                      {t.preview_label && (
                        <span className="topic-bar-credit">{t.preview_label}</span>
                      )}
                    </div>
                    {t.id === 'exoplanet_transit' && (
                      <button
                        className={`topic-bar-gear ${settingsOpen ? 'open' : ''}`}
                        type="button"
                        title="필터 설정"
                        onClick={(e) => { e.stopPropagation(); setSettingsOpen((v) => !v); }}
                      >
                        <GearIcon />
                      </button>
                    )}
                  </div>
                  <div className="topic-bar-info">
                    <span className="topic-bar-name">{t.name}</span>
                    <span className="topic-bar-desc">{t.description}</span>
                  </div>
                </button>
              </div>
            ))}
          </div>

          {settingsOpen && (
            <div className="topic-bar-settings-panel" ref={settingsPanelRef}>
              <label className="topic-settings-field">
                <span>Max Targets</span>
                <input type="number" min={1} max={100} value={draftFilters.maxTargets}
                  onChange={(e) => updateDraft({ maxTargets: Math.max(1, Math.min(100, Number(e.target.value) || 1)) })} />
              </label>
              <label className="topic-settings-field">
                <span>Min Depth (%)</span>
                <input type="number" min={0.1} max={10} step={0.1} value={draftFilters.minDepthPct}
                  onChange={(e) => updateDraft({ minDepthPct: Math.max(0.1, Math.min(10, Number(e.target.value) || 0.1)) })} />
              </label>
              <label className="topic-settings-field">
                <span>Max Period (d)</span>
                <input type="number" min={0.2} max={30} step={0.1} value={draftFilters.maxPeriodDays}
                  onChange={(e) => updateDraft({ maxPeriodDays: Math.max(0.2, Math.min(30, Number(e.target.value) || 0.2)) })} />
              </label>
              <label className="topic-settings-field">
                <span>Max Host V</span>
                <input type="number" min={6} max={16} step={0.1} value={draftFilters.maxHostVmag}
                  onChange={(e) => updateDraft({ maxHostVmag: Math.max(6, Math.min(16, Number(e.target.value) || 6)) })} />
              </label>
              <div className="topic-settings-actions">
                <button className="btn-sm" onClick={() => setDraftFilters(DEFAULT_TRANSIT_FILTERS)}>Reset</button>
                <button className="btn-sm" onClick={() => { setTransitFilters(draftFilters); setTopic('exoplanet_transit'); setSettingsOpen(false); }}>Apply</button>
              </div>
            </div>
          )}
        </>
      )}

      <button
        className="topic-bar-toggle"
        type="button"
        onClick={toggleSidebar}
        title={sidebarCollapsed ? '탐구 패널 열기' : '탐구 패널 닫기'}
      >
        {sidebarCollapsed ? '▼  탐구 활동 열기' : '▲'}
      </button>
    </div>
  );
}
