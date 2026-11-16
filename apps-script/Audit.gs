/**
 * Audit.gs — periksa KESEHATAN data di semua sheet, dan perbaiki yang aman.
 *
 *   auditData()          : laporan saja (tidak mengubah apa pun).
 *   auditDataPerbaiki()  : laporan + perbaikan otomatis yang AMAN:
 *       - nominal tersimpan sebagai teks ("25.000")  -> angka 25000
 *       - tanggal tersimpan sebagai teks             -> tanggal
 *       - tipe/kategori/status huruf besar / spasi   -> dirapikan ("Keluar " -> "keluar")
 *       - ID kosong / ID kembar                       -> diberi ID baru (yang pertama dipertahankan)
 *       - baris kosong di tengah data                 -> dihapus
 *       - judul kolom kosong, sheet wajib hilang, kategori "lainnya" hilang -> dilengkapi
 *   Hal yang butuh keputusan Anda (mis. kategori tak terdaftar, nominal 0) HANYA dilaporkan.
 *
 * Laporan dikirim ke chat Telegram Anda dan dicatat di Execution log.
 * Mandiri: tidak bergantung pada Kamus.gs (membaca sheet Kategori sendiri).
 */

function auditData() { return jalankanAudit(false); }
function auditDataPerbaiki() { return jalankanAudit(true); }

