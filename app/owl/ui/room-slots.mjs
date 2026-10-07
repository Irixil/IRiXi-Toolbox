export const LEGACY_SLOTS=Object.freeze(['lamp','rug','chair','plant','accessory']);
export const BASE_SLOTS=Object.freeze([...LEGACY_SLOTS,'wall-art','floor-light','foreground-plant','pendant','side-furniture','tabletop']);
export const DECOR_SLOTS=Object.freeze(['portable-light','corner-vine-left','corner-vine-right','corner-curtain-left','corner-curtain-right','string-lights']);
export const SLOTS=Object.freeze([...BASE_SLOTS,...DECOR_SLOTS]);
export const DEFAULTS=Object.freeze(Object.fromEntries(SLOTS.map(slot=>[slot,slot==='chair'?'stool':slot==='accessory'?'red-scarf':null])));
