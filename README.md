# Open World Fantasy

Game web 3D open world santai — jelajahi dunia bareng teman. Tanpa target,
tanpa skor, jalan-jalan aja.

**Live:** https://open-world-fantasy.vercel.app/

## Dunianya

Satu dunia kontinu yang dibangun dengan Three.js:

- **Kota** — rumah-rumah, jalan, dan area warga
- **Hutan barat** — pepohonan fantasi dan vegetasi
- **Gurun timur**
- **Salju utara**
- **Laut selatan**

## Fitur

- **Multiplayer** — pemain lain terlihat langsung di dunia, sinkron posisi lewat
  MQTT publik (WSS, broker EMQX utama + Mosquitto cadangan, tanpa akun/kunci).
- **Chat** dalam game untuk menyapa pemain lain.
- **Karakter** — pilih cowok/cewek, warna baju, dan nama.
- **Kontrol HP** — joystick mengambang ala Mobile Legends, tombol lompat,
  minimap, dan kamera yang bisa di-seret/pinch.
- **Suasana** — audio ambient, efek lingkungan, dan siklus suasana dunia.

## Cara jalanin

Situs ini statis — tidak butuh build step atau server backend.

```bash
# cara 1: server statis apa saja dari folder ini
python3 -m http.server 8000
# lalu buka http://localhost:8000

# cara 2: deploy langsung ke host statis (mis. Vercel / GitHub Pages)
```

Buka di browser HP atau desktop, isi nama + pilih karakter, lalu
**Masuk Dunia**.

## Struktur

```
index.html        # halaman utama + layar masuk
css/style.css     # gaya UI, HUD, joystick, chat
js/main.js        # bootstrap game
js/world.js       # pembangun dunia (kota, hutan, gurun, salju, laut)
js/character.js   # avatar + animasi
js/controls.js    # kontrol keyboard/sentuh + kamera
js/net.js         # multiplayer via MQTT/WSS
js/chat.js        # chat dalam game
js/minimap.js     # minimap
js/ambient.js     # suasana/lingkungan
js/audio.js       # audio
js/undergrowth.js # vegetasi bawah
js/config.js      # konfigurasi
js/vendor/        # Three.js, mqtt.js, dan aset 3D hasil bake (Blender)
scripts/          # skrip Blender/Python untuk memanggang aset 3D
tests/            # tes unit (node --test)
char-audit/       # render audit karakter cewek
male-audit/       # render audit karakter cowok
```

## Tes

```bash
node --test tests/
```

## Lisensi

MIT — lihat [LICENSE](LICENSE).
