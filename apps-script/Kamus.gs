/**
 * Kamus.gs — mesin klasifikasi kategori & arah transaksi (deterministik, tanpa AI).
 *
 * Data kamus ada di KamusData.gs:
 *   KATEGORI_KEYWORDS  { kategori: [kata kunci...] }  (pengeluaran, pemasukan, utang/piutang)
 *   KAMUS_NORMAL       { singkatan/gaul/typo: 'kata baku' }
 *   VERBA_MASUK / VERBA_KELUAR  [penanda arah uang]
 * + KAMUS PENGGUNA: sheet "Kamus" [kata, kategori] — diajari lewat /kamus atau otomatis
 *   saat Anda mengubah kategori transaksi. Ajaran pengguna selalu menang.
 *
 * Cara kerja klasifikasi:
 *   1) teks dinormalkan (huruf kecil, tanda baca -> spasi, singkatan -> baku, termasuk yang berakhiran);
 *   2) tiap kata kunci dicocokkan per-kata, mengizinkan akhiran -nya/-in/-an/-kan/-lah/-2;
 *   3) skor per kategori = jumlah bobot kata yang cocok (frasa > kata; kata panjang > pendek);
 *   4) hanya kategori yang ADA di sheet Kategori & sah untuk arah (masuk/keluar) yang dihitung.
 */

var _KAT_MAP = null, _KAMUS_IDX = null, _VERBA_IDX = null, _KAMUS_USER = null;

/**
 * Petunjuk kamus ke AI hanya diberikan bila pemenang unggul sejauh ini atas kandidat kedua.
 * Diukur: ambang 3 -> ketepatan ~96% di korpus tuning DAN held-out (petunjuk diberikan ~50% kalimat);
 * ambang 1.5 turun ke ~89% di held-out. Petunjuk salah lebih buruk daripada tanpa petunjuk.
 */
var AMBANG_PETUNJUK = 3;

// ---------- Kategori dari sheet (cache per eksekusi) ----------

/** Peta kategori sheet: nama -> tipe ('keluar' | 'masuk' | 'both' | ''). */
function kategoriSheetMap() {
  if (_KAT_MAP) return _KAT_MAP;
  var m = {};
  var rows = readAll('Kategori');
  for (var i = 1; i < rows.length; i++) {
    var k = String(rows[i][0] || '').trim().toLowerCase();
    if (k) m[k] = String(rows[i][1] || '').trim().toLowerCase();
  }
  _KAT_MAP = m;
  return m;
}

/** Apakah kategori ada di sheet & sah untuk intent ('keluar'/'masuk'; kosong = apa saja). */
function kategoriBolehUntuk(kat, intent) {
  var t = kategoriSheetMap()[kat];
  if (t === undefined) return false;
  if (!intent) return true;
  return t === 'both' || t === '' || t === intent;
}

/** Arah default sebuah kategori bila arah tidak diketahui. */
function arahDefaultKategori(kat) {
  return kategoriSheetMap()[kat] === 'masuk' ? 'masuk' : 'keluar';
}

// ---------- Normalisasi bahasa ----------

