import { useEffect, useState } from 'react';
import { fetchTopics } from '../../api/client';
import { DEFAULT_TRANSIT_FILTERS, useAppStore } from '../../stores/useAppStore';
import type { Topic, TransitTargetFilters } from '../../types/target';

const TOPIC_CODES: Record<string, string> = {
  eclipsing_binary: 'EB',
  variable_star: 'VAR',
  exoplanet_transit: 'TR',
};

export function TopicSidebar() {
  const [topics, setTopics] = useState<Topic[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
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

  const updateDraft = (patch: Partial<TransitTargetFilters>) => {
    setDraftFilters((current) => ({ ...current, ...patch }));
  };

  return (
    <div className="topic-sidebar">
      <h3>탐구 주제</h3>
      <div className="topic-buttons">
        {topics.map((t) => (
          <div
            key={t.id}
            className={`topic-card-wrap ${t.id === 'exoplanet_transit' ? 'has-settings' : ''}`}
          >
            <button
              className={`topic-btn ${selectedTopic === t.id ? 'active' : ''}`}
              onClick={() => setTopic(t.id)}
              type="button"
            >
              <div className="topic-preview">
                {t.preview_image_url ? (
                  <img src={t.preview_image_url} alt={`${t.name} preview`} />
                ) : null}
                <div className="topic-preview-meta">
                  <span className="topic-icon">{TOPIC_CODES[t.id] ?? t.icon}</span>
                  {t.preview_label && <span className="topic-preview-label">{t.preview_label}</span>}
                </div>
              </div>
              <div className="topic-info">
                <div className="topic-header-row">
                  <div className="topic-header-main">
                    <span className="topic-name">{t.name}</span>
                  </div>
                  <span className="topic-count">
                    {t.id === 'exoplanet_transit'
                      ? `UP TO ${transitFilters.maxTargets}`
                      : `${t.target_count}`}
                  </span>
                </div>
                <span className="topic-desc">{t.description}</span>
              </div>
            </button>

            {t.id === 'exoplanet_transit' && (
              <>
                <div className="topic-card-toolbar">
                  <button
                    className="topic-settings-btn"
                    type="button"
                    onClick={() => setSettingsOpen((current) => !current)}
                  >
                    {settingsOpen ? '필터 닫기' : '필터 설정'}
                  </button>
                </div>

                {settingsOpen && (
                  <div className="topic-settings-panel">
                    <label className="topic-settings-field">
                      <span>Max Targets</span>
                      <input
                        type="number"
                        min={1}
                        max={100}
                        value={draftFilters.maxTargets}
                        onChange={(event) =>
                          updateDraft({
                            maxTargets: Math.max(
                              1,
                              Math.min(100, Number(event.target.value) || 1)
                            ),
                          })
                        }
                      />
                    </label>

                    <label className="topic-settings-field">
                      <span>Min Depth (%)</span>
                      <input
                        type="number"
                        min={0.1}
                        max={10}
                        step={0.1}
                        value={draftFilters.minDepthPct}
                        onChange={(event) =>
                          updateDraft({
                            minDepthPct: Math.max(
                              0.1,
                              Math.min(10, Number(event.target.value) || 0.1)
                            ),
                          })
                        }
                      />
                    </label>

                    <label className="topic-settings-field">
                      <span>Max Period (d)</span>
                      <input
                        type="number"
                        min={0.2}
                        max={30}
                        step={0.1}
                        value={draftFilters.maxPeriodDays}
                        onChange={(event) =>
                          updateDraft({
                            maxPeriodDays: Math.max(
                              0.2,
                              Math.min(30, Number(event.target.value) || 0.2)
                            ),
                          })
                        }
                      />
                    </label>

                    <label className="topic-settings-field">
                      <span>Max Host V</span>
                      <input
                        type="number"
                        min={6}
                        max={16}
                        step={0.1}
                        value={draftFilters.maxHostVmag}
                        onChange={(event) =>
                          updateDraft({
                            maxHostVmag: Math.max(
                              6,
                              Math.min(16, Number(event.target.value) || 6)
                            ),
                          })
                        }
                      />
                    </label>

                    <div className="topic-settings-actions">
                      <button
                        className="btn-sm"
                        onClick={() => setDraftFilters(DEFAULT_TRANSIT_FILTERS)}
                      >
                        Reset
                      </button>
                      <button
                        className="btn-sm"
                        onClick={() => {
                          setTransitFilters(draftFilters);
                          setTopic('exoplanet_transit');
                        }}
                      >
                        Apply
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
