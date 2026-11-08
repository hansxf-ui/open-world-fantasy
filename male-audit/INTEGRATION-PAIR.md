# INTEGRASI PAIR — Karakter Cowok Blender (catatan dari MODEL PHASE)

Model cowok SELESAI (model + bake + bukti visual), BELUM ditempel
ke game. Dokumen ini SATU-SATUNYA yang perlu dibaca fase pair.
Jangan menebak dari file lain. (Untuk fondasi fase 1 cewek, baca
juga `char-audit/INTEGRATION.md` — struktur, pivot, dan aturan
recolor di bawah ini sengaja IDENTIK dengan cewek.)

## File MODEL PHASE (baru, belum di-deploy, belum di-commit)

- `scripts/model-character-male.py` — generator Blender (edit di
  sini bila model berubah, lalu re-bake + re-render).
- `scripts/bake-character-male.py` — GLB -> JS (pola parser
  `bake-kenney.py`, sama seperti bake cewek).
- `scripts/render-male-audit.py` — render audit Cycles.
- `js/vendor/character-blender-male.js` — HASIL BAKE (jangan edit
  manual). Export: `CHARACTER_BLENDER_MALE` + `CHARACTER_BLENDER_MALE_TRIS`.
- `vendor-src/character-male/character-male.glb` — intermediate
  (gitignored).
- `male-audit/*.png` — bukti visual (front, side,
  three-quarter, face-closeup, hand-closeup).

## Geometri: pivot-local, SAMA PERSIS dengan cewek

| Mesh | Pivot (group/body space) | Baked y-range (pivot-local) |
|---|---|---|
| legL | group `(-0.14, 0.85, 0)` | -0.85 .. 0 |
| legR | group `(0.14, 0.85, 0)` | -0.85 .. 0 |
| torso | body `(0, 0.35, 0)` | -0.45 .. 0.525 |
| head | body `(0, 1.0, 0)` | -0.218 .. 0.296 |
| hat | body `(0, 1.22, 0)` | -0.16 .. 0.29 |
| armL | body `(-0.34, 0.65, 0)` | -0.74 .. 0.10 |
| armR | body `(0.34, 0.65, 0)` | -0.74 .. 0.10 |

Body group tetap di y=0.85, group origin tetap di kaki, hadap
+z, kaki menapak tanah persis (character-space y 0.0000..2.3600,
puncak pompom 2.36 = sama dengan cewek). Nama objek TETAP:
`legL, legR, body, torso, head, hat, armL, armR`. Karena pivot,
nama, dan hierarki identik, `poseHumanoid`, `disposeObject3D`,
`nextAnimState`, sprite label (2.65) + balon chat (3.25), dan
collider radius 0.4 TIDAK BERUBAH untuk varian cowok.

## Segitiga (audit boot 41 pemain)

| Mesh | Tris cowok | Tris cewek (banding) |
|---|---|---|
| legL | 88 | 88 |
| legR | 88 | 88 |
| torso | 312 | 312 |
| head | 782 | 894 |
| hat | 240 | 240 |
| armL | 128 | 128 |
| armR | 128 | 128 |
| **Total per pemain** | **1.766** (anggaran 2.640) | 1.878 |

Head cowok lebih hemat 112 tris (tanpa locks + tanpa blush,
minus kotak dagu v1 yang dicabut = 12 tris). Proyeksi audit:
semua-cowok 290.974 − 99.384 (lama: 2.424×41) + 72.406
(cowok: 1.766×41) = **263.996 / 300.000**; campuran cowok/cewek
ada di antara 263.996 dan 268.588 (semua-cewek). Draw call
TIDAK BERUBAH (tetap 7 mesh + 1 sprite per pemain, varian apa
pun). Marker PUTIH (1,1,1) HANYA di torso (288 verts) + lengan
(48+48) — diverifikasi dari file bake; tidak ada part lain yang
kena recolor nyasar. Jadi `recolorShirt` versi putih (dari fase
2 cewek) berlaku TANPA PERUBAHAN untuk cowok.

## Yang WAJIB dilakukan fase pair (BELUM diimplementasikan)

1. `js/character.js`: `buildHumanoid(color, variant)` — pilih
   `CHARACTER_BLENDER` (cewek) atau `CHARACTER_BLENDER_MALE`
   (cowok); konstruksi BufferGeometry dari array bake varian
   tersebut, SEGAR per humanoid (bangun dari array atau
   `clone()` — jangan share geometry antar pemain karena
   recolor memutasi warna verteks). `recolorShirt` (remap
   putih) + `poseHumanoid` + `disposeObject3D` tidak berubah.
