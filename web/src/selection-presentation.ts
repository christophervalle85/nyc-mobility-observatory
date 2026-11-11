/** Local selection feedback stays available while streamed detail catches up. */
export function selectionPresentation(selected:number|null,includesNewark:boolean,detailReady:boolean):{outlineId:number|null;fillId:number|null} {
  const outlineId = selected === 1 && !includesNewark ? null : selected;
  return {outlineId,fillId:detailReady ? outlineId : null};
}