/** Huruf kecil, buang apostrof, tanda baca -> spasi, rapikan spasi. */
function bersihTeks(s) {
  return String(s || '').toLowerCase()
    .replace(/[\u2019'`]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

var AKHIRAN_RE = /^(.{2,}?)(nya|ny|in|an|kan|lah|2)$/;

/** Normalisasi kalimat: singkatan/gaul/typo -> kata baku (per token, juga bila berakhiran). */
function normalisasiTeks(text) {
  var N = (typeof KAMUS_NORMAL !== 'undefined') ? KAMUS_NORMAL : {};
  var has = Object.prototype.hasOwnProperty;
  var toks = bersihTeks(text).split(' ');
  for (var i = 0; i < toks.length; i++) {
    var t = toks[i];
    if (!t) continue;
    if (has.call(N, t)) { toks[i] = N[t]; continue; }
    var m = t.match(AKHIRAN_RE);
    if (m && has.call(N, m[1])) toks[i] = N[m[1]];
  }
  return ' ' + toks.join(' ') + ' ';
}

/**
 * Regex pencocok kata/frasa pada teks ternormalisasi (akhiran opsional untuk kata >= 4 huruf / frasa).
 * Kata kunci IKUT dinormalkan (mis. kata kunci "pinjeman" -> "pinjaman") agar sejalan dengan teks.
 */
function polaKata(kw) {
  var k = normalisasiTeks(kw).trim();
  if (!k) return null;
  var esc = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+');
  var suf = (k.indexOf(' ') >= 0 || k.length >= 4) ? '(?:nya|ny|in|an|kan|lah|2)?' : '';
  return new RegExp('(?:^|\\s)' + esc + suf + '(?=\\s|$)');
}

/**
 * Bobot kata kunci: frasa multi-kata jauh lebih kuat; kata panjang sedikit lebih kuat.
 * KATA_LEMAH (nama tempat/platform: marketplace, minimarket, ojol, bank) diberi bobot rendah —
 * itu menunjukkan DI MANA, bukan APA yang dibeli ("stroller dari fb marketplace" -> anak).
 */
function bobotKata(kw) {
  var k = normalisasiTeks(kw).trim();
  if (kataLemah()[k]) return 1;
  return k.split(' ').length * 2 + Math.min(k.length, 15) / 15;
}

var _LEMAH = null;
function kataLemah() {
  if (_LEMAH) return _LEMAH;
  _LEMAH = {};
  (typeof KATA_LEMAH !== 'undefined' ? KATA_LEMAH : []).forEach(function (w) { _LEMAH[normalisasiTeks(w).trim()] = true; });
  return _LEMAH;
}

// ---------- Aturan utang / piutang ----------
// Siapa yang berutang ditentukan ARAH uang + JENIS peristiwa:
//   masuk  + pinjam  = utang   (saya dapat pinjaman)   | masuk  + kembali = piutang (saya dibayar balik)
//   keluar + pinjam  = piutang (saya meminjamkan)      | keluar + kembali = utang   (saya mengembalikan)
// Ejaan baku DAN gaul ditulis keduanya (aman walau normalisasi belum memetakannya).
var RE_UTANG_ADA = /\s(pinjam|pinjem|pinjaman|pinjeman|minjam|minjem|dipinjam|dipinjem|kupinjam|kupinjem|pinjamkan|utang|hutang|ngutang|berutang|berhutang|kasbon|pinjol|talangin|talangan|ditalangin|kutalangin|nalangin|minjemin|minjamin|meminjamkan|ngutangin|utangin|piutang)\s/;
var RE_PEMBERI = /\s(minjemin|minjamin|meminjamkan|pinjamkan|kasih pinjam|kasih pinjem|kasih utang|talangin|talangan|ditalangin|kutalangin|nalangin|bayarin dulu|ngutangin|utangin|piutang)\s/;
var RE_LEMBAGA = /\s(pinjol|pinjaman online|kasbon|koperasi|gadai|leasing|adakami|kredit pintar|easycash|julo|tunaiku|rupiah cepat|uangme|kur|kta)\s/;
var RE_KEMBALI = /\s(balikin|dibalikin|kembalikan|kembaliin|ngembaliin|dikembalikan|dikembaliin|transfer balik|bayar balik|lunas|lunasin|lunasi|nyicil|dicicil|cicil|ganti uang|ganti duit|bayar utang|bayar hutang|bayar pinjaman|bayar pinjeman|bayar kasbon)\s/;
// Konteks belanja/pesanan: "uang balik" di sini berarti REFUND, bukan piutang.
var RE_KONTEKS_REFUND = /\s(tiket|pesanan|orderan|order|paket|barang|hotel|maskapai|toko|tokped|tokopedia|shopee|lazada|marketplace|deposit|jaminan|ongkir|pembelian|belanjaan|dibatalin|dibatalkan|dicancel|cancel|batal|diundur|retur|refund|cashback)\s/;

/** 'utang' | 'piutang' | '' (bukan urusan utang, atau arah tak diketahui & tak ada petunjuk tegas). */
function pilihUtangPiutang(norm, intent) {
  if (!RE_UTANG_ADA.test(norm)) return '';
  if (RE_PEMBERI.test(norm)) return 'piutang';
  if (RE_LEMBAGA.test(norm)) return 'utang';
  var kembali = RE_KEMBALI.test(norm);
  if (intent === 'masuk') return kembali ? 'piutang' : 'utang';
  if (intent === 'keluar') return kembali ? 'utang' : 'piutang';
  return '';
}

/**
 * Bobot tambahan per kategori (KATEGORI_BOBOT di KamusData.gs), mis. utang/piutang:
 * bila ada kata pinjam-meminjam, itu sinyal kuat yang harus mengalahkan kata benda penyerta
 * ("talangin bayar makan tim" -> piutang, bukan makan).
 */
function bobotKategori(kat) {
  return (typeof KATEGORI_BOBOT !== 'undefined' && KATEGORI_BOBOT[kat]) ? KATEGORI_BOBOT[kat] : 0;
}

// ---------- Indeks kamus ----------

function kamusIndex() {
  if (_KAMUS_IDX) return _KAMUS_IDX;
  var idx = [];
  var KK = (typeof KATEGORI_KEYWORDS !== 'undefined') ? KATEGORI_KEYWORDS : {};
  Object.keys(KK).forEach(function (kat) {
    (KK[kat] || []).forEach(function (kw) {
      var re = polaKata(kw);
      if (re) idx.push({ kat: kat, kw: bersihTeks(kw), re: re, w: bobotKata(kw) + bobotKategori(kat), user: false });
    });
  });
  // Nama kategori itu sendiri (mis. "rumah 2.502.500"), kecuali 'lainnya'. Bobot RENDAH (1.5):
  // nama kategori sering kata umum ("pbb rumah" = tagihan, bukan rumah) -> kata spesifik harus menang.
  Object.keys(kategoriSheetMap()).forEach(function (kat) {
    if (kat === 'lainnya') return;
    var re = polaKata(kat);
    if (re) idx.push({ kat: kat, kw: kat, re: re, w: 1.5 + bobotKategori(kat), user: false });
  });
  // Kamus pengguna — bobot +10 agar selalu menang.
  kamusPengguna().forEach(function (p) {
    var re = polaKata(p.kata);
    if (re) idx.push({ kat: p.kategori, kw: p.kata, re: re, w: bobotKata(p.kata) + 10, user: true });
  });
  _KAMUS_IDX = idx;
  return idx;
}

function verbaIndex() {
  if (_VERBA_IDX) return _VERBA_IDX;
  var idx = [];
  function add(list, arah) {
    (list || []).forEach(function (v) { var re = polaKata(v); if (re) idx.push({ arah: arah, re: re, w: bobotKata(v) }); });
  }
  add(typeof VERBA_MASUK !== 'undefined' ? VERBA_MASUK : [], 'masuk');
  add(typeof VERBA_KELUAR !== 'undefined' ? VERBA_KELUAR : [], 'keluar');
  _VERBA_IDX = idx;
  return idx;
}

// ---------- Klasifikasi ----------

/**
 * Tebak kategori dari teks. intent ('keluar'|'masuk'|'') membatasi kategori yang sah.
 * opts.hanyaPengguna = hanya kamus pengguna.
 * Kembalikan { kategori, skor, kata, dariPengguna } atau null.
 */
function klasifikasi(text, intent, opts) {
  var norm = normalisasiTeks(text);
  if (!norm.trim()) return null;
  var idx = kamusIndex(), jumlah = {}, bukti = {}, user = {};
  for (var i = 0; i < idx.length; i++) {
    var e = idx[i];
    if (opts && opts.hanyaPengguna && !e.user) continue;
    if (!e.re.test(norm)) continue;
    if (!kategoriBolehUntuk(e.kat, intent)) continue;
    jumlah[e.kat] = (jumlah[e.kat] || 0) + e.w;
    if (e.user) user[e.kat] = true;
    if (!bukti[e.kat] || e.w > bukti[e.kat].w) bukti[e.kat] = e;
  }
  // Skor = bukti terkuat + 25% sisanya: kata yang tumpang-tindih ("nasi" + "nasi kotak") tidak dihitung dobel,
  // tapi banyak bukti berbeda tetap sedikit menambah keyakinan.
  var skor = {};
  Object.keys(jumlah).forEach(function (k) { skor[k] = bukti[k].w + 0.25 * (jumlah[k] - bukti[k].w); });
  var best = '', bs = 0;
  Object.keys(skor).forEach(function (k) { if (skor[k] > bs) { bs = skor[k]; best = k; } });

  // Urusan utang/piutang diputuskan oleh aturan arah+peristiwa (kecuali pengguna sudah mengajari).
  if (!(opts && opts.hanyaPengguna) && !(best && user[best])) {
    var up = pilihUtangPiutang(norm, intent);
    // "X balikin duit" tanpa kata pinjam: konteks pesanan/barang = refund; selain itu = piutang dibayar balik.
    if (!up && intent === 'masuk' && RE_KEMBALI.test(norm) && !skor.refund) {
      up = RE_KONTEKS_REFUND.test(norm) ? 'refund' : 'piutang';
    }
    if (up && kategoriBolehUntuk(up, intent)) {
      return { kategori: up, skor: Math.max(bs, 5), kata: (bukti[up] ? bukti[up].kw : 'aturan arah + peristiwa'), dariPengguna: false };
    }
  }
  if (!best) return null;
  var kedua = 0;
  Object.keys(skor).forEach(function (k) { if (k !== best && skor[k] > kedua) kedua = skor[k]; });
  return { kategori: best, skor: bs, selisih: bs - kedua, kata: bukti[best].kw, dariPengguna: !!user[best] };
}

/** Tebak arah uang dari kata kerja/penanda: 'masuk' | 'keluar' | ''. */
function tebakArah(text) {
  var norm = normalisasiTeks(text), m = 0, k = 0;
  var idx = verbaIndex();
  for (var i = 0; i < idx.length; i++) {
    if (!idx[i].re.test(norm)) continue;
    if (idx[i].arah === 'masuk') m += idx[i].w; else k += idx[i].w;
  }
  return m > k ? 'masuk' : (k > m ? 'keluar' : '');
}

/**
 * Tebak aksi keuangan lengkap TANPA AI (dipakai saat AI tak paham / sibuk).
 * Butuh nominal + kategori yang dikenali. Arah dari kata kerja, atau default kategori.
 */
function tebakAksiDeterministik(text) {
  var nominal = parseNominalLoose(text);
  if (!nominal) return null;
  var arah = tebakArah(text);
  var r = klasifikasi(text, arah) || (arah ? klasifikasi(text, '') : null);
  if (!r) return null;
  var intent = (arah && kategoriBolehUntuk(r.kategori, arah)) ? arah : arahDefaultKategori(r.kategori);
  return { intent: intent, nominal: nominal, kategori: r.kategori, keterangan: '', sumber: 'bot-ai' };
}

/** Petunjuk ringkas untuk AI (dipakai di prompt) — '' bila kamus tak menemukan apa-apa. */
function petunjukKamus(text) {
  try {
    var arah = tebakArah(text);
    var r = klasifikasi(text, arah) || (arah ? null : klasifikasi(text, ''));
    if (!r) return '';
    // Petunjuk yang salah lebih buruk daripada tanpa petunjuk -> beri HANYA bila yakin:
    // ajaran pengguna, atau pemenang unggul jelas (selisih >= AMBANG_PETUNJUK) atas kandidat kedua.
    if (!r.dariPengguna && !(r.selisih >= AMBANG_PETUNJUK)) return '';
    // Utang vs piutang bergantung arah; tanpa arah yang jelas jangan menebak.
    if (!arah && (r.kategori === 'utang' || r.kategori === 'piutang')) return '';
    return '\n\n(Petunjuk kamus bot — pakai HANYA bila pesan ini transaksi keuangan: kategori yang cocok "' +
      r.kategori + '" berdasarkan kata "' + r.kata + '".)';
  } catch (e) { return ''; }
}

// ---------- Kamus pengguna (sheet "Kamus") ----------

function kamusSheet() {
  var book = ss();
  var s = book.getSheetByName('Kamus');
  if (!s) { s = book.insertSheet('Kamus'); s.appendRow(['kata', 'kategori']); s.setFrozenRows(1); }
  return s;
}

/** Daftar ajaran pengguna [{kata, kategori}] (cache per eksekusi). */
function kamusPengguna() {
  if (_KAMUS_USER) return _KAMUS_USER;
  var out = [];
  try {
    var s = ss().getSheetByName('Kamus');
    if (s && s.getLastRow() > 1) {
      s.getRange(2, 1, s.getLastRow() - 1, 2).getValues().forEach(function (r) {
        var k = bersihTeks(r[0]), c = String(r[1] || '').trim().toLowerCase();
        if (k && c) out.push({ kata: k, kategori: c });
      });
    }
  } catch (e) { logEvent('WARN', 'kamus_baca_gagal', String(e)); }
  _KAMUS_USER = out;
  return out;
}

function resetKamusCache() { _KAMUS_IDX = null; _KAMUS_USER = null; }

/** Ajari: kata -> kategori (upsert). Kembalikan 'baru' | 'ubah' | 'sama' | ''. */
function ingatKamus(kata, kategori) {
  var k = bersihTeks(kata), c = String(kategori || '').toLowerCase().trim();
  if (!k || !c || k.length < 2 || !/[a-z]/.test(k)) return '';
  var s = kamusSheet();
  var last = s.getLastRow();
  if (last > 1) {
    var rows = s.getRange(2, 1, last - 1, 2).getValues();
    for (var i = 0; i < rows.length; i++) {
      if (bersihTeks(rows[i][0]) !== k) continue;
      if (String(rows[i][1]).toLowerCase().trim() === c) return 'sama';
      s.getRange(i + 2, 2).setValue(c);
      resetKamusCache();
      return 'ubah';
    }
  }
  s.appendRow([k, c]);
  resetKamusCache();
  return 'baru';
}

/** Hapus satu ajaran. true bila ada yang dihapus. */
function hapusKamus(kata) {
  var k = bersihTeks(kata);
  var s = ss().getSheetByName('Kamus');
  if (!s || s.getLastRow() <= 1) return false;
  var rows = s.getRange(2, 1, s.getLastRow() - 1, 1).getValues();
  for (var i = rows.length - 1; i >= 0; i--) {
    if (bersihTeks(rows[i][0]) === k) { s.deleteRow(i + 2); resetKamusCache(); return true; }
  }
  return false;
}

/** Ambil inti keterangan untuk dipelajari (buang tautan arsip; batasi panjang). '' bila tak layak. */
function intiKeterangan(ket) {
  var k = bersihTeks(String(ket || '').split(' | ')[0].replace(/https?:\/\/\S+/g, ' '));
  return (k.length >= 3 && k.length <= 40 && /[a-z]{3,}/.test(k)) ? k : '';
}

// ---------- Perintah ----------

/** /kamus · /kamus <kata...> <kategori> · /kamus hapus <kata...> */
function cmdKamus(args, chatId) {
  args = args || [];
  if (!args.length) {
    var list = kamusPengguna();
    if (!list.length) {
      sendMessage(chatId, '📚 <b>Kamus Anda</b>\nBelum ada ajaran.\n\nAjari bot: <code>/kamus kata kategori</code>\nmis. <code>/kamus warung bu sri makan</code>', { html: true });
      return;
    }
    var out = ['📚 <b>Kamus Anda</b> (' + list.length + ')', '━━━━━━━━━━━━━━'];
    list.slice(-30).forEach(function (p) { out.push('• ' + htmlEsc(p.kata) + ' → <b>' + htmlEsc(p.kategori) + '</b>'); });
    if (list.length > 30) out.push('<i>…30 terbaru dari ' + list.length + '</i>');
    out.push('━━━━━━━━━━━━━━', '<i>Tambah: /kamus kata kategori · hapus: /kamus hapus kata</i>');
    sendMessage(chatId, out.join('\n'), { html: true });
    return;
  }
  if (String(args[0]).toLowerCase() === 'hapus') {
    var kh = args.slice(1).join(' ').trim();
    if (!kh) { sendMessage(chatId, 'Format: /kamus hapus <kata>'); return; }
    sendMessage(chatId, hapusKamus(kh) ? '🗑️ "' + kh + '" dihapus dari kamus.' : '❌ "' + kh + '" tidak ada di kamus Anda.');
    return;
  }
  if (args.length < 2) {
    sendMessage(chatId, 'Format: /kamus <kata> <kategori>\nmis. /kamus warung bu sri makan\nLihat kategori: /kategori');
    return;
  }
  var kat = String(args[args.length - 1]).toLowerCase().trim();
  var kata = args.slice(0, -1).join(' ');
  if (kategoriSheetMap()[kat] === undefined || kat === 'lainnya') {
    sendMessage(chatId, '❌ Kategori "' + kat + '" tidak dikenal. Kata TERAKHIR harus nama kategori. Lihat /kategori.');
    return;
  }
  var st = ingatKamus(kata, kat);
  if (!st) { sendMessage(chatId, '❌ Kata terlalu pendek/tidak valid.'); return; }
  var msg = { baru: '📚 Diingat', ubah: '✏️ Diperbarui', sama: '👌 Sudah ada' }[st];
  sendMessage(chatId, msg + ': "' + htmlEsc(bersihTeks(kata)) + '" → <b>' + htmlEsc(kat) + '</b>', { html: true });
}

/** Jelaskan kata/frasa masuk kategori apa (reverse lookup). */
function jelaskanKata(teks, chatId) {
  var r = klasifikasi(teks, '');
  if (!r) {
    sendMessage(chatId, '🤔 "' + htmlEsc(teks) + '" belum dikenali kamus.\nAjari bot: <code>/kamus ' + htmlEsc(bersihTeks(teks)) + ' &lt;kategori&gt;</code>', { html: true });
    return;
  }
  var t = kategoriSheetMap()[r.kategori];
  var jenis = t === 'masuk' ? 'pemasukan' : (t === 'both' ? 'pemasukan / pengeluaran' : 'pengeluaran');
  var arah = tebakArah(teks);
  sendMessage(chatId,
    '🔎 "' + htmlEsc(teks) + '"\n→ kategori <b>' + htmlEsc(r.kategori) + '</b> (' + jenis + ')' +
    '\nDikenali dari: "' + htmlEsc(r.kata) + '"' + (r.dariPengguna ? ' <i>(kamus Anda)</i>' : '') +
    (arah ? '\nArah uang terbaca: <b>' + arah + '</b>' : '') +
    '\n\n<i>Salah? Ajari: /kamus ' + htmlEsc(bersihTeks(teks)) + ' &lt;kategori&gt;</i>', { html: true });
}

var LABEL_INTENT = {
  keluar: 'Pengeluaran', masuk: 'Pemasukan', tugas: 'Tugas', catat: 'Catatan', cari: 'Cari berkas',
  rekap: 'Rekap keuangan', selesai: 'Tandai tugas selesai', hapus: 'Hapus data', daftar: 'Lihat daftar tugas',
  edit: 'Ubah data', acara: 'Acara / agenda'
};

/** /cek <kalimat> — tunjukkan bagaimana bot memahami kalimat (TIDAK menyimpan apa pun). */
function cmdCek(args, chatId) {
  var teks = (args || []).join(' ').trim();
  if (!teks) { sendMessage(chatId, 'Format: /cek <kalimat>\nmis. /cek isi bensinnya 50rb di spbu'); return; }
  sendTyping(chatId);
  var a = null;
  try { a = aiParse(teks); } catch (e) { a = null; }
  if (!a || !a.intent || a.intent === 'unknown') a = tebakAksiDeterministik(teks) || a;
  var r = klasifikasi(teks, '');
  var arah = tebakArah(teks);

  var lines = ['🔍 <b>Pemahaman Bot</b>', '━━━━━━━━━━━━━━', '💬 "' + htmlEsc(teks) + '"', ''];
  if (a && (a.intent === 'keluar' || a.intent === 'masuk')) {
    var kat = normalisasiKategori(a.kategori, a.intent, (a.keterangan || '') + ' ' + teks);
    lines.push('Jenis: <b>' + LABEL_INTENT[a.intent] + '</b>');
    lines.push('Kategori: <b>' + htmlEsc(kat) + '</b>');
    if (a.nominal) lines.push('Nominal: <b>Rp' + formatRupiah(a.nominal) + '</b>');
    if (a.keterangan) lines.push('Keterangan: ' + htmlEsc(a.keterangan));
  } else if (a && a.intent && LABEL_INTENT[a.intent]) {
    lines.push('Jenis perintah: <b>' + LABEL_INTENT[a.intent] + '</b>');
  } else {
    lines.push('Jenis: <i>belum dikenali</i> — akan dijawab sebagai obrolan AI.');
  }
  lines.push('', '<i>Kamus: ' + (r ? 'kategori ' + htmlEsc(r.kategori) + ' dari kata "' + htmlEsc(r.kata) + '"' +
    (r.dariPengguna ? ' (kamus Anda)' : '') : 'tak ada kata kunci cocok') + (arah ? ' · arah ' + arah : '') + '</i>');
  lines.push('<i>Ini hanya pengecekan — tidak disimpan.</i>');
  sendMessage(chatId, lines.join('\n'), { html: true });
}

/**
 * /lainnya          → daftar transaksi berkategori "lainnya" + saran kategori dari kamus.
 * /lainnya perbaiki → terapkan semua saran yang ada (transaksi tanpa saran dibiarkan).
 */
function cmdLainnya(args, chatId) {
  var terapkan = String((args && args[0]) || '').toLowerCase() === 'perbaiki';
  var s = sheet('Keuangan');
  var rows = s.getDataRange().getValues();
  var daftar = [];
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][3]).toLowerCase().trim() !== 'lainnya') continue;
    var tipe = String(rows[i][1]).toLowerCase().trim();
    var ket = String(rows[i][4] || '').split(' | ')[0];
    var r = ket ? klasifikasi(ket, tipe) : null;
    daftar.push({ row: i + 1, id: rows[i][6] || '', tipe: tipe, nominal: Number(rows[i][2]) || 0, ket: ket, kat: r ? r.kategori : '' });
  }
  if (!daftar.length) { sendMessage(chatId, '🎉 Tidak ada transaksi berkategori "lainnya".'); return; }
  var bisa = daftar.filter(function (x) { return x.kat; });

  if (terapkan) {
    bisa.forEach(function (x) { s.getRange(x.row, 4).setValue(x.kat); });
    logEvent('INFO', 'lainnya_diperbaiki', String(bisa.length));
    refreshDashboard();
    sendMessage(chatId, '✅ ' + bisa.length + ' transaksi dipindah dari "lainnya".' +
      (daftar.length - bisa.length ? '\nSisa ' + (daftar.length - bisa.length) + ' belum dikenali — lihat /lainnya lalu ajari dengan /kamus <kata> <kategori>.' : ''));
    return;
  }

  var out = ['🗂️ <b>Transaksi "lainnya"</b> (' + daftar.length + ')', '━━━━━━━━━━━━━━'];
  daftar.slice(-15).reverse().forEach(function (x) {
    out.push((x.id ? '<b>' + htmlEsc(x.id) + '</b> ' : '• ') + 'Rp' + formatRupiah(x.nominal) +
      (x.ket ? ' · "' + htmlEsc(x.ket.slice(0, 40)) + '"' : ' · <i>tanpa keterangan</i>') +
      ' → ' + (x.kat ? '<b>' + htmlEsc(x.kat) + '</b>' : '❔'));
  });
  if (daftar.length > 15) out.push('<i>…15 terbaru dari ' + daftar.length + '</i>');
  out.push('━━━━━━━━━━━━━━');
  if (bisa.length) out.push('Terapkan saran: <b>/lainnya perbaiki</b> (' + bisa.length + ' transaksi)');
  out.push('<i>Yang ❔: ajari dengan /kamus &lt;kata&gt; &lt;kategori&gt; atau ubah: /edit K-0001 kategori &lt;nama&gt;</i>');
  sendMessage(chatId, out.join('\n'), { html: true });
}
