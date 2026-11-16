/**
 * AIProviders.gs — beberapa "otak AI" gratis sebagai CADANGAN Gemini.
 * Urutan: Gemini (utama) → Groq → OpenRouter. Provider tanpa API key dilewati.
 *
 * Set di Script Properties (opsional, isi yang Anda punya):
 *   GROQ_API_KEY         (https://console.groq.com — gratis, cepat)
 *   OPENROUTER_API_KEY   (https://openrouter.ai — banyak model :free)
 * Model bisa diubah: GROQ_MODEL (default llama-3.3-70b-versatile),
 *   OPENROUTER_MODEL (default rantai OPENROUTER_DEFAULT di bawah).
 * Boleh BEBERAPA model dipisah koma (dicoba berurutan), mis.
 *   OPENROUTER_MODEL = google/gemma-4-31b-it:free,openrouter/free
 * Daftar model gratis OpenRouter sering berganti — cek https://openrouter.ai/models?max_price=0
 * lalu jalankan testAIProviders() dari editor untuk memastikan masih jalan.
 *
 * Semua provider ini memakai format OpenAI-compatible (chat/completions).
 */

/**
 * Rantai model gratis OpenRouter (dicek Nov 2026): Gemma 4 31B (kuat bahasa Indonesia, mode JSON)
 * -> Gemma 4 26B-A4B (lebih ringan/cepat) -> openrouter/free (router otomatis ke model gratis yang tersedia).
 */
var OPENROUTER_DEFAULT = 'google/gemma-4-31b-it:free,google/gemma-4-26b-a4b-it:free,openrouter/free';

/**
 * Rantai model Groq (semua "Production" di docs Groq, Nov 2026). Akses model bisa berbeda per akun —
 * yang tak tersedia (404) otomatis dilewati; testAIProviders menampilkan model yang BISA dipakai akun Anda.
 */
var GROQ_DEFAULT = 'llama-3.3-70b-versatile,openai/gpt-oss-120b,llama-3.1-8b-instant';

/** Pesan error terakhir dari provider cadangan (dibaca testAIProviders). */
var AI_ERR_TERAKHIR = '';

/** Daftar provider OpenAI-compatible yang AKTIF (key terisi), urut prioritas. */
function openaiProviders() {
  var list = [];
  function tambah(nama, url, key, models) {
    String(models).split(',').forEach(function (m) {
      m = m.trim();
      if (m) list.push({ name: nama, url: url, key: key, model: m });
    });
  }
  // .trim(): spasi/enter yang ikut tertempel di Script Properties membuat key ditolak (HTTP 401).
  var groq = String(cfgOptional('GROQ_API_KEY', '')).trim();
  if (groq) tambah('groq', 'https://api.groq.com/openai/v1/chat/completions', groq, cfgOptional('GROQ_MODEL', GROQ_DEFAULT));
  var or = String(cfgOptional('OPENROUTER_API_KEY', '')).trim();
  if (or) tambah('openrouter', 'https://openrouter.ai/api/v1/chat/completions', or, cfgOptional('OPENROUTER_MODEL', OPENROUTER_DEFAULT));
  return list;
}

/** Satu panggilan chat ke provider OpenAI-compatible; teks balasan atau null. */
function openaiChatCall(p, messages, opts) {
  var payload = { model: p.model, messages: messages, temperature: (opts && opts.temperature != null) ? opts.temperature : 0.4 };
  if (opts && opts.json) payload.response_format = { type: 'json_object' };
  if (opts && opts.maxTokens) payload.max_tokens = opts.maxTokens;
  var body = openaiFetch(p, payload);
  if (!body || !body.choices || !body.choices[0] || !body.choices[0].message) {
    if (body && !AI_ERR_TERAKHIR) AI_ERR_TERAKHIR = 'balasan tanpa isi';
    return null;
  }
  var isi = String(body.choices[0].message.content || '').trim();
  if (!isi) AI_ERR_TERAKHIR = 'balasan kosong';
  return isi || null;
}

