/* Mesa Sync — plugin do Obsidian da Mesa de Pensamento (rei-artur.github.io/mesa).
 * Lê as mesas do repositório privado no GitHub e mantém uma nota por mesa na pasta escolhida.
 * O que você escreve em "Minhas anotações" volta pra Mesa. A nota "Entrada da Mesa" vira mesa nova.
 * Funciona no celular e no PC (só usa a API do Obsidian, nada de Node). */
'use strict';
var obsidian = require('obsidian');

var VERSION = '1.0.0';
var SITE = 'https://rei-artur.github.io/mesa/';
var API = 'https://api.github.com';
var ANOT_H = '## Minhas anotações';
var ANOT_HINT = '%% Escreva aqui embaixo. A Mesa guarda e usa como contexto; esta parte nunca é apagada. %%';
var TOP_HINT = '%% Parte gerada pela Mesa de Pensamento: atualiza sozinha. Suas anotações vão no fim da nota. %%';
var ENTRADA = 'Entrada da Mesa';
var ENTRADA_HINT = '%% Escreva ou cole aqui embaixo qualquer pensamento. Quando você sair desta nota, ele vai pra Mesa, vira uma mesa nova e some daqui. %%';
var SETTINGS = { repo: '', token: '', pasta: 'Mesas', intervalo: 60, autoUpdate: true, entrada: true };

