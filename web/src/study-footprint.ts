import { parseZones, zoneExtent, resolveZone } from './zones.ts';
import type { Ring, ZoneCollection } from './zones.ts';
export type FootprintStatus = 'city' | 'newark' | 'unavailable';
export interface FootprintPolygon { name: string; ring: Ring }
export interface StudyFootprint { polygons: FootprintPolygon[]; vertices: number }
const boroughs = ['Bronx', 'Brooklyn', 'Manhattan', 'Queens', 'Staten Island'];
function hull(points: Ring): Ring {
  const unique = new Map(points.map(([x,y]) => [`${x},${y}`, [x,y]]));
  const sorted = [...unique.values()].sort((a,b) => a[0]-b[0] || a[1]-b[1]);
  if (sorted.length < 3) return [];
  const cross = (a:number[],b:number[],c:number[]) => (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  const half = (values:Ring) => { const result:Ring=[];for(const point of values){while(result.length>=2&&cross(result[result.length-2],result[result.length-1],point)<=0)result.pop();result.push(point);}return result; };
  const lower=half(sorted),upper=half([...sorted].reverse());lower.pop();upper.pop();return [...lower,...upper];
}
export function studyFootprint(geography: ZoneCollection, includeNewark = false): StudyFootprint | undefined {
  try { parseZones(geography); } catch { return undefined; }
  const groups = new Map<string,Ring>(boroughs.map(name=>[name,[]]));
  if(includeNewark)groups.set('Newark airport',[]);
  for(const zone of geography.features){
    const name=zone.id===1&&zone.properties.borough==='EWR'?'Newark airport':zone.properties.borough;
    const points=groups.get(name);if(!points)continue;
    const polygons=zone.geometry.type==='Polygon'?[zone.geometry.coordinates]:zone.geometry.coordinates;
    for(const polygon of polygons)for(const [x,y] of polygon[0])points.push([x,y]);
  }
  const polygons=[...groups].map(([name,points])=>({name,ring:hull(points)}));
  const vertices=polygons.reduce((sum,polygon)=>sum+polygon.ring.length,0);
  if(polygons.length>6||vertices>384||polygons.some(p=>p.ring.length<3))return undefined;
  return {polygons,vertices};
}
export interface OverviewTarget { longitude:number;latitude:number;radius:number;range:number }
export function cityOverview(geography:ZoneCollection,aspect:number,verticalFov:number):OverviewTarget|undefined {
  const city=geography.features.filter(zone=>boroughs.includes(zone.properties.borough));
  if(new Set(city.map(zone=>zone.properties.borough)).size!==5)return undefined;
  return fitOverview(city,aspect,verticalFov);
}
/** Opening composition uses local TLC extents around the Midtown skyline. */
export function skylineOpening(geography:ZoneCollection,aspect:number,verticalFov:number):OverviewTarget|undefined {
  const ids = new Set([161,162,163,164,230]);
  const skyline = geography.features.filter(zone=>ids.has(zone.id)&&zone.properties.borough==='Manhattan');
  if(new Set(skyline.map(zone=>zone.id)).size!==ids.size)return undefined;
  const target=fitOverview(skyline,aspect,verticalFov);
  return target && target.range<=40000 ? target : undefined;
}
function fitOverview(city:ZoneCollection['features'],aspect:number,verticalFov:number):OverviewTarget|undefined {
  let west=Infinity,south=Infinity,east=-Infinity,north=-Infinity;
  for(const zone of city){const extent=zoneExtent(zone);if(!extent)return undefined;west=Math.min(west,extent.west);south=Math.min(south,extent.south);east=Math.max(east,extent.east);north=Math.max(north,extent.north);}
  const longitude=(west+east)/2,latitude=(south+north)/2;
  const radius=Math.hypot((east-west)*111320*Math.cos(latitude*Math.PI/180),(north-south)*111320)/2;
  const safeAspect=Number.isFinite(aspect)&&aspect>0?Math.min(5,Math.max(.2,aspect)):1;
  const fov=Number.isFinite(verticalFov)&&verticalFov>0?Math.min(Math.PI*2/3,Math.max(Math.PI/18,verticalFov)):Math.PI/3;
  const halfAngle=Math.min(fov/2,Math.atan(Math.tan(fov/2)*safeAspect));
  return {longitude,latitude,radius,range:Math.min(180000,Math.max(200,radius/Math.sin(halfAngle)*1.18))};
}
export interface FootprintState {kind:FootprintStatus;includesNewark:boolean}
export function footprintMask(geography:ZoneCollection,supported:boolean,replace:(polygons:FootprintPolygon[])=>void,disable:()=>void=()=>{}){
 let available=supported,includesNewark=false;
 function apply(include:boolean){
  const airport=resolveZone(geography,1);
  const footprint=studyFootprint(geography,include);includesNewark=include&&Boolean(airport&&zoneExtent(airport));
  if(!footprint){available=false;disable();return;}
  if(!available)return;
  try{replace(footprint.polygons);}catch{available=false;disable();}
 }
 apply(false);
 return{state():FootprintState{return{kind:available?(includesNewark?'newark':'city'):'unavailable',includesNewark}},newark(){if(!includesNewark)apply(true);},city(){if(includesNewark)apply(false);}};
}
export function visibleStudySelection(id:number|null,includesNewark:boolean,imageryReady:boolean){return imageryReady&&id!==null&&(id!==1||includesNewark);}
