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
      AI_ERR_TERAKHIR = 'jaringan: ' + sensor(String(e)).slice(0, 160);
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
  return sensor(String(pesan).replace(/\s+/g, ' ')).slice(0, 240);
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
  if (!ps.length) { logAman('Belum ada provider cadangan. Isi GROQ_API_KEY dan/atau OPENROUTER_API_KEY di Script Properties.'); return; }
  // Uji dengan kalimat transaksi sungguhan (seperti saat Gemini sibuk) + catat waktu respons.
  var uji = 'tadi isi bensinnya 50rb di spbu';
  var sys = parseSystemPrompt() + '\n\nBALAS HANYA satu objek JSON valid, tanpa teks lain & tanpa code-fence. Sertakan "intent" selalu.';
  logAman('Uji: "' + uji + '" (harapan: intent keluar, nominal 50000, kategori transport)');
  ps.forEach(function (p) {
    var t = null, mulai = Date.now();
    try { t = openaiChatCall(p, [{ role: 'system', content: sys }, { role: 'user', content: uji }], { json: true, temperature: 0, maxTokens: 300 }); }
    catch (e) { t = null; logAman('❌ ' + p.name + ' error: ' + e); }
    var ms = Date.now() - mulai, o = t ? extractJson(t) : null;
    var pas = o && o.intent === 'keluar' && Number(o.nominal) === 50000 && String(o.kategori).toLowerCase() === 'transport';
    logAman((o ? (pas ? '✅ ' : '⚠️ ') : '❌ ') + p.name + ' · ' + p.model + ' · ' + ms + ' ms · ' +
      (o ? JSON.stringify({ intent: o.intent, nominal: o.nominal, kategori: o.kategori }) + (pas ? '' : ' (jawaban kurang tepat)')
         : 'GAGAL → ' + (AI_ERR_TERAKHIR || 'tanpa keterangan')));
    if (!o && /^HTTP 404/.test(AI_ERR_TERAKHIR) && !sudahDaftar[p.name]) {
      sudahDaftar[p.name] = true;
      logAman('   ↳ model yang BISA dipakai akun ' + p.name + ' Anda: ' + daftarModelTersedia(p) +
        '\n   ↳ isi salah satu (atau beberapa, dipisah koma) ke Script Property ' + p.name.toUpperCase() + '_MODEL.');
    }
  });
  logAman('Petunjuk: 401 = API key salah/tidak aktif · 404 = model tak tersedia utk akun Anda · ' +
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
 * Jalankan dari EDITOR (buka AIProviders.gs, pilih testGemini, ▶ Jalankan) untuk mengecek apakah
 * API key GEMINI sudah terpasang & berjalan, lewat jalur yang sama dgn bot: (1) urai transaksi,
 * (2) obrolan, (3) model foto. Bila gagal, diagnosis memakai KONFIGURASI YANG SAMA dgn jalur bot
 * lalu menampilkan kode HTTP + pesan asli Google + penyebab (blokir / token habis / saldo).
 * Rahasia (API key/token) selalu DISENSOR di log.
 */
function testGemini() {
  var mentah = String(cfgOptional('GEMINI_API_KEY', ''));
  var key = mentah.trim();
  if (!key) { logAman('❌ GEMINI_API_KEY belum diisi di Script Properties (⚙️ Setelan project → Properti skrip).'); return; }
  if (mentah !== key) {
    logAman('⚠️ GEMINI_API_KEY mengandung spasi/enter di awal/akhir — bot memakai nilai apa adanya sehingga bisa DITOLAK. ' +
      'Hapus spasi/enter itu di Script Properties.');
  }
  var model = cfgOptional('GEMINI_MODEL', GEMINI_MODEL_DEFAULT);
  var visi = cfgOptional('GEMINI_VISION_MODEL', model);
  logAman('Gemini · model teks: ' + model + ' · model foto: ' + visi);

  // 1) Urai transaksi — persis jalur bot (geminiParse).
  var uji = 'tadi isi bensinnya 50rb di spbu', a = null, lempar = false, t0 = Date.now();
  try { a = geminiParse(uji); } catch (e) { lempar = true; laporLempar('urai transaksi', e); }
  var ms = Date.now() - t0;
  if (a) {
    var pas = a.intent === 'keluar' && Number(a.nominal) === 50000 && String(a.kategori).toLowerCase() === 'transport';
    logAman((pas ? '✅' : '⚠️') + ' urai transaksi · ' + ms + ' ms · "' + uji + '" → ' +
      JSON.stringify({ intent: a.intent, nominal: a.nominal, kategori: a.kategori }) + (pas ? '' : ' (kurang tepat; harapan keluar/50000/transport)'));
  } else {
    logAman('❌ urai transaksi GAGAL · ' + ms + ' ms → ' + diagnosaGemini(key, model, 'urai', !lempar).teks);
  }

  // 2) Obrolan bebas (geminiChat). chatId uji agar riwayat obrolan Anda tidak tercampur.
  var c = null; lempar = false; t0 = Date.now();
  try { c = geminiChat('Jawab satu kalimat singkat: kamu siapa?', 'uji-testGemini'); } catch (e2) { lempar = true; laporLempar('obrolan', e2); }
  ms = Date.now() - t0;
  logAman(c ? '✅ obrolan · ' + ms + ' ms · "' + String(c).replace(/\s+/g, ' ').slice(0, 120) + '"'
            : '❌ obrolan GAGAL · ' + ms + ' ms → ' + diagnosaGemini(key, model, 'obrolan', !lempar).teks);

  // 3) Model foto: pastikan modelnya ada & menjawab (uji baca foto asli: kirim foto struk ke bot).
  if (visi !== model) {
    var d3 = diagnosaGemini(key, visi, 'dasar', false);
    logAman((d3.sehat ? '✅' : '❌') + ' model foto ' + visi + ' → ' + d3.teks);
  } else {
    logAman('ℹ️ model foto = model teks (' + model + '); baca foto asli diuji dgn mengirim foto struk ke bot.');
  }

  // Petunjuk sesuai keadaan (berapa cadangan yang benar-benar aktif).
  var cadangan = openaiProviders().length;
  logAman('Arti kode: 400 "API key not valid" = GEMINI_API_KEY salah · 402 = saldo PRABAYAR project habis ' +
    '(isi saldo di AI Studio, ATAU pakai key dari project TANPA billing = tier gratis) · 403 = key diblokir/API belum aktif · ' +
    '404 = nama model salah · 429 = kuota habis/limit · 5xx = server Google sibuk.');
  logAman(cadangan
    ? 'Bila Gemini gagal: mencatat & ngobrol otomatis pindah ke ' + cadangan + ' model cadangan (Groq/OpenRouter). BACA FOTO hanya lewat Gemini — tidak ada cadangan.'
    : 'Bila Gemini gagal: TIDAK ada cadangan (GROQ_API_KEY/OPENROUTER_API_KEY kosong) — bot hanya bisa kamus & perintah garis miring. BACA FOTO hanya lewat Gemini.');
}

/** Lapor exception tanpa membocorkan rahasia; kenali salah tempel "nilai key di tempat nama property". */
function laporLempar(jalur, e) {
  var m = String(e);
  var lama = m.match(/Config "([^"]+)" belum diset/);           // pesan Config.gs versi lama
  var salahTempel = /Config: di KODE tertulis cfg/.test(m) || (lama && !/^[A-Z][A-Z0-9_]*$/.test(lama[1]));
  if (salahTempel) {
    logAman('❌ ' + jalur + ': di KODE tertulis cfg(\'<NILAI API key>\') — seharusnya NAMA property, mis. cfg(\'GEMINI_API_KEY\'). ' +
      'Salin ulang berkas .gs dari GitHub (atau ganti teks itu jadi nama property), simpan key HANYA di Script Properties, ' +
      'dan buat ulang (rotasi) key yang sempat tertulis di kode/log.');
  } else {
    logAman('❌ ' + jalur + ' melempar error: ' + m);
  }
}

