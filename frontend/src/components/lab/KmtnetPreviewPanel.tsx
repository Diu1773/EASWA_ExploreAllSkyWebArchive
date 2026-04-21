import type { MicrolensingPreviewResponse } from '../../types/microlensing';

interface KmtnetPreviewPanelProps {
  preview: MicrolensingPreviewResponse;
  frameChangeDisabled?: boolean;
  frameLoading?: boolean;
  onFrameChange?: (frameIndex: number) => void;
}

interface PreviewCardProps {
  title: string;
  caption: string;
  imageUrl: string;
  preview: Pick<MicrolensingPreviewResponse, 'cutout_width_px' | 'cutout_height_px'>;
  markerPosition: MicrolensingPreviewResponse['target_position'];
  accentClass?: string;
}

function PreviewCard({
  title,
  caption,
  imageUrl,
  preview,
  markerPosition,
  accentClass = '',
}: PreviewCardProps) {
  const left = `${(markerPosition.x / preview.cutout_width_px) * 100}%`;
  const top = `${(markerPosition.y / preview.cutout_height_px) * 100}%`;

  return (
    <article className={`ml-preview-card ${accentClass}`.trim()}>
      <div className="ml-preview-card-head">
        <strong>{title}</strong>
        <span>{caption}</span>
      </div>
      <div className="ml-preview-stage">
        <img src={imageUrl} alt={title} className="ml-preview-image" />
        <div className="ml-preview-marker" style={{ left, top }} aria-hidden="true" />
      </div>
    </article>
  );
}

export function KmtnetPreviewPanel({
  preview,
  frameChangeDisabled = false,
  frameLoading = false,
  onFrameChange,
}: KmtnetPreviewPanelProps) {
  const currentFrameIndex = preview.frame_index;
  const frameMetadata = preview.frame_metadata;

  return (
    <section className="ml-preview-panel">
      <div className="ml-preview-head">
        <div>
          <span className="ml-preview-kicker">Difference Imaging</span>
          <h4>Raw / Reference / Difference</h4>
        </div>
        <div className="ml-preview-stats">
          <span>HJD {frameMetadata.hjd.toFixed(4)}</span>
          <span>I = {frameMetadata.magnitude.toFixed(3)} ± {frameMetadata.mag_error.toFixed(3)}</span>
          <span>{frameMetadata.filter_band ?? 'I'}-band · {frameMetadata.exposure_sec?.toFixed(0) ?? '120'} s</span>
          <span>A ≈ {frameMetadata.magnification.toFixed(2)}x</span>
        </div>
      </div>

      <div className="ml-preview-toolbar">
        <div className="ml-preview-toolbar-group">
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
            onClick={() => onFrameChange?.(Math.min(preview.frame_count - 1, currentFrameIndex + 1))}
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
        <div className="ml-preview-toolbar-group ml-preview-toolbar-group--grow">
          <span className="selected-count">
            Frame {currentFrameIndex + 1} / {preview.frame_count}
          </span>
          <input
            type="range"
            min={0}
            max={Math.max(preview.frame_count - 1, 0)}
            step={1}
            value={currentFrameIndex}
            disabled={frameChangeDisabled}
            onChange={(event) => onFrameChange?.(Number(event.target.value))}
          />
        </div>
      </div>

      <div className="ml-preview-grid">
        <PreviewCard
          title="Aligned Frame"
          caption={`reference 대비 Δx ${preview.registration_dx_px >= 0 ? '+' : ''}${preview.registration_dx_px.toFixed(2)} px · Δy ${preview.registration_dy_px >= 0 ? '+' : ''}${preview.registration_dy_px.toFixed(2)} px`}
          imageUrl={preview.aligned_image_data_url}
          preview={preview}
          markerPosition={preview.aligned_target_position}
        />
        <PreviewCard
          title="Reference"
          caption={`기준 프레임 #${preview.reference_frame_index + 1}`}
          imageUrl={preview.reference_image_data_url}
          preview={preview}
          markerPosition={preview.reference_target_position}
        />
        <PreviewCard
          title="Difference"
          caption="밝은 잔차만 남긴 차분영상"
          imageUrl={preview.difference_image_data_url}
          preview={preview}
          markerPosition={preview.aligned_target_position}
          accentClass="ml-preview-card--difference"
        />
      </div>

      <div className="ml-preview-note">
        <span>
          현재 프레임은 <strong>{preview.site_label}</strong>의 <code>{frameMetadata.observation_id}</code> 입니다.
          기준 프레임은 HJD {preview.reference_hjd.toFixed(4)}의 <code>{preview.reference_observation_id}</code> 입니다.
          현재 메타데이터는 <strong>{frameMetadata.filter_band ?? 'I'}-band</strong>, <strong>{frameMetadata.exposure_sec?.toFixed(0) ?? '120'} s</strong> 입니다.
        </span>
        <span>
          차분영상에서는 정렬된 현재 프레임과 reference를 비교하므로, 변하지 않는 별이 대부분 사라지고 기준영상보다 밝아진 위치만 강하게 남습니다.
          {frameLoading ? ' 새 프레임을 불러오는 중입니다…' : ''}
        </span>
      </div>
    </section>
  );
}