function jalankanAudit(perbaiki) {
  var book = ss();
  var lap = { masalah: [], beres: [] };
  var M = function (s) { lap.masalah.push(s); };
  var F = function (s) { lap.beres.push(s); };
  var ubahKeuangan = false;

  // ---------- 1) Sheet wajib & judul kolom ----------
  Object.keys(SCHEMA).forEach(function (nama) {
    var s = book.getSheetByName(nama);
    if (!s) {
      if (perbaiki) { s = book.insertSheet(nama); s.appendRow(SCHEMA[nama]); s.setFrozenRows(1); F('Sheet "' + nama + '" dibuat'); }
      else M('Sheet "' + nama + '" tidak ada');
      return;
    }
    var hdr = s.getRange(1, 1, 1, SCHEMA[nama].length).getValues()[0];
    SCHEMA[nama].forEach(function (h, i) {
      var ada = String(hdr[i] || '').trim().toLowerCase();
      if (ada === h) return;
      if (!ada) {
        if (perbaiki) { s.getRange(1, i + 1).setValue(h); F(nama + ': judul kolom ' + (i + 1) + ' diisi "' + h + '"'); }
        else M(nama + ': judul kolom ' + (i + 1) + ' kosong (seharusnya "' + h + '")');
      } else {
        M(nama + ': judul kolom ' + (i + 1) + ' = "' + hdr[i] + '", seharusnya "' + h + '" — cek manual');
      }
    });
  });

  // ---------- 2) Kategori ----------
  var katMap = {};
  var ks = book.getSheetByName('Kategori');
  if (ks && ks.getLastRow() > 1) {
    var lihatKat = {};
    ks.getRange(2, 1, ks.getLastRow() - 1, 2).getValues().forEach(function (row, i) {
      var nama = String(row[0] || ''), tipe = String(row[1] || '');
      var n = nama.trim().toLowerCase(), t = tipe.trim().toLowerCase();
      if (!n) return;
      if (n !== nama || t !== tipe) {
        if (perbaiki) { ks.getRange(i + 2, 1, 1, 2).setValues([[n, t]]); F('Kategori baris ' + (i + 2) + ' dirapikan ("' + nama + '")'); }
        else M('Kategori baris ' + (i + 2) + ': "' + nama + '" perlu dirapikan (huruf kecil, tanpa spasi)');
      }
      if (['keluar', 'masuk', 'both', ''].indexOf(t) < 0) M('Kategori "' + n + '": tipe "' + tipe + '" tidak dikenal (pakai keluar/masuk/both)');
      if (lihatKat[n]) M('Kategori "' + n + '" tercatat ganda (baris ' + lihatKat[n] + ' & ' + (i + 2) + ')');
      else lihatKat[n] = i + 2;
      katMap[n] = t;
    });
  }
  if (ks && !katMap.lainnya) {
    if (perbaiki) { ks.appendRow(['lainnya', 'both']); katMap.lainnya = 'both'; F('Kategori "lainnya" ditambahkan'); }
    else M('Kategori "lainnya" belum ada di sheet Kategori');
  }

  // ---------- 3) Keuangan ----------
  var keu = book.getSheetByName('Keuangan');
  if (keu && keu.getLastRow() > 1) {
    var data = keu.getRange(2, 1, keu.getLastRow() - 1, 7).getValues();
    var kosong = [], lihatId = {}, idGanda = [], idKosong = 0, katAsing = {}, maxId = 0;
    data.forEach(function (r) { var m = String(r[6] || '').match(/(\d+)\s*$/); if (m) maxId = Math.max(maxId, parseInt(m[1], 10)); });

    data.forEach(function (r, i) {
      var baris = i + 2;
      if (!r.slice(0, 6).some(function (v) { return v !== '' && v !== null; })) { kosong.push(baris); return; }

      if (!(r[0] instanceof Date)) {
        var d = auditTanggal(r[0]);
        if (d && perbaiki) { keu.getRange(baris, 1).setValue(d); F('Keuangan baris ' + baris + ': tanggal teks "' + r[0] + '" -> tanggal'); ubahKeuangan = true; }
        else if (d) M('Keuangan baris ' + baris + ': tanggal tersimpan sebagai teks ("' + r[0] + '") — bisa diperbaiki otomatis');
        else M('Keuangan baris ' + baris + ': tanggal tidak valid ("' + r[0] + '")');
      }

      var tipe = auditTipe(r[1]);
      if (!tipe) M('Keuangan baris ' + baris + ': tipe "' + r[1] + '" bukan masuk/keluar');
      else if (tipe !== r[1]) {
        if (perbaiki) { keu.getRange(baris, 2).setValue(tipe); F('Keuangan baris ' + baris + ': tipe -> "' + tipe + '"'); ubahKeuangan = true; }
        else M('Keuangan baris ' + baris + ': tipe "' + r[1] + '" perlu dirapikan -> "' + tipe + '"');
      }

      if (typeof r[2] !== 'number') {
        var n = auditNominal(r[2]);
        if (n && perbaiki) { keu.getRange(baris, 3).setValue(n); F('Keuangan baris ' + baris + ': nominal teks "' + r[2] + '" -> ' + n); ubahKeuangan = true; }
        else M('Keuangan baris ' + baris + ': nominal "' + r[2] + '" bukan angka' + (n ? ' — bisa diperbaiki otomatis' : ' — format meragukan, perbaiki manual'));
      } else if (r[2] <= 0) {
        M('Keuangan baris ' + baris + ': nominal ' + r[2] + ' (nol/negatif)');
      }

      var kat = String(r[3] || '').trim().toLowerCase();
      if (kat !== r[3]) {
        if (perbaiki && kat) { keu.getRange(baris, 4).setValue(kat); F('Keuangan baris ' + baris + ': kategori dirapikan -> "' + kat + '"'); ubahKeuangan = true; }
        else if (kat) M('Keuangan baris ' + baris + ': kategori "' + r[3] + '" perlu dirapikan');
      }
      if (!kat) M('Keuangan baris ' + baris + ': kategori kosong');
      else if (Object.keys(katMap).length && katMap[kat] === undefined) katAsing[kat] = (katAsing[kat] || 0) + 1;

      var id = String(r[6] || '').trim().toUpperCase();
      if (!id) idKosong++;
      else if (lihatId[id]) idGanda.push(baris);
      else lihatId[id] = baris;
    });

    var asing = Object.keys(katAsing);
    if (asing.length) {
      M('Kategori tak terdaftar di sheet Kategori: ' + asing.map(function (k) { return k + ' (' + katAsing[k] + 'x)'; }).join(', ') +
        ' — tambahkan ke sheet Kategori, atau ubah transaksinya (/edit K-0001 kategori …)');
    }
    if (idGanda.length) {
      if (perbaiki) {
        idGanda.forEach(function (baris) { maxId++; keu.getRange(baris, 7).setValue('K-' + ('0000' + maxId).slice(-4)); });
        F('Keuangan: ' + idGanda.length + ' ID kembar diberi ID baru (baris ' + idGanda.join(', ') + ')');
      } else M('Keuangan: ' + idGanda.length + ' ID kembar (baris ' + idGanda.join(', ') + ')');
    }
    if (kosong.length) {
      if (perbaiki) {
        for (var k = kosong.length - 1; k >= 0; k--) keu.deleteRow(kosong[k]);
        F('Keuangan: ' + kosong.length + ' baris kosong di tengah dihapus'); ubahKeuangan = true;
      } else M('Keuangan: ' + kosong.length + ' baris kosong di tengah data (baris ' + kosong.slice(0, 10).join(', ') + (kosong.length > 10 ? ', …' : '') + ')');
    }
    if (idKosong) {
      if (perbaiki) { backfillId('Keuangan', 7, 'K-'); F('Keuangan: ' + idKosong + ' transaksi tanpa ID diberi ID'); }
      else M('Keuangan: ' + idKosong + ' transaksi belum punya ID (jalankan auditDataPerbaiki atau migrateAddIds)');
    }
  }

  // ---------- 4) Tugas ----------
  var tug = book.getSheetByName('Tugas');
  if (tug && tug.getLastRow() > 1) {
    var td = tug.getRange(2, 1, tug.getLastRow() - 1, 5).getValues();
    var lihatT = {}, tGanda = [], tKosong = [], maxT = 0;
    td.forEach(function (r) { var m = String(r[0] || '').match(/(\d+)\s*$/); if (m) maxT = Math.max(maxT, parseInt(m[1], 10)); });
    td.forEach(function (r, i) {
      var baris = i + 2;
      if (!String(r[1] || '').trim() && !String(r[0] || '').trim()) return; // baris kosong
      var id = String(r[0] || '').trim().toUpperCase();
      if (!id) tKosong.push(baris); else if (lihatT[id]) tGanda.push(baris); else lihatT[id] = true;
      var st = auditStatus(r[3]);
      if (!st) M('Tugas baris ' + baris + ': status "' + r[3] + '" bukan open/done');
      else if (st !== r[3]) {
        if (perbaiki) { tug.getRange(baris, 4).setValue(st); F('Tugas baris ' + baris + ': status -> "' + st + '"'); }
        else M('Tugas baris ' + baris + ': status "' + r[3] + '" perlu dirapikan -> "' + st + '"');
      }
      if (r[2] && !(r[2] instanceof Date) && !isValidDate(String(r[2]).trim())) M('Tugas ' + (id || 'baris ' + baris) + ': tenggat "' + r[2] + '" bukan tanggal');
    });
    var tPerlu = tKosong.concat(tGanda);
    if (tPerlu.length) {
      if (perbaiki) {
        tPerlu.forEach(function (baris) { maxT++; tug.getRange(baris, 1).setValue('T-' + ('0000' + maxT).slice(-4)); });
        F('Tugas: ' + tPerlu.length + ' tugas tanpa ID / ID kembar diberi ID baru');
      } else M('Tugas: ' + tKosong.length + ' tanpa ID, ' + tGanda.length + ' ID kembar');
    }
  }

  // ---------- 5) Catatan ----------
  var cat = book.getSheetByName('Catatan');
  if (cat && cat.getLastRow() > 1) {
    var cd = cat.getRange(2, 1, cat.getLastRow() - 1, 3).getValues();
    var cTanpaId = cd.filter(function (r) { return String(r[1] || '').trim() && !String(r[2] || '').trim(); }).length;
    if (cTanpaId) {
      if (perbaiki) { backfillId('Catatan', 3, 'N-'); F('Catatan: ' + cTanpaId + ' catatan tanpa ID diberi ID'); }
      else M('Catatan: ' + cTanpaId + ' catatan belum punya ID');
    }
  }

  // ---------- 6) Jadwal ----------
  var jad = book.getSheetByName('Jadwal');
  if (jad && jad.getLastRow() > 1) {
    jad.getRange(2, 1, jad.getLastRow() - 1, 6).getValues().forEach(function (r, i) {
      var baris = i + 2;
      if (!String(r[1] || '').trim()) return;
      var a = auditAktif(r[4]);
      if (!a) M('Jadwal baris ' + baris + ': aktif "' + r[4] + '" bukan y/n');
      else if (a !== r[4]) {
        if (perbaiki) { jad.getRange(baris, 5).setValue(a); F('Jadwal baris ' + baris + ': aktif -> "' + a + '"'); }
        else M('Jadwal baris ' + baris + ': aktif "' + r[4] + '" perlu dirapikan -> "' + a + '"');
      }
      if (!(r[2] instanceof Date) && !/^\d{1,2}[:.]\d{2}$/.test(String(r[2]).trim())) M('Jadwal "' + r[1] + '": waktu "' + r[2] + '" bukan HH:MM');
    });
  }

  // ---------- 7) Budget & Kamus (bila ada) ----------
  var bud = book.getSheetByName('Budget');
  if (bud && bud.getLastRow() > 1) {
    bud.getRange(2, 1, bud.getLastRow() - 1, 2).getValues().forEach(function (r, i) {
      var baris = i + 2, k = String(r[0] || '').trim().toLowerCase();
      if (!k) return;
      if (Object.keys(katMap).length && (katMap[k] === undefined || katMap[k] === 'masuk')) M('Budget "' + k + '": bukan kategori pengeluaran yang terdaftar');
      if (typeof r[1] !== 'number') {
        var nb = auditNominal(r[1]);
        if (nb && perbaiki) { bud.getRange(baris, 2).setValue(nb); F('Budget "' + k + '": batas teks "' + r[1] + '" -> ' + nb); }
        else M('Budget "' + k + '": batas "' + r[1] + '" bukan angka' + (nb ? ' — bisa diperbaiki otomatis' : ' — format meragukan, perbaiki manual'));
      }
    });
  }
  var kam = book.getSheetByName('Kamus');
  if (kam && kam.getLastRow() > 1 && Object.keys(katMap).length) {
    var kamAsing = kam.getRange(2, 1, kam.getLastRow() - 1, 2).getValues()
      .filter(function (r) { var k = String(r[1] || '').trim().toLowerCase(); return String(r[0] || '').trim() && k && katMap[k] === undefined; })
      .map(function (r) { return '"' + r[0] + '"→' + r[1]; });
    if (kamAsing.length) M('Kamus: kategori tak terdaftar untuk ' + kamAsing.slice(0, 8).join(', ') + (kamAsing.length > 8 ? ', …' : ''));
  }

  if (ubahKeuangan) { try { refreshDashboard(); } catch (e) {} }
  var lengkap = auditLaporan(perbaiki, lap, Infinity);
  Logger.log(lengkap);                                         // Execution log: daftar LENGKAP
  try { sendMessage(cfg('ALLOWED_CHAT_ID'), auditLaporan(perbaiki, lap, 15)); } // Telegram: ringkas (batas 4096 karakter)
  catch (e) { Logger.log('Laporan tak terkirim ke Telegram: ' + e); }
  logEvent('INFO', perbaiki ? 'audit_perbaiki' : 'audit', lap.beres.length + ' diperbaiki, ' + lap.masalah.length + ' masalah');
  return lengkap;
}

