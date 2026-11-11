import type { AreaTarget } from './zones.ts';
export interface FocusOrientation {heading:number;pitch:number}
/** Keep the user's viewing direction; Cesium chooses the flight height. */
export function focusView(target:AreaTarget,orientation:FocusOrientation,duration:number):FocusOrientation&{range:number;duration:number} {
  return {heading:orientation.heading,pitch:orientation.pitch,range:target.range,duration};
}
