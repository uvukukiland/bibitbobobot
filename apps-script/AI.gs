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
    nominal: { type: 'integer' },
    kategori: { type: 'string' },
    keterangan: { type: 'string' },
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
  required: ['intent']
};

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

/**
 * Kamus kata kunci -> kategori (kategori KELUAR). Satu sumber kebenaran:
 * dipakai untuk (a) panduan prompt AI dan (b) tebakan deterministik.
 * Tambah/ubah kata di sini saja. Hindari kata yang ambigu (mis. "tiket" sendiri).
 */
var KATEGORI_KEYWORDS = {
  makan: ['makan', 'makanan', 'minuman', 'jajan', 'jajanan', 'ngemil', 'cemilan', 'nongki', 'kopi', 'ngopi', 'es kopi', 'cafe', 'kafe', 'resto', 'restoran', 'warung', 'warteg', 'gofood', 'grabfood', 'shopeefood', 'snack', 'kue', 'roti', 'donat', 'catering', 'nasi', 'nasi goreng', 'nasi padang', 'ayam geprek', 'bakso', 'mie ayam', 'mie instan', 'indomie', 'bakmi', 'sate', 'martabak', 'gorengan', 'jus', 'boba', 'seblak', 'pempek', 'siomay', 'batagor', 'cilok', 'sushi', 'ramen', 'seafood', 'pizza', 'burger', 'kfc', 'mcd', 'mcdonald', 'hokben', 'starbucks', 'mixue', 'janji jiwa', 'kopi kenangan', 'es teh', 'es krim', 'dimsum', 'kebab', 'soto', 'pecel', 'gado-gado', 'kantin', 'angkringan', 'lalapan', 'frozen food', 'sembako', 'beras', 'telur', 'gula', 'minyak goreng', 'sayur', 'daging', 'buah', 'susu kotak'],
  transport: ['bensin', 'isi bensin', 'bbm', 'pertalite', 'pertamax', 'pertamax turbo', 'solar', 'dexlite', 'spbu', 'shell', 'ojek', 'ojol', 'ojek online', 'grab', 'gojek', 'gocar', 'grabbike', 'grabcar', 'maxim', 'indriver', 'bluebird', 'gosend', 'taksi', 'taxi', 'angkot', 'busway', 'transjakarta', 'damri', 'mikrolet', 'kereta', 'krl', 'mrt', 'lrt', 'commuter', 'tol', 'e-toll', 'etoll', 'parkir', 'parkir motor', 'parkir mobil', 'ongkos', 'tiket pesawat', 'tiket kereta', 'tiket bus', 'tiket kapal', 'pesawat', 'ferry', 'servis motor', 'servis mobil', 'tune up', 'ganti oli', 'oli', 'tambal ban', 'ban', 'ban motor', 'aki', 'busi', 'kampas rem', 'wiper', 'nitrogen', 'bengkel', 'cuci motor', 'cuci mobil', 'cuci helm', 'derek', 'pajak kendaraan', 'stnk', 'tilang', 'denda tilang', 'rental mobil', 'sewa motor', 'travel'],
  belanja: ['sampo', 'shampoo', 'sabun', 'sabun mandi', 'sabun cuci', 'odol', 'pasta gigi', 'sikat gigi', 'deterjen', 'pewangi', 'pelembut', 'tisu', 'tissue', 'skincare', 'kosmetik', 'bedak', 'lipstik', 'parfum', 'sunscreen', 'handbody', 'lotion', 'deodorant', 'pembalut', 'toner', 'serum', 'masker wajah', 'softlens', 'baju', 'pakaian', 'celana', 'kaos', 'kemeja', 'jaket', 'jilbab', 'hijab', 'gamis', 'mukena', 'sajadah', 'sarung', 'peci', 'baju koko', 'seragam', 'sepatu', 'sandal', 'kaos kaki', 'topi', 'ikat pinggang', 'tas', 'dompet', 'jam tangan', 'kacamata', 'aksesoris', 'gelang', 'kalung', 'cincin', 'anting', 'handuk', 'alat tulis', 'pulpen', 'pensil', 'buku tulis', 'kertas', 'elektronik', 'gadget', 'hp', 'laptop', 'komputer', 'printer', 'charger', 'kabel', 'kabel data', 'powerbank', 'mouse', 'keyboard', 'flashdisk', 'casing', 'tempered glass', 'anti gores', 'speaker', 'adaptor', 'earphone', 'headset', 'servis hp', 'service hp', 'perbaikan hp', 'ganti baterai', 'ganti lcd', 'servis laptop', 'rokok', 'vape', 'kado', 'salon', 'potong rambut', 'barbershop', 'cukur', 'pangkas rambut', 'creambath', 'facial', 'fotokopi', 'print', 'ongkir', 'jne', 'jnt', 'sicepat', 'anteraja', 'shopee', 'tokopedia', 'lazada', 'blibli', 'bukalapak', 'tiktok shop', 'olshop', 'belanja', 'minimarket', 'indomaret', 'alfamart', 'transmart', 'hypermart', 'superindo', 'uniqlo', 'erafone', 'ibox'],
  tagihan: ['bpjs', 'asuransi', 'premi', 'listrik', 'pln', 'token listrik', 'token pln', 'pulsa listrik', 'tagihan listrik', 'bayar listrik', 'pdam', 'tagihan air', 'pgn', 'gas pgn', 'telepon', 'telkom', 'indihome', 'first media', 'biznet', 'myrepublic', 'iconnet', 'wifi', 'internet rumah', 'sewa wifi', 'tv kabel', 'langganan koran', 'iuran', 'iuran rt', 'iuran warga', 'iuran sampah', 'sampah', 'keamanan', 'cicilan', 'angsuran', 'kartu kredit', 'kredit', 'kpr', 'paylater', 'kredivo', 'akulaku', 'spaylater', 'home credit', 'leasing', 'pbb', 'pajak bumi', 'biaya admin', 'admin bank', 'pajak penghasilan', 'pph'],
  pulsa: ['pulsa', 'isi pulsa', 'beli pulsa', 'voucher pulsa', 'kuota', 'kuota internet', 'paket data', 'paket internet', 'paket nelpon', 'paket telpon', 'paketan', 'roaming', 'esim', 'kartu perdana', 'telkomsel', 'indosat', 'im3', 'smartfren', 'by.u'],
  hiburan: ['netflix', 'spotify', 'disney', 'youtube premium', 'youtube music', 'amazon prime', 'prime video', 'apple music', 'joox', 'vidio', 'wetv', 'viu', 'iqiyi', 'hbo', 'iflix', 'mola', 'catchplay', 'crunchyroll', 'twitch', 'webtoon', 'bioskop', 'xxi', 'cgv', 'nonton', 'tiket bioskop', 'tiket konser', 'konser', 'game', 'top up game', 'voucher game', 'mobile legend', 'mobile legends', 'diamond ml', 'free fire', 'pubg', 'uc pubg', 'genshin', 'genshin impact', 'honkai', 'valorant', 'roblox', 'robux', 'steam', 'playstation', 'ps4', 'ps5', 'xbox', 'nintendo', 'nintendo switch', 'karaoke', 'wisata', 'liburan', 'rekreasi', 'tiket masuk', 'dufan', 'ancol', 'taman safari', 'trans studio', 'waterboom', 'waterpark', 'kebun binatang', 'wahana'],
  kesehatan: ['obat', 'apotek', 'apotik', 'dokter', 'dokter gigi', 'rumah sakit', 'klinik', 'puskesmas', 'igd', 'rawat inap', 'rawat jalan', 'kontrol', 'periksa', 'periksa mata', 'optik', 'cek darah', 'cek gula', 'cek kolesterol', 'cek kesehatan', 'medical checkup', 'lab', 'laboratorium', 'rontgen', 'usg', 'swab', 'antigen', 'pcr', 'rapid test', 'operasi', 'fisioterapi', 'terapi', 'vitamin', 'suplemen', 'vaksin', 'imunisasi', 'paracetamol', 'antibiotik', 'salep', 'betadine', 'plester', 'hansaplast', 'perban', 'kasa', 'antiseptik', 'hand sanitizer', 'koyo', 'salonpas', 'counterpain', 'balsem', 'minyak kayu putih', 'minyak angin', 'freshcare', 'tolak angin', 'antangin', 'antimo', 'promag', 'antasida', 'obat maag', 'bodrex', 'panadol', 'sanmol', 'decolgen', 'paramex', 'komix', 'obat batuk', 'obat demam', 'norit', 'entrostop', 'diapet', 'tetes mata', 'jamu', 'herbal', 'tensimeter', 'oximeter', 'thermometer', 'kursi roda', 'behel', 'scaling', 'tambal gigi', 'cabut gigi', 'bidan', 'persalinan', 'melahirkan', 'masker medis', 'pijat', 'spa', 'massage', 'refleksi', 'luluran'],
  pendidikan: ['sekolah', 'kuliah', 'kursus', 'les', 'les privat', 'bimbel', 'bimbingan', 'spp', 'ukt', 'uang sekolah', 'uang gedung', 'uang pangkal', 'biaya sekolah', 'biaya kuliah', 'iuran sekolah', 'daftar ulang', 'buku', 'ebook', 'e-book', 'jurnal', 'modul', 'seminar', 'workshop', 'bootcamp', 'pelatihan', 'training', 'webinar', 'kelas online', 'tryout', 'try out', 'wisuda', 'toga', 'skripsi', 'tesis', 'praktikum', 'toefl', 'ielts', 'sertifikasi', 'mengaji', 'ngaji', 'tpa', 'madrasah', 'pesantren', 'ruangguru', 'zenius', 'quipper', 'udemy', 'coursera', 'skill academy'],
  rumah: ['perabot', 'perabotan', 'furniture', 'mebel', 'perlengkapan rumah', 'perbaikan rumah', 'renovasi', 'galon', 'galon air', 'elpiji', 'lpg', 'gas elpiji', 'gas 3kg', 'tabung gas', 'regulator', 'gas', 'sapu', 'pel', 'lap', 'kanebo', 'pengki', 'serbet', 'ember', 'panci', 'wajan', 'piring', 'gelas', 'kompor', 'rice cooker', 'magic com', 'blender', 'mixer', 'vacuum', 'dispenser', 'kulkas', 'mesin cuci', 'kipas angin', 'kasur', 'bantal', 'sprei', 'gorden', 'karpet', 'keset', 'lemari', 'jam dinding', 'lampu', 'lampu led', 'bohlam', 'stop kontak', 'kabel listrik', 'pipa', 'kran', 'selang', 'cat tembok', 'semen', 'keramik', 'paku', 'obat nyamuk', 'baygon', 'pembersih lantai', 'wipol', 'sunlight', 'sikat wc', 'pengharum ruangan', 'kapur barus', 'tukang', 'tukang ledeng', 'tukang listrik', 'service ac', 'servis ac', 'service kulkas', 'service tv', 'service mesin cuci', 'asisten rumah tangga', 'pembantu', 'sewa rumah', 'kontrakan', 'bayar kos', 'kos', 'kost', 'laundry', 'cuci baju', 'setrika'],
  anak: ['popok', 'pampers', 'diapers', 'merries', 'mamypoko', 'susu anak', 'susu formula', 'sufor', 'sgm', 'bebelac', 'mpasi', 'bubur bayi', 'biskuit bayi', 'cerelac', 'milna', 'mainan', 'mainan anak', 'baju anak', 'baju bayi', 'sepatu anak', 'stroller', 'gendongan', 'box bayi', 'baby walker', 'car seat', 'breast pump', 'minyak telon', 'bedak bayi', 'sabun bayi', 'baby oil', 'baby cream', 'wet wipes', 'gurita', 'selimut bayi', 'vitamin anak', 'zwitsal', 'daycare', 'perlengkapan bayi'],
  sedekah: ['sedekah', 'sedekah subuh', 'jumat berkah', 'sodaqoh', 'zakat', 'zakat fitrah', 'zakat mal', 'infaq', 'infak', 'infak masjid', 'iuran masjid', 'donasi', 'sumbangan', 'amal', 'dana sosial', 'kemanusiaan', 'wakaf', 'qurban', 'kurban', 'aqiqah', 'fidyah', 'santunan', 'kotak amal', 'kencleng', 'panti asuhan', 'yatim', 'perpuluhan', 'kolekte', 'persembahan'],
  olahraga: ['gym', 'fitness', 'fitnes', 'membership gym', 'jogging', 'lari', 'maraton', 'fun run', 'sepeda', 'sewa sepeda', 'gowes', 'helm sepeda', 'futsal', 'badminton', 'renang', 'kolam renang', 'kacamata renang', 'sewa lapangan', 'yoga', 'kelas yoga', 'zumba', 'kelas zumba', 'pilates', 'aerobik', 'boxing', 'muaythai', 'karate', 'taekwondo', 'pencak silat', 'panjat tebing', 'wall climbing', 'raket', 'shuttlecock', 'dumbbell', 'barbel', 'treadmill', 'whey protein', 'matras yoga']
};

