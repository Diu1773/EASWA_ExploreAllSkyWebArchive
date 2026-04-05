import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import A from 'aladin-lite';
import type { Target } from '../../types/target';

interface AladinViewerProps {
  targets: Target[];
  onTargetClick: (target: Target) => void;
}

export interface AladinViewerHandle {
  gotoTarget: (target: Target) => Promise<'slewed' | 'already-there'>;
}

const SLEW_ANIMATION_SECONDS = 1.4;
const ZOOM_ANIMATION_SECONDS = 1.1;
const ZOOM_FOV = 6;
const CENTER_EPSILON_DEG = 0.08;
const FOV_EPSILON_DEG = 0.05;

function normalizeRa(ra: number) {
  return ((ra % 360) + 360) % 360;
}

function shortestRaDelta(from: number, to: number) {
  const delta = normalizeRa(to) - normalizeRa(from);
  if (delta > 180) return delta - 360;
  if (delta < -180) return delta + 360;
  return delta;
}

function getViewerCenter(viewer: any): [number, number] | null {
  const value =
    (typeof viewer.getRaDec === 'function' && viewer.getRaDec()) ||
    (typeof viewer.getCenter === 'function' && viewer.getCenter());

  if (Array.isArray(value) && value.length >= 2) {
    return [Number(value[0]), Number(value[1])];
  }

  if (value && typeof value === 'object') {
    if ('ra' in value && 'dec' in value) {
      return [Number(value.ra), Number(value.dec)];
    }
    if ('lon' in value && 'lat' in value) {
      return [Number(value.lon), Number(value.lat)];
    }
  }

  return null;
}

function getViewerFov(viewer: any): number {
  const value =
    (typeof viewer.getFoV === 'function' && viewer.getFoV()) ||
    (typeof viewer.getFov === 'function' && viewer.getFov()) ||
    (typeof viewer.getFieldOfView === 'function' && viewer.getFieldOfView());

  if (Array.isArray(value)) {
    return Math.max(...value.map((entry) => Number(entry)));
  }

  if (typeof value === 'number') {
    return value;
  }

  if (value && typeof value === 'object') {
    const values = Object.values(value)
      .map((entry) => Number(entry))
      .filter((entry) => Number.isFinite(entry));

    if (values.length > 0) {
      return Math.max(...values);
    }
  }

  return 180;
}

export const AladinViewer = forwardRef<AladinViewerHandle, AladinViewerProps>(
function AladinViewer(
  { targets, onTargetClick }: AladinViewerProps,
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const aladinRef = useRef<any>(null);
  const catalogRef = useRef<any>(null);
  const aladinApiRef = useRef<any>(null);
  const onTargetClickRef = useRef(onTargetClick);
  onTargetClickRef.current = onTargetClick;

  useImperativeHandle(ref, () => ({
    gotoTarget: async (target: Target) => {
      const viewer = aladinRef.current;
      if (!viewer) {
        throw new Error('Sky viewer is not ready yet.');
      }

      const setCurrentFov = (value: number) => {
        if (typeof viewer.setFoV === 'function') {
          viewer.setFoV(value);
        } else if (typeof viewer.setFov === 'function') {
          viewer.setFov(value);
        }
      };

      const currentCenter = getViewerCenter(viewer);
      const currentFov = getViewerFov(viewer);
      const isAlreadyCentered =
        currentCenter !== null &&
        Math.abs(shortestRaDelta(currentCenter[0], target.ra)) <= CENTER_EPSILON_DEG &&
        Math.abs(currentCenter[1] - target.dec) <= CENTER_EPSILON_DEG;
      const isAlreadyZoomed = Math.abs(currentFov - ZOOM_FOV) <= FOV_EPSILON_DEG;

      if (isAlreadyCentered) {
        return 'already-there';
      }

      if (typeof viewer.stopAnimation === 'function') {
        viewer.stopAnimation();
      }

      if (!isAlreadyCentered) {
        if (typeof viewer.animateToRaDec === 'function') {
          await new Promise<void>((resolve) => {
            viewer.animateToRaDec(
              target.ra,
              target.dec,
              SLEW_ANIMATION_SECONDS,
              resolve
            );
          });
        } else if (typeof viewer.gotoRaDec === 'function') {
          viewer.gotoRaDec(target.ra, target.dec);
        } else if (typeof viewer.gotoPosition === 'function') {
          viewer.gotoPosition(target.ra, target.dec);
        } else if (typeof viewer.pointTo === 'function') {
          viewer.pointTo(target.ra, target.dec);
        } else {
          throw new Error('This viewer does not support target slewing.');
        }
      }

      if (isAlreadyZoomed) {
        return 'slewed';
      }

      const startFov = getViewerFov(viewer);
      await new Promise<void>((resolve) => {
        const start = performance.now();

        const tick = (now: number) => {
          const progress = Math.min(
            (now - start) / (ZOOM_ANIMATION_SECONDS * 1000),
            1
          );
          const eased =
            progress < 0.5
              ? 4 * progress * progress * progress
              : 1 - Math.pow(-2 * progress + 2, 3) / 2;
          const nextFov = startFov + (ZOOM_FOV - startFov) * eased;
          setCurrentFov(nextFov);

          if (progress < 1) {
            window.requestAnimationFrame(tick);
          } else {
            setCurrentFov(ZOOM_FOV);
            resolve();
          }
        };

        window.requestAnimationFrame(tick);
      });

      return 'slewed';
    },
  }), []);

  // Initialize once
  useEffect(() => {
    let cancelled = false;

    Promise.resolve(A.init)
      .then(() => {
        if (cancelled || !containerRef.current) return;

        aladinApiRef.current = A;
        aladinRef.current = A.aladin(containerRef.current, {
          survey: 'P/DSS2/color',
          fov: 180,
          target: '0 +0',
          projection: 'AIT',
          showReticle: false,
          showLayersControl: false,
          showGotoControl: false,
          showFrame: false,
          showCooGrid: true,
        });

        catalogRef.current = A.catalog({
          name: 'Targets',
          shape: 'circle',
          color: '#ff6600',
          sourceSize: 18,
        });
        aladinRef.current.addCatalog(catalogRef.current);

        aladinRef.current.on('objectClicked', (object: any) => {
          if (object?.data?.id) {
            onTargetClickRef.current(object.data as Target);
          }
        });
      })
      .catch((error) => {
        console.error('Failed to initialize Aladin Lite', error);
      });

    return () => { cancelled = true; };
  }, []);
  // Update markers when targets change
  useEffect(() => {
    if (!catalogRef.current || !aladinApiRef.current) return;
    const api = aladinApiRef.current;

    catalogRef.current.removeAll();
    const sources = targets.map((t) =>
      api.source(t.ra, t.dec, { ...t } as any, {
        popupTitle: t.name,
        popupDesc: `${t.type} | ${t.constellation}`,
      })
    );
    catalogRef.current.addSources(sources);
  }, [targets]);

  return (
    <div className="aladin-shell">
      <div
        ref={containerRef}
        className="aladin-container"
        onContextMenu={(event) => {
          event.preventDefault();
        }}
      />
      <div className="sky-center-reticle" aria-hidden="true">
        <span className="sky-center-reticle-h" />
        <span className="sky-center-reticle-v" />
      </div>
    </div>
  );
});

AladinViewer.displayName = 'AladinViewer';