/* ---------- utilidades ---------- */
function b64enc(s) {
  var bytes = new TextEncoder().encode(s), bin = '';
  for (var i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function b64dec(b) {
  var bin = atob(String(b || '').replace(/\s/g, '')), bytes = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
function hash(s) { // dois hashes curtos juntos: bom o bastante pra deduplicar textos
  var a = 5381, b = 2166136261;
  for (var i = 0; i < s.length; i++) { var c = s.charCodeAt(i); a = ((a << 5) + a + c) | 0; b = Math.imul(b ^ c, 16777619); }
  return (a >>> 0).toString(36) + (b >>> 0).toString(36);
}
function safeName(t) { return String(t || '').replace(/[\\\/:*?"<>|#^\[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80); }
function encPath(p) { return p.split('/').map(encodeURIComponent).join('/'); }
function newer(a, b) {
  var x = String(a || '0').split('.').map(Number), y = String(b || '0').split('.').map(Number);
  for (var i = 0; i < 3; i++) { if ((x[i] || 0) > (y[i] || 0)) return true; if ((x[i] || 0) < (y[i] || 0)) return false; }
  return false;
}
function pad(n) { return ('0' + n).slice(-2); }
function isoDay(t) { var d = new Date(t || Date.now()); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function quando(t) { var d = new Date(t); return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }
function A(x) { return Array.isArray(x) ? x : []; }
function dots(n) { n = Math.max(0, Math.min(5, Math.round(Number(n) || 0))); return '●'.repeat(n) + '○'.repeat(5 - n); }

/* ---------- nota da mesa ---------- */
function splitAnot(text) {
  var lines = String(text || '').split('\n'), i = lines.findIndex(function (l) { return /^##\s.*Minhas anota/i.test(l); });
  if (i < 0) return null;
  var rest = lines.slice(i + 1);
  if (rest.length && rest[0].trim() === ANOT_HINT) rest.shift();
  else if (rest.length && /^%%.*%%$/.test(rest[0].trim()) && /Mesa/.test(rest[0])) rest.shift();
  return rest.join('\n').replace(/^\n+/, '').replace(/\s+$/, '');
}
function renderNote(m, anot) {
  var t = m.tema || {}, cen = A(m.cenarios), fios = A(m.fios), by = {};
  cen.concat(fios).forEach(function (x) { by[x.id] = x; });
  var ativos = cen.filter(function (c) { return c.status !== 'descartado'; });
  var L = ['---', 'tipo: mesa', 'mesa_id: ' + m.id, 'area: ' + JSON.stringify(t.area || ''), 'atualizado: ' + isoDay(m.atualizado),
    'cenarios: ' + ativos.length, 'tags:', '  - mesa', '---', '', '# ' + (t.titulo || 'Mesa'), '', TOP_HINT, ''];
  if (t.veredito) L.push('> [!tip] Recomendação', '> ' + t.veredito, '');
  if (cen.length) {
    var rank = { favorito: 0, ativo: 1, descartado: 2 };
    L.push('## Cenários', '');
    cen.slice().sort(function (a, b) { return (rank[a.status] || 1) - (rank[b.status] || 1); }).forEach(function (c) {
      var off = c.status === 'descartado';
      L.push('### ' + (c.status === 'favorito' ? '★ ' : '') + (off ? '~~' + c.nome + '~~ (descartado)' : c.nome));
      if (c.pai && by[c.pai]) L.push('*variação de ' + by[c.pai].nome + '*');
      if (c.frase) L.push(c.frase);
      L.push('Ganho ' + dots(c.ganho) + ' · Risco ' + dots(c.risco) + ' · Esforço ' + dots(c.esforco));
      A(c.passos).forEach(function (p, i) { L.push((i + 1) + '. ' + (p.quando ? '**' + p.quando + '** — ' : '') + p.o); });
      if (A(c.bom).length) L.push('- ＋ ' + c.bom.join(' · '));
      if (A(c.ruim).length) L.push('- － ' + c.ruim.join(' · '));
      if (A(c.se).length) L.push('- *se* ' + c.se.join(' · '));
      if (c.conta) L.push('- Conta: `' + String(c.conta).replace(/`/g, "'") + '`');
      L.push('');
    });
  }
  if (fios.length) {
    L.push('## Fios', '');
    fios.forEach(function (f) { L.push('### ' + f.nome); A(f.pontos).forEach(function (p) { L.push('- ' + p); }); L.push(''); });
  }
  if (A(m.abertos).length) { L.push('## Em aberto', ''); m.abertos.forEach(function (a) { L.push('- ' + a.texto); }); L.push(''); }
  var dumps = A(m.dumps);
  if (dumps.length) {
    L.push('> [!quote]- Texto bruto (' + dumps.length + ')');
    dumps.forEach(function (d, i) {
      if (i) L.push('>');
      L.push('> **' + quando(d.t) + '**');
      String(d.texto || '').split('\n').forEach(function (l) { L.push('> ' + l); });
    });
    L.push('');
  }
  L.push(ANOT_H, ANOT_HINT, '');
  if (anot) L.push(anot, '');
  return L.join('\n');
}
function entradaTemplate(rest) { return '# ' + ENTRADA + '\n\n' + ENTRADA_HINT + '\n\n' + (rest ? rest + '\n' : ''); }
function entradaBody(text) {
  var lines = String(text || '').split('\n'), i = lines.findIndex(function (l) { return l.trim() === ENTRADA_HINT; });
  if (i < 0) i = lines.findIndex(function (l) { return /^#\s/.test(l); });
  return lines.slice(i + 1).join('\n').trim();
}

/* ---------- plugin ---------- */
class MesaSync extends obsidian.Plugin {
  async onload() {
    this.settings = Object.assign({}, SETTINGS, await this.loadData());
    this.st = Object.assign({ shas: {}, notes: {}, anotSent: {}, etag: '', tree: null, branch: '', last: 0, err: '', beat: 0, upd: 0, dev: '' }, this.ls('estado') || {});
    if (!this.st.dev) { this.st.dev = Math.random().toString(36).slice(2, 10); this.saveSt(); }
    this.self = {}; this.lastEdit = {}; this.anotT = {}; this.anotDirty = { '*': 1 }; this.running = null; this.again = false; this.notified = {};
    this.addSettingTab(new MesaTab(this.app, this));
    this.bar = this.addStatusBarItem();
    this.addRibbonIcon('brain', 'Abrir a Mesa de Pensamento', function () { window.open(SITE); });
    this.addCommand({ id: 'sincronizar', name: 'Sincronizar agora', callback: () => this.sync('comando', true) });
    this.addCommand({ id: 'abrir-entrada', name: 'Abrir a Entrada da Mesa', callback: () => this.openEntrada() });
    this.addCommand({ id: 'abrir-mesa', name: 'Abrir a Mesa de Pensamento', callback: () => window.open(SITE) });
    this.registerEvent(this.app.vault.on('modify', (f) => this.onModify(f)));
    this.registerEvent(this.app.vault.on('rename', (f, old) => this.onRename(f, old)));
    this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.onLeaf()));
    this.registerDomEvent(document, 'visibilitychange', () => {
      if (document.hidden) { this.flushAnot(); this.flushEntrada(); } else this.sync('volta');
    });
    this.registerInterval(window.setInterval(() => { if (!document.hidden) this.sync('tempo'); }, Math.max(30, this.settings.intervalo || 60) * 1000));
    this.app.workspace.onLayoutReady(() => { this.sync('inicio'); this.checkUpdate(); });
    this.paint();
  }
  onunload() { Object.keys(this.anotT).forEach((k) => clearTimeout(this.anotT[k])); clearTimeout(this.entT); }

  /* estado por aparelho (não vai pro Obsidian Sync, pra dois aparelhos não brigarem) */
  ls(k) { try { return this.app.loadLocalStorage('mesa-sync:' + k); } catch (e) { return null; } }
  saveSt() { try { this.app.saveLocalStorage('mesa-sync:estado', this.st); } catch (e) {} }
  async saveSettings() { await this.saveData(this.settings); }
  ready() { return !!(this.settings.repo && this.settings.token); }
  folder() { return obsidian.normalizePath(String(this.settings.pasta || 'Mesas').replace(/^[\/\\]+|[\/\\]+$/g, '') || 'Mesas'); }

  paint(txt) {
    if (!this.bar) return;
    var s = this.st, t = txt || (!this.ready() ? 'Mesa: desligada' : s.err ? 'Mesa ⚠ ' + s.err : s.last ? 'Mesa ✓ ' + quando(s.last).slice(6) : 'Mesa');
    this.bar.setText(t);
  }
  note(key, msg, ms) { // aviso no máximo 1 vez por hora pro mesmo problema
    var now = Date.now(); if (this.notified[key] && now - this.notified[key] < 3600e3) return;
    this.notified[key] = now; new obsidian.Notice(msg, ms || 8000);
  }

  /* ---------- GitHub ---------- */
  async gh(method, path, body, extra) {
    var headers = Object.assign({ Authorization: 'Bearer ' + this.settings.token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }, extra || {});
    if (body) headers['Content-Type'] = 'application/json';
    var r;
    try { r = await obsidian.requestUrl({ url: API + path, method: method, headers: headers, body: body ? JSON.stringify(body) : undefined, throw: false }); }
    catch (e) { var err = new Error('rede'); err.code = 'rede'; throw err; }
    return r;
  }
  fail(r) {
    var j = {}; try { j = r.json || {}; } catch (e) {}
    var code = r.status === 401 ? 'chave' : r.status === 404 ? 'repo' : (r.status === 403 && String(r.headers && (r.headers['x-ratelimit-remaining'] || r.headers['X-RateLimit-Remaining'])) === '0') ? 'limite' : r.status === 403 ? 'permissao' : (r.status === 409 || r.status === 422) ? 'conflito' : 'erro';
    var e = new Error(code); e.code = code; e.status = r.status; e.msg = j.message || ''; return e;
  }
  repoPath() { return '/repos/' + String(this.settings.repo).trim().replace(/^https?:\/\/github\.com\//, '').replace(/\/+$/, ''); }
  async branch() {
    if (this.st.branch) return this.st.branch;
    var r = await this.gh('GET', this.repoPath()); if (r.status !== 200) throw this.fail(r);
    this.st.branch = r.json.default_branch || 'main'; this.saveSt(); return this.st.branch;
  }
  async listTree() {
    var br = await this.branch();
    var r = await this.gh('GET', this.repoPath() + '/git/trees/' + encodeURIComponent(br) + '?recursive=1', null, this.st.etag && this.st.tree ? { 'If-None-Match': this.st.etag } : null);
    if (r.status === 304 && this.st.tree) return this.st.tree;
    if (r.status === 409 || (r.status === 404 && /empty/i.test((r.json || {}).message || ''))) return []; // repositório ainda vazio
    if (r.status !== 200) throw this.fail(r);
    var files = A(r.json.tree).filter(function (x) { return x.type === 'blob'; }).map(function (x) { return { path: x.path, sha: x.sha }; });
    this.st.tree = files; this.st.etag = (r.headers && (r.headers.etag || r.headers.ETag)) || ''; this.saveSt();
    return files;
  }
  async blob(sha) {
    var r = await this.gh('GET', this.repoPath() + '/git/blobs/' + sha); if (r.status !== 200) throw this.fail(r);
    return b64dec(r.json.content);
  }
  async getFile(path) {
    var br = await this.branch();
    var r = await this.gh('GET', this.repoPath() + '/contents/' + encPath(path) + '?ref=' + encodeURIComponent(br));
    if (r.status === 404) return null; if (r.status !== 200) throw this.fail(r);
    return { sha: r.json.sha, text: b64dec(r.json.content) };
  }
  async putFile(path, text, sha, msg) {
    var br = await this.branch(), body = { message: msg, content: b64enc(text), branch: br }; if (sha) body.sha = sha;
    var r = await this.gh('PUT', this.repoPath() + '/contents/' + encPath(path), body);
    if (r.status !== 200 && r.status !== 201) throw this.fail(r);
    this.st.etag = ''; return r.json.content && r.json.content.sha;
  }

  /* ---------- sincronizar ---------- */
  async sync(why, loud) {
    if (!this.ready()) { if (loud) new obsidian.Notice('Mesa Sync: falta o repositório e a chave nas configurações.'); return; }
    if (this.running) { this.again = true; return this.running; }
    this.running = this._sync(why, loud).finally(() => {
      this.running = null; this.paint();
      if (this.again) { this.again = false; setTimeout(() => this.sync('de novo'), 1500); }
    });
    return this.running;
  }
  async _sync(why, loud) {
    this.paint('Mesa ⟳');
    try {
      var files = await this.listTree(), n = 0, first = !this.st.last;
      for (var i = 0; i < files.length; i++) {
        var f = files[i], mm = f.path.match(/^mesas\/([^/]+)\.json$/); if (!mm) continue;
        var id = mm[1];
        if (this.st.shas[id] === f.sha) {
          var was = this.st.notes[id];
          if (was === '(apagada)' || was === '(removida)') continue;
          if ((was && this.app.vault.getAbstractFileByPath(was)) || this.fileFor(id)) continue;
          if (was) { this.st.notes[id] = '(removida)'; continue; } // você apagou a nota: só volta se a mesa mudar
        }
        var m; try { m = JSON.parse(await this.blob(f.sha)); } catch (e) { if (e.code) throw e; continue; }
        if (!m || m.id !== id) { this.st.shas[id] = f.sha; continue; }
        var done = await this.writeNote(m);
        if (done) { this.st.shas[id] = f.sha; n++; }
      }
      await this.ensureEntrada();
      await this.flushAnot(); await this.flushEntrada(); await this.heartbeat();
      this.st.last = Date.now(); this.st.err = ''; this.saveSt();
      if (first && n) new obsidian.Notice('Mesa Sync ligado: ' + n + ' mesa' + (n > 1 ? 's' : '') + ' na pasta ' + this.folder() + '.');
      else if (loud) new obsidian.Notice(n ? 'Mesa: ' + n + ' nota' + (n > 1 ? 's' : '') + ' atualizada' + (n > 1 ? 's' : '') + '.' : 'Mesa: tudo em dia.');
    } catch (e) {
      var c = e.code || 'erro';
      if (c === 'rede') { if (loud) new obsidian.Notice('Mesa: sem internet agora.'); return; }
      this.st.err = c === 'chave' ? 'chave recusada' : c === 'repo' ? 'repositório não achado' : c === 'limite' ? 'limite do GitHub' : c === 'permissao' ? 'sem permissão' : 'erro';
      this.saveSt();
      var msg = c === 'chave' ? 'Mesa Sync: o GitHub recusou a chave (expirou ou foi apagada). Troque nas configurações do plugin.'
        : c === 'repo' ? 'Mesa Sync: não achei o repositório ' + this.settings.repo + ' (ou a chave não tem acesso a ele).'
        : c === 'permissao' ? 'Mesa Sync: a chave não tem permissão de escrever (Contents: Read and write).'
        : c === 'limite' ? 'Mesa Sync: limite do GitHub por agora. Tento de novo sozinho.' : 'Mesa Sync: erro ao sincronizar (' + (e.status || e.message) + ').';
      if (loud) new obsidian.Notice(msg, 9000); else this.note(c, msg);
    }
  }

  fileFor(id) {
    var p = this.st.notes[id], f = p && p.charAt(0) !== '(' && this.app.vault.getAbstractFileByPath(p);
    if (f instanceof obsidian.TFile) return f;
    var md = this.app.vault.getMarkdownFiles();
    for (var i = 0; i < md.length; i++) {
      var fm = (this.app.metadataCache.getFileCache(md[i]) || {}).frontmatter;
      if (fm && String(fm.mesa_id) === id) { this.st.notes[id] = md[i].path; return md[i]; }
    }
    return null;
  }
  editingNow(f) {
    var v = this.app.workspace.getActiveViewOfType(obsidian.MarkdownView);
    return !!(v && v.file && v.file.path === f.path && Date.now() - (this.lastEdit[f.path] || 0) < 30000);
  }
  async ensureFolder(p) {
    if (!this.app.vault.getAbstractFileByPath(p)) { try { await this.app.vault.createFolder(p); } catch (e) {} }
  }
  async writeNote(m) {
    var f = this.fileFor(m.id);
    if (m.apagada) {
      if (f) { try { if (this.app.fileManager.trashFile) await this.app.fileManager.trashFile(f); else await this.app.vault.trash(f, false); } catch (e) {} }
      this.st.notes[m.id] = '(apagada)'; return true;
    }
    if (f) {
      if (this.editingNow(f)) return false; // você está escrevendo nela: atualizo na próxima rodada
      var cur = await this.app.vault.read(f), anot = splitAnot(cur);
      var next = renderNote(m, anot != null ? anot : (m.anot && m.anot.texto) || '');
      if (next !== cur) { this.self[f.path] = Date.now(); await this.app.vault.modify(f, next); }
      if (anot == null) this.st.anotSent[m.id] = hash((m.anot && m.anot.texto) || '');
      return true;
    }
    var dir = this.folder(); await this.ensureFolder(dir);
    var name = safeName(m.obs || (m.tema && m.tema.titulo)) || ('Mesa ' + m.id.slice(-4));
    var path = obsidian.normalizePath(dir + '/' + name + '.md');
    if (this.app.vault.getAbstractFileByPath(path)) path = obsidian.normalizePath(dir + '/' + name + ' (' + m.id.slice(-4) + ').md');
    var text = (m.anot && m.anot.texto) || '';
    this.self[path] = Date.now();
    var nf = await this.app.vault.create(path, renderNote(m, text));
    this.st.notes[m.id] = nf.path; this.st.anotSent[m.id] = hash(text);
    return true;
  }
  idOf(path) { var ids = Object.keys(this.st.notes); for (var i = 0; i < ids.length; i++) if (this.st.notes[ids[i]] === path) return ids[i]; return null; }
  onRename(f, old) {
    var id = this.idOf(old); if (id) { this.st.notes[id] = f.path; this.saveSt(); }
  }
  onModify(f) {
    if (!(f instanceof obsidian.TFile)) return;
    if (this.self[f.path] && Date.now() - this.self[f.path] < 3000) return; // fui eu que escrevi
    this.lastEdit[f.path] = Date.now();
    if (f.path === this.entradaPath()) { clearTimeout(this.entT); this.entT = setTimeout(() => this.flushEntrada(), 60000); return; }
    var id = this.idOf(f.path); if (!id) return;
    this.anotDirty[id] = 1; clearTimeout(this.anotT[id]); this.anotT[id] = setTimeout(() => this.flushAnot(), 8000);
  }
  onLeaf() {
    var f = this.app.workspace.getActiveFile(), was = this.activePath; this.activePath = f && f.path;
    if (was && was === this.entradaPath() && this.activePath !== was) this.flushEntrada();
    if (was && was !== this.activePath && this.idOf(was)) this.flushAnot();
  }

  /* Minhas anotações → Mesa */
  async flushAnot() {
    if (!this.ready() || this.anotBusy) return; this.anotBusy = true;
    try {
      var all = this.anotDirty['*'], ids = all ? Object.keys(this.st.notes) : Object.keys(this.anotDirty);
      this.anotDirty = {};
      for (var i = 0; i < ids.length; i++) {
        var id = ids[i]; if (/^\(/.test(this.st.notes[id] || '')) continue;
        var f = this.fileFor(id); if (!f) continue;
        var text = splitAnot(await this.app.vault.cachedRead(f)); if (text == null) continue;
        if (this.st.anotSent[id] === hash(text)) continue;
        for (var tries = 0; tries < 2; tries++) {
          var remote = await this.getFile('mesas/' + id + '.json'); if (!remote) break;
          var j = JSON.parse(remote.text); if (j.apagada) break;
          j.anot = { texto: text, t: Date.now() };
          try { var sha = await this.putFile('mesas/' + id + '.json', JSON.stringify(j, null, 1), remote.sha, 'Anotações: ' + ((j.tema && j.tema.titulo) || id)); this.st.shas[id] = sha; this.st.anotSent[id] = hash(text); break; }
          catch (e) { if (e.code !== 'conflito') throw e; }
        }
      }
      this.saveSt();
    } catch (e) { this.anotDirty['*'] = 1; if (e.code !== 'rede') this.note('anot', 'Mesa Sync: não consegui mandar suas anotações agora. Tento de novo depois.'); }
    finally { this.anotBusy = false; }
  }

  /* Entrada da Mesa → mesa nova */
  entradaPath() { return obsidian.normalizePath(this.folder() + '/' + ENTRADA + '.md'); }
  async ensureEntrada() {
    if (!this.settings.entrada) return;
    var p = this.entradaPath(); if (this.app.vault.getAbstractFileByPath(p)) return;
    await this.ensureFolder(this.folder()); this.self[p] = Date.now();
    try { await this.app.vault.create(p, entradaTemplate('')); } catch (e) {}
  }
  async openEntrada() {
    await this.ensureEntrada(); var f = this.app.vault.getAbstractFileByPath(this.entradaPath());
    if (f instanceof obsidian.TFile) await this.app.workspace.getLeaf(false).openFile(f);
  }
  async flushEntrada() {
    if (!this.ready() || !this.settings.entrada || this.entBusy) return;
    var f = this.app.vault.getAbstractFileByPath(this.entradaPath()); if (!(f instanceof obsidian.TFile)) return;
    var body = entradaBody(await this.app.vault.read(f)); if (!body) return;
    this.entBusy = true; clearTimeout(this.entT);
    try {
      var path = 'entrada/' + hash(body) + '.md';
      try { await this.putFile(path, body, null, 'Entrada do Obsidian'); }
      catch (e) { if (e.code !== 'conflito') throw e; } // já tinha sido enviado (outro aparelho): tudo bem
      var cur = await this.app.vault.read(f), now = entradaBody(cur);
      var rest = now.indexOf(body) === 0 ? now.slice(body.length).trim() : (now === body ? '' : now);
      this.self[f.path] = Date.now(); await this.app.vault.modify(f, entradaTemplate(rest));
      new obsidian.Notice('Mandei pra Mesa. Ela vira uma mesa nova quando a Mesa abrir.');
    } catch (e) { if (e.code !== 'rede') this.note('entrada', 'Mesa Sync: não consegui mandar a Entrada agora. Tento de novo depois.'); }
    finally { this.entBusy = false; }
  }

  /* a Mesa mostra que o Obsidian está ligado (1 vez por dia) */
  async heartbeat() {
    if (Date.now() - (this.st.beat || 0) < 20 * 3600e3) return;
    var path = 'dispositivos/obsidian-' + this.st.dev + '.json';
    var body = JSON.stringify({ tipo: 'obsidian', aparelho: obsidian.Platform.isMobile ? 'celular' : 'PC', versao: VERSION, t: Date.now() }, null, 1);
    try { var cur = await this.getFile(path); await this.putFile(path, body, cur && cur.sha, 'Obsidian ligado'); this.st.beat = Date.now(); } catch (e) {}
  }

  /* atualiza o próprio plugin quando sai versão nova no site */
  async checkUpdate(force) {
    if (!this.settings.autoUpdate && !force) return;
    if (!force && Date.now() - (this.st.upd || 0) < 6 * 3600e3) return;
    this.st.upd = Date.now(); this.saveSt();
    try {
      var r = await obsidian.requestUrl({ url: SITE + 'obsidian/manifest.json?t=' + Date.now(), throw: false });
      if (r.status !== 200 || !newer(r.json.version, this.manifest.version)) { if (force) new obsidian.Notice('Mesa Sync já está na versão mais nova (' + this.manifest.version + ').'); return; }
      var js = await obsidian.requestUrl({ url: SITE + 'obsidian/main.js?t=' + Date.now(), throw: false });
      if (js.status !== 200 || js.text.length < 2000 || js.text.indexOf('MesaSync') < 0) return;
      var dir = this.manifest.dir;
      await this.app.vault.adapter.write(dir + '/main.js', js.text);
      await this.app.vault.adapter.write(dir + '/manifest.json', r.text);
      new obsidian.Notice('Mesa Sync atualizado para a versão ' + r.json.version + '.');
      var app = this.app, pid = this.manifest.id;
      setTimeout(async function () { try { await app.plugins.disablePlugin(pid); await app.plugins.enablePlugin(pid); } catch (e) {} }, 400);
    } catch (e) {}
  }
}

class MesaTab extends obsidian.PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
  display() {
    var p = this.plugin, s = p.settings, el = this.containerEl; el.empty();
    el.createEl('h2', { text: 'Mesa de Pensamento' });
    var st = p.st, line = !p.ready() ? 'Desligado: falta o repositório e a chave.' : st.err ? 'Problema: ' + st.err + '.' : st.last ? 'Sincronizado em ' + quando(st.last) + '.' : 'Ainda não sincronizou.';
    el.createEl('p', { text: line + ' Versão ' + p.manifest.version + '.' });
    new obsidian.Setting(el).setName('Repositório').setDesc('Onde a Mesa guarda os dados (privado). Ex.: seu-usuario/mesa-dados')
      .addText((t) => t.setValue(s.repo).onChange(async (v) => { s.repo = v.trim(); p.st.branch = ''; p.st.etag = ''; p.saveSt(); await p.saveSettings(); }));
    new obsidian.Setting(el).setName('Chave do GitHub').setDesc('A mesma chave que a Mesa usa. Fica só neste cofre.')
      .addText((t) => { t.inputEl.type = 'password'; t.setValue(s.token).onChange(async (v) => { s.token = v.trim(); await p.saveSettings(); }); });
    new obsidian.Setting(el).setName('Pasta das mesas').setDesc('Uma nota por mesa, com a propriedade "area".')
      .addText((t) => t.setValue(s.pasta).onChange(async (v) => { s.pasta = v.trim() || 'Mesas'; await p.saveSettings(); }));
    new obsidian.Setting(el).setName('Nota "Entrada da Mesa"').setDesc('O que você escrever nela vira uma mesa nova na Mesa.')
      .addToggle((t) => t.setValue(s.entrada).onChange(async (v) => { s.entrada = v; await p.saveSettings(); }));
    new obsidian.Setting(el).setName('Atualizar o plugin sozinho').setDesc('Baixa versões novas do site da Mesa.')
      .addToggle((t) => t.setValue(s.autoUpdate).onChange(async (v) => { s.autoUpdate = v; await p.saveSettings(); }));
    new obsidian.Setting(el).setName('Agora')
      .addButton((b) => b.setButtonText('Sincronizar').setCta().onClick(async () => { await p.sync('botao', true); this.display(); }))
      .addButton((b) => b.setButtonText('Refazer as notas').onClick(async () => { p.st.shas = {}; p.st.etag = ''; p.saveSt(); await p.sync('refazer', true); this.display(); }))
      .addButton((b) => b.setButtonText('Procurar atualização').onClick(() => p.checkUpdate(true)));
  }
}

module.exports = MesaSync;