/** Panduan pemetaan -> teks prompt (dibuat dari KATEGORI_KEYWORDS, satu sumber). */
function kategoriHintText() {
  var lines = ['PEMETAAN KATEGORI — petakan ke yang TERDEKAT; HINDARI "lainnya" (pakai hanya bila benar-benar tak ada yang cocok):'];
  Object.keys(KATEGORI_KEYWORDS).forEach(function (k) {
    var kw = KATEGORI_KEYWORDS[k];
    lines.push('- ' + k + ': ' + kw.slice(0, 14).join(', ') + (kw.length > 14 ? ', dll' : '') + '.');
  });
  lines.push('Catatan "tiket": pesawat/kereta/bus = transport; konser/bioskop = hiburan.');
  return lines.join('\n');
}

/** Tebak kategori dari teks via kata kunci (cocok per-kata). '' bila tak ada. */
function tebakKategori(text) {
  var low = ' ' + String(text || '').toLowerCase() + ' ';
  var cats = Object.keys(KATEGORI_KEYWORDS);
  for (var i = 0; i < cats.length; i++) {
    var kws = KATEGORI_KEYWORDS[cats[i]];
    for (var j = 0; j < kws.length; j++) {
      var kw = kws[j].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // escape regex
      if (new RegExp('\\b' + kw + '\\b', 'i').test(low)) return cats[i];
    }
  }
  return '';
}

