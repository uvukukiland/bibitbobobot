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

/** Daftar provider OpenAI-compatible yang AKTIF (key terisi), urut prioritas. */
/**
 * Rantai model gratis OpenRouter (dicek Nov 2026): Gemma 4 31B (kuat bahasa Indonesia, mode JSON)
 * -> Gemma 4 26B-A4B (lebih ringan/cepat) -> openrouter/free (router otomatis ke model gratis yang tersedia).
 */
var OPENROUTER_DEFAULT = 'google/gemma-4-31b-it:free,google/gemma-4-26b-a4b-it:free,openrouter/free';

function openaiProviders() {
  var list = [];
  function tambah(nama, url, key, models) {
    String(models).split(',').forEach(function (m) {
      m = m.trim();
      if (m) list.push({ name: nama, url: url, key: key, model: m });
    });
  }
  var groq = cfgOptional('GROQ_API_KEY', '');
  if (groq) tambah('groq', 'https://api.groq.com/openai/v1/chat/completions', groq, cfgOptional('GROQ_MODEL', 'llama-3.3-70b-versatile'));
  var or = cfgOptional('OPENROUTER_API_KEY', '');
  if (or) tambah('openrouter', 'https://openrouter.ai/api/v1/chat/completions', or, cfgOptional('OPENROUTER_MODEL', OPENROUTER_DEFAULT));
  return list;
}

/** Satu panggilan chat ke provider OpenAI-compatible; teks balasan atau null. */
function openaiChatCall(p, messages, opts) {
  var payload = { model: p.model, messages: messages, temperature: (opts && opts.temperature != null) ? opts.temperature : 0.4 };
  if (opts && opts.json) payload.response_format = { type: 'json_object' };
  if (opts && opts.maxTokens) payload.max_tokens = opts.maxTokens;
  var body = geminiFetchRetry(p.url, payload, { Authorization: 'Bearer ' + p.key });
  if (!body || !body.choices || !body.choices[0] || !body.choices[0].message) return null;
  return String(body.choices[0].message.content || '').trim() || null;
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
         : 'gagal — cek API key / nama model / pengaturan privasi OpenRouter; detail di sheet Log'));
  });
}

/** Ringkasan provider AI yang aktif (untuk /status). */
function aiProvidersStatus() {
  var out = ['✅ gemini (utama)'];
  openaiProviders().forEach(function (p) { out.push('✅ ' + p.name + ' (' + p.model + ')'); });
  return out;
}
