/* ============================================================
   SkyFit — Carte du monde (v2.4)
   ------------------------------------------------------------
   Carte 2D à plat (projection de Mercator), façon suivi de vols :
     • déplacement au doigt / à la souris, zoom molette, pincement,
       double-clic et boutons (du monde entier jusqu'à la ville) ;
     • continents dessinés en vectoriel → nets à tous les zooms ;
     • la route active est tracée en orthodromie : la portion déjà
       parcourue est en trait plein lumineux, le reste en pointillé,
       et l'avion avance dessus, orienté à son cap ;
     • les 44 destinations, les deux pilotes et les vents en
       altitude sont superposés.

   ⚠️ Aucune géographie n'est calculée ici : les positions et les
   tracés viennent de js/routes.js (Routes.geo / Routes.path), les
   vents de js/weather.js. La carte ne fait que projeter et peindre.

   Repères de projection :
     wx ∈ [0,1[  = longitude (0 = 180° O), wx+1 = tour du monde
     wy ∈ [0,1]  = latitude Mercator (0 = 85° N, 1 = 85° S)
   ============================================================ */

const WorldMap = (() => {

  const D2R = Math.PI / 180;
  const R2D = 180 / Math.PI;
  const MAX_LAT = 85.0511;            // limite de la projection de Mercator
  const EARTH_EQ = 40075;             // circonférence équatoriale (km)

  /* ------------------------------------------------------------
     Palette « cockpit » : fond de nuit, terres bleu ardoise,
     tracés lumineux. Pensée pour rester lisible sur téléphone.
     ------------------------------------------------------------ */
  const C = {
    oceanTop:  '#0a2742',
    oceanMid:  '#071b2f',
    oceanLow:  '#04101d',
    land:      '#14384e',
    landDark:  '#0f2c3e',
    coast:     '#3d86ab',
    grid:      'rgba(140, 200, 240, 0.08)',
    gridMain:  'rgba(140, 200, 240, 0.16)',
    base:      '#ffb03a',
    visited:   '#ffd166',
    owned:     '#dceeff',
    locked:    'rgba(190, 220, 245, 0.28)',
    wind:      'rgba(126, 227, 255, 0.75)',
    label:     '#e9f4ff',
    labelBg:   'rgba(6, 20, 34, 0.72)',
  };

  // Couleur de pilote, accordée au calendrier (Jade rose, Diego bleu)
  // mais éclaircie pour ressortir sur le fond de nuit.
  const NAME_COLORS = [[/jade/i, '#ff6fb5'], [/di[eé]go/i, '#4da3ff']];
  const FALLBACK = ['#4ce0b3', '#c792ea', '#ffa94d', '#5ad1e6'];

  function playerColor(name, idx) {
    for (const [re, col] of NAME_COLORS) if (re.test(name)) return col;
    return FALLBACK[Math.max(0, idx) % FALLBACK.length];
  }

  /* ------------------------------------------------------------
     Projection
     ------------------------------------------------------------ */

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function mx(lon) { return (lon + 180) / 360; }

  function my(lat) {
    const l = clamp(lat, -MAX_LAT, MAX_LAT) * D2R;
    return 0.5 - Math.log(Math.tan(Math.PI / 4 + l / 2)) / (2 * Math.PI);
  }

  function invLat(y) {
    return (2 * Math.atan(Math.exp((0.5 - y) * 2 * Math.PI)) - Math.PI / 2) * R2D;
  }

  /* ------------------------------------------------------------
     État de la vue
     ------------------------------------------------------------ */

  const MIN_Z = -0.35, MAX_Z = 7.5;   // zoom 0 = le monde tient en largeur

  let view = { cx: 0.5, cy: 0.42, zoom: 0 };
  let anim = null;                    // vue cible (déplacement fluide)
  let follow = null;                  // nom du pilote suivi (null = libre)
  let showWind = true;
  let overviewStep = 0;               // 0 → cadrer la route, 1 → cadrer le monde

  let canvas = null, ctx = null, rafId = null;
  let W = 640, H = 420, dpr = 1;

  const worldPx = () => W * Math.pow(2, view.zoom);

  function clampView() {
    const wp = worldPx();
    // Longitude : le monde se répète, on garde juste un repère borné.
    view.cx = ((view.cx % 1) + 1) % 1;
    // Latitude : on ne sort pas de la carte.
    const half = H / 2 / wp;
    view.cy = half * 2 >= 1 ? 0.5 : clamp(view.cy, half, 1 - half);
  }

  /** Coordonnées écran d'un point du monde (copie la plus proche du centre). */
  function toScreen(wx, wy) {
    const wp = worldPx();
    let d = wx - view.cx;
    d -= Math.round(d);
    return [W / 2 + d * wp, H / 2 + (wy - view.cy) * wp];
  }

  /** Point du monde sous un pixel de l'écran. */
  function toWorld(px, py) {
    const wp = worldPx();
    return { x: view.cx + (px - W / 2) / wp, y: view.cy + (py - H / 2) / wp };
  }

  /** Latitude / longitude sous un pixel (utile aux tests et au débogage). */
  function unproject(px, py) {
    const w = toWorld(px, py);
    let lon = (((w.x % 1) + 1) % 1) * 360 - 180;
    return { lon, lat: invLat(clamp(w.y, 0, 1)) };
  }

  function project(lon, lat) {
    const [x, y] = toScreen(mx(lon), my(lat));
    return { x, y };
  }

  /** Zoom centré sur un pixel : le point sous le doigt ne bouge pas. */
  function zoomAt(px, py, dz) {
    const before = toWorld(px, py);
    view.zoom = clamp(view.zoom + dz, MIN_Z, MAX_Z);
    const after = toWorld(px, py);
    view.cx += before.x - after.x;
    view.cy += before.y - after.y;
    clampView();
    anim = null;
    overviewStep = 0;
  }

  function flyTo(lon, lat, zoom) {
    const wx = mx(lon);
    // On rejoint la copie du monde la plus proche : pas de tour complet.
    let d = wx - view.cx;
    d -= Math.round(d);
    anim = { cx: view.cx + d, cy: my(lat), zoom: zoom === undefined ? view.zoom : clamp(zoom, MIN_Z, MAX_Z) };
  }

  function stepAnim() {
    if (!anim) return;
    const k = 0.18;
    view.cx += (anim.cx - view.cx) * k;
    view.cy += (anim.cy - view.cy) * k;
    view.zoom += (anim.zoom - view.zoom) * k;
    if (Math.abs(anim.cx - view.cx) < 1e-5 && Math.abs(anim.cy - view.cy) < 1e-5
        && Math.abs(anim.zoom - view.zoom) < 1e-4) {
      view.cx = anim.cx; view.cy = anim.cy; view.zoom = anim.zoom;
      anim = null;
    }
    clampView();
  }

  /** Cadre la route entière (base + destination) avec une marge. */
  function fitRoute(routeId) {
    const pts = routePath(routeId);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    pts.forEach(p => {
      x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x);
      y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
    });
    const bw = Math.max(1e-4, x1 - x0), bh = Math.max(1e-4, y1 - y0);
    const wp = Math.min(W * 0.78 / bw, H * 0.62 / bh);
    view.zoom = clamp(Math.log2(wp / W), MIN_Z, 5.2);
    view.cx = ((((x0 + x1) / 2) % 1) + 1) % 1;
    view.cy = (y0 + y1) / 2;
    clampView();
    anim = null;
  }

  function fitWorld() {
    view.zoom = MIN_Z + 0.05;
    view.cx = mx(Routes.BASE.lon);
    view.cy = 0.45;
    clampView();
    anim = null;
  }

  /* ------------------------------------------------------------
     Continents : projetés une seule fois, puis simplement
     transformés à chaque image (vectoriel = net à tout zoom).
     ------------------------------------------------------------ */

  let LAND = null;

  function buildLand() {
    LAND = [];
    for (const poly of WORLD_LAND) {
      const pts = [];
      let prev = null;
      for (const [lon, lat] of poly) {
        let x = mx(lon);
        if (prev !== null) x -= Math.round(x - prev);   // continuité au méridien 180°
        prev = x;
        pts.push(x, my(lat));
      }
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (let i = 0; i < pts.length; i += 2) {
        x0 = Math.min(x0, pts[i]); x1 = Math.max(x1, pts[i]);
        y0 = Math.min(y0, pts[i + 1]); y1 = Math.max(y1, pts[i + 1]);
      }
      LAND.push({ pts: Float64Array.from(pts), x0, x1, y0, y1 });
    }
  }

  /* ------------------------------------------------------------
     Tracés de routes : orthodromie projetée, mise en cache
     ------------------------------------------------------------ */

  const PATHS = {};

  /** Points [{x, y, t}] de la route, déroulés (pas de saut au méridien 180°). */
  function routePath(routeId) {
    if (PATHS[routeId]) return PATHS[routeId];
    const raw = Routes.path(routeId, 192);
    const pts = [];
    let prev = null;
    raw.forEach(([lon, lat], i) => {
      let x = mx(lon);
      if (prev !== null) x -= Math.round(x - prev);
      prev = x;
      pts.push({ x, y: my(lat), t: i / (raw.length - 1) });
    });
    PATHS[routeId] = pts;
    return pts;
  }

  /** Point interpolé du tracé à l'avancement t (0 = LFPG, 1 = ville). */
  function pointAtT(pts, t) {
    const f = clamp(t, 0, 1) * (pts.length - 1);
    const i = Math.min(pts.length - 2, Math.floor(f));
    const k = f - i;
    return {
      x: pts[i].x + (pts[i + 1].x - pts[i].x) * k,
      y: pts[i].y + (pts[i + 1].y - pts[i].y) * k,
    };
  }

  /* ------------------------------------------------------------
     Pilotes affichés
     ------------------------------------------------------------ */

  let markers = [];      // recalculés à chaque image (l'avion avance)
  let meName = null;

  /**
   * Position affichée : entre deux ticks du moteur (1 s) on extrapole
   * le déplacement pour que l'avion glisse au lieu de sauter.
   * Vaut pour TOUS les pilotes : depuis la v2.5, les autres profils sont
   * eux aussi simulés en local à chaque seconde (Engine.simulateOthers),
   * leur `lastTick` est donc frais et l'extrapolation légitime.
   */
  /**
   * Vitesse SOL d'un pilote : vitesse air × facteur de vent, exactement la
   * même formule que Engine.simulate. Extrapoler à la vitesse air donnait un
   * glissement 7 à 25 % trop rapide ou trop lent, corrigé d'un coup à chaque
   * tick du moteur → l'avion avançait par à-coups.
   * Le vent est relevé à la position déjà connue (non extrapolée) : le moteur
   * lui-même ne rafraîchit son facteur que tous les 150 km.
   */
  function groundKmh(p) {
    const air = CONFIG.speedForAlt(p.altitude) * State.speedMult(p);
    let f = 1;
    try {
      f = Weather.factorFor(Routes.geo(p), p.altitude, Date.now(), air);
    } catch (e) { f = 1; }
    return air * (isFinite(f) && f > 0 ? f : 1);
  }

  function displayedLegKm(p) {
    const len = Routes.active(p).km || 1;
    let km = typeof p.legKm === 'number' ? p.legKm : 0;
    if (!p.crashed) {
      const dt = (Date.now() - (p.lastTick || 0)) / 1000;
      if (dt > 0 && dt < 5) {
        km += (p.legDir === 1 ? -1 : 1) * groundKmh(p) * dt / 3600;
      }
    }
    return clamp(km, 0, len);
  }

  function buildMarkers() {
    const me = State.current();
    meName = me ? me.name : null;
    const players = State.allPlayers().slice().sort((a, b) => b.totalKm - a.totalKm);
    markers = players.map((p, i) => {
      const isMe = !!me && p.name === me.name;
      const g = Routes.geoAt(Routes.active(p).id, displayedLegKm(p), p.legDir);
      return {
        name: p.name, color: playerColor(p.name, i), me: isMe,
        km: p.totalKm, crashed: !!p.crashed, altitude: p.altitude,
        lon: g.lon, lat: g.lat, heading: g.heading, t: g.t,
        route: g.route, to: g.to, outbound: g.outbound, kmToNext: g.kmToNext,
        pending: Routes.pending(p),
        speed: p.crashed ? 0 : Math.round(groundKmh(p)),
      };
    });
    return markers;
  }

  /* ------------------------------------------------------------
     Peinture
     ------------------------------------------------------------ */

  function drawOcean() {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, C.oceanTop);
    g.addColorStop(0.55, C.oceanMid);
    g.addColorStop(1, C.oceanLow);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  function gridStep() {
    const z = view.zoom;
    if (z < 1) return 30;
    if (z < 2) return 15;
    if (z < 3) return 10;
    if (z < 4.5) return 5;
    if (z < 6) return 2;
    return 1;
  }

  function drawGraticule() {
    const step = gridStep();
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let lat = -80; lat <= 80; lat += step) {
      const [, y] = toScreen(view.cx, my(lat));
      if (y < -2 || y > H + 2) continue;
      ctx.moveTo(0, y); ctx.lineTo(W, y);
    }
    const wp = worldPx();
    const lon0 = Math.floor((view.cx - W / 2 / wp) * 360 - 180);
    const lon1 = Math.ceil((view.cx + W / 2 / wp) * 360 - 180);
    for (let lon = Math.floor(lon0 / step) * step; lon <= lon1; lon += step) {
      const [x] = toScreen(mx(lon), view.cy);
      if (x < -2 || x > W + 2) continue;
      ctx.moveTo(x, 0); ctx.lineTo(x, H);
    }
    ctx.strokeStyle = C.grid;
    ctx.stroke();

    // Équateur et méridien de Greenwich un peu plus marqués
    ctx.beginPath();
    const [, yEq] = toScreen(view.cx, my(0));
    ctx.moveTo(0, yEq); ctx.lineTo(W, yEq);
    const [xGr] = toScreen(mx(0), view.cy);
    ctx.moveTo(xGr, 0); ctx.lineTo(xGr, H);
    ctx.strokeStyle = C.gridMain;
    ctx.stroke();
  }

  function drawLand() {
    if (!LAND) buildLand();
    const wp = worldPx();
    const vx0 = view.cx - W / 2 / wp, vx1 = view.cx + W / 2 / wp;
    const vy0 = view.cy - H / 2 / wp, vy1 = view.cy + H / 2 / wp;

    ctx.save();
    ctx.fillStyle = C.land;
    ctx.strokeStyle = C.coast;
    ctx.lineWidth = view.zoom > 3 ? 1.2 : 0.9;
    ctx.lineJoin = 'round';

    for (const poly of LAND) {
      if (poly.y1 < vy0 || poly.y0 > vy1) continue;
      // Le monde se répète : on dessine les copies visibles (± 1 tour).
      for (let k = Math.floor(vx0 - poly.x1); k <= Math.ceil(vx1 - poly.x0); k++) {
        if (poly.x1 + k < vx0 || poly.x0 + k > vx1) continue;
        const pts = poly.pts;
        ctx.beginPath();
        for (let i = 0; i < pts.length; i += 2) {
          const x = W / 2 + (pts[i] + k - view.cx) * wp;
          const y = H / 2 + (pts[i + 1] - view.cy) * wp;
          if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  /** Décalage de copie du monde pour qu'un tracé tombe près du centre. */
  function wrapShift(pts) {
    const mid = pts[Math.floor(pts.length / 2)].x;
    return -Math.round(mid - view.cx);
  }

  function strokePoly(scr, from, to) {
    ctx.beginPath();
    for (let i = from; i <= to; i++) {
      if (i === from) ctx.moveTo(scr[i][0], scr[i][1]);
      else ctx.lineTo(scr[i][0], scr[i][1]);
    }
  }

  function drawRoutes() {
    const wp = worldPx();
    const seen = {};
    markers.forEach(m => {
      const pts = routePath(m.route.id);
      const k = wrapShift(pts);
      const scr = pts.map(p => [W / 2 + (p.x + k - view.cx) * wp, H / 2 + (p.y - view.cy) * wp]);
      const pp = pointAtT(pts, m.t);
      const planeXY = [W / 2 + (pp.x + k - view.cx) * wp, H / 2 + (pp.y - view.cy) * wp];
      m.screen = planeXY;

      const i = Math.min(pts.length - 2, Math.floor(clamp(m.t, 0, 1) * (pts.length - 1)));

      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      // Partie restante de l'étape : pointillés discrets
      ctx.setLineDash([7, 7]);
      ctx.lineWidth = 2;
      ctx.strokeStyle = hexA(m.color, seen[m.route.id] ? 0.25 : 0.42);
      ctx.beginPath();
      if (m.outbound) {
        ctx.moveTo(planeXY[0], planeXY[1]);
        for (let j = i + 1; j < scr.length; j++) ctx.lineTo(scr[j][0], scr[j][1]);
      } else {
        ctx.moveTo(scr[0][0], scr[0][1]);
        for (let j = 1; j <= i; j++) ctx.lineTo(scr[j][0], scr[j][1]);
        ctx.lineTo(planeXY[0], planeXY[1]);
      }
      ctx.stroke();

      // Partie déjà parcourue sur l'étape en cours : trait plein lumineux
      ctx.setLineDash([]);
      ctx.lineWidth = m.me ? 3.4 : 2.6;
      ctx.strokeStyle = m.color;
      ctx.shadowColor = hexA(m.color, 0.9);
      ctx.shadowBlur = m.me ? 14 : 8;
      ctx.beginPath();
      if (m.outbound) {
        ctx.moveTo(scr[0][0], scr[0][1]);
        for (let j = 1; j <= i; j++) ctx.lineTo(scr[j][0], scr[j][1]);
        ctx.lineTo(planeXY[0], planeXY[1]);
      } else {
        ctx.moveTo(planeXY[0], planeXY[1]);
        for (let j = i + 1; j < scr.length; j++) ctx.lineTo(scr[j][0], scr[j][1]);
      }
      ctx.stroke();
      ctx.restore();

      seen[m.route.id] = true;
    });
  }

  /* --- Villes ------------------------------------------------- */

  const taken = [];   // rectangles d'étiquettes déjà posées (anti-chevauchement)

  // Zones occupées par l'interface (bandeau de vol, boutons) : aucune
  // étiquette de ville ne doit se glisser dessous.
  let reserved = [];

  function computeReserved() {
    if (!canvas) { reserved = []; return; }
    const c = canvas.getBoundingClientRect();
    reserved = ['map-flight', 'map-controls', 'map-scale'].map(id => {
      const el = document.getElementById(id);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return null;
      return { x: r.left - c.left - 6, y: r.top - c.top - 6, w: r.width + 12, h: r.height + 12 };
    }).filter(Boolean);
  }

  function freeSpot(x, y, w, h) {
    for (const r of taken) {
      if (x < r.x + r.w && x + w > r.x && y < r.y + r.h && y + h > r.y) return false;
    }
    taken.push({ x, y, w, h });
    return true;
  }

  function cityLabel(x, y, text, color, strong) {
    ctx.font = strong ? 'bold 11.5px system-ui, sans-serif' : '11px system-ui, sans-serif';
    const w = ctx.measureText(text).width + 10;
    const h = 16;
    // À droite du point, sauf si l'étiquette sortirait de la carte.
    const lx = (x + 8 + w > W - 4) ? x - 8 - w : x + 8;
    if (lx < 2 || !freeSpot(lx, y - h / 2, w, h)) return;
    ctx.fillStyle = C.labelBg;
    roundRect(lx, y - h / 2, w, h, 5);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, lx + 5, y + 0.5);
    ctx.textBaseline = 'alphabetic';
  }

  function drawCities() {
    const me = State.current();
    taken.length = 0;
    reserved.forEach(r => taken.push(r));

    // Les pastilles des pilotes ont la priorité sur les étiquettes de ville
    markers.forEach(m => { if (m.screen) freeSpot(m.screen[0] - 26, m.screen[1] - 16, 52, 44); });

    const list = Routes.all().map(r => {
      const visited = Routes.hasVisited(me, r.city);
      const owned = Routes.isOwned(me, r.id);
      return { r, visited, owned, rank: visited ? 0 : (owned ? 1 : 2) };
    }).sort((a, b) => a.rank - b.rank || b.r.km - a.r.km);

    ctx.save();
    list.forEach(({ r, visited, owned }) => {
      const [x, y] = toScreen(mx(r.lon), my(r.lat));
      if (x < -40 || x > W + 40 || y < -30 || y > H + 30) return;
      const col = visited ? C.visited : (owned ? C.owned : C.locked);
      const rad = visited ? 4.2 : (owned ? 3.4 : 2.4);

      if (visited) {
        ctx.fillStyle = 'rgba(255, 209, 102, 0.18)';
        ctx.beginPath(); ctx.arc(x, y, rad + 5, 0, 7); ctx.fill();
      }
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(x, y, rad, 0, 7); ctx.fill();
      if (owned) {
        ctx.strokeStyle = 'rgba(255,255,255,0.75)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(x, y, rad + 2, 0, 7); ctx.stroke();
      }

      const show = visited || owned || view.zoom > 2.2;
      if (show) cityLabel(x, y, r.city, visited ? C.visited : C.label, visited);
    });

    // La base : toujours en évidence
    const B = Routes.BASE;
    const [bx, by] = toScreen(mx(B.lon), my(B.lat));
    if (bx > -60 && bx < W + 60 && by > -40 && by < H + 40) {
      ctx.fillStyle = 'rgba(255, 176, 58, 0.22)';
      ctx.beginPath(); ctx.arc(bx, by, 11, 0, 7); ctx.fill();
      ctx.fillStyle = C.base;
      ctx.beginPath(); ctx.arc(bx, by, 5, 0, 7); ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(bx, by, 5, 0, 7); ctx.stroke();
      cityLabel(bx, by, B.icao + ' · ' + B.city, C.base, true);
    }
    ctx.restore();
  }

  /* --- Vents en altitude -------------------------------------- */

  function drawWind() {
    if (!showWind || !CONFIG.WEATHER || !CONFIG.WEATHER.ENABLED) return;
    const me = State.current();
    if (!me) return;
    const info = Weather.info();
    if (!info || !info.ok || info.wrongRoute) return;

    const rid = Routes.active(me).id;
    const len = Routes.active(me).km || 1;
    const pts = routePath(rid);
    const k = wrapShift(pts);
    const wp = worldPx();
    const now = Date.now();
    const n = 9;

    ctx.save();
    ctx.strokeStyle = C.wind;
    ctx.fillStyle = C.wind;
    ctx.lineWidth = 1.6;
    ctx.lineCap = 'round';

    for (let i = 1; i < n; i++) {
      const t = i / n;
      const w = Weather.windAt(Routes.geoAt(rid, t * len, 0), me.altitude, now);
      if (!w.ok || w.speed < 3) continue;
      const p = pointAtT(pts, t);
      const x = W / 2 + (p.x + k - view.cx) * wp;
      const y = H / 2 + (p.y - view.cy) * wp;
      if (x < -20 || x > W + 20 || y < -20 || y > H + 20) continue;

      // Le vent SOUFFLE VERS dirFrom + 180 ; Mercator conserve les angles,
      // le nord est en haut partout : la flèche se trace directement.
      const to = (w.dirFrom + 180) * D2R;
      const ux = Math.sin(to), uy = -Math.cos(to);
      const L = 9 + clamp(w.speed, 0, 180) / 180 * 16;
      const a = clamp(0.25 + w.speed / 140, 0.25, 0.85);
      ctx.globalAlpha = a;
      ctx.beginPath();
      ctx.moveTo(x - ux * L / 2, y - uy * L / 2);
      ctx.lineTo(x + ux * L / 2, y + uy * L / 2);
      ctx.stroke();
      // Pointe
      const hx = x + ux * L / 2, hy = y + uy * L / 2;
      const s = 4.5;
      ctx.beginPath();
      ctx.moveTo(hx, hy);
      ctx.lineTo(hx - ux * s + uy * s * 0.6, hy - uy * s - ux * s * 0.6);
      ctx.lineTo(hx - ux * s - uy * s * 0.6, hy - uy * s + ux * s * 0.6);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  /* --- Avions -------------------------------------------------- */

  function planeShape(s) {
    ctx.beginPath();
    ctx.moveTo(0, -s * 1.05);
    ctx.lineTo(s * 0.20, -s * 0.55);
    ctx.lineTo(s * 0.20, s * 0.05);
    ctx.lineTo(s * 1.00, s * 0.45);
    ctx.lineTo(s * 1.00, s * 0.62);
    ctx.lineTo(s * 0.20, s * 0.40);
    ctx.lineTo(s * 0.20, s * 0.86);
    ctx.lineTo(s * 0.46, s * 1.02);
    ctx.lineTo(s * 0.46, s * 1.14);
    ctx.lineTo(0, s * 0.98);
    ctx.lineTo(-s * 0.46, s * 1.14);
    ctx.lineTo(-s * 0.46, s * 1.02);
    ctx.lineTo(-s * 0.20, s * 0.86);
    ctx.lineTo(-s * 0.20, s * 0.40);
    ctx.lineTo(-s * 1.00, s * 0.62);
    ctx.lineTo(-s * 1.00, s * 0.45);
    ctx.lineTo(-s * 0.20, s * 0.05);
    ctx.lineTo(-s * 0.20, -s * 0.55);
    ctx.closePath();
  }

  function drawPlanes() {
    markers.forEach(m => {
      const [x, y] = m.screen || toScreen(mx(m.lon), my(m.lat));
      if (x < -60 || x > W + 60 || y < -60 || y > H + 60) return;
      const s = m.me ? 11 : 9.5;

      ctx.save();
      ctx.translate(x, y);

      // Halo
      const glow = ctx.createRadialGradient(0, 0, 2, 0, 0, s * 2.6);
      glow.addColorStop(0, hexA(m.color, 0.45));
      glow.addColorStop(1, hexA(m.color, 0));
      ctx.fillStyle = glow;
      ctx.beginPath(); ctx.arc(0, 0, s * 2.6, 0, 7); ctx.fill();

      ctx.rotate(m.heading * D2R);
      planeShape(s);
      ctx.fillStyle = m.crashed ? '#8b98a5' : m.color;
      ctx.strokeStyle = m.crashed ? 'rgba(255,255,255,0.5)' : '#fff';
      ctx.lineWidth = 1.4;
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      // Étiquette du pilote
      ctx.save();
      ctx.font = 'bold 11.5px system-ui, sans-serif';
      const txt = m.crashed ? m.name + ' 💥' : m.name;
      const w = ctx.measureText(txt).width + 14;
      // L'étiquette reste dans la carte même quand l'avion frôle un bord.
      const cx0 = clamp(x, w / 2 + 4, Math.max(w / 2 + 4, W - w / 2 - 4));
      const cy0 = Math.min(y + s + 5, H - 21);
      ctx.fillStyle = hexA(m.color, 0.92);
      roundRect(cx0 - w / 2, cy0, w, 17, 8);
      ctx.fill();
      ctx.fillStyle = '#08192a';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(txt, cx0, cy0 + 9);
      ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
      ctx.restore();
    });
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /** Couleur hexadécimale + transparence. */
  function hexA(hex, a) {
    const h = hex.replace('#', '');
    const n = parseInt(h.length === 3 ? h.replace(/./g, c => c + c) : h, 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }

  /* ------------------------------------------------------------
     Boucle de rendu
     ------------------------------------------------------------ */

  let lastOverlay = 0;

  function render() {
    rafId = requestAnimationFrame(render);
    stepAnim();
    buildMarkers();

    // Suivi automatique d'un pilote
    if (follow) {
      const m = markers.find(x => x.name === follow);
      if (m) {
        const wx = mx(m.lon);
        let d = wx - view.cx; d -= Math.round(d);
        view.cx += d * 0.2;
        view.cy += (my(m.lat) - view.cy) * 0.2;
        clampView();
      }
    }

    ctx.clearRect(0, 0, W, H);
    drawOcean();
    drawGraticule();
    drawLand();
    drawRoutes();
    drawCities();
    drawWind();
    drawPlanes();

    const now = Date.now();
    if (now - lastOverlay > 400) { lastOverlay = now; updateOverlay(); }
  }

  /* ------------------------------------------------------------
     Bandeau d'information & échelle
     ------------------------------------------------------------ */

  const SCALES = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000];

  function updateScale() {
    const el = document.getElementById('map-scale');
    if (!el) return;
    const latC = invLat(view.cy);
    const kmPerPx = EARTH_EQ * Math.cos(latC * D2R) / worldPx();
    let best = SCALES[0];
    for (const s of SCALES) { if (s / kmPerPx <= 110) best = s; }
    const px = Math.round(best / kmPerPx);
    el.innerHTML = `<span class="scale-bar" style="width:${Math.max(20, px)}px"></span>${best.toLocaleString('fr-FR')} km`;
  }

  function fmt(n) { return Math.round(n).toLocaleString('fr-FR'); }

  function updateOverlay() {
    updateScale();
    computeReserved();
    const el = document.getElementById('map-flight');
    if (!el) return;
    const m = markers.find(x => x.me) || markers[0];
    if (!m) { el.innerHTML = ''; return; }
    const dest = m.outbound ? m.to.city : Routes.BASE.city;
    const eta = m.speed > 0 ? m.kmToNext / m.speed : null;
    const etaTxt = eta === null ? '—'
      : (eta >= 1 ? Math.floor(eta) + ' h ' + Math.round((eta % 1) * 60) + ' min'
                  : Math.round(eta * 60) + ' min');
    const pct = Math.round((m.outbound ? m.t : 1 - m.t) * 100);
    el.innerHTML = `
      <div class="mf-line mf-route"><span class="mf-dot" style="background:${m.color}"></span>
        ${escapeHtml(m.route.label)}<span class="mf-sep">·</span>${escapeHtml(m.route.city)} ${m.route.icon}</div>
      <div class="mf-line">${m.crashed ? '💥 au sol'
        : `${m.outbound ? '→' : '←'} ${escapeHtml(dest)} · ${fmt(m.kmToNext)} km · ${etaTxt}`}</div>
      <div class="mf-bar"><i style="width:${pct}%;background:${m.color}"></i></div>
      <div class="mf-line mf-small">✈️ ${fmt(m.altitude)} ft · ${fmt(m.speed)} km/h${m.pending ? ' · ⏳ ' + escapeHtml(m.pending.icao) : ''}</div>`;
  }

  /* ------------------------------------------------------------
     Légende (liste des pilotes) & résumé
     ------------------------------------------------------------ */

  function buildLegend() {
    const me = State.current();
    const legend = document.getElementById('map-legend');
    if (!legend) return;

    legend.innerHTML = markers.length ? markers.map(m => {
      const dest = m.outbound ? m.to.city : Routes.BASE.city;
      const état = m.crashed ? '💥 au sol' : `cap ${escapeHtml(dest)} (${fmt(m.kmToNext)} km)`;
      const wait = m.pending ? ` · ⏳ ${escapeHtml(m.pending.icao)} au prochain passage LFPG` : '';
      return `
      <button class="map-player${m.me ? ' is-me' : ''}" data-player="${escapeHtml(m.name)}" type="button">
        <span class="dot" style="background:${m.color}"></span>
        <span class="mp-name">${m.me ? '<b>' + escapeHtml(m.name) + '</b>' : escapeHtml(m.name)}</span>
        <span class="mp-info">${fmt(m.km)} km · ${escapeHtml(m.route.label)} · ${état}${wait}</span>
      </button>`;
    }).join('')
      : '<p class="map-empty">Aucun pilote sur la carte pour l\'instant.</p>';

    const total = Routes.all().length;
    document.getElementById('map-total').textContent = me
      ? `Base ${Routes.BASE.name} · ${Routes.owned(me).length}/${total} routes ouvertes · ${(me.visited || []).length} ville(s) visitée(s)`
      : `${total} destinations au départ de ${Routes.BASE.name}`;

    legend.querySelectorAll('.map-player').forEach(btn =>
      btn.addEventListener('click', () => {
        const name = btn.dataset.player;
        const m = markers.find(x => x.name === name);
        if (!m) return;
        follow = name;
        syncFollowBtn();
        flyTo(m.lon, m.lat, Math.max(view.zoom, 2.2));
      }));
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  /* ------------------------------------------------------------
     Ouverture / fermeture
     ------------------------------------------------------------ */

  function resize() {
    const wrap = document.getElementById('map-wrap');
    if (!wrap || !canvas) return;
    W = Math.max(240, Math.round(wrap.clientWidth));
    H = Math.max(220, Math.round(wrap.clientHeight));
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    clampView();
  }

  function open() {
    const me = State.current();
    document.getElementById('modal-map').classList.add('open');
    resize();
    buildMarkers();
    buildLegend();

    // Vue d'ouverture : la route active entièrement visible.
    if (me) fitRoute(Routes.active(me).id);
    else if (markers.length) fitRoute(markers[0].route.id);
    else fitWorld();
    overviewStep = 1;                 // déjà cadré sur la route : l'appui suivant montre le monde
    follow = null;
    syncFollowBtn();
    syncWindBtn();
    updateOverlay();

    if (!rafId) render();
  }

  function close() {
    document.getElementById('modal-map').classList.remove('open');
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
  }

  function syncFollowBtn() {
    const b = document.getElementById('map-follow');
    if (b) b.classList.toggle('on', !!follow);
  }

  function syncWindBtn() {
    const b = document.getElementById('map-wind');
    if (b) b.classList.toggle('on', showWind);
  }

  /* ------------------------------------------------------------
     Interactions : déplacement, zoom, pincement
     ------------------------------------------------------------ */

  function bindGestures() {
    const pts = new Map();
    let pinch = 0;

    const local = (e) => {
      const r = canvas.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };

    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        pinch = Math.hypot(a.x - b.x, a.y - b.y);
      }
      anim = null;
    });

    canvas.addEventListener('pointermove', (e) => {
      const p = pts.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;

      if (pts.size >= 2) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch > 0 && d > 0) {
          const r = canvas.getBoundingClientRect();
          zoomAt((a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top, Math.log2(d / pinch));
        }
        pinch = d;
        return;
      }

      // Déplacement : le pilote reprend la main, on coupe le suivi.
      follow = null; syncFollowBtn(); overviewStep = 0;
      const wp = worldPx();
      view.cx -= dx / wp;
      view.cy -= dy / wp;
      clampView();
    });

    const end = (e) => {
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = 0;
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('pointerleave', end);

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const [x, y] = local(e);
      zoomAt(x, y, -e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0022));
    }, { passive: false });

    canvas.addEventListener('dblclick', (e) => {
      const [x, y] = local(e);
      zoomAt(x, y, 1);
    });
  }

  function bind() {
    canvas = document.getElementById('map-canvas');
    if (!canvas) return;

    document.getElementById('btn-map').addEventListener('click', open);
    document.querySelector('#modal-map .modal-close').addEventListener('click', close);
    document.getElementById('modal-map').addEventListener('click', (e) => {
      if (e.target.id === 'modal-map') close();
    });

    const on = (id, fn) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('click', fn);
    };
    on('map-zoom-in', () => zoomAt(W / 2, H / 2, 0.9));
    on('map-zoom-out', () => zoomAt(W / 2, H / 2, -0.9));
    on('map-world', () => {
      follow = null; syncFollowBtn();
      const me = State.current();
      // Un appui : la route entière ; l'appui suivant : le monde entier.
      if (overviewStep === 0 && me) { fitRoute(Routes.active(me).id); overviewStep = 1; }
      else { fitWorld(); overviewStep = 0; }
    });
    on('map-follow', () => {
      const m = markers.find(x => x.me) || markers[0];
      if (!m) return;
      follow = follow ? null : m.name;
      syncFollowBtn();
      if (follow) flyTo(m.lon, m.lat, Math.max(view.zoom, 2.6));
    });
    on('map-wind', () => { showWind = !showWind; syncWindBtn(); });

    bindGestures();
    window.addEventListener('resize', () => {
      if (document.getElementById('modal-map').classList.contains('open')) resize();
    });
  }

  document.addEventListener('DOMContentLoaded', bind);

  return {
    open, close,
    // --- points d'entrée pour les tests ---
    _view: () => ({ cx: view.cx, cy: view.cy, zoom: view.zoom, W, H }),
    _project: project,
    _unproject: unproject,
    _zoomAt: zoomAt,
    _fitRoute: fitRoute,
    _fitWorld: fitWorld,
    _markers: () => markers,
    _routePath: routePath,
    _follow: (name) => { follow = name === undefined ? follow : name; return follow; },
    _pan: (dx, dy) => { const wp = worldPx(); view.cx -= dx / wp; view.cy -= dy / wp; clampView(); },
  };
})();