/** Cari kategori dari teks: lewat kata kunci ATAU nama kategori persis (selain "lainnya"). '' bila tak ada. */
function cariKategori(text) {
  var kat = tebakKategori(text);
  if (kat) return kat;
  var toks = String(text).toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/);
  for (var i = 0; i < toks.length; i++) {
    if (toks[i].length >= 3 && toks[i] !== 'lainnya' &&
        (isKategoriValid(toks[i], 'keluar') || isKategoriValid(toks[i], 'masuk'))) return toks[i];
  }
  return '';
}

/**
 * Tentukan kategori final: utamakan kategori valid & spesifik dari AI;
 * bila kosong/'lainnya'/invalid, coba dari konteks (kata kunci / nama kategori); terakhir 'lainnya'.
 */
function normalisasiKategori(rawKat, intent, konteks) {
  var kat = String(rawKat || '').toLowerCase().trim();
  if (isKategoriValid(kat, intent) && kat !== 'lainnya') return kat;
  var tebak = cariKategori(konteks || '');
  if (tebak && isKategoriValid(tebak, intent)) return tebak;
  return isKategoriValid(kat, intent) ? kat : 'lainnya';
}

/** Parse nominal longgar untuk fallback: "2.502.500", "25rb", "1,5jt", "10k". null bila tak ada. */
function parseNominalLoose(text) {
  var s = String(text || '').toLowerCase();
  var m = s.match(/(\d[\d.,]*)\s*(juta|jt|ribu|rb|k)\b/);
  if (m) {
    var num = parseFloat(m[1].replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));
    if (isNaN(num)) return null;
    var v = Math.round(num * (/juta|jt/.test(m[2]) ? 1000000 : 1000));
    return v > 0 ? v : null;
  }
  m = s.match(/\d[\d.,]*\d|\d+/);
  if (m) {
    var cleaned = m[0].replace(/[.,]/g, '');
    if (/^\d+$/.test(cleaned)) { var n = parseInt(cleaned, 10); return n > 0 ? n : null; }
  }
  return null;
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
  var nominal = parseNominalLoose(text);
  if (!nominal) return null;
  var kat = cariKategori(text);
  if (!kat) return null;
  return { intent: tipeKategori(kat), nominal: nominal, kategori: kat, keterangan: '', sumber: 'bot-ai' };
}