/**
 * POST ke provider cadangan. BERBEDA dari Gemini: saat kena limit (429) JANGAN mencoba ulang —
 * langsung kembali agar rantai pindah ke model berikutnya (hemat kuota harian & bot tak menunggu lama).
 * Hanya error server sesaat (500/502/503) & jaringan yang dicoba ulang SEKALI.
 * Pesan error disimpan di AI_ERR_TERAKHIR. Tidak pernah melempar.
 */
function openaiFetch(p, payload) {
  var opt = { method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + p.key }, payload: JSON.stringify(payload) };
  AI_ERR_TERAKHIR = '';
  for (var attempt = 1; attempt <= 2; attempt++) {
    var code = 0, text = '';
    try {
      var res = UrlFetchApp.fetch(p.url, opt);
      code = res.getResponseCode();
      text = res.getContentText();
    } catch (e) {
      AI_ERR_TERAKHIR = 'jaringan: ' + String(e).slice(0, 160);
      if (attempt < 2) { Utilities.sleep(600); continue; }
      return null;
    }
    if (code === 200) { try { return JSON.parse(text); } catch (e2) { AI_ERR_TERAKHIR = 'balasan bukan JSON'; return null; } }
    AI_ERR_TERAKHIR = 'HTTP ' + code + ': ' + ringkasErrorAI(text);
    if ((code === 500 || code === 502 || code === 503) && attempt < 2) { Utilities.sleep(600); continue; }
    logEvent('WARN', 'ai_' + p.name + '_gagal', p.model + ' · ' + AI_ERR_TERAKHIR);
    return null;
  }
  return null;
}

/** Ringkas pesan error JSON dari provider (termasuk detail upstream OpenRouter bila ada). */
function ringkasErrorAI(text) {
  var pesan = text;
  try {
    var b = JSON.parse(text);
    if (b.error) {
      pesan = b.error.message || JSON.stringify(b.error);
      var raw = b.error.metadata && (b.error.metadata.raw || b.error.metadata.provider_name);
      if (raw) pesan += ' [' + String(raw).replace(/\s+/g, ' ').slice(0, 120) + ']';
    }
  } catch (e) {}
  return String(pesan).replace(/\s+/g, ' ').slice(0, 240);
}

/** Coba tiap provider OpenAI-compatible berurutan; {text,provider} atau null. */
function openaiComplete(messages, opts) {
  var ps = openaiProviders();
  for (var i = 0; i < ps.length; i++) {
    var t = null;
    try { t = openaiChatCall(ps[i], messages, opts); } catch (e) { logEvent('WARN', 'ai_' + ps[i].name + '_threw', String(e).slice(0, 120)); }
    if (t) { logEvent('INFO', 'ai_fallback_ok', ps[i].name); return { text: t, provider: ps[i].name }; }
  }
  return null;
}

/** Ambil objek JSON dari teks (buang code-fence; cari blok {...} bila perlu). */
function extractJson(s) {
  if (!s) return null;
  var str = String(s).replace(/```json/gi, '').replace(/```/g, '').trim();
  try { return JSON.parse(str); } catch (e) {}
  var m = str.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch (e2) {} }
  return null;
}

/**
 * Urai aksi: Gemini dulu; bila gagal, provider cadangan (Groq/OpenRouter) via JSON mode.
 * Kembalikan objek aksi {intent,...} atau null.
 */
function aiParse(text) {
  var a = null;
  try { a = geminiParse(text); } catch (e) { logEvent('WARN', 'gemini_parse_threw', String(e).slice(0, 120)); }
  if (a) return a;
  if (!openaiProviders().length) return null;
  var sys = parseSystemPrompt() +
    '\n\nBALAS HANYA satu objek JSON valid, tanpa teks lain & tanpa code-fence. ' +
    'Field yang boleh ada: intent, nominal, kategori, keterangan, teks, jatuh_tempo, query, bulan, id, target, tanggal, field, nilai, jam. ' +
    'Sertakan "intent" selalu.';
  var r = openaiComplete([{ role: 'system', content: sys }, { role: 'user', content: text + petunjukKamus(text) }], { json: true, temperature: 0 });
  if (!r) return null;
  var obj = extractJson(r.text);
  return (obj && obj.intent) ? obj : null;
}