/**
 * Satu panggilan Gemini TANPA retry, dgn konfigurasi yang SAMA spt jalur bot, untuk membaca penyebab asli.
 * jenis: 'urai' (systemInstruction + skema JSON), 'obrolan' (maxOutputTokens 2048), 'dasar' (minimal).
 * setelahGagal: true bila jalur bot barusan gagal (mempengaruhi kalimat saat ternyata sehat).
 * Kembalikan { kode, sehat, teks }.
 */
function diagnosaGemini(key, model, jenis, setelahGagal) {
  var base = 'https://generativelanguage.googleapis.com/v1beta/models/';
  var payload;
  if (jenis === 'urai') {
    payload = { systemInstruction: { parts: [{ text: parseSystemPrompt() }] },
      contents: [{ parts: [{ text: 'tadi isi bensinnya 50rb di spbu' }] }],
      generationConfig: { responseMimeType: 'application/json', responseSchema: ACTION_SCHEMA } };
  } else if (jenis === 'obrolan') {
    payload = { contents: [{ role: 'user', parts: [{ text: 'Jawab satu kalimat singkat: kamu siapa?' }] }],
      generationConfig: { maxOutputTokens: 2048 } };
  } else {
    payload = { contents: [{ parts: [{ text: 'Balas satu kata: OK' }] }] };
  }
  try {
    var res = UrlFetchApp.fetch(base + encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(key),
      { method: 'post', contentType: 'application/json', muteHttpExceptions: true, payload: JSON.stringify(payload) });
    var code = res.getResponseCode(), body = res.getContentText();
    if (code !== 200) {
      var teks = 'HTTP ' + code + ': ' + ringkasErrorAI(body);
      if (code === 404) teks += '\n   ↳ model Gemini yang tersedia utk key Anda: ' + daftarModelGemini(key) +
        '\n   ↳ isi salah satu ke Script Property GEMINI_MODEL.';
      if (code === 429 || code >= 500) teks += ' (sedang limit/sibuk — coba lagi nanti)';
      return { kode: code, sehat: false, teks: teks };
    }
    return analisaBalasan200(body, setelahGagal);
  } catch (e) {
    return { kode: 0, sehat: false, teks: 'jaringan: ' + sensor(String(e)).slice(0, 160) };
  }
}

