# INTEGRASI FASE 2 — Karakter Blender (catatan dari Fase 1)

Fase 1 selesai: model + bake + bukti visual. File ini adalah SATU-SATUNYA
dokumen yang perlu dibaca fase 2. Jangan menebak dari file lain.

## File Fase 1 (baru, belum di-deploy, belum di-commit)

- `scripts/model-character.py` — generator Blender (parametrik, edit di
  sini bila model berubah, lalu re-bake + re-render).
- `scripts/bake-character.py` — GLB -> JS (pola parser bake-kenney.py).
- `scripts/render-char-audit.py` — render audit Cycles.
- `js/vendor/character-blender.js` — HASIL BAKE (jangan edit manual).
- `vendor-src/character/character.glb` — intermediate (gitignored).
- `char-audit/*.png` — bukti visual (front, side, three-quarter,
  face-closeup, hand-closeup).

## Geometri: pivot-local (ini kuncinya)

Setiap mesh di-bake RELATIF TERHADAP PIVOT-nya, bukan terhadap kaki.
Fase 2 cukup pasang mesh di posisi pivot yang SAMA PERSIS dengan
`js/character.js` hari ini — tidak ada posisi yang berubah:

| Mesh | Pivot di character.js | Baked y-range (pivot-local) |
|---|---|---|
| legL (pivot Group + Mesh anak) | group `(-0.14, 0.85, 0)` | -0.85 .. 0 |
| legR (pivot Group + Mesh anak) | group `(0.14, 0.85, 0)` | -0.85 .. 0 |
| torso (Mesh di body) | body `(0, 0.35, 0)` | -0.45 .. 0.48 |
| head (Mesh di body) | body `(0, 1.0, 0)` | -0.28 .. 0.28 |
| hat (Mesh di body) | body `(0, 1.22, 0)` | -0.14 .. 0.29 |
| armL (pivot Group + Mesh anak) | body `(-0.34, 0.65, 0)` | -0.80 .. 0.10 |
| armR (pivot Group + Mesh anak) | body `(0.34, 0.65, 0)` | -0.80 .. 0.10 |

Body group tetap di y=0.85, group origin tetap di kaki. Nama objek
TETAP: `legL, legR, body, torso, head, hat, armL, armR` (poseHumanoid
dan recolorShirt mencari lewat nama; limbMesh = pivot Group dengan
Mesh sebagai `children[0]`). `poseHumanoid` TIDAK BERUBAH (ayun
walk/run, swim, jump bekerja dari pivot yang sama). Sprite label
TIDAK BERUBAH (tinggi total tetap 2.36, label 2.65 + balon 3.25
tetap clear). Collider radius 0.4 TIDAK BERUBAH (berbasis group).

## Segitiga (audit boot 41 pemain)

| Mesh | Tris |
|---|---|
| legL | 88 |
| legR | 88 |
| torso | 312 |
| head | 894 |
| hat | 240 |
| armL | 128 |
| armR | 128 |
| **Total per pemain** | **1.878** (anggaran 2.640, karakter lama 2.424) |

Proyeksi audit fase 2: 290.974 − 99.384 (lama: 2.424×41) + 76.998
(baru: 1.878×41) = **268.588 / 300.000**. Draw call TIDAK BERUBAH
(tetap 7 mesh + 1 sprite per pemain). Sisa anggaran: 762 tris/pemain
— JANGAN dipakai tanpa alasan; ini margin pengaman audit.

## Perubahan character.js yang WAJIB (fase 2, checklist)

1. Import `CHARACTER_BLENDER` dari `./vendor/character-blender.js`.
2. `buildHumanoid`: ganti konstruksi `mergeColored` per part dengan
   BufferGeometry dari array bake (`pos/nor/col/index` per part).
   WAJIB geometri SEGAR per humanoid (bangun dari array, atau
   `geometry.clone()` — clone menyalin attribute, jadi aman).
   JANGAN share satu geometry antar pemain: alasannya di poin 3.