2. Entry screen (`js/main.js` + `index.html`): picker gender
   (cewek/cowok) di samping swatch warna; simpan pilihan di
   localStorage (mis. kunci `owf-gender`, pola sama seperti
   `owf-name`/`owf-color`/`owf-muted`); humanoid lokal dibangun
   dari varian terpilih; ganti varian = rebuild humanoid lokal
   (bukan ganti geometri di tempat).
3. Payload net (`js/net.js`): tambah field varian ke payload
   join/pos (mis. `variant: 'female' | 'male'`); validasi =
   string enum, default `'female'` bila hilang/invalid (kompat
   mundur dengan client lama); remote dibangun dari varian di
   payload-nya; bila pos datang dengan varian berbeda dari
   remote yang sudah dibangun, rebuild remote itu (paling
   sederhana: varian dikunci saat join, perubahan tengah sesi
   diabaikan sampai rejoin — putuskan di fase pair).
4. Tes fase pair (baru, di `tests/`): buildHumanoid kedua
   varian = 7 mesh + 1 sprite, nama + pivot benar, recolor
   putih->warna bekerja di kedua varian tanpa mengubah part
   lain, kaki min y = 0 di kedua varian, validasi + default
   field varian di payload.
5. Deploy: tambah `js/vendor/character-blender-male.js` ke
   daftar file runtime (di samping `character-blender.js`).

## Perbedaan desain cowok vs cewek (dipertahankan vs diubah)

DIPERTAHANKAN (supaya sepasang): beanie + pompom identik,
jaket identik (kerah torus krem + 2 kancing + sabuk + gesper +
hem + 2 saku), tangan identik (telapak + 4 jari bertingkat +
jempol sisi dalam), sepatu + sol + ujung membulat identik,
celana + warna kulit + mata bead + hidung kerucut identik,
pivot/tinggi/nama mesh identik, marker putih identik.

DIUBAH (supaya terbaca cowok): rambut PENDEK — cap saja tanpa
locks samping panjang (cewek punya 2 locks); TANPA blush
(cewek punya 2 blush); bahu/torso sedikit lebih lebar (jaket
atas 0.32 vs 0.30, bahu di ±0.35 vs ±0.33, radius bahu 0.12 vs
0.115); tengkorak sedikit lebih lebar dan kurang tinggi (skala
1.06/0.95 vs 1.0/1.0... cewek: cap rambut 1.05/0.85/1.05,
tengkorak tanpa skala); mulut sedikit lebih lebar (0.08 vs
0.07), tetap balok netral.

## Temuan render + perbaikan SEBELUM melapor (v1 -> v2)

- v1: SATU cacat nyata di close-up wajah — kotak dagu
  (0.14×0.06×0.06, muka depan z 0.22) menonjol ~0.05 dari
  permukaan wajah di tinggi dagu (permukaan tengkorak yang
  di-squash y 0.95 hanya ~0.167 di sana — hitungan ellipsoid,
  bukan teori) sehingga tampil sebagai balok tempelan, bukan
  rahang. Kotak datar tidak bisa mengikuti kelengkungan bola
  (rata di atas = menonjol di bawah).
- v2 (FINAL): kotak dagu DICABUT total (head 794 -> 782 tris).
  Ketegasan rahang kini dari tengkorak yang lebih lebar +
  mulut yang lebih lebar saja. Close-up wajah v2 bersih: mata
  + hidung + mulut terbaca, tanpa blush, rambut pendek terbaca
  dari tepi cap di pelipis, tanpa floater/celah/kaki melayang.
- Sisi lain v1 sudah bersih dan tidak berubah di v2: depan
  (proporsi + kaki menapak + sepatu bersol), samping (profil
  hidung + rambut pendek belakang + sol), 3/4 (jaket + sabuk +
  kerah + topi), close-up tangan (telapak + jari + jempol).

## Trade-off yang diputuskan di MODEL PHASE (bukan cacat)

- Sama seperti cewek: jari menempel (tanpa celah antar jari),
  keterbacaan lewat ujung bertingkat; mulut = balok lurus
  netral; tanpa alis/poni terpisah (brim beanie menelan band
  dahi — pelajaran fase 1 cewek, berlaku identik di sini);
  jaket = silinder meruncing + detail (bukan tailored).
- Tanpa kotak dagu: rahang cowok lebih halus dari rencana awal,
  tapi wajah tetap terbaca cowok lewat kombinasi rambut
  pendek + tanpa blush + bahu lebar + mulut lebar. Menambah
  geometri rahang lain hanya mengulang cacat v1.
