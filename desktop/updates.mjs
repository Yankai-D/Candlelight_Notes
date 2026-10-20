const repository='https://github.com/Yankai-D/Candlelight_Notes';
export const releasesURL=repository+'/releases';
function version(value) {
  const match=/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?$/.exec(value || '');
  const pre=match?.[4]?.split('.') || [];
  if(pre.some(part=>!part||/^0\d+$/.test(part)))return null;
  return match ? {numbers:match.slice(1,4).map(BigInt),pre,text:value.replace(/^v/,'')} : null;
}
export function compareVersions(a,b) {
  const left=version(a),right=version(b);if(!left||!right)throw new Error('版本号无效');
  for(let i=0;i<3;i++)if(left.numbers[i]!==right.numbers[i])return left.numbers[i]>right.numbers[i]?1:-1;
  if(!left.pre.length||!right.pre.length)return left.pre.length===right.pre.length?0:left.pre.length?-1:1;
  for(let i=0;i<Math.max(left.pre.length,right.pre.length);i++){
    const x=left.pre[i],y=right.pre[i];if(x===y)continue;if(x===undefined||y===undefined)return x===undefined?-1:1;
    const nx=/^\d+$/.test(x),ny=/^\d+$/.test(y);
    if(nx&&ny)return BigInt(x)>BigInt(y)?1:-1;
    if(nx!==ny)return nx?-1:1;return x>y?1:-1;
  }return 0;
}
export function selectUpdate(releases,currentVersion,{includePrerelease=currentVersion.startsWith('0.')||currentVersion.includes('-')}={}){
  if(!Array.isArray(releases))throw new Error('版本信息格式不正确');
  const candidates=releases.filter(release=>{
    if(release.draft||!release.published_at||!version(release.tag_name)||(!includePrerelease&&(release.prerelease||version(release.tag_name).pre.length)))return false;
    const tag=release.tag_name,v=version(tag).text;
    return release.html_url===`${repository}/releases/tag/${tag}`&&compareVersions(v,currentVersion)>0&&release.assets?.some(asset=>asset.state==='uploaded'&&asset.name===`Candlelight-Notes-${v}-Setup-x64.exe`&&asset.browser_download_url===`${repository}/releases/download/${tag}/${asset.name}`);
  }).sort((a,b)=>compareVersions(b.tag_name,a.tag_name));
  const latest=candidates[0];return latest?{version:version(latest.tag_name).text,url:latest.html_url,prerelease:!!latest.prerelease}:null;
}
export async function checkForUpdate(currentVersion,{fetcher=fetch,signal=AbortSignal.timeout(8000)}={}){
  const response=await fetcher('https://api.github.com/repos/Yankai-D/Candlelight_Notes/releases?per_page=30',{signal,redirect:'error',headers:{Accept:'application/vnd.github+json','User-Agent':'Candlelight-Notes-Update-Check'}});
  if(!response.ok){await response.body?.cancel().catch(()=>{});throw new Error('暂时无法读取公开版本信息');}
  const chunks=[];let size=0;
  for await(const chunk of response.body){size+=chunk.length;if(size>2*1024*1024)throw new Error('版本信息超过读取限制');chunks.push(Buffer.from(chunk));}
  return selectUpdate(JSON.parse(Buffer.concat(chunks).toString('utf8')),currentVersion);
}