/** Panggil Gemini, kembalikan objek aksi {intent,...} atau null bila gagal. */
function geminiParse(text) {
  var apiKey = cfg('GEMINI_API_KEY');
  var model = cfgOptional('GEMINI_MODEL', 'gemini-2.5-flash');
  var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + apiKey;
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');

  var sys = [
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

  var payload = {
    systemInstruction: { parts: [{ text: sys }] },
    contents: [{ parts: [{ text: text }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: ACTION_SCHEMA,
      temperature: 0
    }
  };

  var res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  var body;
  try { body = JSON.parse(res.getContentText()); } catch (e) { body = null; }
  if (!body || !body.candidates || !body.candidates[0]) {
    logEvent('ERROR', 'gemini_failed', String(res.getResponseCode()) + ' ' + res.getContentText().slice(0, 300));
    return null;
  }
  try {
    return JSON.parse(body.candidates[0].content.parts[0].text);
  } catch (e) {
    logEvent('ERROR', 'gemini_parse_failed', String(e));
    return null;
  }
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

/** Teks ringkas untuk konfirmasi. */
function confirmText(a) {
  switch (a.intent) {
    case 'keluar': return '💸 Pengeluaran Rp' + formatRupiah(a.nominal) + ' · ' + a.kategori + (a.keterangan ? ' · ' + a.keterangan : '') + tglInfo(a);
    case 'masuk':  return '💰 Pemasukan Rp' + formatRupiah(a.nominal) + ' · ' + a.kategori + (a.keterangan ? ' · ' + a.keterangan : '') + tglInfo(a);
    case 'tugas':  return '📋 Tugas: ' + a.teks + (a.jatuh_tempo ? ' (tenggat ' + a.jatuh_tempo + ')' : '');
    case 'catat':  return '📝 Catatan: ' + a.teks;
    case 'acara':  return '📅 Acara: ' + a.teks + ' — ' + a.tanggal + ' ' + (a.jam || '08:00');
    case 'hapus':
      if (a.target === 'tugas') return '🗑️ Hapus tugas ' + (a.id || '?') + '?';
      if (a.target === 'bulan') return '🗑️ Hapus SEMUA keuangan bulan ' + (a.bulan || '?') + '? (tidak bisa dibatalkan)';
      return '🗑️ Hapus transaksi keuangan TERAKHIR?';
    case 'edit':
      if (a.target === 'catatan') return '✏️ Ubah catatan terakhir jadi: ' + (a.nilai || '?');
      if (a.target === 'tugas') return '✏️ Ubah tugas ' + (a.id || '?') + ' — ' + (a.field || '?') + ' → ' + (a.nilai || '?');
      return '✏️ Ubah transaksi terakhir — ' + (a.field || '?') + ' → ' + (a.nilai || '?');
    default:       return '';
  }
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
  try { a = geminiParse(text); }
  catch (e) { logEvent('ERROR', 'gemini_call_threw', String(e)); sendMessage(chatId, '⚠️ AI sedang sibuk/limit. Coba lagi sebentar, atau pakai perintah /help.'); return; }

  if (!a || a.intent === 'unknown') {
    // Pola singkat "<kategori> <nominal>" (mis. "rumah 2.502.500") -> pengeluaran.
    var fb = tebakAksiKeuangan(text);
    if (fb) { setPending(chatId, fb); askConfirm(chatId, confirmText(fb)); return; }
    sendMessage(chatId, [
      '🤔 Belum paham maksudnya. Contoh yang bisa saya proses:',
      '• "jajan kopi 25rb"  (catat pengeluaran)',
      '• "gaji masuk 5jt"  (pemasukan)',
      '• "ingatkan bayar listrik besok"  (tugas)',
      '• "rekap bulan ini" · "lihat tugas"',
      '• "hapus tugas T-0001" · "selesaikan T-0001"',
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

/** Prompt konfirmasi dengan tombol ✅/❌ (tetap bisa diketik /ya /tidak juga). */
function askConfirm(chatId, bodyText) {
  sendButtons(chatId, bodyText, [[
    { text: '✅ Ya', callback_data: 'confirm' },
    { text: '❌ Tidak', callback_data: 'cancel' }
  ]]);
}

/** Tangani tap tombol inline konfirmasi. */
function handleCallback(cq, chatId) {
  answerCallback(cq.id);
  try { if (cq.message) clearButtons(chatId, cq.message.message_id); } catch (e) {}
  var data = String(cq.data || '');
  if (data === 'confirm') confirmPending(chatId);
  else if (data === 'cancel') cancelPending(chatId);
}

/** View read-only via bahasa natural: saldo, catatan, agenda. Return true bila ditangani. */
function handleViewShortcut(text, chatId) {
  var low = ' ' + text.toLowerCase() + ' ';
  var lihat = /\b(lihat|liat|cek|tampilin|tampilkan|daftar|list|show|berapa|ada|apa)\b/.test(low);
  if (/\bsaldo\b/.test(low) || /\b(uang|duit)ku\b/.test(low)) { cmdSaldo(chatId); return true; }
  if (/\b(catatan|notes?)\b/.test(low) && lihat) { cmdCatatan([], chatId); return true; }
  if (/\b(agenda|jadwal|acara)\b/.test(low) && lihat) { cmdAgenda(chatId); return true; }
  return false;
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
      append('Keuangan', [when, a.intent, a.nominal, kat, ket, a.sumber || 'bot-ai']);
      logEvent('INFO', 'ai_keuangan_added', a.intent + ' ' + a.nominal + ' ' + kat);
      sendMessage(chatId, '✅ Tersimpan: ' + confirmText(a) + tanggalSuffix(when));
      refreshDashboard();
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
      append('Catatan', [new Date(), isiCatat]);
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
