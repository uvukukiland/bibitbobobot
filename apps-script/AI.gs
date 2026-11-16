/**
 * AI.gs — lapisan bahasa natural via Gemini (gratis).
 * Pola: teks bebas → Gemini usulkan aksi terstruktur → bot konfirmasi → simpan.
 * Menjaga data bersih (PRD §5): selalu validasi + konfirmasi sebelum tulis.
 */

/** Skema keluaran terstruktur yang dipaksakan ke Gemini. */
var ACTION_SCHEMA = {
  type: 'object',
  properties: {
    intent: { type: 'string', enum: ['keluar', 'masuk', 'tugas', 'catat', 'cari', 'rekap', 'selesai', 'hapus', 'daftar', 'edit', 'acara', 'unknown'] },
    nominal: { type: 'integer', description: 'Jumlah rupiah bulat, mis. "50rb" -> 50000.' },
    kategori: { type: 'string', description: 'Intent keluar/masuk: nama kategori PERSIS dari daftar yang PALING cocok (hindari "lainnya"). Intent lain: isi "lainnya".' },
    keterangan: { type: 'string', description: 'Keterangan singkat transaksi, mis. nama barang/tempat.' },
    teks: { type: 'string' },
    jatuh_tempo: { type: 'string' },
    query: { type: 'string' },
    bulan: { type: 'string' },
    id: { type: 'string' },
    target: { type: 'string', enum: ['terakhir', 'bulan', 'tugas', 'catatan'] },
    tanggal: { type: 'string' },
    field: { type: 'string' },
    nilai: { type: 'string' },
    jam: { type: 'string' }
  },
  // kategori WAJIB: flash-lite terbukti melewatkan field opsional (uji 0/6) walau deskripsi bilang wajib.
  required: ['intent', 'kategori']
};

/**
 * Salinan ACTION_SCHEMA dengan `kategori` dibatasi (enum) ke nama kategori di sheet Kategori,
 * agar Gemini tak bisa mengarang kategori. Bila sheet kosong/gagal dibaca, pakai skema biasa.
 */
function actionSchemaDinamis() {
  var s = JSON.parse(JSON.stringify(ACTION_SCHEMA));
  try {
    var nama = Object.keys(kategoriSheetMap());
    if (nama.length) s.properties.kategori.enum = nama;
  } catch (e) { logEvent('WARN', 'schema_kategori_gagal', String(e).slice(0, 120)); }
  return s;
}

/** Bangun ringkasan daftar kategori untuk diberikan ke model. */
function kategoriListText() {
  var rows = readAll('Kategori');
  var keluar = [], masuk = [];
  for (var i = 1; i < rows.length; i++) {
    var k = rows[i][0], t = String(rows[i][1]).toLowerCase();
    if (t === 'keluar' || t === 'both') keluar.push(k);
    if (t === 'masuk' || t === 'both') masuk.push(k);
  }
  return 'kategori keluar: [' + keluar.join(', ') + '] ; kategori masuk: [' + masuk.join(', ') + ']';
}

// KATEGORI_KEYWORDS, KAMUS_NORMAL, VERBA_MASUK, VERBA_KELUAR -> KamusData.gs
// Mesin klasifikasi (normalisasi, skor, kamus pengguna) -> Kamus.gs

/** Panduan pemetaan -> teks prompt (dibuat dari KATEGORI_KEYWORDS, satu sumber). */
function kategoriHintText() {
  var lines = ['PEMETAAN KATEGORI — petakan ke yang TERDEKAT; HINDARI "lainnya" (pakai hanya bila benar-benar tak ada yang cocok):'];
  Object.keys(KATEGORI_KEYWORDS).forEach(function (k) {
    var kw = KATEGORI_KEYWORDS[k];
    lines.push('- ' + k + ': ' + kw.slice(0, 14).join(', ') + (kw.length > 14 ? ', dll' : '') + '.');
  });
  lines.push('Catatan "tiket": pesawat/kereta/bus = transport; konser/bioskop = hiburan.');
  lines.push('Utang/pinjaman: terima pinjaman = masuk kategori "utang"; bayar/lunasi utang = keluar kategori "utang". Meminjamkan ke orang = keluar "piutang"; dibayar balik = masuk "piutang".');
  lines.push('Cicilan/paylater/kartu kredit (kredivo, akulaku, shopee paylater, KPR) = "tagihan".');
  lines.push('Menabung/beli emas/reksadana/saham = keluar "tabungan". Hasil investasi (dividen, bunga, profit) = masuk "investasi".');
  lines.push('PEMASUKAN: gaji/gajian/upah = "gaji"; proyek/klien/jualan/usaha = "freelance"; THR/bonus/insentif/lembur = "bonus"; angpao/dikasih uang/menang undian = "hadiah"; refund/cashback/reimburse = "refund".');
  return lines.join('\n');
}

/** Tebak kategori dari teks via kamus (lihat Kamus.gs). '' bila tak ada. */
function tebakKategori(text) {
  var r = klasifikasi(text, '');
  return r ? r.kategori : '';
}

/** Cari kategori yang sah untuk intent (keluar/masuk/''), via kamus + nama kategori. '' bila tak ada. */
function cariKategori(text, intent) {
  var r = klasifikasi(text, intent || '');
  return r ? r.kategori : '';
}

/**
 * Tentukan kategori final:
 *   1) ajaran pengguna (sheet Kamus) SELALU menang;
 *   2) kategori AI yang sah & spesifik (bukan "lainnya");
 *   3) tebakan kamus dari konteks (skor tertinggi, sah untuk intent);
 *   4) terakhir "lainnya".
 */
function normalisasiKategori(rawKat, intent, konteks) {
  var kat = String(rawKat || '').toLowerCase().trim();
  var ajar = klasifikasi(konteks || '', intent, { hanyaPengguna: true });
  if (ajar) return ajar.kategori;
  if (isKategoriValid(kat, intent) && kat !== 'lainnya') return kat;
  var r = klasifikasi(konteks || '', intent);
  if (r) return r.kategori;
  return isKategoriValid(kat, intent) ? kat : 'lainnya';
}

