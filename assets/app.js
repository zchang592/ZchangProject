
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.0/+esm';
const SB_URL='https://skneweesbyybsuggsvyw.supabase.co', SB_KEY='sb_publishable_kEhNeMVS8C5BwZZk8Tg1Tw_E_OBjt9K';
const db=createClient(SB_URL,SB_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});
let all=[], decisions={}, currentUser=null, activeFilter='open', query='', pendingAction=null, toastTimeout, refreshPromise=null;
const saving=new Set();
let returnFocus=null;
const $=id=>document.getElementById(id);
const safe=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function bjtToday(){const p=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());const m={};p.forEach(t=>m[t.type]=t.value);return m.year+'-'+m.month+'-'+m.day;}
function formatDate(d){if(!d)return '日期待核实';const a=d.split('-');return a[0]+'.'+a[1]+'.'+a[2];}
function statusFor(id){return decisions[id]||'pending'}
function overdue(r){if(!r.deadline_bjt_date)return false;if(r.deadline_precision==='exact'&&r.deadline_bjt_time)return Date.parse(r.deadline_bjt_date+'T'+r.deadline_bjt_time+'+08:00')<Date.now();return r.deadline_bjt_date<bjtToday();}
function daysLeft(r){return r.deadline_bjt_date?Math.round((Date.parse(r.deadline_bjt_date+'T00:00:00+08:00')-Date.parse(bjtToday()+'T00:00:00+08:00'))/86400000):null;}
function dateOrder(a,b){return (a.deadline_bjt_date||'9999-12-31').localeCompare(b.deadline_bjt_date||'9999-12-31')||(a.deadline_bjt_time||'23:59:59').localeCompare(b.deadline_bjt_time||'23:59:59')||a.title.localeCompare(b.title);}
function precisionLabel(r){return r.deadline_precision==='exact'&&r.deadline_bjt_time?'北京时间 '+r.deadline_bjt_time.slice(0,5):r.deadline_precision==='estimate'?'建议提交日 · 非精确截止':'具体时刻 / 时区未公布';}
function totalFee(r){return Number(r.application_fee||0)+Number(r.compulsory_fee||0);}
function sourceLabel(r){try{return new URL(r.source_url).hostname.replace(/^www\./,'')}catch{return '项目来源'}}
function moveIndicator(){const el=document.querySelector('.tab.active'),indicator=document.querySelector('.tab-indicator');if(el&&indicator){indicator.style.width=el.offsetWidth+'px';indicator.style.transform='translateX('+el.offsetLeft+'px)';}}
function setFilter(view){activeFilter=view;document.querySelectorAll('.tab').forEach(el=>{const active=el.dataset.filter===view;el.classList.toggle('active',active);el.setAttribute('aria-selected',String(active));el.tabIndex=active?0:-1});render();}
function openDetail(id){const r=all.find(x=>x.id===id);if(!r)return;$('detailTitle').textContent=r.title;$('detailGrid').innerHTML=[['截止日期 · 北京',formatDate(r.deadline_bjt_date)+' · '+precisionLabel(r)],['申请 + 强制参与费',totalFee(r)===0?'0 · 免费':totalFee(r)+' '+r.currency],['编制',r.instrumentation||'主办方未指定'],['作品时长',r.duration_text||'主办方未指定']].map(([k,v])=>'<dl><dt>'+safe(k)+'</dt><dd>'+safe(v)+'</dd></dl>').join('');$('detailNotes').textContent=r.notes||'请查阅主办方完整规则。';$('detailSource').href=r.source_url?.startsWith('https://')?r.source_url:'#';$('detailDialog').showModal();}
function updateNext(){const next=all.filter(r=>!overdue(r)&&!['applied','rejected'].includes(statusFor(r.id))&&r.deadline_bjt_date).sort(dateOrder)[0];if(!next){$('nextDate').innerHTML='—<span>暂无待跟进截止日期</span>';$('nextProject').innerHTML='<span>下一次机会，等待发现</span>';$('nextProject').disabled=true;$('nextCountdown').textContent='可在历史记录中查看旧机会';$('nextProgress').style.width='0';return;}const d=next.deadline_bjt_date.split('-'),n=daysLeft(next);$('nextDate').innerHTML=d[1]+'.'+d[2]+'<span>'+d[0]+'</span>';$('nextProject').innerHTML='<span>'+safe(next.title)+'</span><span>↗</span>';$('nextProject').disabled=false;$('nextProject').onclick=()=>openDetail(next.id);$('nextCountdown').textContent=(n===0?'今天':n===1?'明天':n+' 天后')+(next.deadline_precision==='exact'?'截止':' · 建议提前提交');$('nextProgress').style.width=Math.max(4,100-Math.min(n,45)/45*100)+'%';}