/**
 * Obrolan AI: Gemini dulu; bila gagal, provider cadangan. Ingat riwayat yang sama.
 * Kembalikan teks jawaban atau null.
 */
function aiChat(text, chatId) {
  var ans = null;
  try { ans = geminiChat(text, chatId); } catch (e) { logEvent('WARN', 'gemini_chat_threw', String(e).slice(0, 120)); }
  if (ans) return ans;
  if (!openaiProviders().length) return null;
  var sys = 'Kamu "AI_din", asisten pribadi ramah & cerdas, berbahasa Indonesia. ' +
    'Jawab ringkas, jelas, TEKS POLOS (tanpa markdown/HTML). Jujur bila tak tahu. ' +
    'Kamu juga bisa mencatat keuangan/tugas/agenda & membaca foto struk; arahkan singkat bila pengguna ingin mencatat.';
  var hist = chatHistoryGet(chatId).map(function (h) {
    return { role: h.role === 'model' ? 'assistant' : 'user', content: (h.parts && h.parts[0] ? h.parts[0].text : '') };
  });
  var msgs = [{ role: 'system', content: sys }].concat(hist).concat([{ role: 'user', content: text }]);
  var r = openaiComplete(msgs, { temperature: 0.6, maxTokens: 800 });
  if (!r) return null;
  chatHistorySave(chatId, text, r.text);
  return r.text;
}

/**
 * Jalankan dari EDITOR untuk menguji tiap provider cadangan (cek API key benar).
 * Lihat hasilnya di Execution log.
 */
function testAIProviders() {
  var ps = openaiProviders();
  if (!ps.length) { Logger.log('Belum ada provider cadangan. Isi GROQ_API_KEY dan/atau OPENROUTER_API_KEY di Script Properties.'); return; }
  // Uji dengan kalimat transaksi sungguhan (seperti saat Gemini sibuk) + catat waktu respons.
  var uji = 'tadi isi bensinnya 50rb di spbu';
  var sys = parseSystemPrompt() + '\n\nBALAS HANYA satu objek JSON valid, tanpa teks lain & tanpa code-fence. Sertakan "intent" selalu.';
  Logger.log('Uji: "' + uji + '" (harapan: intent keluar, nominal 50000, kategori transport)');
  ps.forEach(function (p) {
    var t = null, mulai = Date.now();
    try { t = openaiChatCall(p, [{ role: 'system', content: sys }, { role: 'user', content: uji }], { json: true, temperature: 0, maxTokens: 300 }); }
    catch (e) { t = null; Logger.log('❌ ' + p.name + ' error: ' + e); }
    var ms = Date.now() - mulai, o = t ? extractJson(t) : null;
    var pas = o && o.intent === 'keluar' && Number(o.nominal) === 50000 && String(o.kategori).toLowerCase() === 'transport';
    Logger.log((o ? (pas ? '✅ ' : '⚠️ ') : '❌ ') + p.name + ' · ' + p.model + ' · ' + ms + ' ms · ' +
      (o ? JSON.stringify({ intent: o.intent, nominal: o.nominal, kategori: o.kategori }) + (pas ? '' : ' (jawaban kurang tepat)')
         : 'GAGAL → ' + (AI_ERR_TERAKHIR || 'tanpa keterangan')));
    if (!o && /^HTTP 404/.test(AI_ERR_TERAKHIR) && !sudahDaftar[p.name]) {
      sudahDaftar[p.name] = true;
      Logger.log('   ↳ model yang BISA dipakai akun ' + p.name + ' Anda: ' + daftarModelTersedia(p) +
        '\n   ↳ isi salah satu (atau beberapa, dipisah koma) ke Script Property ' + p.name.toUpperCase() + '_MODEL.');
    }
  });
  Logger.log('Petunjuk: 401 = API key salah/tidak aktif · 404 = model tak tersedia utk akun Anda · ' +
    '429 = sedang limit (wajar utk model gratis; bot langsung lanjut ke model berikutnya) · ' +
    'pesan "data policy" = izinkan free endpoints di openrouter.ai → Settings → Privacy. ' +
    'Cukup SATU ✅ agar cadangan berfungsi.');
}
var sudahDaftar = {};

