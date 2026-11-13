import type { OverviewTarget } from './study-footprint.ts';

export interface StagePose { pivot: OverviewTarget; heading: number; pitch: number; range: number }
export interface StageCameraPort { lookAt(pose: StagePose): void; reset(): void }

export function stageNavigation(camera: StageCameraPort) {
  function apply(pose: StagePose) {
    try {
      camera.lookAt(pose);
      return true;
    } catch {
      return false;
    } finally {
      try { camera.reset(); } catch { /* Best effort to leave the world transform in place. */ }
    }
  }

  return {
    opening(pivot: OverviewTarget) {
      return apply({ pivot, heading: -Math.PI / 6, pitch: -Math.PI * 40 / 180, range: pivot.range });
    },
    overview(pivot: OverviewTarget) {
      return apply({ pivot, heading: Math.PI / 12, pitch: -Math.PI * 35 / 180, range: pivot.range });
    },
  };
}