function toast(message){$('toast').textContent=message;$('toast').classList.add('show');clearTimeout(toastTimeout);toastTimeout=setTimeout(()=>$('toast').classList.remove('show'),3600);}
function render(){
const c={open:0,hold:0,applied:0,rejected:0};
all.forEach(r=>{const s=statusFor(r.id);if(s==='hold')c.hold++;if(s==='applied')c.applied++;if(s==='rejected')c.rejected++;if(!['applied','rejected'].includes(s)&&!overdue(r))c.open++;});
$('countOpen').textContent=c.open;$('countHold').textContent=c.hold;$('countApplied').textContent=c.applied;$('countRejected').textContent=c.rejected;$('totalBadge').textContent=all.length;
document.querySelectorAll('[data-count]').forEach(el=>el.textContent=c[el.dataset.count]||0);
const rows=all.filter(r=>{const s=statusFor(r.id),exp=overdue(r);let filter=activeFilter==='open'?(s==='pending'||s==='hold')&&!exp:activeFilter==='hold'?s==='hold':activeFilter==='applied'?s==='applied':activeFilter==='rejected'?s==='rejected':activeFilter==='expired'?exp&&(s==='pending'||s==='hold'):true;const match=(r.title+' '+r.instrumentation+' '+r.duration_text+' '+r.notes).toLowerCase().includes(query.toLowerCase().trim());return filter&&match;}).sort(dateOrder);
$('rowSummary').textContent='当前 '+rows.length+' 条 · 共 '+all.length+' 条 · 截止日由近到远';
updateNext();requestAnimationFrame(moveIndicator);
if(!rows.length){$('tbody').innerHTML='<tr><td colspan="5" class="empty"><strong>'+({open:'暂无待跟进机会',hold:'暂时没有 On hold 项目',applied:'你的下一次申请，从这里开始',rejected:'暂时没有排除的项目',expired:'暂无已截止机会',all:'暂无项目'}[activeFilter])+'</strong>'+(query?'尝试其他项目名或乐器名称':activeFilter==='applied'?'点击项目旁的 ✓，申请记录会保存在这里':'切换分类查看其他机会')+'</td></tr>';return;}
$('tbody').innerHTML=rows.map(r=>{
const s=statusFor(r.id),exp=overdue(r),n=daysLeft(r),isSaving=saving.has(r.id);
const stLabel={pending:'待处理',applied:'已报名 · 已归档',hold:'On hold · 继续跟进',rejected:'不要 · 不再推荐'}[s];
const detail=(r.verified==='verified'?'<i class="verified-dot" title="规则已核验"></i>':'<span class="needs-check">待复核</span>')+'<span class="source-name">'+safe(sourceLabel(r))+'</span><button class="details-button" data-detail="'+r.id+'" aria-label="查看 '+safe(r.title)+' 详情">详情 ↗</button>';
const src=r.source_url?.startsWith('https://')?r.source_url:'#';
return '<tr><td class="project"><a target="_blank" rel="noopener noreferrer" href="'+safe(src)+'">'+safe(r.title)+' <span aria-hidden="true">↗</span></a><div class="detail">'+detail+'</div></td>'+
'<td><div class="date">'+safe(formatDate(r.deadline_bjt_date))+'</div><div class="dateInfo '+(exp?'overdue':'')+'">'+(exp?'已截止 · ':'')+safe(precisionLabel(r))+'</div>'+(!exp&&n!==null&&n<=14?'<span class="urgency '+(n<=7?'soon':'')+'">'+(n===0?'今天':n===1?'明天':n+' 天后')+(r.deadline_precision==='exact'?'截止':' · 建议提交')+'</span>':'')+'</td>'+
'<td><div class="config">'+safe(r.instrumentation||'主办方未指定')+'</div><div class="duration">'+safe(r.duration_text||'主办方未指定')+'</div></td>'+
'<td><div class="fee">'+(totalFee(r)===0?'0':safe(totalFee(r))+' '+safe(r.currency))+'<small>'+ (totalFee(r)===0?'免费':'申请＋参与费') +'</small></div></td>'+
'<td><div class="state">'+[['yes','applied','✓','已报名'],['hold','hold','—','On hold'],['no','rejected','×','不要']].map(([cls,status,symbol,label])=>'<button class="'+cls+' '+(s===status?'active':'')+'" data-id="'+r.id+'" data-status="'+status+'" title="'+symbol+' '+label+'" aria-label="'+safe(r.title)+' 标记'+label+'" aria-pressed="'+(s===status)+'" '+(isSaving?'disabled':'')+'>'+symbol+'</button>').join('')+'</div><span class="stateWord">'+safe(isSaving?'正在保存…':stLabel)+'</span></td></tr>';
}).join('');
}
async function refresh(){
if(refreshPromise)return refreshPromise;
if(saving.size)return false;
refreshPromise=(async()=>{
$('syncStatus').textContent='同步中…';$('refreshBtn').disabled=true;$('refreshBtn').classList.add('is-refreshing');
try{
const {data,error}=await db.from('composer_opportunities').select('*').order('deadline_bjt_date',{ascending:true});if(error)throw error;
all=data||[];await refreshDecisions();render();$('syncDot').classList.remove('error');$('syncStatus').textContent='已同步 '+new Date().toLocaleTimeString('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit'});return true;
}catch(error){if(!all.length)$('tbody').innerHTML='<tr><td colspan="5" class="empty"><strong>暂时无法读取机会</strong>'+safe(error.message)+'<br>点击上方刷新重试</td></tr>';$('syncStatus').textContent='同步失败，保留已有清单';$('syncDot').classList.add('error');return false;
}finally{$('refreshBtn').disabled=false;$('refreshBtn').classList.remove('is-refreshing');}
})();
try{return await refreshPromise;}finally{refreshPromise=null;}
}
async function refreshDecisions(){
if(!currentUser){decisions={};return;}
const {data,error}=await db.from('composer_decisions').select('opportunity_id,status').eq('user_id',currentUser.id);
if(error){toast('无法读取个人状态：'+error.message);return;}
const next={};(data||[]).forEach(r=>next[r.opportunity_id]=r.status);decisions=next;
}
async function changeStatus(id,requested){
if(!currentUser){pendingAction={id,requested};showModal();return;}if(saving.has(id))return;
const next=statusFor(id)===requested?'pending':requested;saving.add(id);render();
try{const {error}=await db.from('composer_decisions').upsert({user_id:currentUser.id,opportunity_id:id,status:next,updated_at:new Date().toISOString()},{onConflict:'user_id,opportunity_id'});if(error)throw error;decisions[id]=next;toast('已云端保存：'+({applied:'✓ 已报名',hold:'— On hold',rejected:'× 不要',pending:'恢复待处理'}[next]));}catch(error){toast('保存失败：'+error.message);}finally{saving.delete(id);render();}
}
function showModal(){returnFocus=document.activeElement;$('authError').textContent='';$('loginModal').hidden=false;$('authEmail').focus();}
function hideModal(){$('loginModal').hidden=true;returnFocus?.focus();}
function updateLogin(){ $('loginBtn').textContent=currentUser?'退出登录':'登录';$('syncStatus').textContent=currentUser?'登录状态 · 云端同步':'未登录 · 项目可查看、状态只读';}
document.querySelectorAll('.tab').forEach(el=>{el.setAttribute('aria-selected',String(el.dataset.filter===activeFilter));el.tabIndex=el.dataset.filter===activeFilter?0:-1;el.addEventListener('click',()=>setFilter(el.dataset.filter));});
$('search').addEventListener('input',e=>{query=e.target.value;render();});
$('tbody').addEventListener('click',e=>{const btn=e.target.closest('button[data-id]');if(btn)changeStatus(Number(btn.dataset.id),btn.dataset.status);const detail=e.target.closest('button[data-detail]');if(detail)openDetail(Number(detail.dataset.detail));});
$('loginBtn').addEventListener('click',async()=>{if(currentUser){await db.auth.signOut();currentUser=null;decisions={};pendingAction=null;updateLogin();render();toast('已退出登录');}else showModal();});
$('closeModal').addEventListener('click',()=>{pendingAction=null;hideModal();});
$('loginModal').addEventListener('click',e=>{if(e.target===$('loginModal')){pendingAction=null;hideModal()}});
$('authForm').addEventListener('submit',async e=>{e.preventDefault();$('authError').textContent='正在登录…';const {data,error}=await db.auth.signInWithPassword({email:$('authEmail').value.trim(),password:$('authPassword').value});if(error){$('authError').textContent=error.message;return;}currentUser=data.user;hideModal();updateLogin();await refreshDecisions();render();if(pendingAction){const p=pendingAction;pendingAction=null;await changeStatus(p.id,p.requested);}else toast('登录成功，个人状态已同步');});
$('signupBtn').addEventListener('click',async()=>{const email=$('authEmail').value.trim(),password=$('authPassword').value;if(!email||password.length<6){$('authError').textContent='请输入邮箱和至少6位密码';return;}$('authError').textContent='正在注册…';const {data,error}=await db.auth.signUp({email,password});if(error){$('authError').textContent=error.message;return;}$('authError').textContent=data.session?'注册成功，可以开始使用':(data.user?.identities?.length===0?'邮箱可能已注册，请使用上方登录按钮':'已提交注册。如果未收到邮件，请联系管理员检查 SMTP 设置');});
$('exportCsv').addEventListener('click',()=>{
const rows=[['项目名字','截止日期_北京时间','截止时刻','编制','时长','费用','状态','来源链接','规则核验']];
[...all].sort(dateOrder).forEach(r=>rows.push([r.title,r.deadline_bjt_date||'',precisionLabel(r),r.instrumentation,r.duration_text,String(totalFee(r)),statusFor(r.id),r.source_url,r.verified]));
const csv='\uFEFF'+rows.map(r=>r.map(v=>'"'+String(v??'').replace(/"/g,'""')+'"').join(',')).join('\r\n');
const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'}),u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download='composer-opportunities.csv';a.click();URL.revokeObjectURL(u);
});
(async()=>{try{const {data}=await db.auth.getSession();currentUser=data.session?.user||null;}catch(e){currentUser=null;}updateLogin();await refresh();})();
db.auth.onAuthStateChange((ev,session)=>{if(ev==='SIGNED_OUT'){currentUser=null;decisions={};updateLogin();render();}else if(ev==='SIGNED_IN'&&session?.user&&session.user.id!==currentUser?.id){currentUser=session.user;updateLogin();setTimeout(()=>refresh(),0);}});

/* Appearance is a local device preference; opportunity states remain in Supabase. */
const themeStorageKey='composer-opportunities-theme';
function getPreferredTheme(){try{const t=localStorage.getItem(themeStorageKey);if(t==='light'||t==='dark')return t;}catch(_){}return matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}
function setTheme(t,save=true){
document.documentElement.dataset.theme=t;
$('themeIcon').textContent=t==='dark'?'☀':'☾';
$('themeLabel').textContent=t==='dark'?'浅色':'深色';
$('themeToggle').setAttribute('aria-label',t==='dark'?'切换为浅色模式':'切换为深色模式');
document.querySelector('meta[name="theme-color"]').setAttribute('content',t==='dark'?'#11161b':'#edf0f3');
if(save){try{localStorage.setItem(themeStorageKey,t)}catch(_){}}
}
setTheme(getPreferredTheme(),false);
$('themeToggle').addEventListener('click',()=>setTheme(document.documentElement.dataset.theme==='dark'?'light':'dark'));
$('refreshBtn').addEventListener('click',async()=>{if(await refresh())toast('机会清单已从云端更新');});
let lastCloudRefresh=Date.now();
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&Date.now()-lastCloudRefresh>60000){lastCloudRefresh=Date.now();refresh();}});


