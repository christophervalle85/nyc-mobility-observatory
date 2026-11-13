import type { AreaTarget } from './zones.ts';
export interface FocusOrientation {heading:number;pitch:number}
/** Keep the heading and tilt down enough to see the target from above. */
export function focusView(target:AreaTarget,orientation:FocusOrientation,duration:number):FocusOrientation&{range:number;duration:number} {
  return {heading:orientation.heading,pitch:Math.min(orientation.pitch, -Math.PI / 9),range:target.range,duration};
}