/** Daftar id model yang dapat diakses key ini (GET /models). OpenRouter: hanya yang gratis. */
function daftarModelTersedia(p) {
  try {
    var res = UrlFetchApp.fetch(p.url.replace('/chat/completions', '/models'), {
      muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + p.key }
    });
    if (res.getResponseCode() !== 200) return '(gagal membaca daftar: HTTP ' + res.getResponseCode() + ')';
    var ids = (JSON.parse(res.getContentText()).data || []).map(function (m) { return m.id; })
      .filter(function (id) { return p.name !== 'openrouter' || /:free$/.test(id) || id === 'openrouter/free'; })
      .filter(function (id) { return !/whisper|tts|guard|orpheus|embed|lyria|playai/i.test(id); }); // bukan model chat
    return ids.length ? ids.slice(0, 15).join(', ') + (ids.length > 15 ? ' …' : '') : '(kosong)';
  } catch (e) {
    return '(gagal membaca daftar: ' + String(e).slice(0, 100) + ')';
  }
}

/**
 * Jalankan dari EDITOR (buka AIProviders.gs, pilih testGemini, ▶ Jalankan) untuk menguji GEMINI —
 * otak utama bot — lewat jalur yang sama dgn pesan sungguhan: (1) mengurai transaksi, (2) obrolan,
 * (3) model foto. Bila gagal, tampilkan kode HTTP + pesan asli Google (& daftar model bila 404).
 */
function testGemini() {
  var key = String(cfgOptional('GEMINI_API_KEY', '')).trim();
  if (!key) { Logger.log('❌ GEMINI_API_KEY belum diisi di Script Properties (⚙️ Setelan project).'); return; }
  if (String(cfgOptional('GEMINI_API_KEY', '')) !== key) {
    Logger.log('⚠️ GEMINI_API_KEY mengandung spasi/enter di awal/akhir — bot memakai nilai apa adanya sehingga bisa DITOLAK. ' +
      'Buka Script Properties, hapus spasi/enter itu, simpan.');
  }
  var model = cfgOptional('GEMINI_MODEL', 'gemini-2.5-flash');
  var visi = cfgOptional('GEMINI_VISION_MODEL', model);
  Logger.log('Gemini · model teks: ' + model + ' · model foto: ' + visi);
  var diag = null; // diagnosis dihitung sekali & dipakai ulang (hemat kuota)
  function diagnosa() { return diag || (diag = diagnosaGemini(key, model)); }

  // 1) Urai transaksi — persis jalur bot (geminiParse: prompt kategori + kamus + retry).
  var uji = 'tadi isi bensinnya 50rb di spbu', a = null, t0 = Date.now();
  try { a = geminiParse(uji); } catch (e) { Logger.log('❌ urai transaksi melempar error: ' + e); }
  var ms = Date.now() - t0;
  if (a) {
    var pas = a.intent === 'keluar' && Number(a.nominal) === 50000 && String(a.kategori).toLowerCase() === 'transport';
    Logger.log((pas ? '✅' : '⚠️') + ' urai transaksi · ' + ms + ' ms · "' + uji + '" → ' +
      JSON.stringify({ intent: a.intent, nominal: a.nominal, kategori: a.kategori }) + (pas ? '' : ' (kurang tepat; harapan keluar/50000/transport)'));
  } else {
    Logger.log('❌ urai transaksi GAGAL · ' + ms + ' ms → ' + diagnosa());
  }

  // 2) Obrolan bebas (geminiChat). Pakai chatId uji agar riwayat obrolan Anda tidak tercampur.
  var c = null; t0 = Date.now();
  try { c = geminiChat('Jawab satu kalimat singkat: kamu siapa?', 'uji-testGemini'); } catch (e2) { Logger.log('❌ obrolan melempar error: ' + e2); }
  ms = Date.now() - t0;
  Logger.log(c ? '✅ obrolan · ' + ms + ' ms · "' + String(c).replace(/\s+/g, ' ').slice(0, 120) + '"'
               : '❌ obrolan GAGAL · ' + ms + ' ms → ' + diagnosa());

  // 3) Model foto: cukup pastikan modelnya ada & bisa dipanggil (uji baca foto asli: kirim foto ke bot).
  if (visi !== model) {
    var d = diagnosaGemini(key, visi);
    Logger.log((/^HTTP 200/.test(d) ? '✅' : '❌') + ' model foto ' + visi + ' → ' + d);
  } else {
    Logger.log('ℹ️ model foto = model teks (' + model + '); baca foto asli diuji dgn mengirim foto struk ke bot.');
  }
  Logger.log('Petunjuk: 400 "API key not valid" = GEMINI_API_KEY salah · 403 = key diblokir/API belum aktif · ' +
    '404 = nama model salah (lihat daftar) · 429 = kuota gratis habis/limit (bot otomatis pakai Groq/OpenRouter) · 503 = server Google sibuk.');
}

