import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { PixelCoordinate, StarOverlay, TICStarInfo, TransitCutoutPreview } from '../../types/transit';

interface TransitCutoutViewerProps {
  preview: TransitCutoutPreview;
  displayCutoutSizePx?: number;
  stars: StarOverlay[];
  showTicMarkers?: boolean;
  activeFrameIndex?: number | null;
  onFrameChange?: (frameIndex: number) => void;
  frameChangeDisabled?: boolean;
  frameLoading?: boolean;
  frameLoadingMessage?: string | null;
  onAddComparison?: (position: PixelCoordinate) => void;
  onSelectStar?: (label: string) => void;
  onMoveStar?: (label: string, position: PixelCoordinate) => void;
}

const DRAG_THRESHOLD = 4; // px screen distance before a click becomes a drag

export function TransitCutoutViewer({
  preview,
  displayCutoutSizePx,
  stars,
  showTicMarkers = false,
  activeFrameIndex,
  onFrameChange,
  frameChangeDisabled = false,
  frameLoading = false,
  frameLoadingMessage,
  onAddComparison,
  onSelectStar,
  onMoveStar,
}: TransitCutoutViewerProps) {
  const [zoomScale, setZoomScale] = useState(1);
  const [availableFrameWidth, setAvailableFrameWidth] = useState<number | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  // Pointer interaction state kept in refs so touch and mouse follow the same path
  const pointerRef = useRef<{
    pointerId: number;
    label: string;
    startScreenX: number;
    startScreenY: number;
    dragging: boolean;
  } | null>(null);

  const effectiveDisplaySizePx = Math.min(
    displayCutoutSizePx ?? preview.cutout_width_px,
    preview.cutout_width_px
  );
  const cropOffsetPx = Math.max(0, (preview.cutout_width_px - effectiveDisplaySizePx) / 2);
  const cropScale = preview.cutout_width_px / effectiveDisplaySizePx;

  useEffect(() => {
    setZoomScale(1);
  }, [preview.observation_id, effectiveDisplaySizePx]);

  useEffect(() => {
    if (!frameRef.current) return;

    const frame = frameRef.current;
    const updateWidth = () => {
      setAvailableFrameWidth(frame.clientWidth);
    };

    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  /** Convert a screen mouse event to cutout pixel coords */
  const screenToPixel = useCallback(
    (clientX: number, clientY: number): PixelCoordinate | null => {
      const stage = stageRef.current;
      if (!stage) return null;
      const rect = stage.getBoundingClientRect();
      const rawX =
        cropOffsetPx + ((clientX - rect.left) / rect.width) * effectiveDisplaySizePx;
      const rawY =
        cropOffsetPx + ((clientY - rect.top) / rect.height) * effectiveDisplaySizePx;
      return {
        x: Math.max(0.5, Math.min(preview.cutout_width_px - 0.5, Math.floor(rawX) + 0.5)),
        y: Math.max(0.5, Math.min(preview.cutout_height_px - 0.5, Math.floor(rawY) + 0.5)),
      };
    },
    [cropOffsetPx, effectiveDisplaySizePx, preview.cutout_width_px, preview.cutout_height_px]
  );

  /** Find which star (if any) is under the given pixel position */
  const hitTestStar = useCallback(
    (px: PixelCoordinate): StarOverlay | null => {
      for (const star of stars) {
        const dx = px.x - star.position.x;
        const dy = px.y - star.position.y;
        if (Math.sqrt(dx * dx + dy * dy) <= star.aperture.outerAnnulus + 0.5) {
          return star;
        }
      }
      return null;
    },
    [stars]
  );

  // --- pointer handlers ---

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    if (!onAddComparison) return;

    const px = screenToPixel(event.clientX, event.clientY);
    if (!px) return;

    const hit = hitTestStar(px);
    if (!hit) {
      pointerRef.current = {
        pointerId: event.pointerId,
        label: '',
        startScreenX: event.clientX,
        startScreenY: event.clientY,
        dragging: false,
      };
      return;
    }

    pointerRef.current = {
      pointerId: event.pointerId,
      label: hit.label,
      startScreenX: event.clientX,
      startScreenY: event.clientY,
      dragging: false,
    };
    stageRef.current?.setPointerCapture?.(event.pointerId);
    onSelectStar?.(hit.label);
    event.preventDefault();
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pointer = pointerRef.current;
    if (!pointer || pointer.pointerId !== event.pointerId || pointer.label === '') return;

    const dx = event.clientX - pointer.startScreenX;
    const dy = event.clientY - pointer.startScreenY;
    if (!pointer.dragging) {
      if (Math.sqrt(dx * dx + dy * dy) < DRAG_THRESHOLD) return;
      pointer.dragging = true;
    }

    const px = screenToPixel(event.clientX, event.clientY);
    if (!px) return;

    onMoveStar?.(pointer.label, px);
    event.preventDefault();
  };

  const handlePointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pointer = pointerRef.current;
    if (!pointer || pointer.pointerId !== event.pointerId) return;

    if (!pointer.dragging && pointer.label === '' && onAddComparison) {
      const px = screenToPixel(event.clientX, event.clientY);
      if (px && !hitTestStar(px)) {
        onAddComparison(px);
      }
    }

    stageRef.current?.releasePointerCapture?.(event.pointerId);
    pointerRef.current = null;
  };

  const handlePointerCancel = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (pointerRef.current?.pointerId === event.pointerId) {
      stageRef.current?.releasePointerCapture?.(event.pointerId);
      pointerRef.current = null;
    }
  };

  const baseStageSize =
    availableFrameWidth && availableFrameWidth > 0
      ? Math.min(preview.preview_width_px, Math.max(220, availableFrameWidth - 16))
      : preview.preview_width_px;
  const stageSize = Math.round(baseStageSize * zoomScale);
  const currentFrameIndex = activeFrameIndex ?? preview.frame_index ?? 0;
  const hasMultipleFrames = preview.frame_count > 1;
  const frameMetadata = preview.frame_metadata;

  return (
    <div className="transit-cutout-card">
      <div className="transit-cutout-meta">
        <div>
          <span className="badge">Sector {preview.sector}</span>
          <span className="transit-cutout-subtitle">
            {preview.camera ? `Camera ${preview.camera}` : 'Camera ?'} /{' '}
            {preview.ccd ? `CCD ${preview.ccd}` : 'CCD ?'}
          </span>
        </div>
        <span className="selected-count">
          {preview.cutout_width_px} x {preview.cutout_height_px} px
        </span>
      </div>

      <div className="transit-cutout-toolbar">
        {hasMultipleFrames ? (
          <div className="transit-frame-controls">
            <div className="transit-frame-buttons">
              <button
                type="button"
                className="btn-sm"
                disabled={frameChangeDisabled || currentFrameIndex <= 0}
                onClick={() => onFrameChange?.(0)}
              >
                First
              </button>
              <button
                type="button"
                className="btn-sm"
                disabled={frameChangeDisabled || currentFrameIndex <= 0}
                onClick={() => onFrameChange?.(Math.max(0, currentFrameIndex - 1))}
              >
                Prev
              </button>
              <button
                type="button"
                className="btn-sm"
                disabled={frameChangeDisabled || currentFrameIndex >= preview.frame_count - 1}
                onClick={() =>
                  onFrameChange?.(Math.min(preview.frame_count - 1, currentFrameIndex + 1))
                }
              >
                Next
              </button>
              <button
                type="button"
                className="btn-sm"
                disabled={frameChangeDisabled || currentFrameIndex >= preview.frame_count - 1}
                onClick={() => onFrameChange?.(preview.frame_count - 1)}
              >
                Last
              </button>
            </div>
            <div className="transit-frame-slider">
              <span className="selected-count">
                Frame {currentFrameIndex + 1} / {preview.frame_count}
              </span>
              <input
                type="range"
                min={0}
                max={preview.frame_count - 1}
                step={1}
                value={currentFrameIndex}
                disabled={frameChangeDisabled}
                onChange={(event) => onFrameChange?.(Number(event.target.value))}
              />
            </div>
          </div>
        ) : (
          <span className="selected-count">Single frame preview</span>
        )}

        <div className="transit-cutout-zoom">
          <button
            type="button"
            className="btn-sm"
            disabled={zoomScale <= 1}
            onClick={() => setZoomScale((current) => Math.max(1, current - 0.5))}
          >
            Zoom -
          </button>
          <button
            type="button"
            className="btn-sm"
            onClick={() => setZoomScale(1)}
          >
            1x
          </button>
          <button
            type="button"
            className="btn-sm"
            disabled={zoomScale >= 4}
            onClick={() => setZoomScale((current) => Math.min(4, current + 0.5))}
          >
            Zoom +
          </button>
          <span className="selected-count">View {zoomScale.toFixed(1)}x</span>
        </div>
      </div>

      <div className="transit-cutout-layout">
        <div className="transit-cutout-frame" ref={frameRef}>
          <div
            ref={stageRef}
            className={`transit-cutout-stage ${onAddComparison ? 'interactive' : ''}`}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerEnd}
            onPointerCancel={handlePointerCancel}
            onLostPointerCapture={handlePointerCancel}
            onDragStart={(e) => e.preventDefault()}
            style={{ width: `${stageSize}px`, height: `${stageSize}px` }}
          >
            <div
              className="transit-cutout-content"
              style={{ transform: `scale(${cropScale})` }}
            >
              <img
                src={preview.image_data_url}
                alt={`TESS cutout for sector ${preview.sector}`}
                className="transit-cutout-image"
                draggable={false}
              />
              <svg
                className="transit-cutout-overlay"
                viewBox={`0 0 ${preview.cutout_width_px} ${preview.cutout_height_px}`}
                preserveAspectRatio="none"
              >
                {showTicMarkers && preview.tic_stars?.map((tic) => (
                  <TICMarker key={tic.tic_id} star={tic} />
                ))}
                {stars.map((star) => (
                  <SourceOverlay key={star.label} star={star} />
                ))}
              </svg>
            </div>
            {frameLoading && (
              <div className="transit-cutout-loading">
                {frameLoadingMessage ?? 'Loading frame...'}
              </div>
            )}
          </div>
        </div>

        <aside className="transit-frame-panel">
          <div className="transit-frame-panel-head">
            <strong>Frame Header</strong>
            {frameLoading && <span>Updating...</span>}
          </div>
          <div className="transit-frame-table">
            <div className="transit-frame-row">
              <span>Mode</span>
              <strong>{preview.preview_mode === 'frame' ? 'Frame' : 'Median fallback'}</strong>
            </div>
            <div className="transit-frame-row">
              <span>Frame</span>
              <strong>{currentFrameIndex + 1} / {preview.frame_count}</strong>
            </div>
            <div className="transit-frame-row">
              <span>BTJD</span>
              <strong>{frameMetadata?.btjd ?? 'n/a'}</strong>
            </div>
            <div className="transit-frame-row">
              <span>Cadence</span>
              <strong>{frameMetadata?.cadence_number ?? 'n/a'}</strong>
            </div>
            <div className="transit-frame-row">
              <span>QUALITY</span>
              <strong>{frameMetadata?.quality_flag ?? 'n/a'}</strong>
            </div>
            <div className="transit-frame-row">
              <span>Finite Pixels</span>
              <strong>
                {frameMetadata?.finite_pixels ?? 'n/a'}
                {frameMetadata?.total_pixels ? ` / ${frameMetadata.total_pixels}` : ''}
              </strong>
            </div>
            <div className="transit-frame-row">
              <span>Coverage</span>
              <strong>
                {frameMetadata?.finite_fraction !== null &&
                frameMetadata?.finite_fraction !== undefined
                  ? `${(frameMetadata.finite_fraction * 100).toFixed(1)}%`
                  : 'n/a'}
              </strong>
            </div>
            <div className="transit-frame-row">
              <span>Flux Median</span>
              <strong>{frameMetadata?.flux_median ?? 'n/a'}</strong>
            </div>
            <div className="transit-frame-row">
              <span>Flux Range</span>
              <strong>
                {frameMetadata?.flux_min ?? 'n/a'}
                {frameMetadata?.flux_max !== null && frameMetadata?.flux_max !== undefined
                  ? ` .. ${frameMetadata.flux_max}`
                  : ''}
              </strong>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function SourceOverlay({ star }: { star: StarOverlay }) {
  const { label, position, aperture, type, selected } = star;
  const cls = type === 'target' ? 'target' : 'comparison';

  return (
    <g className={`transit-source-overlay ${cls} ${selected ? 'selected' : ''}`}>
      <circle cx={position.x} cy={position.y} r={aperture.outerAnnulus} />
      <circle cx={position.x} cy={position.y} r={aperture.innerAnnulus} />
      <circle cx={position.x} cy={position.y} r={aperture.apertureRadius} />
      {selected && (
        <circle
          cx={position.x}
          cy={position.y}
          r={aperture.outerAnnulus + 0.6}
          className="transit-source-selection-ring"
        />
      )}
      <text x={position.x + aperture.outerAnnulus + 0.35} y={position.y - 0.35}>
        {label}
      </text>
    </g>
  );
}

function TICMarker({ star }: { star: TICStarInfo }) {
  const { pixel, recommended } = star;
  const r = 0.35;
  return (
    <g className={`transit-tic-marker ${recommended ? 'recommended' : ''}`}>
      <circle cx={pixel.x} cy={pixel.y} r={r} />
      {recommended && (
        <circle cx={pixel.x} cy={pixel.y} r={1.2} className="transit-tic-ring" />
      )}
    </g>
  );
}
