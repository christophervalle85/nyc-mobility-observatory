import {zoneExtent} from './zones.ts';
import type{Ring,ZoneCollection}from'./zones.ts';
function inRing(ring:Ring,x:number,y:number){
 let inside=false;
 for(let i=0,j=ring.length-1;i<ring.length;j=i++){
  const[a,b]=ring[j],[c,d]=ring[i];
  const cross=(x-a)*(d-b)-(y-b)*(c-a);
  if(Math.abs(cross)<1e-10&&x>=Math.min(a,c)&&x<=Math.max(a,c)&&y>=Math.min(b,d)&&y<=Math.max(b,d))return true;
  if((b>y)!==(d>y)&&x<(c-a)*(y-b)/(d-b)+a)inside=!inside;
 }
 return inside;
}
export function zonePicker(geography:ZoneCollection){
 const indexed=geography.features.map(zone=>({zone,extent:zoneExtent(zone)})).filter(item=>item.extent).sort((a,b)=>a.zone.id-b.zone.id);
 return{pick(longitude:number,latitude:number){
  if(!Number.isFinite(longitude)||!Number.isFinite(latitude))return undefined;
  for(const{zone,extent}of indexed){
   if(!extent||longitude<extent.west||longitude>extent.east||latitude<extent.south||latitude>extent.north)continue;
   const polygons=zone.geometry.type==='Polygon'?[zone.geometry.coordinates]:zone.geometry.coordinates;
   if(polygons.some(rings=>inRing(rings[0],longitude,latitude)&&!rings.slice(1).some(ring=>inRing(ring,longitude,latitude))))return zone;
  }
  return undefined;
 }};
}
