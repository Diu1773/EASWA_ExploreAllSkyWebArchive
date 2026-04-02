import { useAppStore } from '../../stores/useAppStore';

interface SliderConfig {
  min: number;
  max: number;
  step: number;
}

interface ParamsPanelProps {
  title?: string;
  apertureConfig?: SliderConfig;
  innerConfig?: SliderConfig;
  outerConfig?: SliderConfig;
}

const DEFAULT_APERTURE = { min: 1, max: 20, step: 0.5 };
const DEFAULT_INNER = { min: 5, max: 30, step: 0.5 };
const DEFAULT_OUTER = { min: 10, max: 40, step: 0.5 };

export function ParamsPanel({
  title = 'Photometry Parameters',
  apertureConfig = DEFAULT_APERTURE,
  innerConfig = DEFAULT_INNER,
  outerConfig = DEFAULT_OUTER,
}: ParamsPanelProps) {
  const aperture = useAppStore((s) => s.apertureRadius);
  const inner = useAppStore((s) => s.innerAnnulus);
  const outer = useAppStore((s) => s.outerAnnulus);
  const setAperture = useAppStore((s) => s.setApertureRadius);
  const setInner = useAppStore((s) => s.setInnerAnnulus);
  const setOuter = useAppStore((s) => s.setOuterAnnulus);

  return (
    <div className="params-panel">
      <h4>{title}</h4>
      <div className="param-row">
        <label>
          Aperture Radius: <strong>{aperture.toFixed(1)} px</strong>
        </label>
        <input
          type="range"
          min={apertureConfig.min}
          max={apertureConfig.max}
          step={apertureConfig.step}
          value={aperture}
          onChange={(e) => setAperture(parseFloat(e.target.value))}
        />
        <span className="param-hint">
          Larger = more light captured, less noise
        </span>
      </div>
      <div className="param-row">
        <label>
          Inner Annulus: <strong>{inner.toFixed(1)} px</strong>
        </label>
        <input
          type="range"
          min={innerConfig.min}
          max={innerConfig.max}
          step={innerConfig.step}
          value={inner}
          onChange={(e) => setInner(parseFloat(e.target.value))}
        />
      </div>
      <div className="param-row">
        <label>
          Outer Annulus: <strong>{outer.toFixed(1)} px</strong>
        </label>
        <input
          type="range"
          min={outerConfig.min}
          max={outerConfig.max}
          step={outerConfig.step}
          value={outer}
          onChange={(e) => setOuter(parseFloat(e.target.value))}
        />
      </div>
    </div>
  );
}
