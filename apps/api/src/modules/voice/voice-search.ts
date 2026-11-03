const names:Readonly<Record<string,readonly string[]>>={
  alloy:['晴空','Sky'],echo:['回声','回聲','Echo'],fable:['暖叙','暖敘','Story'],
  nova:['晨星','Nova'],onyx:['曜石','Onyx'],shimmer:['微光','Glow'],
};

/** Search display names alongside the original query; stored content is unchanged. */
export function voiceSearchIds(query:unknown):string[]{
  if(typeof query!=='string')return[];
  const key=query.normalize('NFKC').trim().toLowerCase();if(!key)return[];
  return Object.entries(names).filter(([id,aliases])=>[id,...aliases].some(name=>name.toLowerCase()===key)).map(([id])=>id);
}
