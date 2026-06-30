/**
 * Commands.gs — handler perintah capture (T1.2–T1.4).
 * Acuan: DESAIN-DAN-TASK.md §D.
 */

var KATEGORI_HINT = 'Lihat/ubah daftar di sheet Kategori.';

/**
 * /keluar & /masuk → tulis ke Keuangan.
 * tipe: 'keluar' | 'masuk'. args: token setelah perintah.
 */
function cmdUang(tipe, args, chatId) {
  // Token '#...' = tanggal (backfill), mis. #kemarin atau #2026-06-19.
  var tanggal = new Date();
  var badDate = null;
  var rest = [];
  args.forEach(function (t) {
    if (t.charAt(0) === '#') {
      var d = resolveTanggal(t.slice(1));
      if (d) tanggal = d; else badDate = t;
    } else rest.push(t);
  });
  if (badDate) {
    sendMessage(chatId, '❌ Tanggal "' + badDate + '" tidak dikenali. Pakai #kemarin, #2harilalu, atau #YYYY-MM-DD.');
    return;
  }

  if (rest.length < 2) {
    sendMessage(chatId,
      'Format: /' + tipe + ' <nominal> <kategori> [keterangan] [#tanggal]\n' +
      'Contoh: /' + tipe + ' 25000 ' + (tipe === 'keluar' ? 'makan kopi pagi' : 'gaji bulanan') + '\n' +
      'Backfill: /' + tipe + ' 25000 makan kemarin #kemarin');
    return;
  }

  var nominal = parseNominal(rest[0]);
  if (nominal === null) {
    sendMessage(chatId, '❌ Nominal "' + rest[0] + '" tidak valid. Harus angka positif, mis. 25000 atau 25.000.');
    return;
  }

  var kategori = rest[1].toLowerCase();
  if (!isKategoriValid(kategori, tipe)) {
    sendMessage(chatId, '❌ Kategori "' + kategori + '" tidak dikenal untuk ' + tipe + '. ' + KATEGORI_HINT);
    return;
  }

  var keterangan = rest.slice(2).join(' ');
  append('Keuangan', [tanggal, tipe, nominal, kategori, keterangan, 'bot']);
  logEvent('INFO', 'keuangan_added', tipe + ' ' + nominal + ' ' + kategori);
  sendMessage(chatId,
    '✅ <b>Tercatat</b>\n' + (tipe === 'keluar' ? '💸 Pengeluaran' : '💰 Pemasukan') +
    '\n<b>Rp' + formatRupiah(nominal) + '</b> · ' + htmlEsc(kategori) +
    (keterangan ? '\n📝 ' + htmlEsc(keterangan) : '') + tanggalSuffix(tanggal),
    { html: true, keyboard: quickActions() });
  refreshDashboard();
  if (tipe === 'keluar') cekBudget(kategori, nominal, chatId);
}

/** " (19/06/2026)" bila tanggal bukan hari ini; '' bila hari ini. */
function tanggalSuffix(d) {
  var tz = Session.getScriptTimeZone();
  var sama = Utilities.formatDate(d, tz, 'yyyy-MM-dd') === Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  return sama ? '' : ' (' + Utilities.formatDate(d, tz, 'dd/MM/yyyy') + ')';
}

/**
 * /tugas <teks> [#YYYY-MM-DD] → tulis ke Tugas.
 * Token yang diawali '#' diperlakukan sebagai tanggal jatuh tempo.
 */
function cmdTugas(args, chatId) {
  if (args.length === 0) {
    sendMessage(chatId, 'Format: /tugas <teks> [#YYYY-MM-DD]\nContoh: /tugas bayar listrik #2026-06-25');
    return;
  }

  var jatuhTempo = '';
  var teksTokens = [];
  args.forEach(function (t) {
    if (t.charAt(0) === '#') jatuhTempo = t.slice(1);
    else teksTokens.push(t);
  });

  var teks = teksTokens.join(' ').trim();
  if (!teks) { sendMessage(chatId, '❌ Teks tugas kosong.'); return; }
  if (jatuhTempo && !isValidDate(jatuhTempo)) {
    sendMessage(chatId, '❌ Tanggal "' + jatuhTempo + '" tidak valid. Pakai #YYYY-MM-DD, mis. #2026-06-25.');
    return;
  }

  var id = nextId('Tugas', 'T-');
  append('Tugas', [id, teks, jatuhTempo, 'open', '']);
  logEvent('INFO', 'tugas_added', id);
  sendMessage(chatId, '✅ Tugas ' + id + ' disimpan' + (jatuhTempo ? ' (tenggat ' + jatuhTempo + ')' : '') + ': ' + teks);
}

/**
 * /catat <teks> → tulis ke Catatan. Pakai teks mentah agar isi asli terjaga.
 */
function cmdCatat(rawText, chatId) {
  var teks = rawText.replace(/^\/catat\s*/i, '').trim();
  if (!teks) { sendMessage(chatId, 'Format: /catat <teks>'); return; }
  append('Catatan', [new Date(), teks]);
  logEvent('INFO', 'catatan_added', '');
  sendMessage(chatId, '✅ Catatan disimpan.');
}

/**
 * /selesai <id-tugas> → tandai status tugas jadi 'done' (Fase 2).
 * Menghentikan pengingat follow-up untuk tugas itu.
 */
function cmdSelesai(args, chatId) {
  if (args.length === 0) { sendMessage(chatId, 'Format: /selesai <id-tugas>, mis. /selesai T-0001'); return; }
  var id = args[0].toUpperCase();
  var s = sheet('Tugas');
  var rows = s.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).toUpperCase() === id) {
      s.getRange(i + 1, 4).setValue('done'); // kolom status
      logEvent('INFO', 'tugas_done', id);
      sendMessage(chatId, '✅ Tugas ' + id + ' ditandai selesai: ' + rows[i][1]);
      return;
    }
  }
  sendMessage(chatId, '❌ Tugas ' + id + ' tidak ditemukan.');
}

/**
 * /cari <kata> → cari berkas di folder Drive root, balas daftar + tautan klik (Fase 3).
 * Tap tautannya untuk buka & edit di app Drive/Docs.
 */
function cmdCari(args, chatId) {
  var query = args.join(' ').trim();
  if (!query) { sendMessage(chatId, 'Format: /cari <kata>\nContoh: /cari laporan'); return; }

  var files;
  try {
    files = searchDriveFiles(query, 10);
  } catch (e) {
    logEvent('ERROR', 'cari_failed', String(e));
    sendMessage(chatId, '❌ Gagal mencari di Drive. Pastikan DRIVE_ROOT_FOLDER_ID benar & folder dapat diakses.');
    return;
  }

  if (files.length === 0) {
    sendMessage(chatId, 'Tidak ada berkas yang namanya mengandung "' + query + '" di folder root & subfoldernya.');
    return;
  }

  var tz = Session.getScriptTimeZone();
  var lines = files.map(function (f, i) {
    return (i + 1) + '. <a href="' + htmlEsc(f.url) + '">' + htmlEsc(f.name) + '</a> <i>(' + Utilities.formatDate(f.updated, tz, 'dd/MM/yyyy') + ')</i>';
  });
  sendMessage(chatId, '🔎 <b>Hasil "' + htmlEsc(query) + '"</b>\n━━━━━━━━━━━━━━\n' + lines.join('\n'), { html: true, preview: false });
}
