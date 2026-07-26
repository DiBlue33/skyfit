/* ============================================================
   SkyFit — Carte : globe terrestre avec les avions du classement
   ------------------------------------------------------------
   Depuis la v2.3 chaque pilote vole sur SA route active, en
   aller-retour entre Paris-CDG (LFPG) et la ville achetée.
   Le tracé et la position viennent de js/routes.js
   (Routes.path / Routes.geo) : la carte ne connaît plus aucune
   géographie en propre.
   Globe orthographique dessiné en canvas, rotation à la souris.
   ============================================================ */

const WorldMap = (() => {

  const D2R = Math.PI / 180;

  // Marqueurs colorés par pilote
  const PLAYER_COLORS = ['#e74c3c', '#2e86de', '#27ae60', '#8e44ad', '#e67e22', '#16a085'];

  // --- Rendu du globe ---

  let canvas, ctx, rafId = null, viewSize = 520;
  let rotLon = -2.35, rotLat = -30;      // rotation courante (centre visible = -rotLon, -rotLat)
  let targetLon = null, targetLat = null; // animation de recentrage
  let dragging = false, lastX = 0, lastY = 0;
  let markers = [];                       // recalculés à l'ouverture
  let tracks = [];                        // tracés des routes actives
  let waypoints = [];                     // LFPG + destinations affichées

  function project(lon, lat, cx, cy, r) {
    const l = (lon + rotLon) * D2R, p = lat * D2R, p0 = -rotLat * D2R;
    const cosc = Math.sin(p0) * Math.sin(p) + Math.cos(p0) * Math.cos(p) * Math.cos(l);
    return {
      x: cx + r * Math.cos(p) * Math.sin(l),
      y: cy - r * (Math.cos(p0) * Math.sin(p) - Math.sin(p0) * Math.cos(p) * Math.cos(l)),
      visible: cosc > 0,
    };
  }

  function drawPolyline(points, cx, cy, r) {
    let pen = false;
    ctx.beginPath();
    for (const [lon, lat] of points) {
      const pt = project(lon, lat, cx, cy, r);
      if (pt.visible) {
        if (pen) ctx.lineTo(pt.x, pt.y); else ctx.moveTo(pt.x, pt.y);
        pen = true;
      } else {
        pen = false;
      }
    }
  }

  // --- Texture équirectangulaire du monde (construite une seule fois).
  // Le globe est ensuite rendu pixel par pixel (projection orthographique
  // inverse) : aucun artefact de découpage des continents à l'horizon.
  const TEX_W = 2048, TEX_H = 1024;
  let texData = null;

  function buildTexture() {
    const c = document.createElement('canvas');
    c.width = TEX_W; c.height = TEX_H;
    const g = c.getContext('2d');
    g.fillStyle = '#3d8fd1';                      // océan
    g.fillRect(0, 0, TEX_W, TEX_H);
    g.fillStyle = '#a8d97f';                      // continents
    g.strokeStyle = 'rgba(55, 105, 55, 0.65)';
    g.lineWidth = 2;
    for (const poly of WORLD_LAND) {
      g.beginPath();
      poly.forEach(([lon, lat], i) => {
        const x = (lon + 180) / 360 * TEX_W;
        const y = (90 - lat) / 180 * TEX_H;
        if (i) g.lineTo(x, y); else g.moveTo(x, y);
      });
      g.closePath();
      g.fill();
      g.stroke();
    }
    texData = new Uint32Array(g.getImageData(0, 0, TEX_W, TEX_H).data.buffer);
  }

  // Tampon de rendu du globe + tables précalculées par pixel
  let raster = null, rctx = null, rimg = null, rbuf = null;
  let pxA = null, pxB = null, pxX = null, pxIdx = null;
  let lastRotLon = null, lastRotLat = null;

  function setupRaster(devicePx, rPx) {
    raster = document.createElement('canvas');
    raster.width = devicePx; raster.height = devicePx;
    rctx = raster.getContext('2d');
    rimg = rctx.createImageData(devicePx, devicePx);
    rbuf = new Uint32Array(rimg.data.buffer);

    // Pour chaque pixel du disque : X (est), b (nord écran), a (cos c)
    const c = devicePx / 2;
    const idx = [], A = [], B = [], X = [];
    for (let py = 0; py < devicePx; py++) {
      for (let px = 0; px < devicePx; px++) {
        const dx = (px - c) / rPx, dy = (c - py) / rPx;
        const d2 = dx * dx + dy * dy;
        if (d2 > 1) continue;
        idx.push(py * devicePx + px);
        X.push(dx);
        B.push(dy);
        A.push(Math.sqrt(1 - d2));
      }
    }
    pxIdx = new Int32Array(idx);
    pxX = new Float32Array(X);
    pxB = new Float32Array(B);
    pxA = new Float32Array(A);
    lastRotLon = lastRotLat = null;
  }

  function renderGlobeRaster() {
    if (rotLon === lastRotLon && rotLat === lastRotLat) return;
    lastRotLon = rotLon; lastRotLat = rotLat;

    const p0 = -rotLat * D2R, l0 = -rotLon * D2R;
    const sinp0 = Math.sin(p0), cosp0 = Math.cos(p0);
    rbuf.fill(0);

    for (let i = 0; i < pxIdx.length; i++) {
      const a = pxA[i], b = pxB[i], x = pxX[i];
      const phi = Math.asin(a * sinp0 + b * cosp0);
      const lam = l0 + Math.atan2(x, a * cosp0 - b * sinp0);
      let u = ((lam / D2R + 180) / 360) % 1;
      if (u < 0) u += 1;
      const v = (90 - phi / D2R) / 180;
      const tx = (u * TEX_W) | 0;
      const ty = Math.min(TEX_H - 1, (v * TEX_H) | 0);
      rbuf[pxIdx[i]] = texData[ty * TEX_W + tx];
    }
    rctx.putImageData(rimg, 0, 0);
  }

  function render() {
    const w = viewSize, h = viewSize;
    const cx = w / 2, cy = h / 2, r = Math.min(w, h) / 2 - 24;
    ctx.clearRect(0, 0, w, h);

    // Halo atmosphérique
    const glow = ctx.createRadialGradient(cx, cy, r * 0.9, cx, cy, r * 1.12);
    glow.addColorStop(0, 'rgba(120, 190, 255, 0.55)');
    glow.addColorStop(1, 'rgba(120, 190, 255, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(cx, cy, r * 1.12, 0, 7); ctx.fill();

    // Globe (océan + continents) rendu pixel par pixel
    renderGlobeRaster();
    ctx.drawImage(raster, cx - r, cy - r, r * 2, r * 2);

    // Ombrage sphérique par-dessus
    const shade = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.15, cx, cy, r);
    shade.addColorStop(0, 'rgba(255, 255, 255, 0.16)');
    shade.addColorStop(0.55, 'rgba(255, 255, 255, 0)');
    shade.addColorStop(1, 'rgba(8, 25, 50, 0.38)');
    ctx.fillStyle = shade;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.fill();
    ctx.strokeStyle = 'rgba(200, 230, 255, 0.5)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.stroke();

    // Routes actives des pilotes (une ligne pointillée par route, couleur du pilote)
    ctx.lineWidth = 2.2;
    ctx.setLineDash([6, 6]);
    for (const tr of tracks) {
      ctx.strokeStyle = tr.color;
      drawPolyline(tr.pts, cx, cy, r);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Escales : la base + les destinations affichées
    ctx.font = '11px sans-serif';
    for (const wp of waypoints) {
      const pt = project(wp.lon, wp.lat, cx, cy, r);
      if (!pt.visible) continue;
      ctx.fillStyle = wp.base ? '#ffd166' : '#fff';
      ctx.beginPath(); ctx.arc(pt.x, pt.y, wp.base ? 4.5 : 3, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.fillText(wp.label, pt.x + 6, pt.y - 5);
    }

    // Avions des pilotes
    for (const m of markers) {
      const pt = project(m.lon, m.lat, cx, cy, r);
      if (!pt.visible) continue;
      // pastille
      ctx.fillStyle = m.color;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(pt.x, pt.y, 13, 0, 7); ctx.fill(); ctx.stroke();
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('✈️', pt.x, pt.y + 1);
      // étiquette
      ctx.font = 'bold 12px sans-serif';
      const tw = ctx.measureText(m.name).width;
      ctx.fillStyle = 'rgba(15, 30, 45, 0.75)';
      roundRect(pt.x - tw / 2 - 6, pt.y + 17, tw + 12, 18, 6);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillText(m.name, pt.x, pt.y + 26);
      ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
    }

    // Animation de recentrage
    if (targetLon !== null) {
      let dl = targetLon - rotLon;
      dl = ((dl + 540) % 360) - 180; // plus court chemin
      const dp = targetLat - rotLat;
      if (Math.abs(dl) < 0.4 && Math.abs(dp) < 0.4) {
        rotLon = targetLon; rotLat = targetLat;
        targetLon = targetLat = null;
      } else {
        rotLon += dl * 0.12;
        rotLat += dp * 0.12;
      }
    }

    rafId = requestAnimationFrame(render);
  }

  function roundRect(x, y, w, h, rr) {
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function centerOn(lon, lat) {
    targetLon = -lon;
    targetLat = -Math.max(-75, Math.min(75, lat));
  }

  // --- Ouverture / fermeture ---

  function open() {
    const me = State.current(); // peut être null (carte depuis l'accueil)

    // Marqueurs, tracés et légende
    const players = State.allPlayers().slice().sort((a, b) => b.totalKm - a.totalKm);
    markers = players.map((p, i) => {
      const g = Routes.geo(p);
      return {
        name: p.name, color: PLAYER_COLORS[i % PLAYER_COLORS.length],
        km: p.totalKm, crashed: !!p.crashed,
        lon: g.lon, lat: g.lat,
        route: g.route, to: g.to, outbound: g.outbound, kmToNext: g.kmToNext,
        pending: Routes.pending(p),
      };
    });

    // Un tracé par route active (dédoublonné), coloré par le premier pilote dessus
    tracks = [];
    waypoints = [{ lon: Routes.BASE.lon, lat: Routes.BASE.lat, label: Routes.BASE.icao, base: true }];
    const seen = {};
    markers.forEach(m => {
      if (!m.route || seen[m.route.id]) return;
      seen[m.route.id] = true;
      tracks.push({ color: m.color, pts: Routes.path(m.route.id, 96) });
      waypoints.push({ lon: m.route.lon, lat: m.route.lat, label: m.route.icao, base: false });
    });

    const fmt = (n) => Math.floor(n).toLocaleString('fr-FR');
    document.getElementById('map-legend').innerHTML = markers.length ? markers.map(m => {
      const dest = m.outbound ? m.to.city : Routes.BASE.city;
      const état = m.crashed ? '💥 au sol' : `cap ${escapeHtml(dest)} (${fmt(m.kmToNext)} km)`;
      const wait = m.pending ? ` · ⏳ ${escapeHtml(m.pending.icao)} au prochain passage LFPG` : '';
      return `
      <button class="map-player" data-center="${m.lon.toFixed(2)},${m.lat.toFixed(2)}" type="button">
        <span class="dot" style="background:${m.color}"></span>
        <span class="mp-name">${me && m.name === me.name ? '<b>' + escapeHtml(m.name) + '</b>' : escapeHtml(m.name)}</span>
        <span class="mp-info">${fmt(m.km)} km · ${escapeHtml(m.route.label)} · ${état}${wait}</span>
      </button>`;
    }).join('')
      : '<p style="text-align:center;color:#5c7186;font-size:0.85rem">Aucun pilote sur la carte pour l\'instant.</p>';

    const total = Routes.all().length;
    document.getElementById('map-total').textContent = me
      ? `Base ${Routes.BASE.name} · ${Routes.owned(me).length}/${total} routes ouvertes · ${(me.visited || []).length} ville(s) visitée(s)`
      : `${total} destinations au départ de ${Routes.BASE.name}`;

    document.querySelectorAll('#map-legend .map-player').forEach(btn =>
      btn.addEventListener('click', () => {
        const [lon, lat] = btn.dataset.center.split(',').map(Number);
        centerOn(lon, lat);
      }));

    document.getElementById('modal-map').classList.add('open');

    // Canvas adapté à la taille affichée (rendu net sur écrans rétine)
    const wrap = document.getElementById('globe-wrap');
    viewSize = Math.max(280, Math.min(wrap.clientWidth || 440, 440));
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = viewSize * dpr;
    canvas.height = viewSize * dpr;
    canvas.style.width = viewSize + 'px';
    canvas.style.height = viewSize + 'px';
    ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Texture + tampon de rendu du globe
    if (!texData) buildTexture();
    const rLogical = viewSize / 2 - 24;
    setupRaster(Math.round(rLogical * 2 * dpr), Math.round(rLogical * 2 * dpr) / 2);

    // Centrer sur mon avion (ou le premier, ou Paris)
    const mine = (me && markers.find(m => m.name === me.name)) || markers[0];
    if (mine) {
      rotLon = -mine.lon; rotLat = -Math.max(-75, Math.min(75, mine.lat));
    } else {
      rotLon = -Routes.BASE.lon; rotLat = -Routes.BASE.lat;
    }
    targetLon = targetLat = null;

    if (!rafId) render();
  }

  function close() {
    document.getElementById('modal-map').classList.remove('open');
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function bind() {
    canvas = document.getElementById('globe');

    document.getElementById('btn-map').addEventListener('click', open);
    document.querySelector('#modal-map .modal-close')
      .addEventListener('click', close);
    document.getElementById('modal-map').addEventListener('click', (e) => {
      if (e.target.id === 'modal-map') close();
    });

    // Rotation à la souris / au doigt
    const start = (x, y) => { dragging = true; lastX = x; lastY = y; targetLon = targetLat = null; };
    const move = (x, y) => {
      if (!dragging) return;
      rotLon += (x - lastX) * 0.35;
      rotLat -= (y - lastY) * 0.35;
      rotLat = Math.max(-90, Math.min(90, rotLat));
      lastX = x; lastY = y;
    };
    canvas.addEventListener('mousedown', e => start(e.clientX, e.clientY));
    window.addEventListener('mousemove', e => move(e.clientX, e.clientY));
    window.addEventListener('mouseup', () => { dragging = false; });
    canvas.addEventListener('touchstart', e => { const t = e.touches[0]; start(t.clientX, t.clientY); }, { passive: true });
    canvas.addEventListener('touchmove', e => { const t = e.touches[0]; move(t.clientX, t.clientY); }, { passive: true });
    canvas.addEventListener('touchend', () => { dragging = false; });
  }

  document.addEventListener('DOMContentLoaded', bind);

  return { open, close };
})();
