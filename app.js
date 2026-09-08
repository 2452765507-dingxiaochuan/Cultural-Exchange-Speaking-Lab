/* ============================================================================
 * 互联网文化交流英语学习平台 · 引擎层 (app.js) — Deep v3
 * 设计要点：
 *  1) 英文朗读更标准(优选母语音+可选音/调速)，中文不朗读；
 *  2) 移除"大白话类比"，概念深卡改用"标准释义 + 官方表述 + 真实案例 + 清晰逻辑"；
 *  3) 每节按理解→模仿→输出三个阶段组织训练；阶段内保留知识点、词汇、概念、跟读、对话、应答与外宾模拟；
 *  4) 词汇/术语面向"AI与互联网小白"：词性 + 详细释义 + 真实产品例句 + 记忆提示。
 * ==========================================================================*/
(function () {
  'use strict';
  var P = window.PLATFORM;
  var PHRASES = window.PHRASE_BANK || [];
  var LESSON_PHRASES = window.LESSON_PHRASES || {};
  if (!P) { document.body.innerHTML = '<p style="padding:40px">内容未加载 (data.js 缺失)。</p>'; return; }

  /* ---------------- 工具 ---------------- */
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  // 用 HTML 实体安全地写入 data-* 属性。不能用 JavaScript 的 \\' 转义：HTML 属性不识别它，遇到英文撇号会截断按钮参数。
  function jq(s) {
    return "'" + esc(String(s == null ? '' : s).replace(/\n/g, ' ')) + "'";
  }
  function toast(msg) {
    var t = $('toast'); if (!t) return;
    t.textContent = msg; t.classList.add('show');
    clearTimeout(t._t); t._t = setTimeout(function () { t.classList.remove('show'); }, 1900);
  }
  function moduleById(id) { for (var i = 0; i < P.modules.length; i++) if (P.modules[i].id === id) return P.modules[i]; return null; }
  function findScene(mid, sid) {
    var m = moduleById(mid); if (!m) return null;
    for (var i = 0; i < m.scenes.length; i++) if (m.scenes[i].id === sid) return { m: m, s: m.scenes[i] };
    return null;
  }
  function srcById(id) { for (var i = 0; i < P.sources.length; i++) if (P.sources[i].id === id) return P.sources[i]; return null; }

  /* ---------------- 状态 ---------------- */
  var KEY = 'ice_lab_v3';
  var defaults = { done: {}, srs: {}, roleplays: [], stageProgress: {}, sceneStage: {}, stageSignals: {}, customItems: {}, settings: { rate: 0.92, voice: '', vocabKnown: {}, cloud: { enabled: false, provider: 'azure', key: '', region: 'eastasia', secretId: '', secretKey: '' } } };
  function fresh() { return JSON.parse(JSON.stringify(defaults)); }
  function load() {
    try {
      var raw = JSON.parse(localStorage.getItem(KEY) || '{}');
      var s = fresh(); for (var k in raw) if (raw.hasOwnProperty(k)) s[k] = raw[k];
      if (!s.settings) s.settings = defaults.settings;
      if (!s.srs) s.srs = {}; if (!s.done) s.done = {}; if (!s.roleplays) s.roleplays = []; if (!s.stageProgress) s.stageProgress = {}; if (!s.sceneStage) s.sceneStage = {}; if (!s.stageSignals) s.stageSignals = {}; if (!s.customItems) s.customItems = {}; if (!s.settings.vocabKnown) s.settings.vocabKnown = {};
      return s;
    } catch (e) { return fresh(); }
  }
  var S = load();
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }

  /* ---------------- 语音朗读（仅英文，优选标准音） ---------------- */
  var VOICES = [];
  var PREF = ['Google US English', 'Microsoft Aria Online (Natural) - English (United States)',
    'Microsoft David - English (United States)', 'Microsoft Mark - English (United States)',
    'Samantha', 'Karen', 'Daniel', 'Albert', 'Fred', 'English United States', 'en-US'];
  function loadVoices() { try { VOICES = window.speechSynthesis ? (speechSynthesis.getVoices() || []) : []; } catch (e) { VOICES = []; } }
  if (window.speechSynthesis) { loadVoices(); speechSynthesis.onvoiceschanged = function () { loadVoices(); repopVoiceSel(); }; }
  function pickVoice() {
    if (!VOICES.length) return null;
    var pool = VOICES.filter(function (v) { return /^en/i.test(v.lang); });
    if (!pool.length) return null;
    if (S.settings.voice) { var sv = pool.filter(function (v) { return v.name === S.settings.voice; }); if (sv.length) return sv[0]; }
    for (var i = 0; i < PREF.length; i++) {
      var hit = pool.filter(function (v) { return v.name === PREF[i] || v.name.indexOf(PREF[i]) >= 0; });
      if (hit.length) return hit[0];
    }
    return pool[0];
  }
  function speak(text) {
    if (!('speechSynthesis' in window)) { toast('当前浏览器不支持语音朗读'); return; }
    if (!text) return;
    try { speechSynthesis.cancel(); } catch (e) {}
    var u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US'; u.rate = S.settings.rate || 0.92; u.pitch = 1.0;
    var v = pickVoice(); if (v) u.voice = v;
    speechSynthesis.speak(u);
  }
  function enBtn(text, label) {
    return '<button class="minibtn" data-act="speak" data-text=' + jq(text) + '> ' + (label || '朗读') + '</button>';
  }

  /* ---------------- 录音打分（更可靠的检测 + 更细的评分反馈） ---------------- */
  function norm(t) { return String(t || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim(); }
  // 功能词权重更低，内容词（名词/动词等）权重更高
  var STOP = { a:1,an:1,the:1,and:1,or:1,but:1,to:1,of:1,in:1,on:1,at:1,for:1,with:1,by:1,is:1,are:1,am:1,was:1,were:1,be:1,been:1,do:1,does:1,doing:1,you:1,i:1,we:1,they:1,he:1,she:1,it:1,this:1,that:1,my:1,your:1,our:1,me:1,us:1,not:1,no:1,so:1,if:1,as:1,from:1,into:1,about:1,can:1,will:1,would:1,could:1,should:1,may:1,might:1,have:1,has:1,had:1 };
  function ww(w) { return STOP[w] ? 0.4 : 1; }
  // 基于词序列的有序对齐评分：惩罚乱序、漏词、多说，并给出逐词反馈
  function evaluate(said, target) {
    var A = norm(said).split(' ').filter(Boolean);
    var B = norm(target).split(' ').filter(Boolean);
    if (!B.length) return { score: 0, hit: 0, total: 0, extra: 0, order: 0, tags: [], said: A };
    if (!A.length) return { score: 0, hit: 0, total: B.length, extra: 0, order: 0,
      tags: B.map(function (w) { return { w: w, st: 'miss' }; }), said: [] };
    var tags = [], ai = 0, hit = 0, wsum = 0, wtotal = 0, orderHits = 0;
    for (var j = 0; j < B.length; j++) {
      var bw = B[j], w = ww(bw); wtotal += w;
      var found = -1;
      for (var k = ai; k < Math.min(ai + 4, A.length); k++) { if (A[k] === bw) { found = k; break; } }
      if (found >= 0) { tags.push({ w: bw, st: 'ok' }); hit++; wsum += w; orderHits++; ai = found + 1; }
      else { tags.push({ w: bw, st: 'miss' }); }
    }
    var extra = A.length - ai;
    for (var x = ai; x < A.length; x++) tags.push({ w: A[x], st: 'extra' });
    var cov = wtotal ? wsum / wtotal : 0;
    var order = B.length ? orderHits / B.length : 0;
    var extraPen = Math.min(0.15, extra * 0.05);
    var score = Math.round(Math.max(0, Math.min(1, cov * 0.7 + order * 0.3 - extraPen)) * 100);
    return { score: score, hit: hit, total: B.length, extra: extra, order: Math.round(order * 100), tags: tags, said: A };
  }
  function manualHtml(targetEn) {
    return '<div style="margin-top:6px"><span class="small">手动输入你读的内容来打分：</span>' +
      '<input id="manual_in" style="padding:6px 9px;border:1px solid var(--line);border-radius:8px;width:100%;margin:6px 0" placeholder="Type what you said…">' +
      '<button class="btn sm" data-act="manual-score" data-en=' + jq(targetEn) + '>打分</button></div>';
  }
  function manualMode(targetEn, resultEl) {
    resultEl.innerHTML = '<div class="warn">麦克风不可用，请手动输入你读的内容打分：</div>' + manualHtml(targetEn);
  }
  function record(targetEn, resultEl, forceLocal) {
    if (cloudReady() && !forceLocal) { cloudRecord(targetEn, resultEl); return; }
    if (state.m && state.s) { sceneSignals(state.m, state.s).imitate = true; save(); refreshStageGates(state.m, state.s); }
    lastRecEl = resultEl;
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { manualMode(targetEn, resultEl); return; }
    if (lineRec) { try { lineRec.stop(); } catch (e) {} }
    var r; try { r = new SR(); } catch (e) { manualMode(targetEn, resultEl); return; }
    lineRec = r;
    r.lang = 'en-US'; r.interimResults = false; r.maxAlternatives = 3; r.continuous = false;
    var got = false;
    resultEl.innerHTML = '<div class="recon"> 正在聆听…请清晰、匀速地朗读这句英文。</div>' +
      '<div style="margin-top:8px"><button class="btn sm" data-act="stop-record">停止并评分</button> ' +
      '<button class="btn sm ghost" data-act="record-retry" data-en=' + jq(targetEn) + '>重录</button></div>';
    var timer = setTimeout(function () { if (lineRec === r && !got) { try { r.stop(); } catch (e) {} } }, 9000);
    r.onresult = function (e) {
      got = true; clearTimeout(timer); if (lineRec === r) lineRec = null;
      var alts = [];
      for (var i = 0; i < (e.results[0].length || 1); i++) alts.push({ t: e.results[0][i].transcript, c: e.results[0][i].confidence || 0 });
      var best = alts[0], bestS = -1;
      alts.forEach(function (a) { var s = evaluate(a.t, targetEn).score; if (s > bestS) { bestS = s; best = a; } });
      finishRec(targetEn, best.t, best.c, resultEl);
    };
    r.onerror = function (ev) {
      clearTimeout(timer); if (lineRec === r) lineRec = null;
      var msg = (ev && ev.error === 'not-allowed') ? '麦克风权限被拒绝，请在浏览器中允许麦克风'
        : (ev && ev.error === 'no-speech') ? '没有检测到声音，请再试一次' : '语音识别出错';
      resultEl.innerHTML = '<div class="warn">' + msg + '。你可手动输入打分。</div>' + manualHtml(targetEn);
    };
    r.onend = function () {
      clearTimeout(timer); if (lineRec === r) lineRec = null;
      if (!got) resultEl.innerHTML = '<div class="warn">没有识别到内容，可能环境太吵或停顿太久。请重录，或手动输入打分。</div>' + manualHtml(targetEn);
    };
    try { r.start(); toast(' 请朗读这句英文…'); } catch (e) { clearTimeout(timer); manualMode(targetEn, resultEl); }
  }
  function finishRec(targetEn, said, conf, resultEl) {
    var ev = evaluate(said, targetEn);
    var color = ev.score >= 80 ? 'var(--ok)' : ev.score >= 50 ? 'var(--warn)' : 'var(--danger)';
    var tag = ev.score >= 80 ? '很接近！' : ev.score >= 50 ? '不错，继续练' : '多听几遍再试';
    var diff = '';
    ev.tags.forEach(function (t) {
      if (t.st === 'ok') diff += '<b style="color:var(--ok)">' + esc(t.w) + '</b> ';
      else if (t.st === 'miss') diff += '<s style="color:var(--danger)">' + esc(t.w) + '</s> ';
      else diff += '<span style="color:var(--warn)">' + esc(t.w) + '</span> ';
    });
    resultEl.innerHTML =
      '<div style="margin-top:6px">你说：<i>' + esc(said) + '</i></div>' +
      '<div style="margin-top:6px">匹配度：<b style="color:' + color + '">' + ev.score + '%</b>' +
      ' &nbsp;<span class="small">' + tag + '</span>' +
      (conf ? ' &nbsp;<span class="small">识别置信度 ' + Math.round(conf * 100) + '%</span>' : '') + '</div>' +
      '<div style="margin-top:6px;line-height:1.8">对照：' + diff + '</div>' +
      '<div class="small" style="margin-top:4px">命中 ' + ev.hit + '/' + ev.total + ' 词 · 顺序分 ' + ev.order + '%' +
      (ev.extra ? (' · 多说 ' + ev.extra + ' 词') : '') + '</div>' +
      '<div style="margin-top:8px"><button class="btn sm ghost" data-act="record-retry" data-en=' + jq(targetEn) + '>重录</button></div>';
  }

  /* ---------------- 云端发音评测（可选；本地识别兜底） ---------------- */
  var cloudRec = null; // { state, recorder, stream, chunks, startedAt, targetEn, resultEl, request }
  function cloudReady() {
    /* GitHub Pages 是纯静态托管，不能安全托管 /evaluate 发音评测代理。 */
    if (window.__GITHUB_PAGES_BUILD__) return false;
    var c = S.settings.cloud || {}; return !!(c.enabled && c.key);
  }
  function blobToWav16k(blob, cb) {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { cb(new Error('no_audioctx')); return; }
    blob.arrayBuffer().then(function (ab) {
      var ctx = new AC();
      ctx.decodeAudioData(ab).then(function (buf) {
        var sr = 16000, len = Math.max(1, Math.ceil(buf.duration * sr));
        var off = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, len, sr);
        var src = off.createBufferSource(); src.buffer = buf; src.connect(off.destination); src.start();
        off.startRendering().then(function (rendered) {
          var ch = rendered.getChannelData(0), n = ch.length, out = new Int16Array(n);
          for (var i = 0; i < n; i++) { var s = Math.max(-1, Math.min(1, ch[i])); out[i] = s < 0 ? s * 0x8000 : s * 0x7FFF; }
          var header = new ArrayBuffer(44), dv = new DataView(header);
          var ws = 'wav ', fmt = 'fmt ', data = 'data';
          dv.setUint32(0, 0x46464952, true); dv.setUint32(4, 36 + out.length * 2, true); dv.setUint32(8, 0x45564157, true);
          dv.setUint32(12, 0x20746d66, true); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
          dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
          dv.setUint32(36, 0x61746164, true); dv.setUint32(40, out.length * 2, true);
          var wav = new Uint8Array(44 + out.length * 2); wav.set(new Uint8Array(header), 0);
          (new Int16Array(wav.buffer, 44)).set(out);
          var bin = ''; for (var k = 0; k < wav.length; k++) bin += String.fromCharCode(wav[k]);
          cb(null, btoa(bin));
        }).catch(function (e) { cb(e); });
      }).catch(function (e) { cb(e); });
    }).catch(function (e) { cb(e); });
  }
  function cloudRecord(targetEn, resultEl) {
    if (state.m && state.s) { sceneSignals(state.m, state.s).imitate = true; save(); refreshStageGates(state.m, state.s); }
    lastRecEl = resultEl;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { record(targetEn, resultEl, true); return; }
    if (cloudRec && cloudRec.state === 'recording') { try { cloudRec.recorder.stop(); } catch (e) {} return; }
    if (cloudRec && cloudRec.state === 'requesting') return;
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      var MR = window.MediaRecorder; if (!MR) { stream.getTracks().forEach(function (t) { t.stop(); }); record(targetEn, resultEl, true); return; }
      var rec = new MR(stream), chunks = [], req = (cloudRec ? cloudRec.request : 0) + 1;
      cloudRec = { state: 'recording', recorder: rec, stream: stream, chunks: chunks, startedAt: Date.now(), targetEn: targetEn, resultEl: resultEl, request: req };
      rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
      rec.onstop = function () {
        if (cloudRec && cloudRec.request !== req) return;
        stream.getTracks().forEach(function (t) { t.stop(); });
        if (!chunks.length) { resultEl.innerHTML = '<div class="warn">没有录到声音，已切回本地识别。</div>'; record(targetEn, resultEl, true); return; }
        var blob = new Blob(chunks, { type: chunks[0].type || 'audio/webm' });
        resultEl.innerHTML = '<div class="recon"> 已录制，正在上传到云端评测…</div>';
        blobToWav16k(blob, function (err, b64) {
          if (err || !b64) { resultEl.innerHTML = '<div class="warn">音频处理失败，已切回本地识别。</div>'; record(targetEn, resultEl, true); return; }
          var c = S.settings.cloud || {};
          fetch('/evaluate', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ provider: c.provider || 'azure', key: c.key, region: c.region, secretId: c.secretId, secretKey: c.secretKey, text: targetEn, audio: b64 }) })
            .then(function (r) { return r.json(); }).then(function (j) {
              if (j && j.ok && j.result) renderCloudResult(targetEn, j.result, resultEl);
              else {
                var msg = (j && j.error === 'missing_azure_key') ? '缺少 Azure 密钥' :
                  (j && j.error && j.error.indexOf('azure_http_') === 0) ? '云端返回错误：' + j.error : '云端评测暂不可用';
                resultEl.innerHTML = '<div class="warn">' + msg + '，已切回本地识别。</div>'; record(targetEn, resultEl, true);
              }
            }).catch(function () { resultEl.innerHTML = '<div class="warn">网络异常，已切回本地识别。</div>'; record(targetEn, resultEl, true); });
        });
      };
      rec.start();
      resultEl.innerHTML = '<div class="recon"> 云端录音中…说完后再点一次“停止评测”。</div>' +
        '<div style="margin-top:8px"><button class="btn sm" data-act="cloud-stop">停止评测</button> ' +
        '<button class="btn sm ghost" data-act="cloud-retry" data-en=' + jq(targetEn) + '>重录</button></div>';
      toast(' 请朗读这句英文…');
    }).catch(function () { resultEl.innerHTML = '<div class="warn">麦克风不可用，已切回本地识别。</div>'; record(targetEn, resultEl, true); });
  }
  function renderCloudResult(targetEn, r, resultEl) {
    function wordColor(s) { return s >= 80 ? 'var(--ok)' : s >= 50 ? 'var(--warn)' : 'var(--danger)'; }
    var words = (r.words || []).map(function (w) {
      var ph = (w.phonemes || []).map(function (p) {
        return '<span title="音素 ' + esc(p.phoneme) + '" style="color:' + wordColor(p.score) + '">' + esc(p.phoneme) + '<sub style="font-size:9px">' + p.score + '</sub></span> ';
      }).join('');
      var et = w.errorType === 'omission' ? '（漏读）' : w.errorType === 'substitution' ? '（读错）' : w.errorType === 'distortion' ? '（发音不准）' : '';
      return '<div class="wordfb"><b style="color:' + wordColor(w.score) + '">' + esc(w.word) + '</b> <span class="small">' + w.score + '%' + et + '</span>' +
        (ph ? '<div class="small" style="line-height:1.7">' + ph + '</div>' : '') + '</div>';
    }).join('');
    resultEl.innerHTML =
      '<div style="margin-top:6px">你说：<i>' + esc(r.display || '') + '</i></div>' +
      '<div style="margin-top:6px">综合发音分：<b style="color:' + wordColor(r.pronounce) + ';font-size:18px">' + r.pronounce + '</b> / 100' +
      ' &nbsp;<span class="small">准确度 ' + r.accuracy + ' · 流利度 ' + r.fluency + ' · 完整度 ' + r.completeness + '</span></div>' +
      '<div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:8px">' + words + '</div>' +
      '<div class="small" style="margin-top:6px">逐词后的数字是发音准确度；下方小字是音素（phoneme）得分，越低越需要练。</div>' +
      '<div style="margin-top:8px"><button class="btn sm ghost" data-act="cloud-retry" data-en=' + jq(targetEn) + '>云端重评</button> ' +
      '<button class="btn sm ghost" data-act="local-score" data-en=' + jq(targetEn) + ' data-rid=' + jq(resultEl.id) + '>改用本地识别</button></div>';
  }

  /* ---------------- SRS（间隔复习） ---------------- */
  function srsAdd(item) {
    if (S.srs[item.id]) { toast('已在复习清单'); return; }
    S.srs[item.id] = { front: item.front, back: item.back, ctx: item.ctx, badge: item.badge || '', sources: item.sources || [],
      due: Date.now(), interval: 0, reps: 0 };
    save(); toast(' 已加入复习清单'); render();
  }
  function srsDue() {
    var out = [], now = Date.now();
    for (var k in S.srs) if (S.srs.hasOwnProperty(k)) if (S.srs[k].due <= now) out.push({ id: k, c: S.srs[k] });
    return out;
  }
  function srsGrade(id, g) {
    var c = S.srs[id]; if (!c) return;
    var day = 86400000;
    if (g === 'again') c.interval = Math.max(c.interval / 2, 0.0007);
    else if (g === 'hard') c.interval = Math.max((c.interval || 0.0007) * 1.6, 1);
    else if (g === 'good') c.interval = c.reps === 0 ? 1 : (c.interval * 2.5);
    else if (g === 'easy') c.interval = (c.interval || 1) * 3.5;
    if (g !== 'again') c.reps++;
    c.due = Date.now() + c.interval * day;
    save(); render();
  }
  function dueCount() { return srsDue().length; }
  function moduleDone(m) { var n = 0; for (var i = 0; i < m.scenes.length; i++) if (S.done[m.id + '|' + m.scenes[i].id]) n++; return n; }
  function sceneKey(mid, sid) { return mid + '|' + sid; }
  function sceneProgress(mid, sid) {
    var key = sceneKey(mid, sid), p = S.stageProgress[key] || {};
    if (S.done[key]) { p.understand = true; p.imitate = true; p.output = true; }
    return p;
  }
  function signalKey(mid, sid) { return sceneKey(mid, sid); }
  function sceneSignals(mid, sid) { var k = signalKey(mid, sid); if (!S.stageSignals[k]) S.stageSignals[k] = {}; return S.stageSignals[k]; }
  function stageReady(mid, sid, i) {
    var q = sceneSignals(mid, sid);
    return i === 0 ? (!!q.vocab && !!q.phrases) : (i === 1 ? !!q.imitate : !!q.roleplay);
  }
  function stageTasks(mid, sid, i) {
    var q = sceneSignals(mid, sid);
    if (i === 0) return [
      { label: '完成本轮词汇卡', done: !!q.vocab },
      { label: '完成本轮短语卡', done: !!q.phrases }
    ];
    if (i === 1) return [{ label: '至少完成一次跟读或录音', done: !!q.imitate }];
    return [{ label: '完成四轮外宾模拟', done: !!q.roleplay }];
  }
  function taskListHtml(mid, sid, i, compact) {
    return '<div class="stage-task-list ' + (compact ? 'compact' : '') + '">' + stageTasks(mid, sid, i).map(function (t) {
      return '<span class="stage-task ' + (t.done ? 'done' : '') + '"><i>' + (t.done ? '✓' : '○') + '</i>' + esc(t.label) + '</span>';
    }).join('') + '</div>';
  }
  function refreshStageGates(mid, sid) {
    [0, 1, 2].forEach(function (i) {
      var b = document.querySelector('[data-act="complete-stage"][data-stage="' + i + '"][data-m="' + mid + '"][data-s="' + sid + '"]');
      if (b) b.disabled = !stageReady(mid, sid, i);
    });
  }
  function sceneStage(mid, sid) {
    var p = sceneProgress(mid, sid), key = sceneKey(mid, sid);
    /* 已完成阶段仍可回顾：用户主动点选后，优先保留当前查看位置；
       只有首次进入、尚无手动选择时，才按学习进度给出推荐阶段。 */
    if (Object.prototype.hasOwnProperty.call(S.sceneStage, key)) {
      return Math.max(0, Math.min(2, Number(S.sceneStage[key])));
    }
    if (p.output) return 2;
    if (p.imitate) return 2;
    if (p.understand) return 1;
    return 0;
  }
  var STAGES = [
    { id: 'understand', label: '理解', title: '先建立知识框架', desc: '读懂场景、词汇、概念和事实来源。' },
    { id: 'imitate', label: '模仿', title: '听清并练习表达', desc: '跟读标准句，观察对话结构，修正表达。' },
    { id: 'output', label: '输出', title: '自己组织并回答', desc: '主动回忆、情景应答，完成外宾模拟。' }
  ];

  /* ---------------- 词汇训练（墨墨式，面向小白） ---------------- */
  var vocabSession = null;
  function sceneCustomItems(mid, sid) { return (S.customItems[sceneKey(mid, sid)] || []).slice(); }
  function sceneVocabItems(mid, sid) {
    var f = findScene(mid, sid); if (!f) return [];
    var out = (f.s.vocab || []).slice();
    sceneCustomItems(mid, sid).forEach(function (item) {
      var exists = out.some(function (v) { return norm(v.en) === norm(item.en); });
      if (!exists) out.push(item);
    });
    return out;
  }
  function cardButton(label, action, extra, variant) { return '<button class="card-action ' + (variant || '') + '" data-act="' + action + '"' + (extra || '') + '>' + label + '</button>'; }
  function startVocab(mid, sid) {
    var f = findScene(mid, sid); if (!f) return;
    var list = sceneVocabItems(mid, sid);
    vocabSession = { mid: mid, sid: sid, queue: list.slice(), total: list.length, known: 0, revealed: {} };
    drawVocab();
  }
  function restartVocab() { if (vocabSession) startVocab(vocabSession.mid, vocabSession.sid); }
  function drawVocab() {
    var wrap = $('vocabWrap'); if (!wrap || !vocabSession) return;
    if (!vocabSession.queue.length) {
      sceneSignals(vocabSession.mid, vocabSession.sid).vocab = true; save(); refreshStageGates(vocabSession.mid, vocabSession.sid);
      wrap.innerHTML = '<div class="study-done"><div><span class="study-done-mark">✓</span><b>本轮词汇已完成</b><p>本轮记住 ' + vocabSession.known + ' / ' + vocabSession.total + '；生疏词已在本轮回队。可以直接再学一轮巩固。</p></div>' +
        '<div class="study-done-actions">' + cardButton('↻ 再学一轮', 'v-restart', '', 'primary') + '<button class="card-action secondary" data-act="stage" data-stage="1" data-m="' + vocabSession.mid + '" data-s="' + vocabSession.sid + '">进入模仿阶段 →</button></div></div>';
      return;
    }
    var v = vocabSession.queue[0], seen = vocabSession.total - vocabSession.queue.length + 1;
    var ipa = v.ipa ? ' /' + esc(v.ipa) + '/' : '';
    var pos = v.pos ? '<span class="pos">' + esc(v.pos) + '</span>' : '';
    var prod = v.product ? '<span class="pill">产品示例：' + esc(v.product) + '</span>' : '';
    var tip = v.tip ? '<div class="vtip"><b>记忆提示</b><span>' + esc(v.tip) + '</span></div>' : '';
    var rev = !!vocabSession.revealed[v.en];
    var reveal = rev ?
      '<div class="card-answer"><div class="vmean"><b>释义</b><span>' + esc(v.def || v.zh) + '</span></div>' +
      (v.exEn ? '<div class="ven">' + esc(v.exEn) + '</div><div class="vzh">' + esc(v.exZh || '') + '</div>' : '') +
      (prod ? '<div class="product-row">' + prod + '</div>' : '') + tip + '</div>' :
      '<div class="card-prompt">先在脑中回忆含义，再揭示答案。</div>';
    var controls = rev ?
      '<div class="card-control"><div class="rating-label">这张词汇卡，你掌握得怎样？</div><div class="rating-buttons">' +
      cardButton('不认识', 'v-grade', ' data-g="no"', 'again') + cardButton('模糊', 'v-grade', ' data-g="fuzzy"', 'fuzzy') + cardButton('认识', 'v-grade', ' data-g="yes"', 'good') +
      '</div><div class="card-tools">' + enBtn(v.en, '朗读英文') + '<button class="minibtn" data-act="add-srs" data-id=' + jq('voc_' + v.en) + ' data-front=' + jq(v.en) + ' data-back=' + jq(v.def || v.zh) + ' data-ctx=' + jq('词汇 · ' + v.en) + '>加入长期复习</button></div></div>' :
      '<div class="card-control">' + cardButton('显示释义与例句', 'v-reveal', '', 'reveal') + '<div class="card-tools">' + enBtn(v.en, '先听发音') + '</div></div>';
    wrap.innerHTML = '<div class="study-card vocab-study-card"><div class="study-card-head"><span class="study-type">词汇卡</span><span class="study-count">第 ' + seen + ' 张 / 共 ' + vocabSession.total + ' 张</span></div>' +
      '<div class="study-progress"><i style="width:' + Math.round((seen - 1) / vocabSession.total * 100) + '%"></i></div><div class="study-card-main"><div class="vword">' + esc(v.en) + '</div><div class="word-meta">' + pos + '<span class="vipa">' + ipa + '</span></div>' + reveal + '</div>' + controls + '</div>';
  }
  function vReveal() { if (vocabSession && vocabSession.queue[0]) { vocabSession.revealed[vocabSession.queue[0].en] = true; drawVocab(); } }
  function vGrade(g) {
    if (!vocabSession || !vocabSession.queue.length) return;
    var v = vocabSession.queue.shift();
    if (g === 'yes') { vocabSession.known++; vocabSession.revealed[v.en] = true; }
    else if (g === 'fuzzy') { vocabSession.queue.splice(Math.min(5, vocabSession.queue.length), 0, v); vocabSession.revealed[v.en] = false; }
    else { vocabSession.queue.splice(Math.min(2, vocabSession.queue.length), 0, v); vocabSession.revealed[v.en] = false; }
    drawVocab();
  }

  /* ---------------- 本节短语卡（每课独立短语包；中文 → 英文） ---------------- */
  var phraseSession = null;
  function shortZh(v) {
    var z = String(v && (v.zh || v.def) || '').trim(); if (!z) return '';
    var cut = z.search(/[：；。]/); if (cut > 0) z = z.slice(0, cut);
    return z.replace(/[（(].*?[）)]/g, '').trim();
  }
  function phraseSourceText(scene) {
    var out = [];
    (scene.vocab || []).forEach(function (v) { out.push({ en: v.exEn || '', zh: v.exZh || '' }); });
    (scene.shadow || []).forEach(function (x) { out.push({ en: x.en || '', zh: x.zh || '' }); });
    (scene.dialogue || []).forEach(function (x) { out.push({ en: x.en || '', zh: x.zh || '' }); });
    (scene.respond || []).forEach(function (x) { out.push({ en: x.refEn || '', zh: x.refZh || '' }); });
    (scene.errorFix || []).forEach(function (x) { out.push({ en: x.better || '', zh: x.betterZh || '' }); });
    return out.filter(function (x) { return x.en; });
  }
  function phraseExample(scene, en) {
    var needle = norm(en), sources = phraseSourceText(scene), best = null;
    for (var i = 0; i < sources.length; i++) {
      var hay = norm(sources[i].en);
      if (hay.indexOf(needle) >= 0) return sources[i];
      var words = needle.split(' ').filter(function (w) { return w.length > 3; });
      var hits = words.filter(function (w) { return hay.indexOf(w) >= 0; }).length;
      if (hits && (!best || hits > best.hits)) best = { hits: hits, item: sources[i] };
    }
    return best && best.hits >= 2 ? best.item : (sources[0] || { en: '', zh: '' });
  }
  function normalizePhraseItem(item, scene) {
    var en = Array.isArray(item) ? item[1] : item.en, zh = Array.isArray(item) ? item[0] : item.zh;
    var ex = phraseExample(scene, en);
    return { en: en, zh: zh, def: zh, exEn: ex.en, exZh: ex.zh, tip: '把中文短语和英文短语作为一个整体对应记忆。' };
  }
  function scenePhraseItems(mid, sid) {
    var f = findScene(mid, sid); if (!f) return [];
    var out = (LESSON_PHRASES[sid] || []).map(function (item) { return normalizePhraseItem(item, f.s); });
    sceneCustomItems(mid, sid).forEach(function (item) {
      if (!/[\s-]/.test(String(item.en || '').trim())) return;
      if (!out.some(function (x) { return norm(x.en) === norm(item.en); })) out.push(item);
    });
    return out;
  }
  function startPhraseCards(mid, sid) {
    var list = scenePhraseItems(mid, sid);
    phraseSession = { mid: mid, sid: sid, queue: list.slice(), total: list.length, known: 0, revealed: {} };
    drawPhraseCards();
  }
  function restartPhraseCards() { if (phraseSession) startPhraseCards(phraseSession.mid, phraseSession.sid); }
  function drawPhraseCards() {
    var wrap = $('phraseCardWrap'); if (!wrap || !phraseSession) return;
    if (!phraseSession.total) { wrap.innerHTML = '<div class="study-empty">本节短语包还未准备好。三击查到的多词短语加入本节后会出现在这里。</div>'; return; }
    if (!phraseSession.queue.length) {
      sceneSignals(phraseSession.mid, phraseSession.sid).phrases = true; save(); refreshStageGates(phraseSession.mid, phraseSession.sid);
      wrap.innerHTML = '<div class="study-done"><div><span class="study-done-mark">✓</span><b>本轮短语已完成</b><p>本轮记住 ' + phraseSession.known + ' / ' + phraseSession.total + '；生疏短语已在本轮重新出现。建议再学一轮，把短语记稳。</p></div><div class="study-done-actions">' + cardButton('↻ 再学一轮', 'phrase-restart', '', 'primary') + '<button class="card-action secondary" data-act="stage" data-stage="1" data-m="' + phraseSession.mid + '" data-s="' + phraseSession.sid + '">进入模仿阶段 →</button></div></div>';
      return;
    }
    var v = phraseSession.queue[0], revealed = !!phraseSession.revealed[v.en], seen = phraseSession.total - phraseSession.queue.length + 1;
    var example = v.exEn ? '<div class="phrase-mini"><div class="phrase-mini-label">本课用法</div><div class="phrase-example-line">' + lookupText(v.exEn, 'phrase-example-en') + '</div><div class="phrase-example-zh">' + esc(v.exZh || '') + '</div></div>' : '';
    var reveal = revealed ? '<div class="card-answer"><div class="phrase-en">' + lookupText(v.en, 'phrase-main-en') + '</div>' + example + '</div>' : '<div class="card-prompt">先看中文，在脑中想出对应英文，再揭示。</div>';
    var controls = revealed ? '<div class="card-control"><div class="rating-label">这个短语，你掌握得怎样？</div><div class="rating-buttons">' +
      cardButton('不认识', 'phrase-grade', ' data-g="no"', 'again') + cardButton('模糊', 'phrase-grade', ' data-g="fuzzy"', 'fuzzy') + cardButton('记住', 'phrase-grade', ' data-g="yes"', 'good') +
      '</div><div class="card-tools">' + enBtn(v.en, '朗读短语') + '<button class="minibtn" data-act="add-srs" data-id=' + jq('phrase_' + phraseSession.mid + '_' + phraseSession.sid + '_' + v.en) + ' data-front=' + jq(v.en) + ' data-back=' + jq(v.zh + (v.exZh ? '｜' + v.exZh : '')) + ' data-ctx=' + jq('本节短语 · ' + v.en) + '>加入长期复习</button></div></div>' :
      '<div class="card-control">' + cardButton('显示英文短语', 'phrase-reveal', '', 'reveal') + '<div class="card-tools">' + enBtn(v.en, '先听发音') + '</div></div>';
    wrap.innerHTML = '<div class="study-card phrase-study-card"><div class="study-card-head"><span class="study-type">本节短语卡</span><span class="study-count">第 ' + seen + ' 张 / 共 ' + phraseSession.total + ' 张</span></div><div class="study-progress"><i style="width:' + Math.round((seen - 1) / phraseSession.total * 100) + '%"></i></div><div class="study-card-main"><div class="phrase-zh-main">' + esc(v.zh || '本节业务短语') + '</div>' + reveal + '</div>' + controls + '</div>';
  }
  function phraseReveal() { if (phraseSession && phraseSession.queue[0]) { phraseSession.revealed[phraseSession.queue[0].en] = true; drawPhraseCards(); } }
  function phraseGrade(g) {
    if (!phraseSession || !phraseSession.queue.length) return;
    var v = phraseSession.queue.shift();
    if (g === 'yes') { phraseSession.known++; phraseSession.revealed[v.en] = true; }
    else if (g === 'fuzzy') { phraseSession.queue.splice(Math.min(5, phraseSession.queue.length), 0, v); phraseSession.revealed[v.en] = false; }
    else { phraseSession.queue.splice(Math.min(2, phraseSession.queue.length), 0, v); phraseSession.revealed[v.en] = false; }
    drawPhraseCards();
  }

  /* ---------------- 三击就地查词 / 查短语 ---------------- */
  function lookupText(text, cls) { return '<span class="lookup-text ' + (cls || '') + '" data-lookup=' + jq(text) + '>' + esc(text) + '</span>'; }
  var BASIC_WORDS = { a:1,an:1,the:1,and:1,or:1,but:1,to:1,of:1,in:1,on:1,at:1,for:1,with:1,by:1,from:1,as:1,is:1,are:1,am:1,was:1,were:1,be:1,been:1,being:1,do:1,does:1,did:1,have:1,has:1,had:1,will:1,would:1,can:1,could:1,should:1,may:1,might:1,i:1,you:1,we:1,they:1,he:1,she:1,it:1,this:1,that:1,these:1,those:1,my:1,your:1,our:1,their:1,not:1,no:1,yes:1,what:1,why:1,how:1,when:1,where:1,who:1,if:1,then:1,than:1,so:1,very:1,just:1,also:1,more:1,most:1,one:1,two:1,all:1,any:1,some:1,only:1,into:1,over:1,up:1,down:1,like:1,about:1 };
  var LOOKUP_LEXICON = {
    scenario:{ zh:'场景；情境', def:'在业务英语里，scenario 指一个有明确人物、目标和条件的具体使用情境。', tip:'把它记成“人在某个情境下要完成的事”，常用于 customer scenario / business scenario。', related:['customer scenario','business scenario','industry scenario'] },
    measure:{ zh:'衡量；措施；指标', def:'作动词时是“衡量”；作名词时可指“措施”或“衡量指标”，要由上下文判断。', tip:'在本课程里常见于 measure the result（衡量结果）和 success measures（成功指标）。', related:['measure the result','success measures','performance measures'] },
    arrangement:{ zh:'安排；约定；具体配置', def:'指为完成某件事做出的安排、约定或组织方式。', tip:'常见于 make arrangements（作出安排）和 the exact arrangement（具体安排）。', related:['make arrangements','the exact arrangement','working arrangement'] },
    impairment:{ zh:'损伤；功能受损', def:'指身体、感官或功能受到损伤或减弱。', tip:'im- 有“使变差”的意味，常见于 visual impairment。', related:['visual impairment','hearing impairment','cognitive impairment'] },
    workflow:{ zh:'工作流；工作流程', def:'一项工作从开始到结束实际经过的步骤和交接方式。', tip:'work + flow，工作如何流转。', related:['the current workflow','approval workflow','improve a workflow'] },
    'current workflow':{ zh:'现有工作流', def:'指客户或团队目前实际采用的工作步骤、角色分工和交接方式。', tip:'current = 当前的；workflow = 工作流。业务交流中先理解现有流程，才谈如何改进。', related:['the current workflow','approval workflow','improve a workflow'] },
    'a clear business problem':{ zh:'明确的业务问题', def:'已经界定清楚、能被分析并值得解决的业务问题。', tip:'先谈问题，再谈产品；这是解决方案式交流的起点。', related:['identify a business problem','solve a business problem','a long product list'] },
    'a long product list':{ zh:'一长串产品清单', def:'很多产品名称的罗列，但未必对应客户真正需要解决的问题。', tip:'在业务介绍中，它常作为“先谈问题而非先罗列产品”的对照。', related:['a clear business problem','product portfolio','solution selling'] },
    'success measures':{ zh:'成功衡量指标', def:'用来判断项目、方案或改进是否达成预期的具体衡量标准。', tip:'measure 是衡量；复数 measures 表示一组指标。', related:['measure the result','performance measures','business outcome'] },
    'hardware cost':{ zh:'硬件成本；硬件投入', def:'购买、部署或维护服务器、设备等硬件产生的成本。', tip:'常与 upfront（前期的）搭配：upfront hardware cost。', related:['upfront hardware cost','operating expenses','total cost of ownership'] },
    'operating expenses':{ zh:'运营开支', def:'系统在日常运行过程中持续发生的支出，常简称 OPEX。', tip:'operating 是“运行中的”；expenses 是“支出”。', related:['operating costs','upfront hardware cost','total cost of ownership'] },
    'total cost of ownership':{ zh:'总拥有成本', def:'不只看采购价，还包括部署、运维、培训、停机、升级等全周期成本，常简称 TCO。', tip:'ownership 不是“拥有权”本身，而是“拥有并使用一套系统的全部成本”。', related:['lower the total cost of ownership','upfront hardware cost','operating expenses'] },
    outcome:{ zh:'结果；最终产出', def:'指一个项目、行动或流程最后得到的结果，常用于业务评估。', tip:'out + come，最后“出来”的结果。', related:['business outcome','desired outcome','measure the outcome'] }
  };
  function selectedLookupText(el, ev) {
    var sel = String(window.getSelection ? window.getSelection().toString() : '').replace(/\s+/g, ' ').trim();
    var fullText = el.getAttribute('data-lookup') || el.textContent || '';
    // 用户手动选中的 1–6 词短语优先；三击浏览器若选中整句则忽略，改按点击位置取词。
    if (sel && norm(sel) !== norm(fullText) && sel.length <= 72 && /[a-z]/i.test(sel) && sel.split(' ').length <= 6) return sel;
    var range = null;
    try {
      if (document.caretRangeFromPoint) range = document.caretRangeFromPoint(ev.clientX, ev.clientY);
      else if (document.caretPositionFromPoint) { var pos = document.caretPositionFromPoint(ev.clientX, ev.clientY); if (pos) { range = { startContainer: pos.offsetNode, startOffset: pos.offset }; } }
    } catch (e) {}
    if (range && range.startContainer && range.startContainer.nodeType === 3 && el.contains(range.startContainer)) {
      var t = range.startContainer.nodeValue || '', at = Math.max(0, Math.min(range.startOffset || 0, t.length));
      var left = at, right = at;
      while (left > 0 && /[A-Za-z'-]/.test(t.charAt(left - 1))) left--;
      while (right < t.length && /[A-Za-z'-]/.test(t.charAt(right))) right++;
      var hit = t.slice(left, right); if (/[A-Za-z]/.test(hit)) return hit;
    }
    var full = el.getAttribute('data-lookup') || el.textContent || '';
    var word = full.match(/[A-Za-z][A-Za-z'-]*/);
    return word ? word[0] : full;
  }
  function allLookupCandidates() {
    var out = [];
    P.modules.forEach(function (m) { m.scenes.forEach(function (s) { (s.vocab || []).forEach(function (v) { out.push(v); }); }); });
    return out;
  }
  function lookupEntry(text) {
    var raw = String(text || '').trim().replace(/[.,!?;:]+$/, ''), n = norm(raw), candidates = allLookupCandidates();
    var exact = candidates.filter(function (v) { return norm(v.en) === n; })[0];
    var lex = LOOKUP_LEXICON[n];
    var containing = candidates.filter(function (v) { return norm(v.en).split(' ').indexOf(n) >= 0; })[0];
    var base = exact || containing || {};
    var related = (lex && lex.related ? lex.related.slice() : []);
    candidates.forEach(function (v) { if (norm(v.en) !== n && norm(v.en).indexOf(n) >= 0 && related.indexOf(v.en) < 0 && related.length < 6) related.push(v.en); });
    return { en: raw, zh: (exact && shortZh(exact)) || (lex && lex.zh) || (containing && shortZh(containing)) || '暂未收录释义',
      def: (exact && exact.def) || (lex && lex.def) || (containing && containing.def) || '该词暂未在本地课程词库中收录。你仍可加入本节词汇卡，后续再补充释义。',
      tip: (exact && exact.tip) || (lex && lex.tip) || (containing && containing.tip) || '建议结合当前句反复朗读，并在本节词汇卡中复习。',
      exEn: (exact && exact.exEn) || '', exZh: (exact && exact.exZh) || '', related: related, known: !!(exact || lex || containing) };
  }
  function showLookup(text) {
    if (!state.m || !state.s) return;
    var clean = String(text || '').trim().replace(/^[^A-Za-z]+|[^A-Za-z'-]+$/g, '');
    var n = norm(clean); if (!n || (n.split(' ').length === 1 && (BASIC_WORDS[n] || n.length < 4))) { toast('这是基础词，已跳过查词'); return; }
    var e = lookupEntry(clean), modal = $('lookupModal'); if (!modal) return;
    var rel = e.related.length ? '<div class="lookup-related"><b>相关短语</b><div>' + e.related.map(function (x) { return '<button class="lookup-chip" data-act="lookup-related" data-text=' + jq(x) + '>' + esc(x) + '</button>'; }).join('') + '</div></div>' : '';
    modal.innerHTML = '<div class="lookup-shade" data-act="close-lookup"></div><div class="lookup-box" role="dialog" aria-modal="true"><button class="lookup-close" data-act="close-lookup">×</button>' +
      '<div class="lookup-word">' + esc(e.en) + '</div><div class="lookup-zh">' + esc(e.zh) + '</div>' +
      '<div class="lookup-def">' + esc(e.def) + '</div>' +
      (e.exEn ? '<div class="lookup-example">' + esc(e.exEn) + '<br><span>' + esc(e.exZh) + '</span></div>' : '') +
      '<div class="lookup-tip"><b>记忆提示：</b>' + esc(e.tip) + '</div>' + rel +
      '<div class="lookup-actions"><button class="btn sm" data-act="add-lookup-scene" data-en=' + jq(e.en) + ' data-zh=' + jq(e.zh) + ' data-def=' + jq(e.def) + ' data-tip=' + jq(e.tip) + ' data-exen=' + jq(e.exEn) + ' data-exzh=' + jq(e.exZh) + '>加入本节词汇卡</button>' +
      '<button class="btn sm ghost" data-act="add-lookup-srs" data-en=' + jq(e.en) + ' data-zh=' + jq(e.zh) + '>加入长期复习</button> ' + enBtn(e.en, '朗读') + '</div></div>';
    modal.classList.add('show');
  }
  function addLookupToScene(el) {
    if (!state.m || !state.s) return;
    var key = sceneKey(state.m, state.s), list = S.customItems[key] || [], en = el.getAttribute('data-en');
    if (sceneVocabItems(state.m, state.s).some(function (v) { return norm(v.en) === norm(en); })) { toast('本节词汇卡里已经有这个词或短语'); return; }
    list.push({ en: en, zh: el.getAttribute('data-zh'), def: el.getAttribute('data-def'), tip: el.getAttribute('data-tip'), exEn: el.getAttribute('data-exen'), exZh: el.getAttribute('data-exzh'), pos: '自选' });
    S.customItems[key] = list; save(); $('lookupModal').classList.remove('show'); toast('已加入本节理解阶段的词汇卡');
    if (state.view === 'scene') renderScene(state.m, state.s);
  }

  /* ---------------- 侧栏 ---------------- */
  function renderSide() {
    var items = [['home', '', '总览'], ['today', '', '今日学习'], ['map', '', '知识地图'],
      ['review', '', '复习', dueCount()], ['phrases', '', '句块训练'], ['dict', '', '概念词典'], ['progress', '', '我的进度'],
      ['settings', '', '语音设置']];
    var nav = items.map(function (it) {
      return '<button class="navbtn' + (state.view === it[0] ? ' on' : '') + '" data-act="nav" data-view="' + it[0] + '">' +
        (it[1] ? it[1] + ' ' : '') + it[2] + (it[3] ? '<span class="badge">' + it[3] + '</span>' : '') + '</button>';
    }).join('');
    var modlist = P.modules.map(function (m) {
      var d = moduleDone(m), t = m.scenes.length;
      return '<button class="modbtn" data-act="open-module" data-m="' + m.id + '"><span>' + m.zh + '</span><span class="pct">' + d + '/' + t + '</span></button>';
    }).join('');
    $('nav').innerHTML = nav;
    $('modlist').innerHTML = modlist;
  }

  /* ---------------- 视图 ---------------- */
  var state = { view: 'home', m: null, s: null };
  var TOP = { home: ['总览', '理解行业，练好表达'], today: ['今日学习', '按步骤完成一节课'], map: ['知识地图', '模块 → 场景 → 概念'],
    module: ['模块', '选择一节课程'], review: ['间隔复习', '按计划复习已学内容'], phrases: ['句块训练', '练习高频商务表达'], dict: ['概念词典', '随时查询、随时朗读'],
    progress: ['我的进度', '查看学习记录'], settings: ['语音设置', '选择英文朗读声音'], scene: ['场景学习', '在具体场景中练习表达'] };

  function backBar(label, act, a, b) {
    return '<div class="backbar"><button class="minibtn" data-act="' + act + '"' + (a ? ' data-m="' + a + '"' : '') + (b ? ' data-s="' + b + '"' : '') + '>← ' + esc(label) + '</button></div>';
  }

  function cleanupMedia() {
    stopRoleSpeech();
    if (lineRec) { try { lineRec.stop(); } catch (e) {} lineRec = null; }
    var active = roleAudio;
    if (active) {
      active.cancelled = true;
      if (active.recorder && active.state === 'recording') { try { active.recorder.stop(); } catch (e) {} }
      if (active.stream && active.state !== 'recording') active.stream.getTracks().forEach(function (track) { try { track.stop(); } catch (e) {} });
    }
    roleAudio = { state: 'idle', recorder: null, chunks: [], startedAt: 0, stream: null, request: (active && active.request ? active.request + 1 : 0), cancelled: false };
    try { if (window.speechSynthesis) speechSynthesis.cancel(); } catch (e) {}
  }
  function render() {
    cleanupMedia();
    var t = TOP[state.view] || ['总览', ''];
    if ($('topTitle')) $('topTitle').textContent = t[0];
    if ($('topSub')) $('topSub').textContent = t[1];
    renderSide();
    if (state.view === 'home') renderHome();
    else if (state.view === 'map') renderMap();
    else if (state.view === 'module') renderModule(state.m);
    else if (state.view === 'today') renderToday();
    else if (state.view === 'review') renderReview();
    else if (state.view === 'phrases') renderPhraseBank();
    else if (state.view === 'dict') renderDict();
    else if (state.view === 'progress') renderProgress();
    else if (state.view === 'settings') renderSettings();
    else if (state.view === 'scene') renderScene(state.m, state.s);
    window.scrollTo(0, 0);
  }

  function renderHome() {
    var total = 0, doneN = 0; P.modules.forEach(function (m) { m.scenes.forEach(function (sc) { total++; if (S.done[m.id + '|' + sc.id]) doneN++; }); });
    var pr = P.meta.principles.map(function (p) { return '<span>✓ ' + esc(p) + '</span>'; }).join('');
    var modules = P.modules.map(function (m) {
      var d = moduleDone(m), t = m.scenes.length, pct = Math.round(d / t * 100);
      return '<div class="mcard" data-act="open-module" data-m="' + m.id + '" style="--mc:' + m.color + '">' +
        '<h3>' + m.zh + ' <span class="small">· ' + esc(m.en) + '</span></h3>' +
        '<p>' + esc(m.intro) + '</p><div class="prog"><i style="width:' + pct + '%"></i></div>' +
        '<div class="small" style="margin-top:6px">已完成 ' + d + ' / ' + t + ' 节</div></div>';
    }).join('');
    $('view').innerHTML =
      '<div class="hero"><h2>' + esc(P.meta.title) + '</h2>' +
      '<p>' + esc(P.meta.subtitle) + '</p><p class="small" style="color:#bcd0ec">' + esc(P.meta.tagline) + '</p>' +
      '<div class="princ">' + pr + '</div>' +
      '<button class="cta" data-act="nav" data-view="today"> 开始今日深学 →</button></div>' +
      '<div class="grid">' + modules + '</div>';
  }

  function renderMap() {
    var html = '<h2 style="margin:4px 0 2px">知识地图</h2><p class="muted">6 个模块，每个模块包含具体课程。先选择模块，再进入一节课程学习。</p>';
    P.modules.forEach(function (m) {
      html += '<div class="card" style="border-left:4px solid ' + m.color + '"><div class="row"><div><h3 style="margin:0">' + m.zh + ' <span class="small">· ' + esc(m.en) + '</span></h3>' +
        '<div class="muted">' + esc(m.intro) + '</div></div></div><div class="grid" style="margin-top:12px">';
      m.scenes.forEach(function (s) {
        var done = S.done[m.id + '|' + s.id];
        html += '<div class="mcard" data-act="open-scene" data-m="' + m.id + '" data-s="' + s.id + '" style="cursor:pointer;border-top:3px solid ' + m.color + '">' +
          '<h3 style="margin:0 0 4px;font-size:15px">' + s.zh + (done ? ' <span class="done-tag">已学</span>' : '') + '</h3>' +
          '<div class="small" style="color:var(--sub)">' + esc(s.en) + '</div>' +
          '<div class="small" style="margin-top:6px">' + esc(s.goal) + '</div></div>';
      });
      html += '</div></div>';
    });
    $('view').innerHTML = html;
  }

  function renderModule(mid) {
    var m = moduleById(mid); if (!m) { state.view = 'map'; render(); return; }
    var d = moduleDone(m), t = m.scenes.length, pct = Math.round(d / t * 100);
    var html = '<div class="backbar"><button class="minibtn" data-act="nav" data-view="map">← 知识地图</button></div>';
    html += '<div class="scene-head"><div><h2 style="margin:0">' + m.zh +
      ' <span class="small">· ' + esc(m.en) + '</span></h2><div class="muted">' + esc(m.intro) + '</div></div>' +
      '<span class="spacer"></span><span class="small">已完成 ' + d + '/' + t + '</span></div><div class="bar" style="margin:8px 0 14px"><i style="width:' + pct + '%"></i></div>';
    m.scenes.forEach(function (s, i) {
      var done = S.done[m.id + '|' + s.id];
      html += '<div class="card" style="cursor:pointer" data-act="open-scene" data-m="' + m.id + '" data-s="' + s.id + '">' +
        '<div class="row"><b>' + (i + 1) + '. ' + s.zh + (done ? ' <span class="done-tag">已学</span>' : '') + '</b>' +
        '<span class="spacer"></span><span class="small">' + esc(s.en) + ' →</span></div>' +
        '<div class="muted" style="margin-top:4px">' + esc(s.goal) + '</div></div>';
    });
    $('view').innerHTML = html;
  }

  function badgeHtml(b, sources) {
    if (b === 'fact') {
      var links = (sources || []).map(function (sid) { var s = srcById(sid); return s ? '<a href="' + s.url + '" target="_blank" rel="noopener">🔗 ' + esc(s.label) + '</a>' : ''; }).join(' · ');
      return '<span class="badge-fact" title="事实 · 可核验">✔ 事实·可核验</span>' + (links ? ' <span class="small">' + links + '</span>' : '');
    }
    if (b === 'opinion') return '<span class="badge-opinion" title="表达建议 · 非事实"> 表达·建议</span>';
    return '';
  }


  /* ---------------- 外宾模拟：多轮追问 + 可解释的本地反馈 ----------------
   * 反馈只检查转写文本中的结构和信息覆盖；录音只分析节奏，不冒充发音评测。
   */
  var roleState = null;
  var roleRec = null;
  var roleAudio = { state: 'idle', recorder: null, chunks: [], startedAt: 0, stream: null, request: 0, cancelled: false };
  var lineRec = null;
  var lastRecEl = null;
  function roleTurns(scene) {
    var bank = window.ROLE_TURNS || {};
    var turns = bank[scene.id];
    if (!Array.isArray(turns) || turns.length !== 4) return [];
    return turns.map(function (t) {
      return { q: t.q || '', zhQuestion: t.zh || '', ref: t.ref || '', zh: t.refZh || '', focus: t.focus || [] };
    });
  }
  function roleDataReady(scene) {
    var turns = roleTurns(scene);
    return turns.length === 4 && turns.every(function (t) { return t.q && t.ref && t.zh; });
  }
  function startRole(mid, sid) {
    var f = findScene(mid, sid); if (!f) return;
    var turns = roleTurns(f.s);
    if (turns.length !== 4) { toast('本节外宾模拟数据未完成，暂不能开始'); return; }
    roleState = { mid: mid, sid: sid, turn: 0, turns: turns, answers: [], checked: [] };
    drawRoleSimulator();
  }
  function stopRoleSpeech() {
    if (roleRec) { try { roleRec.stop(); } catch (e) {} }
    roleRec = null;
  }
  function roleStartSpeech() {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { roleSetStatus('当前浏览器不支持语音转写。请使用 Chrome / Edge，或直接在文本框输入。', 'warn'); return; }
    stopRoleSpeech();
    var r = new SR(); roleRec = r;
    r.lang = 'en-US'; r.interimResults = true; r.continuous = true; r.maxAlternatives = 1;
    var finals = '', last = '';
    r.onstart = function () { roleSetStatus(' 正在连续转写：请用完整英文回答；结束后点击“停止转写”。', 'recon'); };
    r.onresult = function (e) {
      var interim = '';
      for (var i = e.resultIndex; i < e.results.length; i++) {
        var tx = e.results[i][0].transcript.trim();
        if (e.results[i].isFinal) { if (tx && tx !== last) { finals += (finals ? ' ' : '') + tx; last = tx; } }
        else interim += tx + ' ';
      }
      var all = (finals + (interim ? (finals ? ' ' : '') + interim.trim() : '')).trim();
      var ta = $('roleAnswer'); if (ta) ta.value = all;
    };
    r.onerror = function (e) { if (e.error !== 'no-speech' && e.error !== 'aborted') roleSetStatus('转写中断：' + esc(e.error) + '。你可以直接修正或手动输入。', 'warn'); };
    r.onend = function () { if (roleRec === r) { roleRec = null; roleSetStatus('转写已停止。请检查文本后再点“检查回答”。', 'success'); } };
    try { r.start(); } catch (e) { roleSetStatus('无法启动转写，请检查麦克风权限。', 'warn'); }
  }
  function roleSetStatus(text, cls) { var el = $('roleSpeechStatus'); if (el) el.innerHTML = '<div class="' + (cls || 'small') + '">' + text + '</div>'; }
  function keywords(text) {
    var stop = {the:1,and:1,that:1,with:1,from:1,this:1,have:1,will:1,for:1,are:1,our:1,what:1,when:1,your:1,into:1,about:1,which:1,they:1,them:1,then:1,than:1,also:1,can:1,not:1,more:1};
    var out = []; (String(text || '').toLowerCase().match(/[a-z]{5,}/g) || []).forEach(function (w) { if (!stop[w] && out.indexOf(w) < 0) out.push(w); });
    return out.slice(0, 6);
  }
  function cleanSpokenEnglish(text) {
    var t = String(text || '').trim().replace(/\s+/g, ' ');
    if (!t) return '';
    var fixes = [
      [/\bi\s/gi, 'I '],
      [/\bi\b/g, 'I'],
      [/\bim\b/gi, 'I\'m'],
      [/\bdont\b/gi, 'don\'t'],
      [/\bcant\b/gi, 'can\'t'],
      [/\bwecom\b/gi, 'WeCom'],
      [/\btencent meeting\b/gi, 'Tencent Meeting'],
      [/\bhunyuan\b/gi, 'Hunyuan'],
      [/\byuanbao\b/gi, 'Yuanbao']
    ];
    fixes.forEach(function (x) { t = t.replace(x[0], x[1]); });
    t = t.charAt(0).toUpperCase() + t.slice(1);
    if (!/[.!?]$/.test(t)) t += '.';
    return t;
  }
  function makeOptimizedAnswer(answer, turn) {
    var cleaned = cleanSpokenEnglish(answer);
    var words = (cleaned.match(/[A-Za-z]+(?:'[A-Za-z]+)?/g) || []).length;
    if (words < 7) return turn.ref;
    // 常见口语转写/中式搭配的可解释修正；不会伪装成对任意复杂语法的人工判改。
    var rewrites = [
      [/I cannot speak for others,? but/gi, 'I would avoid speaking for other providers. For our own positioning,'],
      [/our positioning is/gi, 'our positioning focuses on'],
      [/built for industry scenarios/gi, 'designed to support industry scenarios'],
      [/strong connectivity to/gi, 'strong connections with'],
      [/we just/gi, 'we do not simply'],
      [/it is very good/gi, 'it can be useful for the defined workflow']
    ];
    rewrites.forEach(function (x) { cleaned = cleaned.replace(x[0], x[1]); });
    var coverage = roleCoverage(cleaned, turn);
    if (!coverage.missing.length) return cleaned;
    // 只补本题尚未覆盖的信息，保证“优化稿”仍以学习者原意为主，而不是错配到别题答案。
    return cleaned + ' More specifically, ' + turn.ref;
  }
  function roleCoverage(answer, turn) {
    var low = String(answer || '').toLowerCase();
    var hit = (turn.focus || []).filter(function (x) { return low.indexOf(String(x).toLowerCase()) >= 0; });
    var missing = (turn.focus || []).filter(function (x) { return hit.indexOf(x) < 0; });
    return { hit: hit, missing: missing };
  }
  function checkRoleAnswer() {
    if (!roleState) return;
    if (state.m && state.s) { sceneSignals(state.m, state.s).roleAttempt = true; save(); }
    var ta = $('roleAnswer'), ans = ta ? ta.value.trim() : '';
    roleState.answers[roleState.turn] = ans;
    var turn = roleState.turns[roleState.turn], words = (ans.match(/[A-Za-z]+(?:'[A-Za-z]+)?/g) || []).length;
    var hasStructure = /the short answer|at a high level|first|second|finally|because|for example|in practical terms|to sum up|the key point/i.test(ans);
    var hasBoundary = /not sure|verify|let me check|get back|specialist|i do not want to guess|can confirm|assessed/i.test(ans);
    var coverage = roleCoverage(ans, turn);
    var enoughCoverage = coverage.hit.length >= Math.min(2, (turn.focus || []).length);
    var score = Math.min(5, (words >= 18 ? 1 : 0) + (words >= 40 ? 1 : 0) + (hasStructure ? 1 : 0) + (enoughCoverage ? 1 : 0) + (hasBoundary ? 1 : 0));
    var optimized = makeOptimizedAnswer(ans, turn);
    roleState.checked[roleState.turn] = { score: score, words: words, hit: coverage.hit.length, total: (turn.focus || []).length, optimized: optimized };
    var lengthTip = words < 18 ? '回答偏短：先给一句结论，再补一个理由、例子或边界。' : (words < 40 ? '长度基本够用：可再补一项本题要求的信息。' : '展开充分：注意准确性，不必为了长度堆词。');
    var el = $('roleFeedback'); if (el) el.innerHTML = '<div class="role-feedback"><b>本题内容检查 ' + score + ' / 5</b><div>已覆盖：' + (coverage.hit.length ? esc(coverage.hit.join('、')) : '暂未识别到本题关键点') + '</div><div>待补：' + (coverage.missing.length ? esc(coverage.missing.join('、')) : '无明显缺项') + '</div><div>结构：' + (hasStructure ? '✓ 有明确展开信号' : '建议用 The short answer is… / At a high level,… / For example,… 组织回答。') + '</div><div>' + lengthTip + '</div>' + (hasBoundary ? '<div>✓ 你使用了核实或边界处理表达。</div>' : '') + '<div class="role-answer-block"><b>本题标准示范（对题版）</b><div class="en">' + esc(turn.ref) + '</div><div class="zh">' + esc(turn.zh) + '</div><div class="rowact">' + enBtn(turn.ref, '朗读标准示范') + '</div></div><div class="role-answer-block optimized"><b>基于你回答的优化稿</b><div class="small">保留你已表达的思路，并补齐本题缺失的信息与更稳妥的结构；不是对任意口音或复杂语法的人工级评测。</div><div class="en">' + esc(optimized) + '</div><div class="rowact">' + enBtn(optimized, '朗读优化稿') + '</div></div><div class="small">检查依据：你的语音转写/手动文本与本题专属关键点；不等同于 AI 语义判卷或发音评分。</div></div>';
  }
  function roleNext() {
    if (!roleState) return;
    checkRoleAnswer();
    if (roleState.turn < roleState.turns.length - 1) { roleState.turn++; drawRoleSimulator(); }
    else finishRole();
  }
  function finishRole() {
    if (!roleState) return;
    stopRoleSpeech();
    var answered = roleState.answers.filter(function (x) { return x && x.trim(); }).length;
    var scores = roleState.checked.filter(Boolean); var avg = scores.length ? Math.round(scores.reduce(function (n, x) { return n + x.score; }, 0) / scores.length * 10) / 10 : 0;
    S.roleplays.push({ scene: roleState.sid, at: Date.now(), answered: answered, total: roleState.turns.length, avg: avg });
    if (state.m && state.s) { sceneSignals(state.m, state.s).roleplay = answered >= roleState.turns.length; refreshStageGates(state.m, state.s); }
    save();
    var host = $('roleSim'); if (!host) return;
    host.innerHTML = '<div class="role-summary"><h3> 本轮复盘</h3><div class="role-stats"><span><b>' + answered + '/' + roleState.turns.length + '</b><small>已回答</small></span><span><b>' + avg + '/5</b><small>平均结构检查</small></span></div><ol><li>回听录音：是否先给结论，再给理由或例子？</li><li>回看每题参考回答：挑 1–2 个句块加入“间隔复习”。</li><li>隔一天再做同一场景，目标是更短、更清楚、更准确。</li></ol><div class="row"><button class="btn sm" data-act="role-restart">再练一遍</button><button class="minibtn" data-act="role-close">返回本节练习</button></div></div>';
    roleState = null;
  }
  function drawRoleSimulator() {
    var host = $('roleSim'); if (!host || !roleState) return;
    var t = roleState.turns[roleState.turn];
    host.innerHTML = '<div class="role-sim"><div class="role-top"><span class="role-label">VISITOR · 外宾追问</span><span class="pill">第 ' + (roleState.turn + 1) + ' / ' + roleState.turns.length + ' 问</span></div><div class="role-question"><div class="role-question-en">' + esc(t.q) + '</div><div class="role-question-zh">' + esc(t.zhQuestion) + '</div></div><div class="role-actions"><button class="minibtn" data-act="speak" data-text=' + jq(t.q) + '> 朗读问题</button><button class="minibtn" data-act="role-speech"> 连续转写</button><button class="minibtn" data-act="role-stop"> 停止转写</button><button class="minibtn" data-act="role-record"> 记录节奏</button></div><div id="roleSpeechStatus" class="role-status">请先独立回答；提交后将显示“本题标准示范”和“基于你回答的优化稿”，两者都可朗读。</div><textarea id="roleAnswer" class="role-textarea" placeholder="建议：结论先行 → 一个理由/例子 → 必要时说明边界或下一步。">' + esc(roleState.answers[roleState.turn] || '') + '</textarea><div class="row"><button class="btn sm ghost" data-act="role-check"> 检查并生成优化稿</button><button class="btn sm" data-act="role-next">' + (roleState.turn === roleState.turns.length - 1 ? '结束并复盘' : '提交并继续追问 →') + '</button><button class="minibtn" data-act="role-show-ref">查看本题标准示范</button></div><div id="roleFeedback"></div><div id="roleRecord"></div><div id="roleRef" class="role-ref"><b>本题标准示范（完成独立作答后再看）</b><div class="en">' + esc(t.ref) + '</div><div class="zh">' + esc(t.zh) + '</div><div class="rowact">' + enBtn(t.ref, '朗读标准示范') + '</div></div></div>';
  }
  function roleRecord() {
    var box = $('roleRecord'); if (!box) return;
    if (roleAudio.state === 'recording') { try { roleAudio.recorder.stop(); } catch (e) {} return; }
    if (roleAudio.state === 'requesting') { toast('正在请求麦克风，请稍候'); return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { box.innerHTML = '<div class="warn">当前浏览器无法录音。建议使用 Chrome / Edge，并通过本地 localhost 打开。</div>'; return; }
    if (!window.MediaRecorder) { box.innerHTML = '<div class="warn">当前浏览器不支持录音功能。你仍可使用“连续转写”或手动输入回答。</div>'; return; }
    var request = (roleAudio.request || 0) + 1;
    roleAudio = { state: 'requesting', recorder: null, chunks: [], startedAt: 0, stream: null, request: request, cancelled: false };
    box.innerHTML = '<div class="recon">正在请求麦克风权限…</div>';
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      if (roleAudio.request !== request || roleAudio.state !== 'requesting') { stream.getTracks().forEach(function (x) { x.stop(); }); return; }
      var rec; try { rec = new MediaRecorder(stream); } catch (e) { stream.getTracks().forEach(function (x) { x.stop(); }); roleAudio.state = 'idle'; box.innerHTML = '<div class="warn">当前浏览器无法创建录音。你仍可使用连续转写或手动输入。</div>'; return; }
      var session = { state: 'recording', recorder: rec, chunks: [], startedAt: Date.now(), stream: stream, request: request, cancelled: false };
      roleAudio = session;
      box.innerHTML = '<div class="recon"> 录音中：说完这段回答后，再点一次“记录节奏”结束。</div>';
      rec.ondataavailable = function (e) { if (e.data && e.data.size) session.chunks.push(e.data); };
      rec.onstop = function () {
        if (session.stream) session.stream.getTracks().forEach(function (x) { try { x.stop(); } catch (e) {} });
        var sec = (Date.now() - session.startedAt) / 1000;
        var blob = new Blob(session.chunks, { type: rec.mimeType || 'audio/webm' });
        if (roleAudio === session) roleAudio = { state: 'idle', recorder: null, chunks: [], startedAt: 0, stream: null, request: request, cancelled: false };
        if (!session.cancelled && document.body.contains(box)) analyseRoleAudio(blob, sec, box);
      };
      rec.start();
    }).catch(function () { if (roleAudio.request === request) roleAudio.state = 'idle'; box.innerHTML = '<div class="warn">未获得麦克风权限。请在浏览器地址栏允许麦克风后再试。</div>'; });
  }
  function analyseRoleAudio(blob, sec, box) {
    var url = URL.createObjectURL(blob), base = '<audio controls src="' + url + '" style="width:100%;margin-top:8px"></audio>';
    var fr = new FileReader();
    fr.onload = function () { var AC = window.AudioContext || window.webkitAudioContext; if (!AC) { box.innerHTML = '<div class="role-meter"> 录音 ' + sec.toFixed(1) + ' 秒。建议回听自己的停顿与结论是否清晰。</div>' + base; return; }
      try { var ac = new AC(); ac.decodeAudioData(fr.result, function (buf) { var ch = buf.getChannelData(0), step = Math.max(1, Math.floor(ch.length / 500)), active = 0, sum = 0, n = 0; for (var i = 0; i < ch.length; i += step) { var v = Math.abs(ch[i]); sum += v; if (v > .02) active++; n++; } var ratio = n ? active / n : 0, volume = n ? sum / n : 0; ac.close(); box.innerHTML = '<div class="role-meter"><b>表达节奏参考</b> · ' + sec.toFixed(1) + ' 秒 · 说话占比 ' + Math.round(ratio * 100) + '% · 音量稳定参考 ' + Math.round(Math.min(100, volume / .16 * 100)) + '%<div class="small">仅根据录音时长、声音连续度和平均音量做本地估算；不等同于发音或英语能力评分。</div></div>' + base; }, function () { box.innerHTML = '<div class="role-meter"> 录音 ' + sec.toFixed(1) + ' 秒。建议回听自己的停顿与结论是否清晰。</div>' + base; }); } catch (e) { box.innerHTML = '<div class="role-meter"> 录音 ' + sec.toFixed(1) + ' 秒。</div>' + base; }
    }; fr.readAsArrayBuffer(blob);
  }

  function renderScene(mid, sid) {
    var f = findScene(mid, sid); if (!f) { state.view = 'map'; render(); return; }
    var m = f.m, s = f.s;
    var situ = s.situation;
    var progress = sceneProgress(mid, sid), activeStage = sceneStage(mid, sid);
    var completedCount = [progress.understand, progress.imitate, progress.output].filter(Boolean).length;
    var html = '<div class="backbar"><button class="minibtn" data-act="open-module" data-m="' + m.id + '">← ' + m.zh + '（模块）</button>' +
      '<button class="minibtn" data-act="nav" data-view="map" style="margin-left:6px">← 知识地图</button></div>';
    html += '<div class="scene-head"><div>' +
      '<h2 style="margin:0">' + s.zh + '</h2><div class="muted">' + esc(s.en) + '</div></div>' +
      '<div class="spacer"></div>' +
      (S.done[m.id + '|' + s.id] ? '<span class="done-tag">本节已完成 · 可复习</span>' : '<span class="stage-status">已完成 ' + completedCount + '/3 阶段</span>') +
      '</div>';
    html += '<div class="card" style="background:#fbfdff"><div class="row"><b> 情境</b><span class="spacer"></span>' +
      '<span class="pill">目标：' + esc(s.goal) + '</span></div>' +
      '<p class="muted" style="margin:8px 0 0"><b>地点 / 角色：</b>' + esc(situ.where + ' ｜ ' + situ.who) + '</p>' +
      '<p class="muted" style="margin:4px 0 0"><b>前情 → 后情：</b>' + esc(situ.before) + ' <b>→</b> ' + esc(situ.after) + '</p></div>';

    var stageCards = STAGES.map(function (st, i) {
      var complete = !!progress[st.id], tasks = stageTasks(m.id, s.id, i), doneN = tasks.filter(function (t) { return t.done; }).length;
      return '<button class="stage-card ' + (i === activeStage ? 'active ' : '') + (complete ? 'complete ' : '') + '" data-act="stage" data-stage="' + i + '" data-m="' + m.id + '" data-s="' + s.id + '"><span class="stage-num">' + (complete ? '✓' : (i + 1)) + '</span><span><b>' + st.label + '</b><small>' + st.desc + '</small>' +
        '<em class="stage-review">' + (complete ? '已完成 · 可随时复习' : '任务 ' + doneN + '/' + tasks.length + ' 已完成') + '</em></span></button>';
    }).join('');
    html += '<div class="stage-flow"><div class="stage-flow-title"><b>本节学习路径</b><span class="small">完成每一阶段列出的任务，按钮才会点亮；三个阶段均可随时回顾。</span></div><div class="stage-cards">' + stageCards + '</div></div>';

    // vocab + phrase cards
    var customN = sceneCustomItems(mid, sid).length, phraseN = scenePhraseItems(mid, sid).length;
    var vHtml = '<div class="study-section-intro"><div><span class="section-kicker">理解任务 1 / 2</span><h3>词汇卡</h3><p>先看英文，再揭示释义和例句；场景中非基础词或短语可三击查询，并加入本节。</p></div><span class="study-total">本轮 ' + sceneVocabItems(mid, sid).length + ' 张</span></div>' +
      (customN ? '<div class="personal-vocab-note">本节已收集 <b>' + customN + '</b> 个个人词/短语，它们会与系统词汇一起进入本轮训练。</div>' : '') +
      '<div id="vocabWrap"></div>' +
      '<div class="phrase-section"><div class="study-section-intro"><div><span class="section-kicker">理解任务 2 / 2</span><h3>本节短语卡</h3><p>一张一张记：中文短语 → 英文短语。每张附本课真实用法和中文意思。</p></div><span class="study-total">本轮 ' + phraseN + ' 张</span></div><div id="phraseCardWrap"></div></div>';
    if (!(sceneVocabItems(mid, sid).length)) vHtml += '<p class="muted">本节未设词汇表；你可以在场景英文上三击词或短语，把它加入本节。</p>';

    // shadow
    var shHtml = '<p class="muted">先听标准英文（），再点  录音模仿打分。建议每句重复 2–3 遍，直到跟上节奏与重音。</p><div class="dlg">';
    (s.shadow || []).forEach(function (l, li) {
      shHtml += '<div class="line"><div class="who you">跟读</div><div class="bubble">' +
        '<div class="en">' + lookupText(l.en, 'shadow-en') + '</div><div class="zh">' + esc(l.zh) + '</div>' +
        '<div class="rowact">' + enBtn(l.en) +
        ' <button class="minibtn" data-act="start-record" data-en=' + jq(l.en) + ' data-rid="' + s.id + '_sh' + li + '"> 录音打分</button>' +
        ' <span id="' + s.id + '_sh' + li + '"></span>' +
        ' <button class="minibtn" data-act="add-srs" data-id="' + s.id + '_sh' + li + '" data-front=' + jq(l.en) + ' data-back=' + jq(l.zh) +
        ' data-ctx=' + jq(m.zh + ' · ' + s.zh + ' / 跟读') + '> 复习这句</button></div></div></div>';
    });
    shHtml += '</div>';
    if (!(s.shadow && s.shadow.length)) shHtml += '<p class="muted">本节未设跟读句。</p>';

    // concept（标准释义，无类比）
    var cHtml = '';
    (s.concepts || []).forEach(function (c, ci) {
      var cid = s.id + '_c' + ci;
      cHtml += '<div class="concept"><div class="chead"><span>' + esc(c.term) + ' <span class="en">' + esc(c.zh) + '</span></span>' +
        badgeHtml(c.badge, c.sources) + '</div>' +
        '<div class="row"><div class="lab">标准释义（面向小白）</div>' + esc(c.def) + '</div>' +
        (c.official ? '<div class="row"><div class="lab">官方表述</div><div class="official">' + esc(c.official) + '</div></div>' : '') +
        (c.case ? '<div class="row"><div class="lab">真实案例</div>' + esc(c.case) + '</div>' : '') +
        '<div class="row en"><div class="lab">场景例句</div><div class="enline">' + lookupText(c.enExample, 'concept-example-en') + '</div>' +
        '<div>' + esc(c.zhExample) + '</div>' +
        '<div class="rowact">' + enBtn(c.enExample) +
        ' <button class="minibtn" data-act="add-srs" data-id="' + cid + '" data-front=' + jq(c.enExample) + ' data-back=' + jq(c.zhExample) +
        ' data-ctx=' + jq(m.zh + ' · ' + s.zh + ' / ' + c.term) + ' data-badge="' + (c.badge || '') + '"> 加入复习</button></div></div>' +
        '<div class="row"><div class="lab">常见误解</div><div class="mistake">' + esc(c.mistake) + '</div></div></div>';
    });
    if (!(s.concepts && s.concepts.length)) cHtml += '<p class="muted">本节未设概念深卡。</p>';

    // dialogue：每句承担明确交流功能，不将对话作为可有可无的展示文字。
    var dHtml = '<p class="muted">这里不是“读一遍就过”的示例。每段都按真实任务组织：外宾问题 → 你先澄清或定位 → 核心回答 → 例子/边界 → 下一步。蓝色为你可直接调用的表达；每句下方标出它的沟通动作。</p><div class="dlg">';
    s.dialogue.forEach(function (l, li) {
      var isYou = l.who === '你' || l.who === 'You';
      var whoCls = isYou ? 'you' : 'guest';
      dHtml += '<div class="line"><div class="who ' + whoCls + '">' + esc(l.who) + '</div><div class="bubble">' +
        '<div class="en">' + lookupText(l.en, 'dialogue-en') + '</div><div class="zh">' + esc(l.zh) + '</div>' +
        (isYou && l.purpose ? '<div class="line-purpose"> ' + esc(l.purpose) + '</div>' : '') +
        '<div class="rowact">' + (isYou ? (enBtn(l.en) +
          badgeHtml(l.badge, l.sources) +
          ' <button class="minibtn" data-act="add-srs" data-id="' + s.id + '_d' + li + '" data-front=' + jq(l.en) + ' data-back=' + jq(l.zh) +
          ' data-ctx=' + jq(m.zh + ' · ' + s.zh + ' / ' + (l.purpose || '关键表达')) + ' data-badge="' + (l.badge || '') + '"> 复习这句</button>' +
          ' <button class="minibtn" data-act="start-record" data-en=' + jq(l.en) + ' data-rid="' + s.id + '_r' + li + '"> 录音打分</button>' +
          ' <span id="' + s.id + '_r' + li + '"></span>') : '') +
        '</div></div></div>';
    });
    dHtml += '</div>';

    // recall
    var rHtml = '<p class="muted">先盖住答案、自己说/写，再点「看答案」——主动提取比反复听更记得住。</p>';
    (s.recall || []).forEach(function (q, qi) {
      var qid = s.id + '_q' + qi;
      rHtml += '<div class="quiz"><div class="q"> ' + esc(q.prompt) + '</div>' +
        '<div class="acts"><button class="btn sm" data-act="reveal-quiz" data-qid="' + qid + '">看答案</button></div>' +
        '<div class="reveal" id="' + qid + '">' + esc(q.model) + '</div></div>';
    });

    // respond（情景应答）
    var respHtml = '<p class="muted">给定场景，请你先用英文组织一段回答（可默念或写下），再点「看参考答案」核对。重点练"从问题到表达"的组织能力。</p>';
    (s.respond || []).forEach(function (q, qi) {
      var qid = s.id + '_resp' + qi;
      respHtml += '<div class="quiz"><div class="q"> ' + esc(q.prompt) + '</div>' +
        (q.hint ? '<div class="small" style="margin:4px 0">提示：' + esc(q.hint) + '</div>' : '') +
        '<div class="acts"><button class="btn sm" data-act="reveal-quiz" data-qid="' + qid + '">看参考答案</button>' +
        (q.refEn ? ' ' + enBtn(q.refEn, '听英文') : '') + '</div>' +
        '<div class="reveal" id="' + qid + '"><b>EN：</b>' + esc(q.refEn || '') + '<br><b>中：</b>' + esc(q.refZh || '') + '</div></div>';
    });
    if (!(s.respond && s.respond.length)) respHtml += '<p class="muted">本节未设情景应答。</p>';

    // roleplay：单轮材料升级为四轮追问训练，不替代本节标准内容。
    var rp = s.roleplay;
    var rpHtml = rp ? '<div class="rp role-intro"><div class="setup"> ' + esc(rp.setup) + '</div><div class="guest">外宾（开场）：<br>"' + esc(rp.guestLine) + '"</div><div class="small" style="margin:8px 0"><b>本轮训练：</b>开场回答 → 解释追问 → 具体例子 → 下一步。先独立作答，再看参考。</div><button class="btn sm" data-act="start-role" data-m="' + m.id + '" data-s="' + s.id + '">开始 4 轮外宾模拟 →</button></div><div id="roleSim"></div>' : '<p class="muted">本节未设外宾模拟。</p>'; 

    // fix（表达纠错）
    var fixHtml = '<p class="muted">先看一句"中式或薄弱"的英文，想清楚问题在哪，再对照「更标准的表达」。这能直接提升你对外讲的得体度。</p>';
    (s.errorFix || []).forEach(function (fx, xi) {
      fixHtml += '<div class="fix"><div class="weak"> 较弱：<span class="en">' + esc(fx.weak) + '</span>' +
        (fx.why ? '<div class="why">问题：' + esc(fx.why) + '</div>' : '') + '</div>' +
        '<div class="good"> 更标准：<div class="en">' + esc(fx.better) + '</div>' +
        (fx.betterZh ? '<div class="zh">' + esc(fx.betterZh) + '</div>' : '') +
        '<div class="rowact">' + enBtn(fx.better) + ' <button class="minibtn" data-act="add-srs" data-id="' + s.id + '_fx' + xi +
        '" data-front=' + jq(fx.better) + ' data-back=' + jq(fx.betterZh || fx.why || '') +
        ' data-ctx=' + jq(m.zh + ' · ' + s.zh + ' / 表达纠错') + '> 复习</button></div></div></div>';
    });
    if (!(s.errorFix && s.errorFix.length)) fixHtml += '<p class="muted">本节未设表达纠错。</p>';

    // sources
    var srcIds = {}; (s.sources || []).forEach(function (x) { srcIds[x] = 1; });
    (s.concepts || []).forEach(function (c) { (c.sources || []).forEach(function (x) { srcIds[x] = 1; }); });
    s.dialogue.forEach(function (l) { (l.sources || []).forEach(function (x) { srcIds[x] = 1; }); });
    var srcHtml = '<p class="muted">本场景引用的事实来源（点击可核验）。没有来源标注的为「表达建议」，非事实陈述。</p>';
    var any = false;
    P.sources.forEach(function (s2) {
      if (!srcIds[s2.id]) return; any = true;
      srcHtml += '<div class="dictitem"><h4>🔗 ' + esc(s2.label) + '</h4><div class="small">' + esc(s2.note) + '</div>' +
        '<div style="margin-top:6px"><a href="' + s2.url + '" target="_blank" rel="noopener">' + esc(s2.url) + '</a></div></div>';
    });
    if (!any) srcHtml += '<p class="muted">本场景主要为表达训练，无新增事实来源。</p>';

    function stageFooter(i) {
      var complete = !!progress[STAGES[i].id], ready = stageReady(m.id, s.id, i), next = i < 2 ? STAGES[i + 1].label : '完成本节';
      var tasks = '<div class="stage-requirements"><div class="stage-req-title">完成本阶段需要</div>' + taskListHtml(m.id, s.id, i, false) + '</div>';
      if (complete && i < 2) return tasks + '<div class="stage-footer"><span class="done-tag">本阶段已完成 · 可随时复习</span><button class="btn sm" data-act="stage" data-stage="' + (i + 1) + '" data-m="' + m.id + '" data-s="' + s.id + '">进入' + next + '阶段 →</button></div>';
      if (complete && i === 2) return tasks + '<div class="stage-footer"><span class="done-tag">本节已完成 · 可随时复习</span><button class="minibtn" data-act="nav" data-view="today">返回今日学习</button></div>';
      return tasks + '<div class="stage-footer"><span class="small">' + (ready ? '全部任务已完成，现在可以记录本阶段完成。' : '请先完成上方所有任务；内容始终可以自由查看。') + '</span><button class="btn sm" data-act="complete-stage" data-stage="' + i + '" data-m="' + m.id + '" data-s="' + s.id + '"' + (ready ? '' : ' disabled') + '>' + (i < 2 ? '完成' + STAGES[i].label + '阶段，进入' + next : '完成本节课程') + ' →</button></div>';
    }
    html += '<section class="stage-pane" style="display:' + (activeStage === 0 ? '' : 'none') + '">' +
      (s.brief ? '<div class="card stage-intro"><b>知识要点</b><p class="muted" style="margin:6px 0 0">' + esc(s.brief) + '</p></div>' : '') + vHtml + cHtml + srcHtml + stageFooter(0) + '</section>' +
      '<section class="stage-pane" style="display:' + (activeStage === 1 ? '' : 'none') + '"><div class="stage-heading"><b>模仿阶段</b><span>先听、再跟读，再观察表达在对话中的作用。</span></div>' + shHtml + dHtml + fixHtml + stageFooter(1) + '</section>' +
      '<section class="stage-pane" style="display:' + (activeStage === 2 ? '' : 'none') + '"><div class="stage-heading"><b>输出阶段</b><span>先自己组织，再看示范；最后完成外宾模拟。</span></div>' + rHtml + respHtml + rpHtml + stageFooter(2) + '</section>';

    $('view').innerHTML = html;
    if (sceneVocabItems(mid, sid).length) startVocab(mid, sid);
    startPhraseCards(mid, sid);
  }

  function renderToday() {
    var pick = null;
    outer: for (var i = 0; i < P.modules.length; i++) for (var j = 0; j < P.modules[i].scenes.length; j++) {
      var m = P.modules[i], sc = m.scenes[j];
      if (!S.done[m.id + '|' + sc.id]) { pick = { m: m.id, s: sc.id }; break outer; }
    }
    if (!pick) { var mm = P.modules[0]; pick = { m: mm.id, s: mm.scenes[0].id }; }
    var f = findScene(pick.m, pick.s);
    // 今日学习实际跳转到课程页面，同时同步标题、侧栏和外宾模拟返回状态。
    state.view = 'scene'; state.m = pick.m; state.s = pick.s;
    render();
  }

  function renderReview() {
    var due = srsDue();
    var all = []; for (var k in S.srs) if (S.srs.hasOwnProperty(k)) all.push({ id: k, c: S.srs[k] });
    var html = '<div class="row"><h2 style="margin:4px 0"> 间隔复习</h2><span class="spacer"></span>' +
      '<span class="pill">待复习 ' + due.length + '</span><span class="pill" style="background:#f0f4f9;color:var(--sub)">清单共 ' + all.length + '</span></div>' +
      '<p class="muted">看到英文或情境后，先自己回忆中文意思，再点击“翻面”核对。按掌握程度打分，系统会安排下次复习。</p>';
    if (!all.length) { html += '<div class="card">还没有复习卡片。在任意概念、对话句或词汇点「 加入复习」即可。</div>'; $('view').innerHTML = html; return; }

    if (due.length) {
      html += '<h3 style="margin:14px 0 4px"> 现在该复习的（' + due.length + '）</h3><div class="deck">';
      due.forEach(function (it) {
        html += '<div class="fcard"><div class="ctx">' + esc(it.c.ctx) + ' ' + badgeHtml(it.c.badge, it.c.sources) + '</div>' +
          '<div class="en">' + esc(it.c.front) + '</div>' +
          '<div class="rowact">' + enBtn(it.c.front) + '</div>' +
          '<div class="reveal" id="rv_' + it.id + '" style="margin-top:8px;padding:9px 12px;background:#f1fbf6;border:1px solid #cdeede;border-radius:9px;display:none">' + esc(it.c.back) + '</div>' +
          '<div class="row" style="margin-top:8px"><button class="btn sm" data-act="rv-flip" data-id="' + it.id + '">翻面</button>' +
          '<span class="spacer"></span>' +
          '<button class="minibtn" data-act="grade" data-id="' + it.id + '" data-g="again">生疏</button>' +
          '<button class="minibtn" data-act="grade" data-id="' + it.id + '" data-g="hard">模糊</button>' +
          '<button class="minibtn" data-act="grade" data-id="' + it.id + '" data-g="good">熟练</button>' +
          '<button class="minibtn" data-act="grade" data-id="' + it.id + '" data-g="easy">太简单</button></div></div>';
      });
      html += '</div>';
    } else {
      html += '<div class="card" style="background:#e7f7ef;border:1px solid #bfe9d4"> 当前没有待复习项。明天再来，或去学习里继续加卡片。</div>';
    }

    html += '<h3 style="margin:18px 0 4px"> 全部复习卡片</h3><div class="deck">';
    all.forEach(function (it) {
      var dueSoon = it.c.due <= Date.now();
      html += '<div class="fcard"><div class="ctx">' + esc(it.c.ctx) + '</div><div class="en">' + esc(it.c.front) + '</div>' +
        '<div class="zh">' + esc(it.c.back) + '</div>' +
        '<div class="row" style="margin-top:8px">' + enBtn(it.c.front) +
        (dueSoon ? '<span class="done-tag">待复习</span>' : '<span class="small">下次 ' + new Date(it.c.due).toLocaleDateString() + '</span>') +
        '<span class="spacer"></span><button class="minibtn" data-act="srs-remove" data-id="' + it.id + '">移除</button></div></div>';
    });
    html += '</div>';
    $('view').innerHTML = html;
  }


  /* ---------------- 结构化句块库 ---------------- */
  function renderPhraseBank() {
    var html = '<div class="row"><h2 style="margin:4px 0"> 句块训练</h2><span class="spacer"></span><span class="pill">' + PHRASES.length + ' 个高频句块</span></div><p class="muted">把高频表达练成可以直接调用的“高频商务表达”。先按用途挑 3–5 条听读，再加入间隔复习；这里的句子是表达模板，不是对具体产品、数据或合作条件的承诺。</p><input class="search" id="phraseSearch" placeholder="搜索：澄清 / next step / example / 结论先行 …"><div id="phraseList"></div>';
    $('view').innerHTML = html; renderPhraseList('');
    $('phraseSearch').addEventListener('input', function (e) { renderPhraseList(e.target.value); });
  }
  function renderPhraseList(q) {
    q = String(q || '').toLowerCase(); var html = '<div class="phrase-grid">';
    PHRASES.forEach(function (p, i) { var hay = [p.en,p.zh,p.tag,p.use,p.example].join(' ').toLowerCase(); if (q && hay.indexOf(q) < 0) return;
      html += '<div class="phrase-card"><span class="phrase-tag">' + esc(p.tag) + '</span><h3>' + esc(p.en) + '</h3><div class="phrase-zh">' + esc(p.zh) + '</div><div class="phrase-use"><b>什么时候用：</b>' + esc(p.use) + '</div><div class="phrase-example"><span>例</span> ' + esc(p.example) + '</div><div class="rowact">' + enBtn(p.en, '听句块') + ' ' + enBtn(p.example, '听例句') + ' <button class="minibtn" data-act="add-srs" data-id="phrase_' + i + '" data-front=' + jq(p.en) + ' data-back=' + jq(p.zh + '｜' + p.use) + ' data-ctx=' + jq('句块训练 · ' + p.tag) + '> 加入复习</button></div></div>';
    });
    html += '</div>'; if (html === '<div class="phrase-grid"></div>') html = '<p class="muted">没有匹配的句块。</p>'; $('phraseList').innerHTML = html;
  }

  function renderDict() {
    var html = '<h2 style="margin:4px 0 2px"> 概念词典</h2><p class="muted">关键概念的标准释义 + 官方表述 + 真实案例，随时查、随时听。输入关键词（中/英）即可筛选。</p>' +
      '<input class="search" id="dictSearch" placeholder="搜索：foundation model / 产业互联网 / 导览 / hallucination …">' +
      '<div id="dictList"></div>';
    $('view').innerHTML = html;
    renderDictList('');
    $('dictSearch').addEventListener('input', function (e) { renderDictList(e.target.value); });
  }
  function renderDictList(q) {
    q = (q || '').toLowerCase();
    var html = '';
    P.modules.forEach(function (m) {
      m.scenes.forEach(function (s) {
        (s.concepts || []).forEach(function (c) {
          if (q && (c.term + c.zh + c.def + (c.official || '') + c.enExample).toLowerCase().indexOf(q) < 0) return;
          html += '<div class="dictitem"><h4>' + esc(c.term) + ' <span class="small">· ' + esc(c.zh) + '</span> ' + badgeHtml(c.badge, c.sources) + '</h4>' +
            '<div class="small"><b>标准释义：</b>' + esc(c.def) + '</div>' +
            (c.official ? '<div class="small" style="margin-top:4px"><b>官方表述：</b><span class="official">' + esc(c.official) + '</span></div>' : '') +
            (c.case ? '<div class="small" style="margin-top:4px"><b>真实案例：</b>' + esc(c.case) + '</div>' : '') +
            '<div style="margin-top:6px"><span class="enline" style="color:var(--brand)">' + esc(c.enExample) + '</span> — ' + esc(c.zhExample) + '</div>' +
            '<div class="rowact" style="margin-top:6px">' + enBtn(c.enExample) + '</div>' +
            '<div class="mistake" style="margin-top:6px">' + esc(c.mistake) + '</div></div>';
        });
      });
    });
    if (!html) html = '<p class="muted">没有匹配的概念。</p>';
    $('dictList').innerHTML = html;
  }

  function renderProgress() {
    var total = 0, doneN = 0;
    P.modules.forEach(function (m) { m.scenes.forEach(function (sc) { total++; if (S.done[m.id + '|' + sc.id]) doneN++; }); });
    var pct = total ? Math.round(doneN / total * 100) : 0;
    var srsN = 0; for (var k in S.srs) if (S.srs.hasOwnProperty(k)) srsN++;
    var html = '<h2 style="margin:4px 0 2px"> 我的进度</h2>' +
      '<div class="stat">' +
      '<div class="box"><div class="n">' + doneN + '/' + total + '</div><div class="l">已完成节次</div><div class="bar"><i style="width:' + pct + '%"></i></div></div>' +
      '<div class="box"><div class="n">' + srsN + '</div><div class="l">复习卡片</div></div>' +
      '<div class="box"><div class="n">' + dueCount() + '</div><div class="l">待复习</div></div>' +
      '<div class="box"><div class="n">' + (S.roleplays || []).length + '</div><div class="l">外宾模拟次数</div></div></div>';
    html += '<h3 style="margin:10px 0">各模块完成度</h3>';
    P.modules.forEach(function (m) {
      var d = moduleDone(m), t = m.scenes.length, pp = Math.round(d / t * 100);
      html += '<div style="margin:8px 0"><b>' + m.zh + '</b> <span class="small">' + d + '/' + t + '</span>' +
        '<div class="bar"><i style="width:' + pp + '%"></i></div></div>';
    });
    html += '<div class="card" style="margin-top:16px"><b> 关于「记不住」</b><p class="muted" style="margin:6px 0 0">本平台不靠「多听几遍」。每句英文/每个词都可「 加入复习」，系统按间隔重复安排复习——你只需在「复习」里每天花 5 分钟翻面回忆。这是被认知科学验证的 retention 方法。</p></div>';
    $('view').innerHTML = html;
  }

  function repopVoiceSel() {
    var sel = $('voiceSel'); if (!sel) return;
    var pool = VOICES.filter(function (v) { return /^en/i.test(v.lang); });
    var cur = S.settings.voice || (pickVoice() ? pickVoice().name : '');
    var opt = '<option value="">自动优选（' + (cur || '系统') + '）</option>';
    pool.forEach(function (v) { opt += '<option value="' + esc(v.name) + '"' + (v.name === S.settings.voice ? ' selected' : '') + '>' + esc(v.name) + '</option>'; });
    sel.innerHTML = opt;
  }
  function renderSettings() {
    var html = '<h2 style="margin:4px 0 2px"> 语音设置</h2><p class="muted">选一个你觉得最标准的英文声音，并调整语速。朗读仅用于英文，中文不朗读。</p>' +
      '<div class="card"><div class="row"><div><b>英文语音</b><div class="small">优先 Google / Microsoft 自然音；选「自动优选」由系统挑最标准的。</div></div>' +
      '<span class="spacer"></span><select id="voiceSel" style="padding:8px 10px;border:1px solid var(--line);border-radius:9px;min-width:240px"></select></div>' +
      '<div class="row" style="margin-top:14px"><div><b>语速</b><div class="small">0.7 慢 ∼ 1.1 快，默认 0.92（清晰优先）。</div></div>' +
      '<span class="spacer"></span><input id="rateR" type="range" min="0.7" max="1.1" step="0.02" value="' + (S.settings.rate || 0.92) + '" style="min-width:200px">' +
      ' <span id="rateV" class="small">' + (S.settings.rate || 0.92) + '</span></div>' +
      '<div class="row" style="margin-top:14px"><button class="btn sm" data-act="test-voice"> 试听标准音</button>' +
      '<span class="small">示例：Tencent helps enterprises digitize with cloud and AI.</span></div></div>';
    if (window.__GITHUB_PAGES_BUILD__) {
      html += '<h2 style="margin:22px 0 2px">公开版功能说明</h2>' +
        '<div class="card"><b>发音练习与本地识别</b><p class="muted" style="margin:7px 0 0">本公开版支持浏览器朗读、录音、语音识别与内容匹配反馈。云端音素级评测需要安全的服务端代理，因此仅在桌面本地版中提供；请勿在公开网页中输入任何云端密钥。</p></div>';
    } else {
      var c = S.settings.cloud || {};
      html += '<h2 style="margin:22px 0 2px"> 云端发音评测（实验）</h2>' +
        '<p class="muted">开启后，跟读录音会送到云端做<strong>音素级</strong>评测（逐词、逐音素打分，类似流利说）。密钥只在本机 localhost 使用，不离开你的电脑。默认关闭，关掉则使用本地识别兜底。</p>' +
        '<div class="card"><label class="row"><div><b>启用云端评测</b><div class="small">需要你自己的云端语音密钥（见下方）。</div></div>' +
        '<span class="spacer"></span><input type="checkbox" id="cloudOn" ' + (c.enabled ? 'checked' : '') + ' style="width:20px;height:20px"></label>' +
        '<div class="row" style="margin-top:12px"><div><b>服务商</b></div><span class="spacer"></span>' +
        '<select id="cloudProv" style="padding:8px 10px;border:1px solid var(--line);border-radius:9px;min-width:200px">' +
        '<option value="azure"' + (c.provider === 'azure' ? ' selected' : '') + '>Azure 发音评测</option>' +
        '<option value="tencent"' + (c.provider === 'tencent' ? ' selected' : '') + '>腾讯云（待实现）</option></select></div>' +
        '<div id="azureFields" style="margin-top:12px">' +
        '<div class="row" style="margin-top:8px"><div><b>Azure 密钥</b></div><span class="spacer"></span><input id="cloudKey" style="padding:6px 9px;border:1px solid var(--line);border-radius:8px;min-width:280px" placeholder="Ocp-Apim-Subscription-Key" value="' + esc(c.key || '') + '"></div>' +
        '<div class="row" style="margin-top:8px"><div><b>Azure 区域</b></div><span class="spacer"></span><input id="cloudRegion" style="padding:6px 9px;border:1px solid var(--line);border-radius:8px;min-width:200px" placeholder="eastasia" value="' + esc(c.region || 'eastasia') + '"></div>' +
        '<div class="small" style="margin-top:4px">区域需与密钥一致，例如 eastasia / southeastasia / westus。</div></div>' +
        '<div class="row" style="margin-top:14px"><button class="btn sm" data-act="save-cloud"> 保存云端设置</button>' +
        '<span class="small">免费额度：Azure 语音每月 50 万字符内免费。</span></div></div>';
    }
    $('view').innerHTML = html;
    repopVoiceSel();
    var sel = $('voiceSel');
    sel.addEventListener('change', function () { S.settings.voice = sel.value; save(); pickVoice(); toast('已保存语音偏好'); });
    var rr = $('rateR');
    rr.addEventListener('input', function () { $('rateV').textContent = parseFloat(rr.value).toFixed(2); });
    rr.addEventListener('change', function () { S.settings.rate = parseFloat(rr.value); save(); toast('已保存语速'); });
    var prov = $('cloudProv');
    if (prov) {
      prov.addEventListener('change', function () { $('azureFields').style.display = prov.value === 'azure' ? '' : 'none'; });
      $('azureFields').style.display = (c.provider === 'azure') ? '' : 'none';
    }
  }

  /* ---------------- 事件委托 ---------------- */
  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-act]'); if (!el) return;
    var act = el.getAttribute('data-act');
    if (act === 'nav') { state.view = el.getAttribute('data-view'); state.m = null; state.s = null; render(); }
    else if (act === 'open-module') { state.view = 'module'; state.m = el.getAttribute('data-m'); render(); }
    else if (act === 'open-scene') { state.view = 'scene'; state.m = el.getAttribute('data-m'); state.s = el.getAttribute('data-s'); render(); }
    else if (act === 'speak') { speak(el.getAttribute('data-text')); }
    else if (act === 'stage') {
      var stageIndex = Number(el.getAttribute('data-stage')), smid = el.getAttribute('data-m'), ssid = el.getAttribute('data-s');
      /* 阶段卡片是开放的复习入口；完成条件只控制“完成阶段”记录，不限制查看。 */
      S.sceneStage[sceneKey(smid, ssid)] = Math.max(0, Math.min(2, stageIndex)); save(); renderScene(smid, ssid);
    }
    else if (act === 'complete-stage') {
      var ci = Number(el.getAttribute('data-stage')), cmid = el.getAttribute('data-m'), csid = el.getAttribute('data-s'), key = sceneKey(cmid, csid), cp = sceneProgress(cmid, csid);
      if (!stageReady(cmid, csid, ci)) { toast(ci === 0 ? '请先完成本轮词汇训练' : (ci === 1 ? '请先完成一次跟读或录音尝试' : '请先完成四轮外宾模拟')); return; }
      if (ci === 0) cp.understand = true;
      if (ci === 1 && cp.understand) cp.imitate = true;
      if (ci === 2 && cp.imitate) { cp.output = true; S.done[key] = true; }
      if ((ci === 0 && cp.understand) || (ci === 1 && cp.imitate) || (ci === 2 && cp.output)) {
        S.stageProgress[key] = cp; S.sceneStage[key] = Math.min(2, ci + 1); save(); toast(ci === 2 ? '本节课程已完成' : '阶段已完成，进入下一阶段'); render();
      } else toast('请先完成前一个阶段');
    }
    else if (act === 'add-srs') {
      srsAdd({ id: el.getAttribute('data-id'), front: el.getAttribute('data-front'), back: el.getAttribute('data-back'),
        ctx: el.getAttribute('data-ctx'), badge: el.getAttribute('data-badge') });
    }
    else if (act === 'phrase-reveal') { phraseReveal(); }
    else if (act === 'phrase-grade') { phraseGrade(el.getAttribute('data-g')); }
    else if (act === 'phrase-restart') { restartPhraseCards(); }
    else if (act === 'v-restart') { restartVocab(); }
    else if (act === 'close-lookup') { var lm = $('lookupModal'); if (lm) lm.classList.remove('show'); }
    else if (act === 'lookup-related') { showLookup(el.getAttribute('data-text')); }
    else if (act === 'add-lookup-scene') { addLookupToScene(el); }
    else if (act === 'add-lookup-srs') {
      var lookupEn = el.getAttribute('data-en'), lookupZh = el.getAttribute('data-zh');
      srsAdd({ id: 'lookup_' + norm(lookupEn), front: lookupEn, back: lookupZh, ctx: '三击查词 / 自选词汇' });
    }
    else if (act === 'reveal-quiz') { var q = $(el.getAttribute('data-qid')); if (q) q.classList.add('show'); }
    else if (act === 'reveal-ref') { var r = $(el.getAttribute('data-rpid')); if (r) r.classList.add('show'); }
    else if (act === 'start-record') { record(el.getAttribute('data-en'), $(el.getAttribute('data-rid'))); }
    else if (act === 'local-score') { record(el.getAttribute('data-en'), $(el.getAttribute('data-rid')), true); }
    else if (act === 'stop-record') { if (lineRec) { try { lineRec.stop(); } catch (e) {} } }
    else if (act === 'record-retry') { record(el.getAttribute('data-en'), lastRecEl || $(el.getAttribute('data-rid'))); }
    else if (act === 'cloud-retry') { cloudRecord(el.getAttribute('data-en'), lastRecEl || $(el.getAttribute('data-rid'))); }
    else if (act === 'cloud-stop') { if (cloudRec && cloudRec.recorder) { try { cloudRec.recorder.stop(); } catch (e) {} } }
    else if (act === 'save-cloud') {
      var c = S.settings.cloud || {};
      c.enabled = !!$('cloudOn') && $('cloudOn').checked;
      c.provider = $('cloudProv') ? $('cloudProv').value : 'azure';
      if ($('cloudKey')) c.key = $('cloudKey').value.trim();
      if ($('cloudRegion')) c.region = $('cloudRegion').value.trim() || 'eastasia';
      S.settings.cloud = c; save();
      toast(c.enabled ? '已开启云端评测' : '已关闭云端评测（使用本地识别）');
    }
    else if (act === 'manual-score') { var inp = $('manual_in'); if (inp) finishRec(el.getAttribute('data-en'), inp.value, 0, inp.parentNode); }
    else if (act === 'rv-flip') { var rv = $('rv_' + el.getAttribute('data-id')); if (rv) rv.style.display = rv.style.display === 'none' ? '' : 'none'; }
    else if (act === 'grade') { srsGrade(el.getAttribute('data-id'), el.getAttribute('data-g')); toast('已记录，安排下次复习'); }
    else if (act === 'srs-remove') { delete S.srs[el.getAttribute('data-id')]; save(); render(); toast('已移除'); }
    else if (act === 'v-reveal') { vReveal(); }
    else if (act === 'v-grade') { vGrade(el.getAttribute('data-g')); }
    else if (act === 'test-voice') { speak('Tencent helps enterprises digitize with cloud and AI.'); }
    else if (act === 'start-role') { startRole(el.getAttribute('data-m'), el.getAttribute('data-s')); }
    else if (act === 'role-speech') { roleStartSpeech(); }
    else if (act === 'role-stop') { stopRoleSpeech(); roleSetStatus('转写已停止。请检查文本后再点“检查回答”。', 'success'); }
    else if (act === 'role-record') { roleRecord(); }
    else if (act === 'role-check') { checkRoleAnswer(); }
    else if (act === 'role-next') { roleNext(); }
    else if (act === 'role-show-ref') { var rr2 = $('roleRef'); if (rr2) rr2.classList.toggle('show'); }
    else if (act === 'role-restart') { if (state.m && state.s) startRole(state.m, state.s); }
    else if (act === 'role-close') { roleState = null; if (state.m && state.s) renderScene(state.m, state.s); }
  });

  /* 三击文本：仅在课程内容标记的英文句上生效；基础词会被自动跳过。 */
  document.addEventListener('click', function (e) {
    var target = e.target.closest('.lookup-text'); if (!target) return;
    var now = Date.now(), last = Number(target.getAttribute('data-last-click') || 0), count = Number(target.getAttribute('data-click-count') || 0);
    count = (now - last < 700) ? count + 1 : 1;
    target.setAttribute('data-last-click', String(now)); target.setAttribute('data-click-count', String(count));
    if (count >= 3) { target.setAttribute('data-click-count', '0'); showLookup(selectedLookupText(target, e)); }
  });

  /* 页面被关闭或切换时释放麦克风与语音资源。 */
  window.addEventListener('pagehide', cleanupMedia);
  /* ---------------- 启动 ---------------- */
  $('nav').innerHTML = '<span class="muted">加载中…</span>';
  render();
})();