3. `recolorShirt` WAJIB DIUBAH (ini satu-satunya perubahan logika):
   - Lama: remap verteks yang warnanya == warna baju lama.
   - Baru: remap verteks yang warnanya == PUTIH (1,1,1, toleransi
     0.01) ke warna baru. Putih HANYA ada di torso/armL/armR
     (bake meng-assert ini); tidak ada part lain yang kena.
   - `buildHumanoid` WAJIB memanggil `recolorShirt(group, color)`
     sesudah membangun, karena geometri bake berwarna putih di
     bagian baju — tanpa panggilan ini jaket tampil PUTIH.
   - `userData.shirtColor` tetap disimpan (kompatibilitas API),
     tapi tidak lagi dipakai sebagai kunci pencocokan.
4. Material: tetap SATU `MeshLambertMaterial({vertexColors: true})`
   untuk ke-7 mesh (sama seperti hari ini).
5. `disposeObject3D`, `poseHumanoid`, `nextAnimState`: TIDAK BERUBAH.
6. Tes fase 2 (baru, di `tests/`): buildHumanoid dari geometri bake
   = 7 mesh + 1 sprite; nama + pivot benar; recolor putih->warna
   bekerja dan tidak mengubah part lain; kaki min y = 0.

## Warna (jangan "diperbaiki" — ini disengaja)

Warna bake adalah nilai LINEAR dari palet `character.js`
(generator mengonversi sRGB->linear saat set material Blender),
persis seperti `mergeColored` yang lewat `THREE.Color(hex)`.
Jadi karakter baru tampil dengan tone yang SAMA dengan yang lama.
Rumah memakai konvensi lain (angka sRGB mentah) — jangan
menyeragamkan keduanya; itu akan mengubah tone karakter.

## Bukti visual Fase 1 (diperiksa sendiri, anomali diperbaiki)

- v1: mata terlalu besar (bead 0.035), mulut balok tebal, alis +
  poni TAK TERLIHAT (terkubur di dalam silinder brim beanie yang
  solid: band y 1.925..2.015 radius 0.26 menelan semua geometri di
  band itu — terbukti dari render, bukan teori).
- v2: mata dikecilkan (r 0.028), mulut ditipiskan (0.07×0.015),
  hidung dibesarkan (r 0.04, ujung z 0.28, TERLIHAT di close-up),
  alis + poni DICABUT (bukan dipindah: band dahi antara brim dan
  mata praktis nol, dan hairline sudah terbaca lewat tepi cap +
  locks). Hidung terverifikasi mengarah +z (ujung di depan wajah).
- v3: ujung jari dibuat bertingkat (tengah terpanjang) supaya
  tangan terbaca sebagai 4 jari, bukan balok mitten.
- Final: depan (proporsi + kaki menapak + sepatu bersol terbaca),
  samping (profil hidung + volume rambut belakang + sol),
  3/4 (jaket + sabuk + kerah + topi terbaca), close-up wajah
  (mata + hidung + mulut + blush terbaca), close-up tangan
  (telapak + jari + jempol).

## Trade-off yang diputuskan di Fase 1 (bukan cacat)

- Jari menempel (tanpa celah antar jari); keterbacaan lewat
  ujung bertingkat, bukan celah. Celah 0.004 m tidak terlihat di
  skala game dan hanya menambah risiko z-fight.
- Mulut = balok lurus (netral), bukan kurva senyum — kurva torus
  64 tris tidak sebanding di skala ini.
- Tanpa alis/poni terpisah (alasan brim di atas). Wajah tetap
  terbaca lewat mata + hidung + mulut + blush + tepi rambut.
- Jaket = silinder meruncing + kerah + kancing + sabuk + hem +
  saku (bukan bentuk tailored) — menjaga siluet yang sama dengan
  karakter lama supaya collider + animasi tidak berubah.