/** Satu panggilan Gemini kecil TANPA retry untuk membaca pesan error asli. 'HTTP 200 …' bila sehat. */
function diagnosaGemini(key, model) {
  var base = 'https://generativelanguage.googleapis.com/v1beta/models/';
  try {
    var res = UrlFetchApp.fetch(base + encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(key), {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      payload: JSON.stringify({ contents: [{ parts: [{ text: 'Balas satu kata: OK' }] }] })
    });
    var code = res.getResponseCode();
    if (code === 200) return 'HTTP 200 (sehat — kegagalan tadi kemungkinan sibuk/limit sesaat)';
    var pesan = ringkasErrorAI(res.getContentText());
    var hasil = 'HTTP ' + code + ': ' + pesan;
    if (code === 404) hasil += '\n   ↳ model Gemini yang tersedia utk key Anda: ' + daftarModelGemini(key) +
      '\n   ↳ isi salah satu ke Script Property GEMINI_MODEL.';
    return hasil;
  } catch (e) {
    return 'jaringan: ' + String(e).slice(0, 160);
  }
}

/** Daftar model Gemini yang bisa generateContent utk key ini. */
function daftarModelGemini(key) {
  try {
    var res = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=' + encodeURIComponent(key),
      { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return '(gagal membaca daftar: HTTP ' + res.getResponseCode() + ')';
    var ids = (JSON.parse(res.getContentText()).models || [])
      .filter(function (m) { return (m.supportedGenerationMethods || []).indexOf('generateContent') >= 0 && /gemini/.test(m.name); })
      .map(function (m) { return String(m.name).replace(/^models\//, ''); })
      .filter(function (n) { return !/tts|image-generation|embedding|live|audio/i.test(n); });
    return ids.length ? ids.slice(0, 15).join(', ') + (ids.length > 15 ? ' …' : '') : '(kosong)';
  } catch (e) {
    return '(gagal membaca daftar: ' + String(e).slice(0, 100) + ')';
  }
}

/** Uji SEMUA otak AI sekaligus: Gemini (utama) lalu cadangan Groq/OpenRouter. */
function testSemuaAI() {
  Logger.log('===== GEMINI (utama) =====');
  testGemini();
  Logger.log('===== CADANGAN (Groq / OpenRouter) =====');
  testAIProviders();
}

/** Ringkasan provider AI yang aktif (untuk /status). */
function aiProvidersStatus() {
  var out = ['✅ gemini (utama)'];
  openaiProviders().forEach(function (p) { out.push('✅ ' + p.name + ' (' + p.model + ')'); });
  return out;
}
