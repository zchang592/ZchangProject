const SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/drive.file'
].join(' ');
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const FIELDS = 'id,name,mimeType,size,modifiedTime,webViewLink,appProperties,parents';

function loadGoogleIdentity() {
  if (globalThis.google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = () => globalThis.google?.accounts?.oauth2 ? resolve() : reject(new Error('Google授权组件加载失败。'));
    script.onerror = () => reject(new Error('无法加载Google授权组件，请检查网络或浏览器设置。'));
    document.head.appendChild(script);
  });
}

export async function authorizeDrive(clientId) {
  if (!/^[0-9]+-[a-z0-9-]+\.apps\.googleusercontent\.com$/i.test(clientId.trim()))
    throw new Error('请先填写有效的 Google OAuth 网页客户端 ID。');
  await loadGoogleIdentity();
  const token = await new Promise((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: clientId.trim(),
      scope: SCOPES,
      callback: response => response.error ? reject(new Error(response.error_description || response.error)) : resolve(response),
      error_callback: error => reject(new Error(error.message || '授权窗口已关闭。'))
    });
    client.requestAccessToken({prompt: ''});
  });
  if (!google.accounts.oauth2.hasGrantedAllScopes(token, ...SCOPES.split(' '))) {
    throw new Error('Google Drive 授权未包含所需的读取和文件创建权限，请重新授权。');
  }
  return new DriveClient(token.access_token, Date.now() + Number(token.expires_in || 3600) * 1000);
}

function quoteDrive(s) { return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }

export class DriveClient {
  constructor(accessToken, expiresAt = Date.now() + 3600 * 1000) {
    this.accessToken = accessToken;
    this.expiresAt = expiresAt;
  }
  ready() { return !!this.accessToken && Date.now() < this.expiresAt - 30000; }
  clear() { this.accessToken = ''; this.expiresAt = 0; }
  async request(url, options = {}) {
    if (!this.ready()) throw new Error('Google Drive授权已过期，请重新连接。');
    const headers = new Headers(options.headers || {});
    headers.set('Authorization', 'Bearer ' + this.accessToken);
    const response = await fetch(url, {...options, headers, cache: 'no-store'});
    if (!response.ok) {
      let message = 'Google Drive 请求失败 (' + response.status + ')';
      try { const data = await response.json(); message += '：' + (data.error?.message || ''); } catch (_) {}
      throw new Error(message);
    }
    return response;
  }
  async list(q, fields = FIELDS) {
    const files = [];
    let pageToken = '';
    do {
      const url = new URL('https://www.googleapis.com/drive/v3/files');
      url.searchParams.set('q', q);
      url.searchParams.set('fields', 'nextPageToken,files(' + fields + ')');
      url.searchParams.set('pageSize', '100');
      if (pageToken) url.searchParams.set('pageToken', pageToken);
      const json = await (await this.request(url)).json();
      files.push(...(json.files || []));
      pageToken = json.nextPageToken || '';
    } while (pageToken);
    return files;
  }
  async children(folderId) {
    return this.list("'" + quoteDrive(folderId) + "' in parents and trashed = false");
  }
  async startChanges() {
    const response = await this.request('https://www.googleapis.com/drive/v3/changes/startPageToken?fields=startPageToken');
    return (await response.json()).startPageToken;
  }
  async changes(pageToken) {
    const changes = []; let next = pageToken, newStart = '';
    while (next) {
      const url = new URL('https://www.googleapis.com/drive/v3/changes');
      url.searchParams.set('pageToken', next);
      url.searchParams.set('pageSize', '100');
      url.searchParams.set('fields', 'nextPageToken,newStartPageToken,changes(fileId,removed,file(id,parents,mimeType,name,modifiedTime))');
      const result = await (await this.request(url)).json();
      changes.push(...(result.changes || []));
      newStart = result.newStartPageToken || newStart;
      next = result.nextPageToken || '';
    }
    return {changes, pageToken:newStart || pageToken};
  }
  async download(fileId, maxBytes = 100 * 1024 * 1024) {
    const response = await this.request('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(fileId) + '?alt=media');
    const length = Number(response.headers.get('content-length') || 0);
    if (length > maxBytes) throw new Error('文件过大，请在 Google Drive 中手动处理。');
    const blob = await response.blob();
    if (blob.size > maxBytes) throw new Error('文件过大，请在 Google Drive 中手动处理。');
    return blob;
  }
  async createFolder(name, parent, properties = {}) {
    const metadata = {name, mimeType: FOLDER_MIME, appProperties: properties};
    if (parent) metadata.parents = [parent];
    const url = 'https://www.googleapis.com/drive/v3/files?fields=' + encodeURIComponent(FIELDS);
    const result = await this.request(url, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(metadata)});
    return result.json();
  }
  async folderByProperty(parent, key, value, name) {
    const q = "'" + quoteDrive(parent || 'root') + "' in parents and trashed = false and mimeType = '" + FOLDER_MIME +
      "' and appProperties has { key='" + quoteDrive(key) + "' and value='" + quoteDrive(value) + "' }";
    const found = await this.list(q);
    return found[0] || this.createFolder(name, parent, {[key]: value});
  }
  async uploadOnce(parent, name, blob, role, options = {}) {
    const q = "'" + quoteDrive(parent) + "' in parents and trashed = false and appProperties has { key='submission_role' and value='" +
      quoteDrive(role) + "' }";
    const existing = await this.list(q);
    if (existing.length) return {...existing[0], skipped: true};
    if (options.googleDoc) {
      const named = await this.list("'"+quoteDrive(parent)+"' in parents and trashed = false and name = '"+quoteDrive(name)+"'");
      const same = named.find(file=>file.mimeType==='application/vnd.google-apps.document');
      if(same) return {...same, skipped:true};
    }
    const boundary = 'composer_' + crypto.randomUUID().replaceAll('-', '');
    const metadata = {name, parents: [parent], appProperties: {submission_role: role}};
    if (options.googleDoc) metadata.mimeType = 'application/vnd.google-apps.document';
    const contentType = blob.type || 'application/octet-stream';
    const body = new Blob([
      '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n',
      JSON.stringify(metadata),
      '\r\n--' + boundary + '\r\nContent-Type: ' + contentType + '\r\n\r\n',
      blob,
      '\r\n--' + boundary + '--\r\n'
    ], {type: 'multipart/related; boundary=' + boundary});
    const url = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=' + encodeURIComponent(FIELDS);
    const result = await this.request(url, {method: 'POST', headers: {'Content-Type': body.type}, body});
    return {...(await result.json()), skipped: false};
  }
}

export const GOOGLE_DRIVE_FOLDER = FOLDER_MIME;