/** Susun laporan; `batas` = maks baris per bagian (Infinity = semua). */
function auditLaporan(perbaiki, lap, batas) {
  var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm');
  var out = ['🩺 Audit Data ' + (perbaiki ? '+ Perbaikan' : '(laporan)') + ' — ' + stamp, ''];
  var potong = function (arr) {
    return arr.slice(0, batas).map(function (s) { return '• ' + s; })
      .concat(arr.length > batas ? ['• …dan ' + (arr.length - batas) + ' lagi (daftar lengkap di Execution log)'] : []);
  };
  if (lap.beres.length) out = out.concat(['✅ Diperbaiki (' + lap.beres.length + '):'], potong(lap.beres), ['']);
  if (lap.masalah.length) out = out.concat(['⚠️ Perlu dicek (' + lap.masalah.length + '):'], potong(lap.masalah), ['']);
  if (!lap.beres.length && !lap.masalah.length) out.push('🎉 Semua data sehat — tidak ada masalah ditemukan.');
  else if (!perbaiki && lap.masalah.length) out.push('Jalankan auditDataPerbaiki untuk memperbaiki yang aman secara otomatis.');
  return out.join('\n');
}

/** "masuk" | "keluar" | '' dari teks tipe yang mungkin berantakan. */
function auditTipe(v) {
  var s = String(v || '').trim().toLowerCase();
  if (/^(masuk|pemasukan|income|in)$/.test(s)) return 'masuk';
  if (/^(keluar|pengeluaran|expense|out)$/.test(s)) return 'keluar';
  return '';
}