/** Uang gaul -> angka. */
var UANG_GAUL = {
  cepek: 100, gopek: 500, seceng: 1000, noceng: 2000, goceng: 5000, ceban: 10000, noban: 20000,
  goban: 50000, gocap: 50000, cetiau: 1000000, sejuta: 1000000, sepuluhrb: 10000
};

/** Parse nominal longgar untuk fallback: "2.502.500", "25rb", "1,5jt", "10k", "goceng". null bila tak ada. */
function parseNominalLoose(text) {
  var s = String(text || '').toLowerCase();
  var g = s.match(/\b(cepek|gopek|seceng|noceng|goceng|ceban|noban|goban|gocap|cetiau|sejuta)\b/);
  var m = s.match(/(\d[\d.,]*)\s*(juta|jt|jeti|ribu|rebu|rbu|rb|k)\b/);
  if (!m && g) return UANG_GAUL[g[1]];
  if (m) {
    var num = parseFloat(m[1].replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));
    if (isNaN(num)) return null;
    var v = Math.round(num * (/juta|jt|jeti/.test(m[2]) ? 1000000 : 1000));
    return v > 0 ? v : null;
  }
  m = s.match(/\d[\d.,]*\d|\d+/);
  if (m) {
    var cleaned = m[0].replace(/[.,]/g, '');
    if (/^\d+$/.test(cleaned)) { var n = parseInt(cleaned, 10); return n > 0 ? n : null; }
  }
  return parseAngkaKata(s);
}

/** Angka dalam kata: "dua puluh lima ribu", "seratus lima puluh rebu", "satu setengah juta". null bila tak ada. */
function parseAngkaKata(s) {
  var DIGIT = { nol: 0, satu: 1, dua: 2, tiga: 3, empat: 4, lima: 5, enam: 6, tujuh: 7, delapan: 8, sembilan: 9 };
  var toks = String(s || '').toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/);
  var total = 0, cur = 0, last = 0, mulai = false, skala = false;
  for (var i = 0; i < toks.length; i++) {
    var t = toks[i];
    if (DIGIT.hasOwnProperty(t)) { cur += DIGIT[t]; last = DIGIT[t]; mulai = true; }
    else if (t === 'sepuluh') { cur += 10; last = 0; mulai = true; }
    else if (t === 'sebelas') { cur += 11; last = 0; mulai = true; }
    else if (t === 'seratus') { cur += 100; last = 0; mulai = true; skala = true; }
    else if (t === 'setengah') { cur += 0.5; last = 0; mulai = true; }
    else if (t === 'belas' && mulai) { cur += 10; last = 0; }
    else if (t === 'puluh' && mulai) { cur = cur - last + last * 10; last = 0; skala = true; }
    else if (t === 'ratus' && mulai) { cur = cur - last + last * 100; last = 0; skala = true; }
    else if (t === 'seribu') { total += 1000; mulai = true; skala = true; }
    else if (/^(ribu|rebu|rb|rbu)$/.test(t) && mulai) { total += (cur || 1) * 1000; cur = 0; last = 0; skala = true; }
    else if (/^(juta|jt)$/.test(t) && mulai) { total += (cur || 1) * 1000000; cur = 0; last = 0; skala = true; }
    else if (mulai && skala) break; // angka selesai
    else if (mulai) { total = 0; cur = 0; last = 0; mulai = false; } // "beli dua kopi" bukan nominal
  }
  var v = Math.round(total + cur);
  return (skala && v >= 100) ? v : null;
}

/** Tipe kategori: 'masuk' bila kategori pemasukan, selain itu 'keluar'. */
function tipeKategori(kat) {
  if (isKategoriValid(kat, 'keluar')) return 'keluar';
  if (isKategoriValid(kat, 'masuk')) return 'masuk';
  return 'keluar';
}

/**
 * Fallback saat AI tak paham: tangkap pola singkat "<kategori/kata-kunci> <nominal>"
 * (mis. "rumah 2.502.500", "galon 25rb"). Return aksi keuangan atau null.
 */
function tebakAksiKeuangan(text) {
  return tebakAksiDeterministik(text); // Kamus.gs: arah dari kata kerja + kategori skor tertinggi
}

/**
 * POST ke Gemini dengan RETRY pada error sementara (429/500/503 — server sibuk/limit sesaat)
 * & kegagalan jaringan. Kembalikan body JSON terurai atau null. TIDAK PERNAH melempar.
 * Ini kunci agar bot tidak "diam" saat Gemini sedang ramai (penyebab umum AI tak merespons).
 */
function geminiFetchRetry(url, payload, headers) {
  var opt = { method: 'post', contentType: 'application/json', payload: JSON.stringify(payload), muteHttpExceptions: true };
  if (headers) opt.headers = headers;
  var delay = 700;
  for (var attempt = 1; attempt <= 3; attempt++) {
    var code = 0, text = '';
    try {
      var res = UrlFetchApp.fetch(url, opt);
      code = res.getResponseCode();
      text = res.getContentText();
    } catch (e) {
      logEvent('WARN', 'gemini_fetch_threw', 'percobaan ' + attempt + ': ' + String(e).slice(0, 120));
      if (attempt < 3) { Utilities.sleep(delay); delay *= 2; continue; }
      return null;
    }
    if (code === 200) { try { return JSON.parse(text); } catch (e) { return null; } }
    if ((code === 429 || code === 500 || code === 503) && attempt < 3) {
      logEvent('WARN', 'gemini_retry', 'HTTP ' + code + ' percobaan ' + attempt);
      Utilities.sleep(delay); delay *= 2; continue;
    }
    logEvent('ERROR', 'gemini_http', 'HTTP ' + code + ' ' + text.slice(0, 200));
    return null;
  }
  return null;
}

