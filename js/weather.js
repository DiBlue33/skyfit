/* ============================================================
   SkyFit — Météo & vents en altitude (Open-Meteo)
   ------------------------------------------------------------
   Le vent réel joue sur la vitesse de l'avion :
     vitesse sol = vitesse air + composante de vent le long du cap
   La composante est plafonnée à ±25 % de la vitesse air.

   Les vents sont récupérés par niveau de pression (1000 → 200 hPa)
   sur les points de relevé de la ROUTE ACTIVE (LFPG ↔ ville), en une
   seule requête multi-coordonnées, sur J-1 → J+2 (96 h). Tout est mis
   en cache dans localStorage pour que le rattrapage hors ligne applique
   le vent réel de chaque heure passée.

   ⚠️ Depuis la v2.3 les fonctions de consultation reçoivent une
   « situation de vol » `geo` produite par Routes.geo(player) :
   { route, t (0 = LFPG, 1 = destination), heading, lon, lat }.

   API : https://api.open-meteo.com/v1/forecast  (gratuit, sans clé)
   ============================================================ */

const Weather = (() => {

  const D2R = Math.PI / 180;
  const R2D = 180 / Math.PI;

  /* --- Niveaux de pression et altitude standard (ISA) associée --- */
  const LEVELS = [
    { hpa: 1000, ft:   364 },
    { hpa:  850, ft:  4781 },
    { hpa:  700, ft:  9882 },
    { hpa:  500, ft: 18289 },
    { hpa:  400, ft: 23574 },
    { hpa:  300, ft: 30065 },
    { hpa:  250, ft: 33999 },
    { hpa:  200, ft: 38662 },
  ];

  const CACHE_KEY   = 'skyfit_weather_v1';
  const API_URL     = 'https://api.open-meteo.com/v1/forecast';
  const REFRESH_MS  = 3 * 3600 * 1000;   // rafraîchir au plus toutes les 3 h
  const RETRY_MS    = 10 * 60 * 1000;    // après un échec, réessayer dans 10 min
  const STALE_MS    = 12 * 3600 * 1000;  // au-delà, le cache est signalé « périmé »

  /* Données en mémoire :
     { fetchedAt, routeId, t0, hours, points: [ { name, lon, lat, t,
         u: [level][hour], v: [level][hour],
         code: [hour], cloud: [hour], precip: [hour] } ] }        */
  let data = null;
  let lastAttempt = 0;
  let fetching = false;
  let lastError = null;      // dernier échec de relevé, affiché dans le panneau
  const listeners = [];

  /* ------------------------------------------------------------
     Cache localStorage
     ------------------------------------------------------------ */

  function load() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return false;
      const d = JSON.parse(raw);
      // Un cache sans routeId vient de la v2.2 (tour du monde) : inutilisable.
      if (d && d.routeId && Array.isArray(d.points) && d.points.length && d.hours > 0) {
        data = d;
        return true;
      }
    } catch (e) { /* cache illisible : on repart de zéro */ }
    return false;
  }

  function save() {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(data)); }
    catch (e) { /* quota dépassé : on garde les données en mémoire */ }
  }

  /* ------------------------------------------------------------
     Récupération auprès d'Open-Meteo
     ------------------------------------------------------------ */

  /** Route dont on relève les vents : celle du pilote connecté. */
  function activeRouteId() {
    try {
      const p = (typeof State !== 'undefined') ? State.current() : null;
      return Routes.active(p).id;
    } catch (e) {
      return Routes.DEFAULT_ROUTE;
    }
  }

  function buildUrl() {
    const stops = Routes.samplePoints(activeRouteId());
    const hourly = [];
    LEVELS.forEach(l => {
      hourly.push('wind_speed_' + l.hpa + 'hPa');
      hourly.push('wind_direction_' + l.hpa + 'hPa');
    });
    hourly.push('weather_code', 'cloud_cover', 'precipitation');

    const params = new URLSearchParams({
      latitude:  stops.map(s => s.lat.toFixed(2)).join(','),
      longitude: stops.map(s => s.lon.toFixed(2)).join(','),
      hourly: hourly.join(','),
      wind_speed_unit: 'kmh',
      timezone: 'UTC',
      past_days: '1',
      forecast_days: '3',
    });
    return API_URL + '?' + params.toString();
  }

  /** Vent (km/h, direction d'où il vient) → composantes u (est) / v (nord). */
  function toUV(speed, dirFrom) {
    const a = dirFrom * D2R;
    return { u: -speed * Math.sin(a), v: -speed * Math.cos(a) };
  }

  /** Transforme la réponse brute (tableau ou objet unique) en données compactes. */
  function parse(json, routeId) {
    const arr = Array.isArray(json) ? json : [json];
    const stops = Routes.samplePoints(routeId);
    const points = [];
    let t0 = null, hours = 0;

    arr.forEach((res, i) => {
      const h = res && res.hourly;
      if (!h || !Array.isArray(h.time) || !h.time.length) return;

      // Open-Meteo renvoie « 2026-07-26T00:00 » en UTC (timezone=UTC)
      const times = h.time.map(t => Date.parse(t.length <= 16 ? t + ':00Z' : t));
      if (t0 === null) { t0 = times[0]; hours = times.length; }

      const u = [], v = [];
      LEVELS.forEach(l => {
        const sp = h['wind_speed_' + l.hpa + 'hPa'] || [];
        const dr = h['wind_direction_' + l.hpa + 'hPa'] || [];
        const ul = [], vl = [];
        for (let k = 0; k < hours; k++) {
          const s = sp[k], d = dr[k];
          if (typeof s !== 'number' || typeof d !== 'number') { ul.push(null); vl.push(null); continue; }
          const c = toUV(s, d);
          ul.push(Math.round(c.u)); vl.push(Math.round(c.v));
        }
        u.push(ul); v.push(vl);
      });

      const stop = stops[i] || stops[0];
      points.push({
        name: stop.name,
        lon: typeof res.longitude === 'number' ? res.longitude : stop.lon,
        lat: typeof res.latitude === 'number' ? res.latitude : stop.lat,
        t: typeof stop.t === 'number' ? stop.t : (stops.length > 1 ? i / (stops.length - 1) : 0),
        u, v,
        code:   (h.weather_code   || []).slice(0, hours),
        cloud:  (h.cloud_cover    || []).slice(0, hours),
        precip: (h.precipitation  || []).slice(0, hours),
      });
    });

    if (!points.length || t0 === null) return null;
    return { fetchedAt: Date.now(), routeId: routeId || null, t0, hours, points };
  }

  /**
   * Récupère les prévisions si le cache est trop vieux.
   * Ne lève jamais : en cas d'échec, on continue avec le cache (ou vent nul).
   */
  function refresh(force) {
    if (fetching) return Promise.resolve(false);
    const now = Date.now();
    const routeId = activeRouteId();
    // Changement de route : les relevés en cache ne sont plus au bon endroit.
    const wrongRoute = !!data && data.routeId !== routeId;
    if (!force && !wrongRoute) {
      if (data && now - data.fetchedAt < REFRESH_MS) return Promise.resolve(false);
      if (now - lastAttempt < RETRY_MS) return Promise.resolve(false);
    }
    if (wrongRoute && !force && now - lastAttempt < RETRY_MS) return Promise.resolve(false);
    lastAttempt = now;
    fetching = true;

    return fetch(buildUrl())
      .then(r => r.json().then(j => {
        // Open-Meteo renvoie { error: true, reason: "..." } avec un code 400
        if (!r.ok || (j && j.error)) {
          throw new Error('HTTP ' + r.status + ((j && j.reason) ? ' — ' + j.reason : ''));
        }
        return j;
      }))
      .then(json => {
        const parsed = parse(json, routeId);
        if (!parsed) throw new Error('réponse illisible');
        data = parsed;
        lastError = null;
        save();
        listeners.forEach(fn => { try { fn(); } catch (e) {} });
        return true;
      })
      .catch(err => {
        lastError = (err && err.message) ? String(err.message).slice(0, 160) : 'réseau indisponible';
        return false;
      })
      .then(ok => { fetching = false; return ok; });
  }

  function onUpdate(fn) { if (typeof fn === 'function') listeners.push(fn); }

  /* ------------------------------------------------------------
     Interpolations
     ------------------------------------------------------------ */

  /** Index d'heure (réel, non entier) pour un instant donné. */
  function hourIndex(timeMs) {
    if (!data) return null;
    return (timeMs - data.t0) / 3600000;
  }

  /** Interpolation linéaire d'une série horaire, avec bornage aux extrémités. */
  function atHour(series, hi) {
    if (!series || !series.length) return null;
    const last = series.length - 1;
    if (hi <= 0) return num(series[0]);
    if (hi >= last) return num(series[last]);
    const i = Math.floor(hi), f = hi - i;
    const a = num(series[i]), b = num(series[i + 1]);
    if (a === null) return b;
    if (b === null) return a;
    return a + (b - a) * f;
  }

  function num(x) { return typeof x === 'number' && isFinite(x) ? x : null; }

  /** Composantes u/v pour un point, une altitude et une heure. */
  function uvAtPoint(pt, altFt, hi) {
    if (!pt) return null;
    // Relevé incomplet (cache partiel, réponse tronquée) → pas de vent,
    // surtout pas d'exception : ce code tourne à chaque tick du moteur.
    if (!Array.isArray(pt.u) || !Array.isArray(pt.v)) return null;
    // Encadrement en altitude
    let lo = 0, hi2 = LEVELS.length - 1;
    if (altFt <= LEVELS[0].ft) { lo = hi2 = 0; }
    else if (altFt >= LEVELS[LEVELS.length - 1].ft) { lo = hi2 = LEVELS.length - 1; }
    else {
      for (let i = 0; i < LEVELS.length - 1; i++) {
        if (altFt >= LEVELS[i].ft && altFt <= LEVELS[i + 1].ft) { lo = i; hi2 = i + 1; break; }
      }
    }
    const f = (lo === hi2) ? 0 : (altFt - LEVELS[lo].ft) / (LEVELS[hi2].ft - LEVELS[lo].ft);

    const uA = atHour(pt.u[lo], hi),  vA = atHour(pt.v[lo], hi);
    const uB = atHour(pt.u[hi2], hi), vB = atHour(pt.v[hi2], hi);
    if (uA === null && uB === null) return null;
    if (uA === null) return { u: uB, v: vB };
    if (uB === null) return { u: uA, v: vA };
    return { u: uA + (uB - uA) * f, v: vA + (vB - vA) * f };
  }

  /**
   * Cisaillement vertical du vent à un point, en km/h par 1 000 ft.
   *
   * C'est LE bon indicateur de turbulence en air clair : on compare le
   * VECTEUR vent des deux niveaux de pression qui encadrent l'avion.
   * Un jet-stream de 250 km/h homogène donne un cisaillement nul (vol
   * parfaitement lisse) ; c'est en entrant et en sortant du courant que
   * ça secoue. Renvoie null si le relevé est incomplet.
   */
  function shearAtPoint(pt, altFt, hi) {
    if (!pt || !Array.isArray(pt.u) || !Array.isArray(pt.v)) return null;
    const n = LEVELS.length;
    // Deux niveaux voisins encadrant l'altitude (ou la paire la plus
    // proche quand l'avion est sous le 1er / au-dessus du dernier).
    let lo = 0;
    if (altFt >= LEVELS[n - 1].ft) lo = n - 2;
    else if (altFt > LEVELS[0].ft) {
      for (let i = 0; i < n - 1; i++) {
        if (altFt >= LEVELS[i].ft && altFt <= LEVELS[i + 1].ft) { lo = i; break; }
      }
    }
    const hiLvl = lo + 1;
    const uA = atHour(pt.u[lo], hi),    vA = atHour(pt.v[lo], hi);
    const uB = atHour(pt.u[hiLvl], hi), vB = atHour(pt.v[hiLvl], hi);
    if (uA === null || uB === null || vA === null || vB === null) return null;
    const dz = (LEVELS[hiLvl].ft - LEVELS[lo].ft) / 1000;
    if (!(dz > 0)) return null;
    return Math.hypot(uB - uA, vB - vA) / dz;
  }

  /**
   * Situation de vol normalisée. Accepte :
   *   - un objet `geo` issu de Routes.geo(player) / Routes.geoAt(...)
   *   - un nombre = km parcourus depuis LFPG sur la route active (aller)
   *   - rien = verticale LFPG
   */
  function asGeo(x) {
    if (x && typeof x === 'object' && typeof x.t === 'number') return x;
    if (typeof x === 'number' && isFinite(x)) {
      return Routes.geoAt(activeRouteId(), x, 0);
    }
    return Routes.geoAt(activeRouteId(), 0, 0);
  }

  /**
   * Points de relevé encadrant la situation de vol, et poids de mélange.
   * Les points sont répartis uniformément en fraction de route (Routes.
   * samplePoints), donc l'index réel vaut simplement t × (n − 1).
   * Si le cache concerne une AUTRE route (relevé pas encore rafraîchi),
   * on retombe sur le point géographiquement le plus proche : c'est
   * approximatif mais toujours mieux qu'un vent nul.
   */
  function frame(geo) {
    if (!data || !data.points || !data.points.length) return null;
    const pts = data.points, n = pts.length;
    const sameRoute = !data.routeId || !geo.route || data.routeId === geo.route.id;
    if (!sameRoute) {
      let bi = 0, bd = Infinity;
      for (let i = 0; i < n; i++) {
        const dLon = ((pts[i].lon - geo.lon + 540) % 360 - 180) * Math.cos(geo.lat * D2R);
        const d = Math.hypot(dLon, pts[i].lat - geo.lat);
        if (d < bd) { bd = d; bi = i; }
      }
      return { iA: bi, iB: bi, f: 0 };
    }
    if (n < 2) return { iA: 0, iB: 0, f: 0 };
    const t = Math.max(0, Math.min(1, geo.t || 0));
    const x = t * (n - 1);
    const iA = Math.min(n - 2, Math.floor(x));
    return { iA, iB: iA + 1, f: x - iA };
  }

  /* ------------------------------------------------------------
     API publique de consultation
     ------------------------------------------------------------ */

  /**
   * Vent subi dans une situation de vol / une altitude / un instant.
   * Retourne toujours un objet ; `ok:false` = pas de données (vent neutre).
   *   speed    : force du vent (km/h)
   *   dirFrom  : direction d'où vient le vent (degrés)
   *   tail     : composante dans l'axe du vol (>0 vent arrière, <0 vent de face)
   *   cross    : composante latérale (km/h)
   *   heading  : cap de l'avion
   */
  function windAt(where, altFt, timeMs) {
    const none = { ok: false, speed: 0, dirFrom: 0, tail: 0, cross: 0, heading: 0 };
    const geo = asGeo(where);
    if (!data) return { ok: false, speed: 0, dirFrom: 0, tail: 0, cross: 0, heading: geo.heading };
    const hi = hourIndex(typeof timeMs === 'number' ? timeMs : Date.now());
    if (hi === null || hi < -1 || hi > data.hours) return none;

    const fr = frame(geo);
    if (!fr) return none;

    const a = uvAtPoint(data.points[fr.iA], altFt, hi);
    const b = uvAtPoint(data.points[fr.iB], altFt, hi);
    let u, v;
    if (a && b)      { u = a.u + (b.u - a.u) * fr.f; v = a.v + (b.v - a.v) * fr.f; }
    else if (a)      { u = a.u; v = a.v; }
    else if (b)      { u = b.u; v = b.v; }
    else return none;

    const heading = geo.heading;
    const hr = heading * D2R;
    // Vecteur unitaire du cap en (est, nord)
    const tail  = u * Math.sin(hr) + v * Math.cos(hr);
    const cross = u * Math.cos(hr) - v * Math.sin(hr);
    const speed = Math.hypot(u, v);
    const dirFrom = (Math.atan2(-u, -v) * R2D + 360) % 360;

    return { ok: true, speed, dirFrom, tail, cross, heading };
  }

  /** Ratio d'effet sur la vitesse, plafonné à ±MAX_RATIO. */
  function ratioFor(tail, airspeedKmh) {
    const max = CONFIG.WEATHER.MAX_RATIO;
    if (!(airspeedKmh > 0)) return 0;
    const r = tail / airspeedKmh;
    return Math.max(-max, Math.min(max, r));
  }

  /** Multiplicateur de vitesse sol (1 = vent nul). */
  function factorFor(where, altFt, timeMs, airspeedKmh) {
    if (!CONFIG.WEATHER.ENABLED) return 1;
    const w = windAt(where, altFt, timeMs);
    if (!w.ok) return 1;
    return 1 + ratioFor(w.tail, airspeedKmh);
  }

  /** Vent + effet, prêt pour l'affichage (badge HUD). */
  function summaryFor(player) {
    const airspeed = State.airspeed(player);
    const geo = Routes.geo(player);
    const w = windAt(geo, player.altitude, Date.now());
    const ratio = w.ok ? ratioFor(w.tail, airspeed) : 0;
    return {
      ok: w.ok && CONFIG.WEATHER.ENABLED,
      speed: w.speed, dirFrom: w.dirFrom, tail: w.tail, cross: w.cross,
      heading: w.heading, ratio,
      airspeed, ground: airspeed * (1 + ratio),
      route: geo.route, to: geo.to, from: geo.from, outbound: geo.outbound,
      stale: !data || (Date.now() - data.fetchedAt > STALE_MS),
    };
  }

  /** Conditions au sol (nuages, pluie, code météo) à la position du joueur. */
  function conditionsAt(where, timeMs) {
    const none = { ok: false, cloud: 0, precip: 0, code: 0 };
    if (!data) return none;
    const hi = hourIndex(typeof timeMs === 'number' ? timeMs : Date.now());
    if (hi === null || hi < -1 || hi > data.hours) return none;
    const fr = frame(asGeo(where));
    if (!fr) return none;
    const iA = fr.iA, iB = fr.iB, t = fr.f;
    const mix = (key) => {
      const a = atHour(data.points[iA][key], hi);
      const b = atHour(data.points[iB][key], hi);
      if (a === null && b === null) return null;
      if (a === null) return b;
      if (b === null) return a;
      return a + (b - a) * t;
    };
    const cloud = mix('cloud'), precip = mix('precip');
    const codeA = atHour(data.points[t < 0.5 ? iA : iB]['code'], hi);
    if (cloud === null && precip === null) return none;
    return {
      ok: true,
      cloud: cloud === null ? 0 : cloud,
      precip: precip === null ? 0 : precip,
      code: codeA === null ? 0 : Math.round(codeA),
    };
  }

  /**
   * Turbulences à la position et à l'altitude du joueur.
   *   { ok, level: 0..3, label, shear (km/h/1000ft), cause }
   *
   * Trois sources, on garde la plus forte :
   *   1. cisaillement vertical du vent (turbulence en air clair) ;
   *   2. convection (orage, averse) via le code météo ;
   *   3. rafales à basse altitude (sous 5 000 ft, près du relief).
   * Sans données : level 0, `ok: false` — l'avion vole lisse, jamais
   * d'exception (cette fonction est appelée à chaque rafraîchissement).
   */
  function turbulenceAt(where, altFt, timeMs) {
    const T = (CONFIG.WEATHER && CONFIG.WEATHER.TURB) || {};
    const labels = T.LABELS || ['calme', 'légères', 'modérées', 'fortes'];
    const none = { ok: false, level: 0, label: labels[0], shear: 0, cause: null };
    if (!data || !CONFIG.WEATHER.ENABLED) return none;

    const hi = hourIndex(typeof timeMs === 'number' ? timeMs : Date.now());
    if (hi === null || hi < -1 || hi > data.hours) return none;
    const geo = asGeo(where);
    const fr = frame(geo);
    if (!fr) return none;

    const ft = (typeof altFt === 'number' && isFinite(altFt)) ? altFt : 0;

    /* 1) Cisaillement vertical — interpolé le long de la route */
    const sA = shearAtPoint(data.points[fr.iA], ft, hi);
    const sB = shearAtPoint(data.points[fr.iB], ft, hi);
    let shear = 0;
    if (sA !== null && sB !== null) shear = sA + (sB - sA) * fr.f;
    else if (sA !== null) shear = sA;
    else if (sB !== null) shear = sB;

    const th = T.SHEAR || [6, 12, 20];
    let level = 0, cause = null;
    for (let i = th.length - 1; i >= 0; i--) {
      if (shear >= th[i]) { level = i + 1; cause = 'cisaillement'; break; }
    }

    /* 2) Convection : orages et averses secouent bien plus qu'un jet-stream */
    const cond = conditionsAt(geo, timeMs);
    const byCode = (T.CODES || {})[cond.code];
    if (cond.ok && byCode && byCode > level) { level = byCode; cause = 'convection'; }

    /* 3) Basse altitude : rafales et turbulence mécanique près du sol */
    if (ft < (T.LOW_ALT_FT || 5000)) {
      const w = windAt(geo, ft, timeMs);
      const lw = T.LOW_WIND || [45, 70];
      let low = 0;
      if (w.ok && w.speed >= lw[1]) low = 2;
      else if (w.ok && w.speed >= lw[0]) low = 1;
      if (low > level) { level = low; cause = 'basse altitude'; }
    }

    return {
      ok: true,
      level,
      label: labels[Math.min(level, labels.length - 1)],
      shear: Math.round(shear * 10) / 10,
      cause: level > 0 ? cause : null,
    };
  }

  /**
   * Grille de prévisions pour le panneau météo :
   * pour chaque altitude palier et chaque heure à venir, le vent et son effet.
   *   { t0, hours, alts: [ft], rows: [ { ft, cells: [ {tail, speed, ratio} ] } ] }
   */
  function forecastGrid(player, hoursAhead) {
    const H = hoursAhead || 48;
    const plane = CONFIG.planeOf(player);
    // Paliers d'altitude propres à l'AVION PILOTÉ (v2.6) : de l'altitude de
    // décollage à son plafond. Conseiller 38 000 ft au pilote d'un Cessna
    // n'aurait aucun sens — et au-dessus du plafond, la vitesse plafonne,
    // ce qui rendait le classement du meilleur créneau arbitraire.
    const lo = CONFIG.ALT_START_RATIO, n = 8;
    const alts = [];
    for (let i = 0; i < n; i++) {
      const frac = lo + (1 - lo) * (i / (n - 1));
      alts.push(Math.round(plane.ceiling * frac / 500) * 500);
    }
    // Heure pleine courante (UTC local du navigateur)
    const start = new Date(); start.setMinutes(0, 0, 0);
    const t0 = start.getTime();
    const geo = Routes.geo(player);

    const rows = alts.map(ft => {
      const airspeed = CONFIG.speedAt(ft, plane);
      const cells = [];
      for (let h = 0; h < H; h++) {
        const w = windAt(geo, ft, t0 + h * 3600000);
        cells.push(w.ok
          ? { ok: true, tail: w.tail, speed: w.speed, dirFrom: w.dirFrom, ratio: ratioFor(w.tail, airspeed) }
          : { ok: false, tail: 0, speed: 0, dirFrom: 0, ratio: 0 });
      }
      return { ft, airspeed, cells };
    });

    return { t0, hours: H, alts, rows, ceiling: plane.ceiling, ok: !!data };
  }

  /**
   * Meilleur créneau (altitude + heure) sur les prochaines heures.
   * Classement par VITESSE SOL et non par pourcentage : un +25 % à 5 000 ft
   * reste bien plus lent qu'un +10 % à 38 000 ft — conseiller de descendre
   * serait un mauvais conseil.
   */
  function bestWindow(player, hoursAhead) {
    const g = forecastGrid(player, hoursAhead || 48);
    let best = null;
    g.rows.forEach(row => {
      row.cells.forEach((c, h) => {
        if (!c.ok) return;
        const ground = row.airspeed * (1 + c.ratio);
        if (!best || ground > best.ground) {
          best = { ft: row.ft, hour: h, ratio: c.ratio, tail: c.tail,
                   ground: ground, airspeed: row.airspeed, t: g.t0 + h * 3600000 };
        }
      });
    });
    return best;
  }

  function info() {
    if (!data) return null;
    const route = Routes.byId(data.routeId);
    return {
      fetchedAt: data.fetchedAt, hours: data.hours, t0: data.t0,
      points: data.points.length,
      routeId: data.routeId,
      routeLabel: route ? route.label : '—',
      routeCity: route ? route.city : null,
      wrongRoute: data.routeId !== activeRouteId(),
      stale: Date.now() - data.fetchedAt > STALE_MS,
      error: lastError,
    };
  }

  /** Dernier échec de relevé (null si tout va bien) — aide au diagnostic. */
  function error() { return lastError; }

  /** Initialisation : cache puis rafraîchissement en tâche de fond. */
  function init() {
    load();
    if (CONFIG.WEATHER.ENABLED) {
      refresh(false);
      setInterval(() => refresh(false), 30 * 60 * 1000);
      window.addEventListener('online', () => refresh(true));
    }
  }

  // Injection directe (tests hors ligne)
  function _setData(d) { data = d; if (d) save(); }

  return {
    init, refresh, onUpdate, load,
    windAt, ratioFor, factorFor, summaryFor, conditionsAt, turbulenceAt,
    forecastGrid, bestWindow, activeRouteId, info, error,
    LEVELS, _setData, _shearAtPoint: shearAtPoint,
  };
})();
