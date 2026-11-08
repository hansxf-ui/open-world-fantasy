// Round minimap (top-right HUD): a whole-world overview so the player
// always knows where they are. Zone colors mirror the ground texture;
// north (snow) is at the top, +z (sea) at the bottom. Pure functions so
// the mapping and drawing are testable without a DOM canvas.

export const MAP_WORLD = 400; // world spans -200..200 on both axes

// World (x, z) -> map fractions (0..1, 0..1). Canvas y grows downward,
// so north (z = -200) maps to the top.
export function worldToMap(x, z) {
  return [(x + 200) / MAP_WORLD, (z + 200) / MAP_WORLD];
}

// Triangle points for the player arrow: tip + two base corners, in
// canvas pixels. Facing uses the same yaw convention as the 3D view
// (rotation.y = atan2(dir.x, dir.z)), and +z is down on the map.
export function playerArrowPoints(px, py, yaw, r = 7) {
  const dx = Math.sin(yaw);
  const dy = Math.cos(yaw);
  const bx = px - dx * r * 0.7;
  const by = py - dy * r * 0.7;
  const perpX = -dy;
  const perpY = dx;
  return [
    [px + dx * r, py + dy * r],
    [bx + perpX * r * 0.6, by + perpY * r * 0.6],
    [bx - perpX * r * 0.6, by - perpY * r * 0.6],
  ];
}

const ZONE_COLORS = {
  base: '#e0c8a0',
  snow: '#fff4e8',
  forest: '#a8c3a0',
  desert: '#f2d98c',
  beach: '#e8d0a0',
  sea: '#7ec8d8',
  city: '#e8c9a0',
};

// Draw the whole world into a square ctx of `size` px (already scaled
// for device pixels by the caller). player: {x, z, yaw}; remotes:
// [{x, z, color}].
export function drawMinimap(ctx, size, player, remotes) {
  const f = (v) => (v / MAP_WORLD) * size; // world meters -> map px
  ctx.fillStyle = ZONE_COLORS.base;
  ctx.fillRect(0, 0, size, size);
  // Snow (north, z < -120).
  ctx.fillStyle = ZONE_COLORS.snow;
  ctx.fillRect(0, 0, size, f(80));
  // Forest (west, x < -45).
  ctx.fillStyle = ZONE_COLORS.forest;
  ctx.fillRect(0, 0, f(155), size);
  // Desert (east, x > 45).
  ctx.fillStyle = ZONE_COLORS.desert;
  ctx.fillRect(f(245), 0, size - f(245), size);
  // Beach (110 < z < 120) then sea (z > 120, south).
  ctx.fillStyle = ZONE_COLORS.beach;
  ctx.fillRect(0, f(310), size, f(10));
  ctx.fillStyle = ZONE_COLORS.sea;
  ctx.fillRect(0, f(320), size, size - f(320));
  // City plaza (center, drawn last so it sits on top).
  ctx.fillStyle = ZONE_COLORS.city;
  ctx.fillRect(f(155), f(155), f(90), f(90));
  // Street grid over the city (same lines as the 3D streets).
  ctx.fillStyle = 'rgba(90, 80, 70, 0.45)';
  for (const l of [-35, -21, -7, 7, 21, 35]) {
    ctx.fillRect(f(l + 200), f(155), 2, f(90));
    ctx.fillRect(f(155), f(l + 200), f(90), 2);
  }

  // Remote players as colored dots.
  for (const r of remotes) {
    if (!Number.isFinite(r.x) || !Number.isFinite(r.z)) continue;
    const [mx, my] = worldToMap(r.x, r.z);
    ctx.fillStyle = r.color || '#f6c9a8';
    ctx.beginPath();
    ctx.arc(mx * size, my * size, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  // Local player: white arrow with a dark edge, always on top.
  const [mx, my] = worldToMap(player.x, player.z);
  const pts = playerArrowPoints(mx * size, my * size, player.yaw || 0);
  ctx.fillStyle = '#fff8ec';
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  ctx.lineTo(pts[1][0], pts[1][1]);
  ctx.lineTo(pts[2][0], pts[2][1]);
  ctx.closePath();
  ctx.fill();
}