/** System prompt pengurai aksi (dipakai Gemini & provider cadangan). */
function parseSystemPrompt() {
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return [
    'Kamu pengurai untuk asisten keuangan & tugas pribadi berbahasa Indonesia.',
    'Ubah pesan pengguna menjadi SATU aksi terstruktur sesuai skema.',
    'intent: "keluar"=pengeluaran uang, "masuk"=pemasukan uang, "tugas"=hal yang harus dilakukan, "catat"=catatan bebas, "cari"=mencari berkas/file di Drive, "rekap"=minta ringkasan/laporan keuangan, "selesai"=menandai tugas sudah selesai, "hapus"=menghapus data, "daftar"=minta lihat daftar tugas, "unknown"=tidak yakin.',
    'keluar/masuk: nominal = angka rupiah (ubah "25rb"->25000, "1,5jt"->1500000, "10k"->10000); kategori WAJIB diisi dengan yang PALING cocok dari daftar. HINDARI "lainnya" — hampir semua hal punya kategori lebih tepat (lihat PEMETAAN KATEGORI di bawah); pakai "lainnya" hanya bila benar-benar tak ada yang cocok. JANGAN pernah mengosongkan kategori. keterangan = ringkas. tanggal = YYYY-MM-DD HANYA bila pengguna menyebut waktu lampau ("kemarin"/"kemaren"/"kmrn", "2 hari lalu", "minggu lalu", tanggal tertentu); "td"/"tadi"/"barusan" = hari ini (KOSONGKAN); bila tidak disebut KOSONGKAN (hari ini = ' + today + ').',
    'Daftar kategori — ' + kategoriListText() + '.',
    'WAJIB paham Bahasa Indonesia santai/gaul, singkatan, & typo umum.',
    'Uang gaul/singkatan: "rb"/"ribu"/"rebu"/"k"=ribu; "jt"/"juta"=juta; "ceban"=10000; "goceng"=5000; "seceng"=1000; "cepek"=100; "gopek"=500; "gocap"=50000. Contoh "abis goceng"->5000, "gajian 5jt"->5000000, "kopi 2rb"->2000.',
    'Kata ganti/umum: "gw/gue/ane/aku/sy/saya"=pengguna; "duit/duwit/cuan/fulus"=uang; "tf/transfer"=transaksi transfer; "byr/bayar"=pengeluaran; "gajian/gaji cair/gaji masuk"=pemasukan gaji.',
    'Pola singkat "<kategori> <angka>" atau "<angka> <kategori>" = pengeluaran (intent keluar) kategori itu. Contoh "rumah 2.502.500" -> keluar 2502500 kategori rumah; "makan 25rb" -> keluar 25000 makan.',
    kategoriHintText(),
    'Intent gaul/singkatan: "catetin/catet dong/notes"=catat; "ingetin/ingatin/jangan lupa/reminder/todo"=tugas; "cariin/carikan/search"=cari; "abis berapa sih/laporan dong/cek keuangan/rekap dong"=rekap; "apus/apusin/ilangin/delete/del"=hapus; "kelarin/udah beres/rampung/done"=selesai; "liat tugas/ada tugas apa/todo list"=daftar.',
    'cari: query = kata kunci nama berkas (mis. "cari file laporan" -> query "laporan").',
    'tugas: teks = isi tugas; jatuh_tempo = YYYY-MM-DD bila disebut (hari ini = ' + today + ').',
    'acara/agenda SATU KALI pada tanggal tertentu (mis. "rapat tim 30 juni jam 2 siang", "ada acara 5 juli", "meeting besok jam 9"): intent "acara"; teks = nama acara; tanggal = YYYY-MM-DD; jam = HH:MM 24-jam ("jam 2 siang"->14:00, "jam 9 pagi"->09:00, "jam 8 malam"->20:00); bila jam tak disebut KOSONGKAN. Beda dari "tugas" (yang harus dikerjakan) — "acara" itu jadwal/agenda.',
    'catat: teks = isi catatan.',
    'rekap: bulan = YYYY-MM bila pengguna menyebut bulan (hitung dari hari ini = ' + today + '; "bulan ini" = kosongkan; "bulan lalu" = bulan sebelumnya). Contoh "rekap keuangan", "laporan bulan ini", "berapa pengeluaranku" -> intent rekap.',
    'selesai: id = ID tugas berformat T-0001 bila disebut. Contoh "tugas T-0002 sudah beres" -> intent selesai, id "T-0002".',
    'daftar: tidak butuh field lain. Contoh "tugas apa saja", "lihat daftar tugas", "ada tugas apa hari ini" -> intent daftar.',
    'hapus: target = "terakhir" (transaksi keuangan terakhir), "bulan" (semua keuangan 1 bulan; isi bulan = YYYY-MM), atau "tugas" (isi id = T-0001). Contoh "hapus transaksi terakhir" -> target "terakhir"; "hapus keuangan bulan mei" -> target "bulan", bulan "' + today.slice(0, 4) + '-05".',
    'edit: untuk MEMPERBAIKI entri yang salah. target = "terakhir" (transaksi keuangan terakhir), "tugas" (isi id), atau "catatan" (catatan terakhir). field = yang diubah; nilai = nilai baru. Untuk keuangan field salah satu: nominal|kategori|keterangan|tipe|tanggal (jika nominal, nilai = angka rupiah dinormalkan, mis "30rb"->"30000"). Untuk tugas field: teks|tenggat|status. Untuk catatan: cukup nilai = teks baru. Contoh "ubah nominal terakhir jadi 30rb" -> intent edit, target "terakhir", field "nominal", nilai "30000"; "ganti kategori transaksi terakhir ke transport" -> field "kategori", nilai "transport".',
    'Pakai "unknown" hanya bila benar-benar tidak ada intent yang cocok.'
  ].join('\n');
}

