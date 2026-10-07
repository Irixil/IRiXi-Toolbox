// Fixed local asset contract. Parent supplies registered original-style PNGs.
// Change ready only after materialization, provenance and actual visual review.
export const OUTFIT_PACK = Object.freeze({ ready: true, version: 'owl-p0-equipment-assets-v1' });
export const OUTFIT_FILES = Object.freeze({
  glassesFront: ['glasses-front.png',800,520],glassesUp: ['glasses-up.png',800,520],
  glassesLeft30: ['glasses-left30.png',800,520],glassesLeft60: ['glasses-left60.png',800,520],
  glassesRight30: ['glasses-right30.png',800,520],glassesRight60: ['glasses-right60.png',800,520],
  chairBack: ['reading-chair-back.png',1254,1254],chairFront: ['reading-chair-front.png',1254,1254],
});
export async function loadOutfitAssets(loadImage,pack=OUTFIT_PACK){
  if(!pack.ready)return {images:{},missing:Object.keys(OUTFIT_FILES)};
  const entries=Object.entries(OUTFIT_FILES),results=await Promise.allSettled(entries.map(async([key,[name,w,h]])=>{
    const image=await loadImage('./assets/outfit/'+name);
    if(image.naturalWidth!==w||image.naturalHeight!==h)throw Error('配饰素材尺寸不匹配');
    return [key,image];
  }));
  return {images:Object.fromEntries(results.filter(r=>r.status==='fulfilled').map(r=>r.value)),missing:entries.filter((_e,i)=>results[i].status==='rejected').map(e=>e[0])};
}
