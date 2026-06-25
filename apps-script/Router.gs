/**
 * Router.gs — parse perintah & dispatch ke handler (§D).
 * Dipanggil dari Main.doPost setelah gerbang whitelist.
 */

function route(text, chatId) {
  var t = text.trim();

  // Pesan tanpa awalan '/' → jalur bahasa natural (AI).
  if (t.charAt(0) !== '/') { handleNatural(t, chatId); return; }

  var tokens = t.split(/\s+/);
  var cmd = tokens[0].toLowerCase();
  var args = tokens.slice(1);

  switch (cmd) {
    case '/ping':   sendMessage(chatId, 'pong'); break;
    case '/start':
    case '/help':   sendMessage(chatId, helpText()); break;

    // Fase 1 — capture
    case '/keluar': cmdUang('keluar', args, chatId); break;
    case '/masuk':  cmdUang('masuk', args, chatId); break;
    case '/tugas':  cmdTugas(args, chatId); break;
    case '/catat':  cmdCatat(text, chatId); break;
    case '/selesai': cmdSelesai(args, chatId); break;
    case '/cari':   cmdCari(args, chatId); break;
    case '/dropbox': cmdCariDropbox(args, chatId); break;
    case '/acara':  cmdAcara(args, chatId); break;

    // Quality of life — lihat, rekap, edit & hapus
    case '/daftar': cmdDaftar(args, chatId); break;
    case '/catatan': cmdCatatan(args, chatId); break;
    case '/agenda': cmdAgenda(chatId); break;
    case '/kategori': cmdKategori(args, chatId); break;
    case '/saldo':  cmdSaldo(chatId); break;
    case '/status': cmdStatus(chatId); break;
    case '/rekap':  cmdRekap(args, chatId); break;
    case '/edit':   cmdEdit(args, chatId); break;
    case '/hapus':  cmdHapus(args, chatId); break;

    // Lapisan AI — konfirmasi aksi tertunda
    case '/ya':     confirmPending(chatId); break;
    case '/tidak':
    case '/batal':  cancelPending(chatId); break;

    default:
      sendMessage(chatId, 'Perintah tidak dikenal. Kirim /help untuk daftar.');
  }
}

function helpText() {
  return [
    'Asisten Pribadi — perintah:',
    '/keluar <nominal> <kategori> [ket] [#tgl]',
    '/masuk <nominal> <kategori> [ket] [#tgl]',
    '/tugas <teks> [#YYYY-MM-DD]',
    '/acara <label> #YYYY-MM-DD [HH:MM] (agenda sekali)',
    '/daftar [semua] (lihat tugas)',
    '/selesai <id-tugas>',
    '/catat <teks>  ·  /catatan [kata] (lihat)',
    '/agenda (acara mendatang)  ·  /saldo',
    '/kategori [nama] (daftar kategori)',
    '/cari <kata> (Drive)  ·  /dropbox <kata>',
    '/rekap [YYYY-MM] (ringkasan bulan)  ·  /status',
    '/edit terakhir|tugas <id>|catatan … (perbaiki)',
    '/hapus terakhir | tugas <id> | bulan YYYY-MM',
    '/ping',
    '',
    'Backfill tanggal: #kemarin, #2harilalu, #YYYY-MM-DD',
    '',
    'Atau ketik bebas (AI), tanpa garis miring:',
    '· "tadi jajan kopi 25rb"',
    '· "rekap keuangan bulan ini"',
    '· "rapat tim 30 juni jam 2 siang" (acara)',
    '· "tugas T-0001 sudah selesai"',
    '· "hapus transaksi terakhir"',
    '',
    '📸 Kirim FOTO struk / bukti transfer / catatan tulisan tangan',
    '   → bot baca otomatis & arsipkan ke Drive.',
    'Untuk simpan/hapus/ubah, bot minta konfirmasi → tap tombol ✅/❌ (atau ketik /ya /tidak).'
  ].join('\n');
}