/** HTTP 200 belum tentu berisi jawaban: periksa blokir keamanan, finishReason & token berpikir. */
function analisaBalasan200(body, setelahGagal) {
  var b;
  try { b = JSON.parse(body); } catch (e) { return { kode: 200, sehat: false, teks: 'HTTP 200 tapi balasan bukan JSON' }; }
  var blok = b.promptFeedback && b.promptFeedback.blockReason;
  if (blok) return { kode: 200, sehat: false, teks: 'HTTP 200 tapi pesan DIBLOKIR filter keamanan (' + blok + ')' };
  var cand = b.candidates && b.candidates[0];
  var ada = !!(cand && cand.content && cand.content.parts && cand.content.parts.some(function (p) { return p.text; }));
  var fr = cand && cand.finishReason;
  var pikir = b.usageMetadata && b.usageMetadata.thoughtsTokenCount;
  if (ada) {
    return { kode: 200, sehat: true, teks: 'HTTP 200 — key & model SEHAT dgn konfigurasi bot' +
      (setelahGagal ? ' saat dicek ulang; kegagalan barusan kemungkinan sementara (limit/sibuk). Detail: sheet Log, event gemini_*.' : '.') };
  }
  if (fr === 'MAX_TOKENS') {
    return { kode: 200, sehat: false, teks: 'HTTP 200 tapi jawaban KOSONG: token habis (finishReason MAX_TOKENS' +
      (pikir ? ', ' + pikir + ' token dipakai "berpikir"' : '') + ') — ganti GEMINI_MODEL ke model yg berpikir minimal, mis. gemini-3.5-flash-lite.' };
  }
  return { kode: 200, sehat: false, teks: 'HTTP 200 tapi jawaban kosong (finishReason ' + (fr || 'tidak ada') + ').' };
}

/** Sensor rahasia (API key Gemini/Groq/OpenRouter, token Telegram, ?key= di URL) sebelum ditulis ke log. */
function sensor(s) {
  return String(s)
    .replace(/(AIza|AQ\.|gsk_|sk-or-v1-|sk-|ya29\.)[0-9A-Za-z_\-.]{8,}/g, function (m, p) { return p + '••••(disensor)'; })
    .replace(/\b\d{6,}:[A-Za-z0-9_-]{20,}\b/g, '••••(token disensor)')
    .replace(/([?&]key=)[^&\s"']+/g, '$1••••');
}

/** Logger.log yang selalu menyensor rahasia. */
function logAman(s) { Logger.log(sensor(s)); }

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