/**
 * Model Gemini bawaan (bisa diganti lewat Script Property GEMINI_MODEL / GEMINI_VISION_MODEL).
 * gemini-3.5-flash-lite (cek docs Nov 2026): tier gratis, berpikir "minimal" (tercepat), mendukung
 * output terstruktur & gambar; pengganti resmi gemini-2.5-flash (usang, ditutup utk pengguna baru,
 * dialihkan otomatis mulai 1 Des 2026).
 * Catatan API Gemini 3.x: `temperature`/`top_p`/`top_k` usang (kini diabaikan, kelak HTTP 400) — jangan dikirim;
 * token "berpikir" ikut dihitung dalam maxOutputTokens — beri ruang longgar agar jawaban tak terpotong.
 */
var GEMINI_MODEL_DEFAULT = 'gemini-3.5-flash-lite';

/** Panggil Gemini, kembalikan objek aksi {intent,...} atau null bila gagal. */
function geminiParse(text) {
  var apiKey = cfg('GEMINI_API_KEY');
  var model = cfgOptional('GEMINI_MODEL', GEMINI_MODEL_DEFAULT);
  var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + apiKey;
  var sys = parseSystemPrompt();

  var payload = {
    systemInstruction: { parts: [{ text: sys }] },
    contents: [{ parts: [{ text: text + petunjukKamus(text) }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: actionSchemaDinamis()
    }
  };

  var body = geminiFetchRetry(url, payload);
  if (!body || !body.candidates || !body.candidates[0]) return null;
  try {
    return JSON.parse(body.candidates[0].content.parts[0].text);
  } catch (e) {
    logEvent('ERROR', 'gemini_parse_failed', String(e));
    return null;
  }
}

// ---------- Mode obrolan AI (tanya-jawab bebas) ----------

/** Kunci & ambil/simpan riwayat obrolan ringan (4 giliran terakhir, 30 menit). */
function chatKey(chatId) { return 'chat_' + chatId; }
function chatHistoryGet(chatId) {
  var v = CacheService.getScriptCache().get(chatKey(chatId));
  try { return v ? JSON.parse(v) : []; } catch (e) { return []; }
}
function chatHistorySave(chatId, userText, modelText) {
  var h = chatHistoryGet(chatId);
  h.push({ role: 'user', parts: [{ text: userText }] });
  h.push({ role: 'model', parts: [{ text: modelText }] });
  if (h.length > 8) h = h.slice(h.length - 8);
  CacheService.getScriptCache().put(chatKey(chatId), JSON.stringify(h), 1800);
}

/**
 * Obrolan AI umum (bukan perintah): jawab pertanyaan / minta saran / ngobrol.
 * Mengingat 4 giliran terakhir agar nyambung. Kembalikan teks jawaban atau null.
 */
function geminiChat(text, chatId) {
  var apiKey = cfg('GEMINI_API_KEY');
  // Obrolan boleh memakai model lebih pintar (GEMINI_CHAT_MODEL, mis. gemini-3.8-flash) tanpa
  // memperlambat pencatatan transaksi yang tetap memakai GEMINI_MODEL (cepat).
  var model = cfgOptional('GEMINI_CHAT_MODEL', cfgOptional('GEMINI_MODEL', GEMINI_MODEL_DEFAULT));
  var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + apiKey;

  var sys = [
    'Kamu "AI_din", asisten pribadi yang ramah, cerdas, dan membantu. Selalu berbahasa Indonesia.',
    'Jawab ringkas, jelas, dan enak dibaca di chat Telegram (hindari jawaban bertele-tele; pakai poin "•" bila perlu).',
    'Selain mengobrol, kamu punya fitur: mencatat keuangan, tugas, agenda, dan membaca foto struk. Bila pengguna tampak ingin mencatat, arahkan singkat caranya (mis. ketik "kopi 25rb" atau kirim foto struk).',
    'Jangan mengarang; bila tidak tahu, katakan jujur.',
    'PENTING: balas dalam TEKS POLOS. Jangan pakai Markdown/HTML (tanpa **, ##, _, atau tag) karena akan tampil mentah.'
  ].join('\n');

  var contents = chatHistoryGet(chatId).concat([{ role: 'user', parts: [{ text: text }] }]);
  var payload = {
    systemInstruction: { parts: [{ text: sys }] },
    contents: contents,
    generationConfig: { maxOutputTokens: 2048 } // longgar: token "berpikir" ikut dihitung
  };

  var body = geminiFetchRetry(url, payload);
  if (!body || !body.candidates || !body.candidates[0]) return null;
  var ans = '';
  try { ans = body.candidates[0].content.parts[0].text; } catch (e) { return null; }
  ans = String(ans || '').trim();
  if (ans) chatHistorySave(chatId, text, ans);
  return ans || null;
}

// ---------- Penyimpanan aksi tertunda (menunggu konfirmasi) ----------

/** Bersihkan partikel akhiran ("dong/deh/lah/aja/sih/nih/kok/ya") & tanda baca. */
function bersihPartikel(s) {
  var t = String(s).toLowerCase().replace(/[.!,?\s]+$/g, '').trim();
  var prev;
  do { prev = t; t = t.replace(/\s+(dong|deh|lah|aja|sih|nih|kok|ya|yaa|gan|bro|sis)$/g, '').trim(); } while (t !== prev);
  return t;
}

/** Jawaban "iya" dalam aneka ragam Indonesia & gaul. */
function isYa(s) {
  var t = bersihPartikel(s);
  return /^(ya+h?|iya+h?|iy[ah]?|ok(e|ay|eh|eds)?|oce|sip+(lah)?|gas+(keun|kan)?|lanjut(kan)?|boleh|yo+i?|yu?p|yep|yes+|bener|betul|setuju|sip|simpan|save|deal|mantap|gaskeun|y|yha|ya?wes(an)?|ya?udah)$/.test(t);
}

/** Jawaban "tidak/batal" dalam aneka ragam Indonesia & gaul. */
function isTidak(s) {
  var t = bersihPartikel(s);
  return /^(tidak|tdk|t?gak|n?gak?|ngga?k?|kaga?k?|e?ngga?k?|no+|nope|batal(in|kan)?|cancel|jangan|skip|oga?h|ga\s?jadi|gajadi|ga\s?usah|gausah|nggausah|n)$/.test(t);
}

function pendingKey(chatId) { return 'pending_' + chatId; }
function setPending(chatId, action) { CacheService.getScriptCache().put(pendingKey(chatId), JSON.stringify(action), 600); }
function getPending(chatId) { var v = CacheService.getScriptCache().get(pendingKey(chatId)); return v ? JSON.parse(v) : null; }
function clearPending(chatId) { CacheService.getScriptCache().remove(pendingKey(chatId)); }

/** Kartu konfirmasi (HTML). Bagian dinamis di-escape; dikirim via askConfirm/sendMessage{html:true}. */
function confirmText(a) {
  var e = htmlEsc;
  var rp = function (n) { return '<b>Rp' + formatRupiah(n) + '</b>'; };
  switch (a.intent) {
    case 'keluar': return '💸 <b>Pengeluaran</b>\n' + rp(a.nominal) + ' · ' + e(a.kategori) + (a.keterangan ? '\n📝 ' + e(a.keterangan) : '') + tglInfo(a);
    case 'masuk':  return '💰 <b>Pemasukan</b>\n' + rp(a.nominal) + ' · ' + e(a.kategori) + (a.keterangan ? '\n📝 ' + e(a.keterangan) : '') + tglInfo(a);
    case 'tugas':  return '📋 <b>Tugas</b>\n' + e(a.teks) + (a.jatuh_tempo ? '\n⏰ Tenggat ' + e(a.jatuh_tempo) : '');
    case 'catat':  return '📝 <b>Catatan</b>\n' + e(a.teks);
    case 'acara':  return '📅 <b>Acara</b>\n' + e(a.teks) + '\n🗓️ ' + e(a.tanggal) + ' ' + e(a.jam || '08:00');
    case 'hapus':
      if (a.target === 'tugas') return '🗑️ Hapus tugas <b>' + e(a.id || '?') + '</b>?';
      if (a.target === 'bulan') return '🗑️ Hapus <b>SEMUA</b> keuangan bulan <b>' + e(a.bulan || '?') + '</b>?\n<i>Tidak bisa dibatalkan.</i>';
      return '🗑️ Hapus transaksi keuangan <b>TERAKHIR</b>?';
    case 'edit':
      if (a.target === 'catatan') return '✏️ Ubah catatan terakhir jadi:\n' + e(a.nilai || '?');
      if (a.target === 'tugas') return '✏️ Ubah tugas <b>' + e(a.id || '?') + '</b> — ' + e(a.field || '?') + ' → <b>' + e(a.nilai || '?') + '</b>';
      return '✏️ Ubah transaksi terakhir — ' + e(a.field || '?') + ' → <b>' + e(a.nilai || '?') + '</b>';
    default:       return '';
  }
}

/** Tombol aksi cepat setelah mencatat transaksi. */
function quickActions() {
  return [[
    { text: '📊 Rekap', callback_data: 'qa_rekap' },
    { text: '👛 Saldo', callback_data: 'qa_saldo' },
    { text: '↩️ Batalkan', callback_data: 'qa_undo' }
  ]];
}

/** " · tgl 2026-06-19" bila aksi keuangan menyebut tanggal lampau yang valid. */
function tglInfo(a) {
  return (a.tanggal && isValidDate(a.tanggal)) ? ' · tgl ' + a.tanggal : '';
}

// ---------- Alur natural language ----------

/**
 * Tangani "hapus/selesai tugas ..." secara deterministik (regex + pencarian),
 * tanpa memanggil AI. Return true bila sudah ditangani.
 */
function handleTugasShortcut(text, chatId) {
  var low = ' ' + text.toLowerCase() + ' ';
  var punyaId = !!extractTugasId(text);
  var adaTugas = /\b(tugas|tugasan|todo|to-?do|to do|task|kerjaan)\b/.test(low);
  var katHapus = /\b(hapus|hapusin|apus|apusin|ilangin|hilangkan|hilangin|buang|buangin|delete|del|remove)\b/.test(low);
  var katSelesai = /\b(selesai|selesaikan|selesaiin|kelar|kelarin|beres|beresin|rampung|tuntas|done|udahan|complete|ceklis|checklist)\b/.test(low);
  var katLihat = /\b(daftar|lihat|liat|cek|tampilin|tampilkan|list|show|ada|apa)\b/.test(low);

  // Lihat daftar tugas (read-only) — perintah paling sering, dibuat deterministik (tanpa AI).
  var bareTugas = /^\s*(tugas|tugasku|tugasan|todo|to-?do)\s*\??\s*$/.test(low);
  if (!katHapus && !katSelesai && (bareTugas || (adaTugas && katLihat))) {
    cmdDaftar([], chatId);
    return true;
  }

  var isHapus = katHapus && (adaTugas || punyaId);
  var isSelesai = katSelesai && (adaTugas || punyaId);
  if (!isHapus && !isSelesai) return false;

  var id = resolveTugasId(text);
  if (!id) {
    sendMessage(chatId, '🤔 Tugas yang mana? Sebutkan ID (mis. T-0001) atau kata kunci judulnya.\nKetik /daftar untuk melihat daftar tugas.');
    return true;
  }
  if (isHapus) {
    var a = { intent: 'hapus', target: 'tugas', id: id };
    setPending(chatId, a);
    askConfirm(chatId, confirmText(a));
  } else {
    cmdSelesai([id], chatId);
  }
  return true;
}

/** Dipanggil dari Router untuk pesan non-perintah (tanpa awalan '/'). */
function handleNatural(text, chatId) {
  var low = text.toLowerCase().trim();

  // Jika ada aksi tertunda, tafsirkan jawaban ya/tidak.
  if (getPending(chatId)) {
    if (isYa(low)) { confirmPending(chatId); return; }
    if (isTidak(low)) { cancelPending(chatId); return; }
    // selain itu: anggap permintaan baru, timpa yang lama.
  }

  // Operasi tugas (hapus/selesai) ditangani deterministik — lebih andal dari AI untuk ID.
  if (handleTugasShortcut(text, chatId)) return;
  // Lihat saldo/catatan/agenda — read-only, deterministik.
  if (handleViewShortcut(text, chatId)) return;

  var a = null;
  sendTyping(chatId); // beri tanda "sedang mengetik…" selama AI berpikir
  try { a = aiParse(text); } // Gemini → Groq → OpenRouter
  catch (e) { logEvent('ERROR', 'gemini_call_threw', String(e)); sendMessage(chatId, '⚠️ AI sedang sibuk/limit. Coba lagi sebentar, atau pakai perintah /help.'); return; }

  if (!a || a.intent === 'unknown') {
    // Pola singkat "<kategori> <nominal>" (mis. "rumah 2.502.500") -> pengeluaran.
    var fb = tebakAksiKeuangan(text);
    if (fb) { setPending(chatId, fb); askConfirm(chatId, confirmText(fb)); return; }
    // Bukan pola keuangan/tugas → layani sebagai obrolan AI biasa.
    sendTyping(chatId);
    var jawab = aiChat(text, chatId); // Gemini → Groq → OpenRouter
    if (jawab) { sendMessage(chatId, jawab); return; }
    sendMessage(chatId, [
      '🤔 Maaf, AI sedang sibuk. Contoh yang bisa saya proses:',
      '• "jajan kopi 25rb"  (catat pengeluaran)',
      '• "gaji masuk 5jt"  (pemasukan)',
      '• "ingatkan bayar listrik besok"  (tugas)',
      '• "rekap bulan ini" · "lihat tugas"',
      'Atau ketik /help untuk daftar perintah.'
    ].join('\n'));
    return;
  }

  // Aksi read-only / aman: langsung jalankan tanpa konfirmasi.
  if (a.intent === 'cari') {
    if (/dropbox/i.test(text)) cmdCariDropbox([a.query || ''], chatId);
    else cmdCari([a.query || ''], chatId);
    return;
  }
  if (a.intent === 'rekap') { cmdRekap([a.bulan || ''], chatId); return; }
  if (a.intent === 'daftar') { cmdDaftar([], chatId); return; }
  if (a.intent === 'selesai') {
    var sid = resolveTugasId(a.id) || resolveTugasId(text);
    if (!sid) { sendMessage(chatId, '🤔 Tugas yang mana? Sebutkan ID (mis. T-0001) atau kata kunci judulnya. Ketik /daftar.'); return; }
    cmdSelesai([sid], chatId);
    return;
  }

  // Edit: mengubah data → selalu lewat konfirmasi.
  if (a.intent === 'edit') {
    var et = String(a.target || '').toLowerCase();
    if (et === 'catatan') {
      if (!String(a.nilai || '').trim()) { sendMessage(chatId, '🤔 Catatan baru isinya apa?'); return; }
    } else if (et === 'tugas') {
      if (!a.id || !a.field || !String(a.nilai || '').trim()) { sendMessage(chatId, '🤔 Sebutkan ID tugas, bagian yang diubah, dan nilainya. Mis. "ubah tenggat T-0001 ke 2026-06-30".'); return; }
    } else {
      a.target = 'terakhir';
      if (!a.field || !String(a.nilai || '').trim()) { sendMessage(chatId, '🤔 Mau ubah apa dan jadi apa? Mis. "ubah nominal terakhir jadi 30rb".'); return; }
    }
    setPending(chatId, a);
    askConfirm(chatId, confirmText(a));
    return;
  }

  // Hapus: destruktif → selalu lewat konfirmasi.
  if (a.intent === 'hapus') {
    var tgt = String(a.target || '').toLowerCase();
    if (tgt === 'tugas') {
      a.id = resolveTugasId(a.id) || resolveTugasId(text);
      if (!a.id) { sendMessage(chatId, '🤔 Hapus tugas yang mana? Sebutkan ID (mis. T-0001) atau kata kunci judulnya. Ketik /daftar.'); return; }
    }
    if (tgt === 'bulan' && !parseBulan(a.bulan)) { sendMessage(chatId, '🤔 Bulan mana? Sebutkan, mis. "hapus keuangan bulan 2026-05".'); return; }
    if (tgt !== 'tugas' && tgt !== 'bulan') a.target = 'terakhir';
    setPending(chatId, a);
    askConfirm(chatId, confirmText(a));
    return;
  }

  // Pastikan data lengkap untuk tiap jenis (cegah tampilan "undefined").
  if (a.intent === 'keluar' || a.intent === 'masuk') {
    if (!a.nominal || a.nominal <= 0) {
      sendMessage(chatId, '🤔 Nominalnya berapa? Sebutkan angkanya, mis. "kopi 25rb".');
      return;
    }
    a.kategori = normalisasiKategori(a.kategori, a.intent, (a.keterangan || '') + ' ' + text);
  }
  if ((a.intent === 'tugas' || a.intent === 'catat') && !String(a.teks || '').trim()) {
    sendMessage(chatId, '🤔 Isinya apa? Coba tulis lebih lengkap.');
    return;
  }
  if (a.intent === 'acara' && (!String(a.teks || '').trim() || !a.tanggal || !isValidDate(a.tanggal))) {
    sendMessage(chatId, '🤔 Acara apa & tanggal berapa? mis. "rapat tim 30 Juni jam 2 siang".');
    return;
  }

  setPending(chatId, a);
  askConfirm(chatId, confirmText(a));
}

function confirmPending(chatId) {
  var a = getPending(chatId);
  if (!a) { sendMessage(chatId, 'Tidak ada yang menunggu konfirmasi.'); return; }
  clearPending(chatId);
  executeAction(a, chatId);
}

function cancelPending(chatId) {
  clearPending(chatId);
  sendMessage(chatId, '❌ Dibatalkan.');
}

/** Prompt konfirmasi dengan tombol ✅/❌ (HTML; tetap bisa diketik /ya /tidak juga). */
function askConfirm(chatId, bodyText) {
  sendButtons(chatId, bodyText, [[
    { text: '✅ Ya', callback_data: 'confirm' },
    { text: '❌ Tidak', callback_data: 'cancel' }
  ]], true);
}

/** Tangani tap tombol inline: konfirmasi ✅/❌ & aksi cepat (rekap/saldo/batalkan). */
function handleCallback(cq, chatId) {
  answerCallback(cq.id);
  var data = String(cq.data || '');
  var clear = function () { try { if (cq.message) clearButtons(chatId, cq.message.message_id); } catch (e) {} };
  if (data === 'confirm') { clear(); confirmPending(chatId); }
  else if (data === 'cancel') { clear(); cancelPending(chatId); }
  else if (data === 'qa_rekap') { cmdRekap([], chatId); }       // biarkan tombol agar bisa ditekan lagi
  else if (data === 'qa_saldo') { cmdSaldo(chatId); }
  else if (data === 'qa_undo') { clear(); hapusKeuanganTerakhir(chatId); }
}

/** View read-only via bahasa natural: saldo, catatan (+cari), agenda/jadwal, kategori. */
function handleViewShortcut(text, chatId) {
  var low = ' ' + text.toLowerCase() + ' ';
  var lihat = /\b(lihat|liat|cek|tampilin|tampilkan|tunjukin|tunjukkan|daftar|list|show|berapa|ada|apa|mana|cari|cariin)\b/.test(low);
  var bare = bersihPartikel(text); // teks inti tanpa partikel/tanda baca akhir (mis. "catatan?" -> "catatan")

  // SALDO — konservatif agar tak bentrok dgn "uang masuk ...".
  if (/\bsaldo\b/.test(low) || /\b(uang|duit)ku\b/.test(low)) { cmdSaldo(chatId); return true; }

  // KATEGORI: daftar, atau "X masuk kategori apa?" (identifikasi).
  // Perintah UBAH kategori ("ganti kategori terakhir ke transport") dibiarkan lewat ke AI (intent edit).
  if (/\bkategori(nya)?\b/.test(low) && !/\b(ubah|ubahin|ganti|gantiin|edit|pindah|pindahin|koreksi|benerin|set|jadi|jadiin)\b/.test(low)) {
    var term = String(text).toLowerCase().replace(/[?!.,:;"']/g, ' ')
      .replace(/\b(masuk|masuknya|termasuk|kategori|kategorinya|apa|apaan|mana|yang|yg|ya|dong|sih|itu|ini|ke|di|lihat|liat|cek|daftar|list|semua|kah|nih|deh|tuh|tolong|bot|kalau|kalo|klo|bisa)\b/g, ' ')
      .replace(/\s+/g, ' ').trim();
    cmdKategori(term ? term.split(' ') : [], chatId);
    return true;
  }

  // BUDGET (lihat daftar) & EXPORT/BACKUP.
  if (/\b(budget|anggaran)\b/.test(low) && !/\d/.test(low)) { cmdBudget([], chatId); return true; }
  if (/\b(export|ekspor|backup|cadangkan|cadangan)\b/.test(low)) { cmdExport(chatId); return true; }

  // RIWAYAT transaksi terakhir — HANYA melihat. Perintah aksi ("hapus/ganti kategori transaksi terakhir")
  // dibiarkan lewat ke AI (intent hapus/edit) agar tidak dibajak jadi daftar riwayat.
  var aksiUbah = /\b(hapus|hapusin|apus|apusin|delete|del|buang|ubah|ubahin|ganti|gantiin|edit|koreksi|benerin|pindah|pindahin|jadi|jadiin|set)\b/.test(low);
  if (!aksiUbah && (/\briwayat\b/.test(low) || (/\btransaksi\b/.test(low) && /\b(terakhir|terbaru|lihat|liat|cek)\b/.test(low)))) { cmdRiwayat([], chatId); return true; }

  // HAPUS LOG.
  if (/\blog\b/.test(low) && /\b(hapus|bersih|bersihkan|kosongkan|clear)\b/.test(low)) { cmdHapusLog(chatId); return true; }

  // CATATAN — bare "catatan", atau "lihat/cari catatan [kata]" (kata = pencarian).
  if (/\b(catatan|catetan|notes?)\b/.test(low) && (lihat || /^(catatan|catetan|notes?)$/.test(bare))) {
    var q = String(text).toLowerCase()
      .replace(/\b(lihat|liat|cek|tampilin|tampilkan|tunjukin|tunjukkan|daftar|list|show|ada|apa|mana|cari|cariin|semua|catatan|catetan|notes?)\b/g, ' ')
      .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    cmdCatatan(q ? [q] : [], chatId); return true;
  }

  // AGENDA / JADWAL / ACARA — bare noun atau ada verba lihat (BUKAN saat membuat acara baru).
  if (/\b(agenda|jadwal|acara)\b/.test(low) && (lihat || /^(agenda|jadwal|acara)$/.test(bare))) {
    cmdAgenda(chatId); return true;
  }
  return false;
}

/** /kategori [nama] — daftar kategori dari sheet; dengan nama: contoh kata kuncinya. */
function cmdKategori(args, chatId) {
  var rows = readAll('Kategori');
  var arg = String((args && args.join ? args.join(' ') : args) || '').toLowerCase().trim();

  if (arg) { // /kategori <nama> -> contoh kata kunci
    var ada = false;
    for (var i = 1; i < rows.length; i++) { if (String(rows[i][0]).toLowerCase() === arg) { ada = true; break; } }
    if (!ada) { jelaskanKata(arg, chatId); return; } // bukan nama kategori -> "kata ini masuk kategori apa?"
    var kws = (typeof KATEGORI_KEYWORDS !== 'undefined' && KATEGORI_KEYWORDS[arg]) ? KATEGORI_KEYWORDS[arg] : [];
    if (kws.length) sendMessage(chatId, '🏷️ <b>Contoh kata kunci "' + htmlEsc(arg) + '"</b>\n' + htmlEsc(kws.slice(0, 40).join(', ')) + (kws.length > 40 ? ', dll' : ''), { html: true });
    else sendMessage(chatId, '🏷️ Kategori "' + htmlEsc(arg) + '" ada (belum punya kata kunci otomatis). Sebut namanya langsung saat mencatat, mis. "' + htmlEsc(arg) + ' 50rb".', { html: true });
    return;
  }

  var keluar = [], masuk = [], both = [];
  for (var j = 1; j < rows.length; j++) {
    var nama = rows[j][0]; if (!nama) continue;
    var t = String(rows[j][1]).toLowerCase();
    if (t === 'masuk') masuk.push(nama);
    else if (t === 'both') both.push(nama);
    else keluar.push(nama);
  }
  var out = ['🏷️ <b>Daftar Kategori</b>', '━━━━━━━━━━━━━━',
    '💸 <b>Pengeluaran (' + keluar.length + ')</b>', htmlEsc(keluar.join(', ')) || '-',
    '', '💰 <b>Pemasukan (' + masuk.length + ')</b>', htmlEsc(masuk.join(', ')) || '-'];
  if (both.length) out.push('', '↔️ <b>Keduanya</b>: ' + htmlEsc(both.join(', ')));
  out.push('━━━━━━━━━━━━━━',
    '<i>/kategori &lt;nama&gt; → contoh kata kunci · /kategori &lt;kata&gt; → kata itu masuk kategori apa</i>',
    '<i>/cek &lt;kalimat&gt; → lihat cara bot memahami · /kamus → ajari kata baru</i>');
  sendMessage(chatId, out.join('\n'), { html: true });
}

/** Tulis aksi ke sheet setelah dikonfirmasi. Tetap validasi (jaga data bersih). */
function executeAction(a, chatId) {
  switch (a.intent) {
    case 'keluar':
    case 'masuk':
      if (!a.nominal || a.nominal <= 0) { sendMessage(chatId, '❌ Nominal tidak valid — batal.'); return; }
      var kat = String(a.kategori || '').toLowerCase();
      if (!isKategoriValid(kat, a.intent)) {
        sendMessage(chatId, '❌ Kategori "' + kat + '" tidak dikenal — batal. Tambah di sheet Kategori bila perlu.');
        return;
      }
      var when = (a.tanggal && isValidDate(a.tanggal)) ? new Date(a.tanggal + 'T12:00:00') : new Date();
      var ket = a.keterangan || '';
      if (a.arsip) ket += (ket ? ' | ' : '') + a.arsip;
      append('Keuangan', [when, a.intent, a.nominal, kat, ket, a.sumber || 'bot-ai', nextId('Keuangan', 'K-', 7)]);
      logEvent('INFO', 'ai_keuangan_added', a.intent + ' ' + a.nominal + ' ' + kat);
      sendMessage(chatId, '✅ <b>Tersimpan</b>\n' + confirmText(a) + tanggalSuffix(when), { html: true, keyboard: quickActions() });
      refreshDashboard();
      if (a.intent === 'keluar') cekBudget(kat, a.nominal, chatId);
      break;

    case 'tugas':
      if (!a.teks) { sendMessage(chatId, '❌ Teks tugas kosong — batal.'); return; }
      var due = (a.jatuh_tempo && isValidDate(a.jatuh_tempo)) ? a.jatuh_tempo : '';
      var id = nextId('Tugas', 'T-');
      append('Tugas', [id, a.teks, due, 'open', '']);
      logEvent('INFO', 'ai_tugas_added', id);
      sendMessage(chatId, '✅ Tugas ' + id + ' tersimpan' + (due ? ' (tenggat ' + due + ')' : '') + ': ' + a.teks);
      break;

    case 'catat':
      if (!a.teks) { sendMessage(chatId, '❌ Catatan kosong — batal.'); return; }
      var isiCatat = a.teks + (a.arsip ? ' | ' + a.arsip : '');
      append('Catatan', [new Date(), isiCatat, nextId('Catatan', 'N-', 3)]);
      logEvent('INFO', 'ai_catatan_added', '');
      sendMessage(chatId, '✅ Catatan tersimpan.');
      break;

    case 'acara':
      tambahAcara(a.teks, a.tanggal, a.jam, chatId);
      break;

    case 'hapus':
      // Sudah dikonfirmasi /ya; untuk hapus per bulan lewati pengaman KONFIRM tahap-2.
      if (a.target === 'tugas') hapusTugas(a.id, chatId);
      else if (a.target === 'bulan') hapusKeuanganBulan(a.bulan, 'KONFIRM', chatId);
      else hapusKeuanganTerakhir(chatId);
      break;

    case 'edit':
      if (a.target === 'catatan') editCatatanTerakhir(a.nilai, chatId);
      else if (a.target === 'tugas') editTugas(a.id, normField(a.field), a.nilai, chatId);
      else editKeuanganTerakhir(normField(a.field), a.nilai, chatId);
      break;

    default:
      sendMessage(chatId, 'Tidak bisa diproses.');
  }
}