// Refresh the open page; this never schedules research or changes user decisions.
setInterval(()=>{if(!document.hidden&&$('loginModal').hidden&&!$('detailDialog').open)refresh();},60000);
document.querySelectorAll('.stat').forEach(el=>el.addEventListener('click',()=>{setFilter(el.dataset.view);$('opportunitySheet').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'instant':'smooth',block:'start'});}));
new ResizeObserver(moveIndicator).observe(document.querySelector('.tabs'));
$('closeDetail').addEventListener('click',()=>$('detailDialog').close());
$('detailDialog').addEventListener('click',e=>{if(e.target===$('detailDialog')){const r=$('detailDialog').getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)$('detailDialog').close();}});
if(!/Mac|iPhone|iPad/.test(navigator.platform))$('searchShortcut').textContent='Ctrl K';
document.addEventListener('keydown',e=>{
if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'&&$('loginModal').hidden&&!$('detailDialog').open){e.preventDefault();$('search').focus();}
if(!$('loginModal').hidden){if(e.key==='Escape'){e.preventDefault();pendingAction=null;hideModal();}if(e.key==='Tab'){const focusables=[...$('loginModal').querySelectorAll('input,button')].filter(el=>!el.disabled);const first=focusables[0],last=focusables.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}}}
const focused=e.target.closest('.tab');if(focused&&['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const tabs=[...document.querySelectorAll('.tab')],i=tabs.indexOf(focused),n=e.key==='Home'?0:e.key==='End'?tabs.length-1:(i+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;setFilter(tabs[n].dataset.filter);tabs[n].focus();}
});
