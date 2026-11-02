import {authorizeDrive, GOOGLE_DRIVE_FOLDER} from './drive.js?v=20261102d';
import {inspectPdf, extractProgrammeNote} from './pdf-tools.js?v=20261102d';

const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
  '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
}[ch]));
const knownDriveUrl = value => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && ['drive.google.com','docs.google.com'].includes(url.hostname) ? url.href : '';
  } catch (_) { return ''; }
};
const httpsUrl = value => { try { const url=new URL(value); return url.protocol==='https:'?url.href:''; } catch (_) { return ''; } };
const fileType = f => f.mime || f.mimeType || '';
const fileName = f => f.name || f.title || '';
const isPdf = f => fileType(f) === 'application/pdf' || /\.pdf$/i.test(fileName(f));
const isAudio = f => /^audio\//i.test(fileType(f)) || /\.(mp3|wav|aiff|m4a|flac)$/i.test(fileName(f));
const isVideo = f => /^video\//i.test(fileType(f)) || /\.(mp4|mov|webm)$/i.test(fileName(f));
const prettySize = n => n ? (Number(n) / 1024 / 1024).toFixed(1) + ' MB' : '大小待确认';
const safeName = text => String(text).replace(/[\\/:*?"<>|\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);

export function initPortfolio({db, getUser, getOpportunity, requestLogin, toast, onChange = () => {}}) {
  let workspace = null, drive = null, detail = null, prep = null;
  let candidate = null, previewUrl = '', busy = false, driveChangesToken = '', categoryIds = [];
  const mediaUrls={score:'',audio:''};
  const verifiedScoreTitles={'1gwSKpuSTXYx4gPnudD9fDY1sbasGTK8e':'Journey to the Fourth'}; 
  const userRequired = () => { if (getUser()) return true; requestLogin(); return false; };
  const works = () => Array.isArray(workspace?.portfolio) ? workspace.portfolio : [];
  const findWork = id => works().find(w => w.folder_id === id);
  const activeAssess = () => workspace?.matches?.[String(detail?.id)] || null;

  async function refresh() {
    const user = getUser();
    if (!user) { clear(); return; }
    const {data, error} = await db.from('composer_personal_workspace').select('portfolio,matches,settings,updated_at').eq('user_id', user.id).maybeSingle();
    if (getUser()?.id !== user.id) return;
    if (error) { toast('无法读取作品库：' + error.message); return; }
    workspace = data;
    if (detail) renderMatches();
    if ($('portfolioDialog').open) renderPortfolio();
  }
  function clear() {
    workspace = null; detail = null; prep = null; candidate = null;
    if (drive) drive.clear(); drive = null;
    driveChangesToken = ''; categoryIds = [];
    if (previewUrl) URL.revokeObjectURL(previewUrl); previewUrl = '';
    for (const id of ['portfolioDialog','prepDialog']) if ($(id).open) $(id).close();
    $('matchPanel').textContent = '';
  }
  async function updateWorkspace(values) {
    const user = getUser();
    if (!user) throw new Error('请先登录。');
    const {data, error} = await db.from('composer_personal_workspace')
      .update({...values, updated_at: new Date().toISOString()})
      .eq('user_id', user.id).select('portfolio,matches,settings,updated_at').single();
    if (error) throw error;
    if (getUser()?.id !== user.id) throw new Error('登录已改变，请重试。');
    workspace = data;
  }
  function renderMatches() {
    const panel = $('matchPanel');
    if (!detail) { panel.textContent = ''; return; }
    if (!getUser()) {
      panel.innerHTML = '<div class="match-heading"><div><span class="eyebrow">YOUR PORTFOLIO</span><h3>与你的作品匹配</h3></div></div><p class="muted">登录后查看作品匹配与投稿准备。</p><button class="btn" data-login type="button">登录查看</button>';
      return;
    }
    if (!workspace) {
      panel.innerHTML = '<div class="match-heading"><div><span class="eyebrow">YOUR PORTFOLIO</span><h3>与你的作品匹配</h3></div></div><p class="muted">作品库暂未读取，请刷新后重试。</p>';
      return;
    }
    const assessment = activeAssess();
    if (!assessment) {
      panel.innerHTML = '<div class="match-heading"><div><span class="eyebrow">YOUR PORTFOLIO</span><h3>与你的作品匹配</h3></div></div><p class="muted">这个机会尚未完成作品匹配。可以先打开作品库或在对话中请求核对。</p>';
      return;
    }
    const cards = (assessment.items || []).map(item => {
      const work = findWork(item.work_id); if (!work) return '';
      const kind = {candidate:'初筛候选', reference:'代表作参考', adaptation:'需改编或确认'}[item.kind] || '待核实';
      const url = knownDriveUrl(work.folder_url);
      return '<article class="match-card"><div class="match-card-top"><span class="match-kind '+esc(item.kind)+'">'+esc(kind)+'</span><span class="work-duration">'+esc(work.duration)+'</span></div>'+
        '<h4>'+esc(work.title)+'</h4><p>'+esc(item.why)+'</p><p class="match-check"><strong>还需确认：</strong>'+esc(item.check)+'</p>'+
        '<div class="match-actions">'+(url?'<a href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">打开作品文件 ↗</a>':'')+
        '<button type="button" data-prep-work="'+esc(work.folder_id)+'">准备这部作品 →</button></div></article>';
    }).join('');
    panel.innerHTML = '<div class="match-heading"><div><span class="eyebrow">YOUR PORTFOLIO</span><h3>与你的作品匹配</h3></div><span class="private-pill">仅登录后可见</span></div>'+
      '<p class="match-summary">'+esc(assessment.summary || '')+'</p>'+
      (cards ? '<div class="match-cards">'+cards+'</div>' : '<p class="no-match">暂未发现可直接推荐的作品。</p>')+
      (assessment.caveat ? '<p class="match-caveat">'+esc(assessment.caveat)+'</p>' : '')+
      '<p class="match-disclaimer">'+(assessment.checked_on?'核对日期：'+esc(assessment.checked_on)+'。':'')+'这是依据已掌握资料的初筛，不代表已确认参赛资格。请核对最新规则、作品版本及版权。 '+
      (httpsUrl(assessment.source)?'<a href="'+esc(httpsUrl(assessment.source))+'" target="_blank" rel="noopener noreferrer">查看核对来源 ↗</a>':'')+'</p>';
  }
  function openDetail(opportunity) { detail = opportunity; renderMatches(); }
  function summaryFor(id) {
    if(!getUser() || !workspace) return null;
    const assessment=workspace.matches?.[String(id)];
    if(!assessment) return {label:'待匹配',titles:[]};
    const candidates=(assessment.items||[]).filter(x=>x.kind==='candidate').map(x=>findWork(x.work_id)).filter(Boolean);
    return {label:candidates.length?'初筛候选':'暂无直接候选',titles:candidates.map(w=>w.title.split(/\s+-\s+for\b|\s+-\s+|[-—]为/i)[0].trim())};
  }

  function renderPortfolio() {
    const panel = $('driveConnection'), settings = workspace?.settings || {};
    const connected = !!drive?.ready();
    panel.innerHTML = '<div class="connection-heading"><div><span class="eyebrow">GOOGLE DRIVE</span><h3>连接与同步</h3></div>'+
      '<span class="connection-status '+(connected?'connected':'')+'">'+(connected?'已连接':'未连接')+'</span></div>'+
      '<p>连接后可读取现有作品文件，并在此网站创建的投稿文件夹中保存副本。原文件不改动；授权仅保存在当前浏览器会话中。</p>'+
      '<details class="oauth-details"><summary>首次设置 Google 授权</summary><div><p>在 Google Cloud 启用 Drive API，配置 OAuth 同意屏幕，在“数据访问”中添加以下两个范围：<code>https://www.googleapis.com/auth/drive.readonly</code> 和 <code>https://www.googleapis.com/auth/drive.file</code>。创建“网页应用”客户端 ID，授权的 JavaScript 来源填写 <code>https://zchang592.github.io</code>；测试模式需把你的 Google 账号加入测试用户。这里只需客户端 ID，不需要客户端密钥。</p>'+
      '<a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener noreferrer">打开 Google Cloud 凭据 ↗</a> · <a href="https://developers.google.com/workspace/drive/api/quickstart/js" target="_blank" rel="noopener noreferrer">查看 Google 官方设置步骤 ↗</a>'+
      '<label for="googleClientId">Google OAuth 客户端 ID</label><div class="connection-input"><input id="googleClientId" type="text" autocomplete="off" spellcheck="false" placeholder="…apps.googleusercontent.com" value="'+esc(settings.google_client_id || '')+'"><button type="button" class="btn" data-save-client>保存 ID</button></div></div></details>'+
      '<div class="connection-actions"><button type="button" class="btn '+(!connected?'primary':'')+'" data-connect>'+(connected?'重新授权':'连接 Google Drive')+'</button>'+
      '<button type="button" class="btn" data-sync '+(!connected?'disabled':'')+'>同步作品文件</button>'+
      (connected?'<button type="button" class="btn quiet" data-disconnect>断开</button>':'')+'</div>'+
      '<p class="connection-note">连接期间，网页每分钟检查作品目录变更。请将新作品放入“作曲作品精选／分类／作品文件夹”；编制、时长和机会匹配仍需核实。关闭页面或授权过期后不会后台同步。</p><p id="driveFeedback" role="status" class="muted"></p>';
    const term = $('workSearch').value.trim().toLowerCase();
    const filtered = works().filter(w => [w.title,w.instrumentation,w.year].some(x => String(x||'').toLowerCase().includes(term)));
    $('portfolioList').innerHTML = filtered.length ? filtered.map(work => {
      const folder = knownDriveUrl(work.folder_url), files = Array.isArray(work.files) ? work.files : [];
      return '<details class="portfolio-work"><summary><span><strong>'+esc(work.title)+'</strong><small>'+esc(work.instrumentation)+'</small></span><span aria-hidden="true">＋</span></summary>'+
      '<div class="portfolio-work-body"><div class="work-facts"><span>'+esc(work.year)+'</span><span>'+esc(work.duration)+'</span><span>'+files.length+' 个文件</span></div>'+
      '<p>'+esc(work.summary)+'</p><p class="muted">依据：'+esc(work.evidence || '待核实')+'</p>'+
      (folder?'<a href="'+esc(folder)+'" target="_blank" rel="noopener noreferrer">打开 Drive 作品文件夹 ↗</a>':'')+
      '<ul>'+files.map(f=>{const url=knownDriveUrl(f.url || f.webViewLink);return '<li>'+(url?'<a target="_blank" rel="noopener noreferrer" href="'+esc(url)+'">'+esc(fileName(f))+' ↗</a>':esc(fileName(f)))+'</li>';}).join('')+'</ul></div></details>';
    }).join('') : '<p class="no-match">没有找到作品。</p>';
  }
  async function showPortfolio() {
    if (!userRequired()) return;
    if (!workspace) await refresh();
    renderPortfolio();
    if (!$('portfolioDialog').open) $('portfolioDialog').showModal();
  }
  async function saveClient() {
    const id = $('googleClientId').value.trim();
    if (!/^[0-9]+-[a-z0-9-]+\.apps\.googleusercontent\.com$/i.test(id)) throw new Error('请输入有效的网页 OAuth 客户端 ID。');
    await updateWorkspace({settings: {...workspace.settings, google_client_id: id}});
    renderPortfolio(); toast('Google 客户端 ID 已保存。');
  }
  async function connectDrive() {
    const clientId = workspace?.settings?.google_client_id;
    if (!clientId) { $('driveFeedback').textContent = '请先展开“首次设置 Google 授权”，保存客户端 ID。'; $('driveConnection').querySelector('details').open = true; return; }
    drive = await authorizeDrive(clientId);
    driveChangesToken = await drive.startChanges();
    renderPortfolio(); toast('Google Drive 已连接，正在同步作品文件。');
    await syncDrive();
  }
  async function syncDrive() {
    if (!drive?.ready()) throw new Error('请先连接 Google Drive。');
    const rootId = workspace?.settings?.works_root_id;
    if (!rootId) throw new Error('尚未配置作品库根目录。');
    const feedback = $('driveFeedback'); feedback.textContent = '正在读取作品文件夹…';
    const categories = (await drive.children(rootId)).filter(f => f.mimeType === GOOGLE_DRIVE_FOLDER);
    categoryIds = categories.map(f=>f.id);
    let folders = [];
    for (const category of categories) folders.push(...(await drive.children(category.id)).filter(f => f.mimeType === GOOGLE_DRIVE_FOLDER).map(f => ({...f, category:category.name})));
    if (!folders.length) throw new Error('未读取到作品文件夹，原有作品清单未更改。');
    const collected = new Map(); let cursor = 0;
    const worker = async () => {
      while (cursor < folders.length) {
        const i = cursor++, folder = folders[i], files = await drive.children(folder.id);
        collected.set(folder.id, files.map(f=>({id:f.id,name:f.name,mime:f.mimeType,size:f.size || null,url:f.webViewLink || ''})));
        feedback.textContent = '已读取 ' + collected.size + ' / ' + folders.length + ' 个作品文件夹…';
      }
    };
    await Promise.all(Array.from({length: Math.min(4, folders.length)}, worker));
    const old = works(), byId = new Map(old.map(w => [w.folder_id,w]));
    const next = old.map(w => collected.has(w.folder_id) ? {...w,files:collected.get(w.folder_id)} : w);
    for (const folder of folders) if (!byId.has(folder.id)) next.push({
      folder_id:folder.id,title:folder.name,folder_url:folder.webViewLink || '',category:folder.category,
      year:'待核实',instrumentation:'待核实',duration:'待核实',summary:'从 Google Drive 同步的新作品；请先补充作品资料。',evidence:'文件夹名称',files:collected.get(folder.id)
    });
    await updateWorkspace({portfolio:next,settings:{...workspace.settings,catalog_asof:new Date().toISOString()}});
    onChange();
    renderPortfolio(); $('driveFeedback').textContent = '同步完成：'+folders.length+' 个作品文件夹，旧资料均已保留。';
    if (detail) renderMatches();
  }

  function inferredAnon(op) {
    const text = String(op.notes || '');
    if (/非匿名|不需要匿名|无需匿名|不要求匿名/.test(text)) return 'no';
    if (/匿名|anonymous/i.test(text)) return 'yes';
    return '';
  }
  function recommendedBio(op) {
    const topic=(op.title+' '+op.instrumentation).toLowerCase();
    const bio=workspace?.settings?.bio || {};
    const focus=/electronic|technology|多媒体|电子|技术/.test(topic)
      ? bio.technology
      : /voice|choral|choir|合唱|人声|声乐/.test(topic)
      ? bio.vocal
      : bio.chamber;
    return [bio.introduction,focus,bio.closing].filter(Boolean).join(' ');
  }
  function preparationAdvice(op) {
    const text=(op.title+' '+op.instrumentation+' '+op.notes).toLowerCase(), advice=[];
    if(/electronic|technology|多媒体|电子|技术/.test(text)) advice.push('简介可优先突出电子音乐、换能器钢琴和技术合作经历；确认设备要求。');
    else if(/voice|choral|choir|合唱|人声|声乐/.test(text)) advice.push('简介可优先突出声乐写作及相关合作，核对歌词和文本授权。');
    else advice.push('简介可优先突出室内乐、独奏及与专业演奏家的合作。');
    if(/150词|150 words/i.test(text)) advice.push('记录中出现150词限制，请分别核对简介与曲解。');
    if(/200词|200 words/i.test(text)) advice.push('记录中出现200词限制，请核对具体适用材料。');
    if(inferredAnon(op)==='yes') advice.push('身份信息与匿名评审材料分开；检查谱面、录音、链接和文件名。');
    return advice.join(' ');
  }
  function fileOptions(work, selected, filter) {
    const files = (work?.files || []).filter(filter);
    return '<option value="">'+(files.length?'请选择文件':'未找到对应文件')+'</option>'+files.map(f=>
      '<option value="'+esc(f.id)+'" '+(f.id===selected?'selected':'')+'>'+esc(fileName(f))+' · '+esc(prettySize(f.size))+(isVideo(f)?' · 从视频提取WAV':'')+'</option>').join('');
  }
  function draftData() {
    const w = $('prepWork').value;
    return {work_folder_id:w, anonymity:$('prepAnon').value, score_id:$('prepScore').value,
      audio_id:$('prepAudio').value, english_title:$('prepEnglishTitle').value.trim(), bio:$('prepBio').value, program_note:$('prepProgram').value, program_note_source_id:$('prepScore').value,
      include_cv:$('prepCV').checked,identities:$('prepIdentityNames').value};
  }
  async function saveDraft() {
    const user = getUser(); if (!user || !prep) throw new Error('请先登录。');
    const d = {...(prep.draft || {}), ...draftData()};
    const row = {user_id:user.id,opportunity_id:prep.op.id,work_folder_id:d.work_folder_id || null,
      draft:d,drive_folder_id:prep.folderId || null,updated_at:new Date().toISOString()};
    const {error} = await db.from('composer_preparation_drafts').upsert(row,{onConflict:'user_id,opportunity_id'});
    if (error) throw error;
    prep.draft = d; return d;
  }
  function refreshSelectedFiles(chosenScore, chosenAudio) {
    const work = findWork($('prepWork').value);
    $('prepScore').innerHTML = fileOptions(work,chosenScore,isPdf);
    $('prepAudio').innerHTML = fileOptions(work,chosenAudio,f=>isAudio(f)||isVideo(f));
    const note = $('workFileHint');
    note.textContent = work ? '编制：'+work.instrumentation+' · 时长：'+work.duration+'。文件清单来自最近一次同步。' : '选择作品后显示可用的谱面与音频。';
    candidate = null; if (previewUrl) URL.revokeObjectURL(previewUrl); previewUrl = '';
    $('pdfFeedback').textContent = '';
    $('candidatePreview').hidden = true;
    $('confirmCandidate').checked = false;
  }
  function renderPrep() {
    const op = prep.op, d = prep.draft || {}, requiredAnon=inferredAnon(op)==='yes', assessment = workspace?.matches?.[String(op.id)];
    const recommended = new Set((assessment?.items || []).map(x=>x.work_id));
    const sortedWorks = [...works()].sort((a,b)=>Number(recommended.has(b.folder_id))-Number(recommended.has(a.folder_id)) || a.title.localeCompare(b.title));
    const parts=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
    const dateParts=Object.fromEntries(parts.map(p=>[p.type,p.value])), today=dateParts.year+'-'+dateParts.month+'-'+dateParts.day;
    const expired=op.deadline_bjt_date && (op.deadline_bjt_date<today ||
      (op.deadline_precision==='exact' && op.deadline_bjt_time && Date.parse(op.deadline_bjt_date+'T'+op.deadline_bjt_time+'+08:00')<Date.now()));
    $('prepProject').textContent = op.title + ' · 北京时间 '+(op.deadline_bjt_date || '日期待核实')+(expired?' · 已截止':'')+'。请以原始公告为准。';
    $('prepContent').innerHTML =
      '<div class="prep-banner"><strong>先准备，再提交</strong><span>这里不会代你报名，也不会将项目标为“已报名”。</span></div>'+
      (requiredAnon?'<div class="anon-warning" role="alert"><strong>⚠ 记录提示：此机会要求匿名</strong><p>已锁定匿名流程。请打开主办方原始规则核对具体要求；只分享匿名评审子文件夹，逐页检查姓名、题献、水印、元数据与音频。</p>'+(/化名|pseudonym/i.test(op.notes||'')?'<p><strong>该项目可能还要求化名：请按主办方规则放入总谱，并逐页复核。</strong></p>':'')+'</div>':'<div class="anon-warning"><strong>匿名要求需核对原始规则</strong><p>现有记录不足以保证完整准确，请先阅读主办方要求，再选择是否匿名。</p></div>')+
      '<div class="prep-grid"><div class="field"><label for="prepWork">选择作品</label><select id="prepWork"><option value="">请选择作品</option>'+sortedWorks.map(w=>'<option value="'+esc(w.folder_id)+'" '+(w.folder_id===d.work_folder_id?'selected':'')+'>'+(recommended.has(w.folder_id)?'★ ':'')+esc(w.title)+'</option>').join('')+'</select></div>'+
      '<div class="field"><label for="prepAnon">评审材料需要匿名吗？</label><select id="prepAnon"><option value="">待确认</option><option value="yes" '+(d.anonymity==='yes'?'selected':'')+'>需要匿名</option>'+(!requiredAnon?'<option value="no" '+(d.anonymity==='no'?'selected':'')+'>不需要匿名</option>':'')+'</select></div></div>'+
      '<p id="workFileHint" class="muted"></p><div class="field"><label for="prepEnglishTitle">作品英文标题（请照总谱填写）</label><input id="prepEnglishTitle" value="'+esc(d.english_title || '')+'" placeholder="请确认原谱上的英文标题"><small>用于文件命名；不自动翻译。</small></div><div class="prep-grid"><div class="field"><label for="prepScore">总谱 PDF</label><select id="prepScore"></select></div><div class="field"><label for="prepAudio">音频／视频来源（可选）</label><select id="prepAudio"></select><small>选视频时尝试提取为16位 WAV；浏览器可能重采样，格式须符合主办方要求。</small></div></div>'+
      '<div class="prep-grid"><div id="scorePreview" class="media-preview"><p>选择总谱后预览。</p></div><div id="audioPreview" class="media-preview"><p>选择音频后试听。</p></div></div>'+
      '<div class="pdf-tool"><div><strong>PDF 检查与匿名候选稿</strong><p>扫描文本和元数据；匿名时另生成图片化候选稿。图片、水印、题献及特殊字体可能漏检，必须逐页检查。</p></div><button type="button" class="btn" id="inspectScore">检查 PDF</button><p id="pdfFeedback" role="status" class="muted"></p>'+
      '<div class="field"><label for="prepIdentityNames">需检查的姓名及别名（逗号分隔，可修改）</label><input id="prepIdentityNames" type="text" value="'+esc(d.identities || (workspace.settings?.anonymity_names || []).join(', '))+'"></div>'+
      '<div id="candidatePreview" hidden><a id="previewLink" target="_blank" rel="noopener noreferrer">打开匿名候选稿并逐页检查 ↗</a><label class="checkline"><input type="checkbox" id="confirmCandidate"> 我已逐页检查候选稿及身份信息，确认可以用于匿名评审。</label></div></div>'+
      '<details class="prep-requirements"><summary>项目现有规则与待办</summary><p>'+esc(op.notes || '请核对主办方规则。')+'</p></details>'+
      '<div class="cv-advice"><strong>本项目的简介建议</strong><p>'+esc(preparationAdvice(op))+'</p></div>'+
      '<div class="field"><label for="prepBio">英文简介（可编辑）</label><textarea id="prepBio" rows="6">'+esc(d.bio || recommendedBio(op))+'</textarea><small>依据中文详细简介整理，请核对事实及字数。已有草稿不会自动覆盖。</small><button class="btn" type="button" id="useLatestBio">使用新版简介</button></div>'+
      '<div class="field"><label for="prepProgram">作品说明（可编辑）</label><textarea id="prepProgram" rows="5" placeholder="填写作品介绍；留空则不创建作品说明文档">'+esc(d.program_note_source_id===d.score_id ? d.program_note || '' : '')+'</textarea><small id="programSource">选中总谱后尝试提取标明 Programme Note 的原文；请对照原谱核对。</small><button class="btn" type="button" id="readProgram">从所选总谱读取作品说明</button></div>'+
      '<label class="checkline"><input type="checkbox" id="prepCV" '+(d.include_cv?'checked':'')+'> 同时复制已有英文 CV 原件（请先确认是否需要及版本是否最新）</label>'+
      '<div class="prep-actions"><button class="btn" type="button" id="savePrep">保存准备草稿</button><button class="btn primary" type="button" id="makePackage">在 Google Drive 创建材料文件夹</button></div>'+
      '<p id="prepFeedback" class="muted" role="status"></p><div id="prepLinks" class="prep-links"></div>'+
      '<p class="privacy-note">匿名项目只将核查后的匿名候选谱放进“评审材料”文件夹；原始谱面和音频不会自动放入。身份资料单独保存，提交链接前请检查分享权限。</p>';
    refreshSelectedFiles(d.score_id,d.audio_id);
    if (d.score_id) {if(verifiedScoreTitles[d.score_id] && !$('prepEnglishTitle').value.trim()) $('prepEnglishTitle').value=verifiedScoreTitles[d.score_id]; loadMedia('score',!$('prepProgram').value.trim());} if (d.audio_id) loadMedia('audio');
    if (prep.folderUrl) $('prepLinks').innerHTML = '<a target="_blank" rel="noopener noreferrer" href="'+esc(prep.folderUrl)+'">打开此前创建的投稿文件夹 ↗</a>';
  }
  async function showPrep(workId) {
    if (!userRequired()) return;
    if (!workspace) await refresh();
    if (!workspace || !detail) { toast('请先打开机会详情。'); return; }
    const user=getUser(), op=detail;
    const {data,error}=await db.from('composer_preparation_drafts').select('work_folder_id,draft,drive_folder_id').eq('user_id',user.id).eq('opportunity_id',op.id).maybeSingle();
    if (error) { toast('无法读取投稿草稿：'+error.message); return; }
    if (getUser()?.id !== user.id) return;
    const d = data?.draft || {};
    prep={op,draft:{...d,work_folder_id:workId || d.work_folder_id || '',anonymity:inferredAnon(op)==='yes'?'yes':(d.anonymity || '')},folderId:data?.drive_folder_id || null,folderUrl:knownDriveUrl(d.folder_url || '')};
    renderPrep(); if (!$('prepDialog').open) $('prepDialog').showModal();
  }
  async function loadMedia(kind, readNote=false) {
    const el=$(kind==='score'?'scorePreview':'audioPreview'), selected=$(kind==='score'?'prepScore':'prepAudio').value;
    if(mediaUrls[kind]) URL.revokeObjectURL(mediaUrls[kind]); mediaUrls[kind]='';
    if(!selected){el.innerHTML='<p>请选择文件。</p>';return;}
    if(!drive?.ready()){el.innerHTML='<p>请先连接 Google Drive 再预览。</p>';return;}
    el.innerHTML='<p>正在读取文件…</p>';
    try {
      const work=findWork($('prepWork').value), file=(work?.files||[]).find(f=>f.id===selected);
      if(!file)throw new Error('未找到文件');
      const blob=await drive.download(selected,100*1024*1024);
      if(!$(kind==='score'?'prepScore':'prepAudio') || $(kind==='score'?'prepScore':'prepAudio').value!==selected) return;
      const typed=kind==='score'?new Blob([blob],{type:'application/pdf'}):blob;
      const url=URL.createObjectURL(typed);mediaUrls[kind]=url;
      if(kind==='score'){el.innerHTML='<iframe title="总谱 PDF 预览" src="'+url+'#toolbar=1"></iframe><p><a href="'+url+'" target="_blank" rel="noopener">在新窗口打开总谱 ↗</a></p>';
        if(readNote) await readProgramFromBlob(blob,selected,false);
      }else{const tag=isVideo(file)?'video':'audio';el.innerHTML='<'+tag+' controls preload="metadata" src="'+url+'"></'+tag+'><p>若无法播放，请在 Google Drive 中打开原文件。</p>';}
    }catch(e){el.innerHTML='<p>预览失败：'+esc(e.message)+'。请检查 Drive 连接或在 Drive 中打开。</p>';}
  }
  async function readProgramFromBlob(blob,scoreId,force) {
    const status=$('programSource'); if(!status)return;
    status.textContent='正在查找总谱里的 Programme Note…';
    try{const note=await extractProgrammeNote(await blob.arrayBuffer());
      if(!$('prepScore') || $('prepScore').value!==scoreId)return;
      if(!note){status.textContent='未能可靠提取原文，可能没有标题、是扫描件或排版特殊；请查看总谱并手动粘贴。';return;}
      if(!$('prepProgram').value.trim() || force){$('prepProgram').value=note;status.textContent='已从所选 PDF 提取原文，请对照原谱检查断行与内容。';}
      else status.textContent='总谱中找到说明；现有内容未覆盖。点击“从所选总谱读取作品说明”可替换。';
    }catch(e){status.textContent='无法提取原文：'+e.message+'；请对照总谱手动粘贴。';}
  }
  async function readProgram(){
    if(!drive?.ready())throw new Error('请先连接 Google Drive。');
    const id=$('prepScore').value;if(!id)throw new Error('请先选择总谱。');
    if($('prepProgram').value.trim()&&!confirm('将用总谱里的原文替换当前作品说明，继续吗？'))return;
    await readProgramFromBlob(await drive.download(id,35*1024*1024),id,true);
  }
  async function inspectSelectedScore() {
    if (!drive?.ready()) throw new Error('请先在“我的作品库”中连接 Google Drive。');
    const work=findWork($('prepWork').value), score=(work?.files || []).find(f=>f.id===$('prepScore').value);
    if (!score) throw new Error('请先选择作品和总谱 PDF。');
    if (score.size && Number(score.size)>35*1024*1024) throw new Error('PDF超过35 MB，请先压缩或手动检查。');
    const feedback=$('pdfFeedback'), anon=$('prepAnon').value==='yes';
    const identities=$('prepIdentityNames').value.split(/[,，;；]/).map(s=>s.trim()).filter(Boolean);
    if(anon&&!identities.length) throw new Error('请先填写需要检查的姓名或别名。');
    candidate=null; $('candidatePreview').hidden=true; $('confirmCandidate').checked=false;
    feedback.textContent='正在下载并检查总谱…';
    const blob=await drive.download(score.id,35*1024*1024);
    const result=await inspectPdf(await blob.arrayBuffer(),{makeCandidate:anon,identities,onProgress:(n,total)=>{feedback.textContent='正在检查第 '+n+' / '+total+' 页…';}});
    feedback.textContent='已检查 '+result.pages+' 页；文本中检测到 '+result.found+' 处姓名片段，元数据命中 '+result.metadataHits.length+' 项；'+result.emptyTextPages+' 页无法提取文本。扫描不能保证完全匿名。';
    if (result.candidate) {
      candidate={blob:result.candidate,scoreId:score.id,opId:prep.op.id};
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl=URL.createObjectURL(result.candidate); $('previewLink').href=previewUrl; $('candidatePreview').hidden=false;
    }
  }
  function checklist(op, work, data, anonymous) {
    return [
      '投稿材料准备草稿', '项目：'+op.title, '截止（北京时间）：'+(op.deadline_bjt_date || '待确认'),
      '原始规则：'+op.source_url, '作品：'+work.title, '编制：'+work.instrumentation, '时长：'+work.duration,
      '匿名要求：'+(anonymous?'需要；匿名评审只分享匿名材料子文件夹':'不需要（仍需按主办方规则复核）'),
      '', '【项目记录：须再次核对】', op.notes || '待确认', '', '【英文简介草稿：待本人修改】',data.bio,
      '', '【作品说明：待本人填写／修改】',data.program_note || '[待填写]',
      '', '【提交前检查】', '□ 申请资格、演出／出版／获奖记录', '□ 截止时间与时区', '□ 乐谱版本、编制、时长与文件大小',
      '□ 录音／音频要求及可访问性', '□ 简介、曲解与其他表格', '□ 提交链接的共享权限及有效期',
      ...(anonymous?['□ 匿名谱逐页检查；检查题献、水印、页眉、元数据和文件名','□ 匿名录音及其元数据和链接身份需人工另行处理','□ 不要把“身份资料”文件夹或上层文件夹分享给匿名评审']:[]),
      '□ 确认已实际提交后，才在机会表标记“已报名”'
    ].join('\n');
  }
  async function makePackage() {
    if (!drive?.ready()) throw new Error('请先在“我的作品库”中连接 Google Drive。');
    const d=draftData(), work=findWork(d.work_folder_id);
    if (!work) throw new Error('请先选择作品。');
    if (inferredAnon(prep.op)==='yes' && d.anonymity!=='yes') throw new Error('该项目记录提示必须匿名，已锁定匿名流程。');
    if (!['yes','no'].includes(d.anonymity)) throw new Error('请先核实并选择是否要求匿名。');
    const anonymous=d.anonymity==='yes', score=(work.files||[]).find(f=>f.id===d.score_id);
    if (!score) throw new Error('请先选择总谱。');
    if (anonymous && (!candidate || candidate.scoreId!==score.id || candidate.opId!==prep.op.id || !$('confirmCandidate').checked))
      throw new Error('匿名项目请先生成候选谱并逐页检查，再勾选确认。');
    await saveDraft();
    const status=$('prepFeedback'); status.textContent='正在创建投稿文件夹…';
    const englishName=(s,fallback)=>safeName(s).replace(/[^\x20-\x7e]/g,' ').replace(/\s+/g,' ').trim()||fallback;
    const workTitle=d.english_title;
    if(!workTitle || !/^[A-Za-z0-9][A-Za-z0-9 '’.,:;!?&()\-]*$/.test(workTitle)) throw new Error('请先照总谱填写并确认英文作品名，文件命名不会自动翻译。');
    const titleSlug=workTitle.replace(/[^A-Za-z0-9]+/g,' ').trim().split(/\s+/).map(w=>w.charAt(0).toUpperCase()+w.slice(1)).join('');
    if(!titleSlug) throw new Error('英文作品名无法用于文件命名。');
    const prefix='ZhichangLin_'+titleSlug;
    const root=await drive.folderByProperty('root','composer_workspace','root_v1','Composition Applications');
    const opportunityFolder=await drive.folderByProperty(root.id,'opportunity_id',String(prep.op.id),englishName(prep.op.title,'Opportunity '+prep.op.id));
    const folder=await drive.folderByProperty(opportunityFolder.id,'work_folder_id',work.folder_id,prefix+'_SCORE');
    let review=folder, identity=folder;
    if (anonymous) {
      review=await drive.folderByProperty(folder.id,'submission_area','anonymous','01 Anonymous Review Materials');
      identity=await drive.folderByProperty(folder.id,'submission_area','identity','02 Identity Materials Private');
    }
    let skipped=0;
    status.textContent='正在准备总谱副本…';
    const scoreBlob=anonymous?candidate.blob:await drive.download(score.id,100*1024*1024);
    const scoreResult=await drive.uploadOnce(review.id,anonymous?'Anonymous_SCORE.pdf':prefix+'_SCORE.pdf',new Blob([scoreBlob],{type:'application/pdf'}),'score_'+score.id+(anonymous?'_anonymous':'_original'));
    if (scoreResult.skipped) skipped++;
    const audio=(work.files||[]).find(f=>f.id===d.audio_id);
    if (audio && !anonymous) {
      status.textContent=isVideo(audio)?'正在从视频提取 WAV 音频，可能需要一些时间…':'正在复制所选音频…';
      let audioBlob=await drive.download(audio.id,100*1024*1024), targetName=prefix+'_AUDIO.'+(fileName(audio).split('.').pop()||'audio').replace(/[^a-zA-Z0-9]/g,'').toLowerCase();
      if(isVideo(audio)) {
        const {extractWav}=await import('./audio-tools.js?v=20261102d');
        audioBlob=(await extractWav(audioBlob)).blob;
        targetName=prefix+'_AUDIO.wav';
      }
      const result=await drive.uploadOnce(review.id,targetName,audioBlob,'audio_'+audio.id);
      if (result.skipped) skipped++;
    }
    if (d.include_cv && workspace.settings?.cv_doc_id) {
      status.textContent='正在复制英文简历原件…';
      const cv=await drive.download(workspace.settings.cv_doc_id,25*1024*1024);
      const result=await drive.uploadOnce(identity.id,'CV_original_CHECK.docx',cv,'cv_original');
      if (result.skipped) skipped++;
    }
    status.textContent='正在创建独立的 Google 文档…';
    const documents=[
      {name:prefix+'_BIOGRAPHY',title:'Composer Biography',body:d.bio,role:'composer_biography'},
      {name:prefix+'_PROGRAMMENOTE',title:workTitle,body:d.program_note,role:'programme_note'}
    ];
    for(const doc of documents) {
      const content=String(doc.body||'').trim();
      if(!content) continue;
      const blob=new Blob([doc.title+'\n\n'+content],{type:'text/plain;charset=utf-8'});
      const created=await drive.uploadOnce(identity.id,doc.name,blob,doc.role,{googleDoc:true});
      if(created.skipped) skipped++;
    }
    const folderUrl=knownDriveUrl(folder.webViewLink || '');
    const reviewUrl=knownDriveUrl(review.webViewLink || '');
    const identityUrl=knownDriveUrl(identity.webViewLink || '');
    prep.folderId=folder.id; prep.folderUrl=folderUrl;
    // Store only provider-returned links. Existing copies are never silently overwritten.
    const updated={...d,folder_url:folderUrl,review_url:reviewUrl,identity_url:identityUrl};
    const {error}=await db.from('composer_preparation_drafts').upsert({user_id:getUser().id,opportunity_id:prep.op.id,
      work_folder_id:work.folder_id,draft:updated,drive_folder_id:folder.id,updated_at:new Date().toISOString()},{onConflict:'user_id,opportunity_id'});
    if (error) throw new Error('文件已创建，但网站草稿未能保存：'+error.message);
    prep.draft=updated;
    $('prepLinks').innerHTML=(folderUrl?'<a href="'+esc(folderUrl)+'" target="_blank" rel="noopener noreferrer">打开投稿文件夹 ↗</a>':'')+
      (anonymous&&reviewUrl?'<a href="'+esc(reviewUrl)+'" target="_blank" rel="noopener noreferrer">打开匿名评审材料 ↗</a>':'')+
      (anonymous&&identityUrl?'<a href="'+esc(identityUrl)+'" target="_blank" rel="noopener noreferrer">打开身份资料（请勿分享给匿名评审） ↗</a>':'');
    status.textContent='材料已创建。'+(anonymous?'匿名音频没有自动复制，请单独处理并核查。':'')+(skipped?' '+skipped+' 个同角色文件已存在，未覆盖；需要更新时请先在 Drive 中处理旧副本。':'')+'分享权限和实际投稿仍需由你确认。';
    toast('投稿文件夹已创建；尚未提交申请。');
  }
  async function run(action, feedbackId) {
    if (busy) return;
    busy=true;
    try { await action(); }
    catch (error) { const feedback=$(feedbackId); if(feedback) feedback.textContent=error.message || '操作失败'; toast(error.message || '操作失败'); }
    finally { busy=false; }
  }
  $('portfolioBtn').addEventListener('click',()=>run(showPortfolio,'driveFeedback'));
  $('closePortfolio').addEventListener('click',()=>$('portfolioDialog').close());
  $('closePrep').addEventListener('click',()=>$('prepDialog').close());
  $('prepDialog').addEventListener('close',()=>{for(const k of ['score','audio']){if(mediaUrls[k])URL.revokeObjectURL(mediaUrls[k]);mediaUrls[k]='';}if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl='';candidate=null;});
  $('workSearch').addEventListener('input',renderPortfolio);
  $('matchPanel').addEventListener('click',e=>{
    if(e.target.closest('[data-login]')) requestLogin();
    const button=e.target.closest('[data-prep-work]'); if(button) run(()=>showPrep(button.dataset.prepWork),'prepFeedback');
  });
  $('prepareBtn').addEventListener('click',()=>run(()=>showPrep(),'prepFeedback'));
  $('driveConnection').addEventListener('click',e=>{
    if(e.target.closest('[data-save-client]')) run(saveClient,'driveFeedback');
    if(e.target.closest('[data-connect]')) run(connectDrive,'driveFeedback');
    if(e.target.closest('[data-sync]')) run(syncDrive,'driveFeedback');
    if(e.target.closest('[data-disconnect]')) {if(drive)drive.clear();drive=null;driveChangesToken='';categoryIds=[];renderPortfolio();toast('已断开本次 Drive 连接。');}
  });
  $('prepContent').addEventListener('change',e=>{
    if(e.target.id==='prepWork') {refreshSelectedFiles(); $('prepEnglishTitle').value=''; $('prepProgram').value=''; $('programSource').textContent='请选择总谱，系统将尝试提取原文。'; loadMedia('score'); loadMedia('audio');}
    if(e.target.id==='prepScore') {if(verifiedScoreTitles[e.target.value] && !$('prepEnglishTitle').value.trim()) $('prepEnglishTitle').value=verifiedScoreTitles[e.target.value]; loadMedia('score',true);}
    if(e.target.id==='prepAudio') loadMedia('audio');
    if(e.target.id==='prepScore'||e.target.id==='prepAnon'||e.target.id==='prepIdentityNames') {candidate=null; if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl='';$('candidatePreview').hidden=true;$('pdfFeedback').textContent='';}
  });
  $('prepContent').addEventListener('click',e=>{
    if(e.target.id==='savePrep') run(async()=>{await saveDraft();$('prepFeedback').textContent='准备草稿已保存到私人账户。';toast('准备草稿已保存');},'prepFeedback');
    if(e.target.id==='useLatestBio') {$('prepBio').value=recommendedBio(prep.op);$('prepFeedback').textContent='已载入新版简介，保存草稿后生效。';}
    if(e.target.id==='inspectScore') run(inspectSelectedScore,'pdfFeedback');
    if(e.target.id==='readProgram') run(readProgram,'prepFeedback');
    if(e.target.id==='makePackage') run(makePackage,'prepFeedback');
  });
  // Poll Drive only while this page is open and the user has actively connected.
  // It syncs file metadata, not opportunity research or application status.
  setInterval(async()=>{
    if (document.hidden || busy || !drive?.ready() || !driveChangesToken || !workspace) return;
    busy=true;
    try {
      const result=await drive.changes(driveChangesToken);
      const known=new Set([workspace.settings?.works_root_id,...categoryIds,...works().map(w=>w.folder_id),...works().flatMap(w=>(w.files||[]).map(f=>f.id))]);
      const relevant=result.changes.some(c=>known.has(c.fileId)||(c.file?.parents||[]).some(id=>known.has(id)));
      if(relevant){await syncDrive();toast('Google Drive 作品文件已同步；匹配建议仍需重新核对。');}
      driveChangesToken=result.pageToken;
    } catch (_) {
      // Retain the old token so the next check can recover without losing changes.
    } finally {busy=false;}
  },60000);
  return {refresh,clear,openDetail,summaryFor};
}
