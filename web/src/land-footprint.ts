import {resolveZone,zoneExtent} from './zones.ts';
import type {ZoneCollection} from './zones.ts';
import {studyFootprint} from './study-footprint.ts';
import type {FootprintState} from './study-footprint.ts';

export interface LandPolygon {name:string;ring:number[][];holes?:number[][][]}
export interface LandFootprint {polygons:LandPolygon[];vertices:number}
const SOURCE='NYC DCP water-excluded borough boundaries 26c';
const MAX_POLYGONS=128,MAX_VERTICES=8192;
function record(value:unknown):value is Record<string,unknown>{return typeof value==='object'&&value!==null&&!Array.isArray(value);}
function parsePolygons(input:unknown):LandFootprint|undefined {
  if(!Array.isArray(input)||input.length===0||input.length>MAX_POLYGONS)return undefined;
  let vertices=0;
  function ring(input:unknown):number[][]|undefined {
    if(!Array.isArray(input)||input.length<3||input.length>MAX_VERTICES-vertices)return undefined;
    const output:number[][]=[],distinct=new Set<string>();
    for(const point of input){
      if(!Array.isArray(point)||point.length!==2)return undefined;
      const [longitude,latitude]=point;
      if(typeof longitude!=='number'||typeof latitude!=='number'||!Number.isFinite(longitude)||!Number.isFinite(latitude)||longitude< -74.3||longitude> -73.6||latitude<40.45||latitude>40.95)return undefined;
      distinct.add(`${longitude},${latitude}`);output.push([longitude,latitude]);
    }
    if(distinct.size<3)return undefined;
    vertices+=output.length;return output;
  }
  const polygons:LandPolygon[]=[];
  for(const inputPolygon of input){
    if(!record(inputPolygon)||typeof inputPolygon.name!=='string'||!inputPolygon.name.trim()||inputPolygon.name.length>96)return undefined;
    const outer=ring(inputPolygon.ring);if(!outer)return undefined;
    const polygon:LandPolygon={name:inputPolygon.name,ring:outer};
    if(inputPolygon.holes!==undefined){
      if(!Array.isArray(inputPolygon.holes)||inputPolygon.holes.length>Math.floor(MAX_VERTICES/3))return undefined;
      polygon.holes=[];
      for(const inputHole of inputPolygon.holes){const hole=ring(inputHole);if(!hole)return undefined;polygon.holes.push(hole);}
    }
    polygons.push(polygon);
  }
  return {polygons,vertices};
}
/** Coordinate/budget validation only; fixed source topology is verified offline. */
export function parseLandFootprint(input:unknown):LandFootprint|undefined {
  if(!record(input)||input.version!==1||input.source!==SOURCE)return undefined;
  return parsePolygons(input.polygons);
}

/** Candidate mask never substitutes the old convex city hulls on failure. */
export function landFootprintMask(geography:ZoneCollection,land:LandFootprint|undefined,supported:boolean,replace:(polygons:LandPolygon[])=>void,disable:()=>void){
  const parsed=land&&parsePolygons(land.polygons);
  const base=parsed&&parsed.vertices===land?.vertices?parsed:undefined;
  let available=Boolean(supported&&base),includesNewark=false,disabled=false;
  function unavailable(){available=false;if(!disabled){disabled=true;try{disable();}catch{/* State must remain truthful even if renderer teardown fails. */}}}
  function apply(polygons:LandPolygon[]){
    if(!available)return;
    try{replace(polygons);}catch{unavailable();}
  }
  if(available&&base)apply(base.polygons);else unavailable();
  return {
    state():FootprintState{return {kind:available?(includesNewark?'newark':'city'):'unavailable',includesNewark};},
    newark(){
      if(includesNewark)return;
      const airport=resolveZone(geography,1);
      includesNewark=Boolean(airport&&airport.properties.borough==='EWR'&&zoneExtent(airport));
      if(!includesNewark){unavailable();return;}
      if(!available||!base)return;
      // This source-only legacy hull is computed solely on explicit airport focus.
      const extension=studyFootprint(geography,true)?.polygons.at(-1);
      if(!extension||extension.name!=='Newark airport'){unavailable();return;}
      const combined=parsePolygons([...base.polygons,extension]);
      if(!combined){unavailable();return;}
      apply(combined.polygons);
    },
    city(){if(!includesNewark)return;includesNewark=false;if(available&&base)apply(base.polygons);},
  };
}