/** "open" | "done" | ''. */
function auditStatus(v) {
  var s = String(v || '').trim().toLowerCase();
  if (/^(open|belum|aktif|todo)$/.test(s)) return 'open';
  if (/^(done|selesai|beres|sudah)$/.test(s)) return 'done';
  return '';
}

/** "y" | "n" | ''. */
function auditAktif(v) {
  var s = String(v === true ? 'y' : (v === false ? 'n' : v || '')).trim().toLowerCase();
  if (/^(y|ya|yes|aktif|1|true)$/.test(s)) return 'y';
  if (/^(n|no|tidak|nonaktif|0|false)$/.test(s)) return 'n';
  return '';
}

/**
 * Tanggal dari teks "YYYY-MM-DD[ HH:MM]" atau "dd/MM/yyyy[ HH:MM]" (juga - dan .).
 * KETAT: tahun, bulan, tanggal & jam diperiksa bolak-balik — tanggal mustahil (mis. "12/31/2026"
 * format AS = bulan 31) DITOLAK, bukan digulirkan ke tanggal lain. null bila ragu.
 */
function auditTanggal(v) {
  var s = String(v || '').trim(), m, y, mo, d, h = 12, mi = 0;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2})[:.](\d{2})(?::\d{2})?)?$/))) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else if ((m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})(?:\s+(\d{1,2})[:.](\d{2}))?$/))) { d = +m[1]; mo = +m[2]; y = +m[3]; }
  else return null;
  if (m[4] !== undefined) { h = +m[4]; mi = +m[5]; }
  if (h > 23 || mi > 59) return null;
  var r = new Date(y, mo - 1, d, h, mi);
  return (r.getFullYear() === y && r.getMonth() === mo - 1 && r.getDate() === d) ? r : null;
}

/**
 * Nominal dari teks — KETAT, hanya bentuk yang tak ambigu (id_ID: titik = ribuan):
 *   "25000" · "25.000" · "Rp 1.500.000" · "1.500.000,00" · "1,500,000" · "1,500,000.00" · "25000,00"
 * Desimal sungguhan ("25.50", "1,5") atau format campuran -> null (hanya dilaporkan, TIDAK ditulis),
 * agar tak pernah menghasilkan angka 100x lipat.
 */
function auditNominal(v) {
  var s = String(v === null || v === undefined ? '' : v).replace(/^\s*rp\.?\s*/i, '').replace(/\s+/g, '');
  var m;
  if (/^\d+$/.test(s)) return Number(s) || null;
  if ((m = s.match(/^(\d{1,3}(?:\.\d{3})+)(?:,00?)?$/))) return Number(m[1].replace(/\./g, '')) || null;
  if ((m = s.match(/^(\d{1,3}(?:,\d{3})+)(?:\.00?)?$/))) return Number(m[1].replace(/,/g, '')) || null;
  if ((m = s.match(/^(\d+)[,.]00?$/))) return Number(m[1]) || null;
  return null;
}
