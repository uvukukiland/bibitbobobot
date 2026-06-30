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
    case '/start':  sendMessage(chatId, welcomeText(), { html: true }); break;
    case '/help':   sendMessage(chatId, helpText(), { html: true }); break;

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
    case '/riwayat': cmdRiwayat(args, chatId); break;
    case '/catatan': cmdCatatan(args, chatId); break;
    case '/agenda': cmdAgenda(chatId); break;
    case '/kategori': cmdKategori(args, chatId); break;
    case '/budget': cmdBudget(args, chatId); break;
    case '/export':
    case '/backup': cmdExport(chatId); break;
    case '/hapuslog':
    case '/bersihlog': cmdHapusLog(chatId); break;
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

function welcomeText() {
  return [
    '👋 <b>Halo! Saya AI_din</b>, asisten pribadi Anda.',
    '',
    'Saya bantu catat <b>keuangan</b>, <b>tugas</b>, &amp; <b>agenda</b> — cukup ngobrol biasa, tanpa perlu hafal perintah.',
    '',
    'Coba ketik:',
    '• "jajan kopi 25rb"  → catat pengeluaran',
    '• "gaji masuk 5jt"  → pemasukan',
    '• "ingatkan bayar listrik besok"  → tugas',
    '• "rekap bulan ini"  → laporan',
    '• "tips hemat belanja bulanan"  → 💬 tanya/ngobrol AI',
    '',
    '📸 Atau kirim <b>FOTO</b> struk / transfer / resi — saya baca otomatis.',
    '',
    'Tekan tombol <b>Menu</b> (≡) di kiri bawah untuk semua perintah, atau ketik /help.'
  ].join('\n');
}

function helpText() {
  return [
    '📖 <b>Panduan AI_din</b>',
    '━━━━━━━━━━━━━━',
    '💬 <b>Ngobrol bebas</b>',
    'Tanya apa saja / minta saran — saya jawab seperti asisten AI.',
    'Mis. "tips hemat belanja bulanan".',
    '',
    '💸 <b>Keuangan</b>',
    '• "kopi 25rb"  atau  /keluar [nominal] [kategori] [ket]',
    '• "gaji masuk 5jt"  atau  /masuk [nominal] [kategori]',
    '• /saldo  ·  /rekap [YYYY-MM | YYYY]  ·  /kategori [nama]',
    '• /budget [kategori] [nominal]  ·  /export (backup .xlsx)',
    '',
    '✅ <b>Tugas &amp; Agenda</b>',
    '• /tugas [teks] [#YYYY-MM-DD]  ·  /daftar [semua]',
    '• /selesai [id]  ·  /agenda',
    '• /acara [label] #YYYY-MM-DD [HH:MM]',
    '',
    '🗒️ <b>Catatan &amp; Berkas</b>',
    '• /catat [teks]  ·  /catatan [kata]',
    '• /cari [kata] (Drive)  ·  /dropbox [kata]',
    '',
    '🧾 <b>Riwayat &amp; Backup</b>',
    '• /riwayat [n] (transaksi + ID)  ·  /export',
    '',
    '✏️ <b>Perbaiki / Hapus</b>',
    '• /edit terakhir | K-0001 | tugas [id] | N-0001 …',
    '• /hapus terakhir | K-0001 | tugas [id] | N-0001 | bulan YYYY-MM',
    '',
    '📸 <b>Foto</b>',
    'Kirim foto struk / transfer / resi / tulisan tangan — saya baca otomatis &amp; arsipkan.',
    '',
    '🗓️ Backfill tanggal: #kemarin, #2harilalu, #YYYY-MM-DD',
    '⚙️ /status   ·   ❓ /help',
    '',
    '<i>Untuk simpan/hapus/ubah, bot minta konfirmasi → tap ✅/❌.</i>'
  ].join('\n');
}
