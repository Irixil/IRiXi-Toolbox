// Room display only: original 900x1000 rig and its pose animation remain unchanged.
export const ROLE_DISPLAY=Object.freeze({scale:.64,offset:[224,458.2],seatSource:[450,745],seatWorld:[512,935]});
export function sourceToRoom(point,display=ROLE_DISPLAY){return {x:display.offset[0]+point.x*display.scale,y:display.offset[1]+point.y*display.scale};}
export function roomToSource(point,display=ROLE_DISPLAY){return {x:(point.x-display.offset[0])/display.scale,y:(point.y-display.offset[1])/display.scale};}
