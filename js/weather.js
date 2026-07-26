/* ============================================================
   SkyFit — Météo & vents en altitude (Open-Meteo)
   ------------------------------------------------------------
   Le vent réel joue sur la vitesse de l'avion :
     vitesse sol = vitesse air + composante de vent le long du cap
   La composante est plafonnée à ±25 % de la vitesse air.

   Les vents sont récupérés par niveau de pression (1000 → 200 hPa)
   sur les 12 escales du tour du monde, en une seule requête
   multi-coordonnées, sur J-1 → J+2 (96 h). Tout est mis en cache
   dans localStorage pour que le rattrapage hors ligne applique
   le vent réel de chaque heure passée.

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
     { fetchedAt, t0, hours, points: [ { name, lon, lat,
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
      if (d && Array.isArray(d.points) && d.points.length && d.hours > 0) {
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

  function buildUrl() {
    const stops = WorldMap.route();
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
  function parse(json) {
    const arr = Array.isArray(json) ? json : [json];
    const stops = WorldMap.route();
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
        u, v,
        code:   (h.weather_code   || []).slice(0, hours),
        cloud:  (h.cloud_cover    || []).slice(0, hours),
        precip: (h.precipitation  || []).slice(0, hours),
      });
    });

    if (!points.length || t0 === null) return null;
    return { fetchedAt: Date.now(), t0, hours, points };
  }

  /**
   * Récupère les prévisions si le cache est trop vieux.
   * Ne lève jamais : en cas d'échec, on continue avec le cache (ou vent nul).
   */
  function refresh(force) {
    if (fetching) return Promise.resolve(false);
    const now = Date.now();
    if (!force) {
      if (data && now - data.fetchedAt < REFRESH_MS) return Promise.resolve(false);
      if (now - lastAttempt < RETRY_MS) return Promise.resolve(false);
    }
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
        const parsed = parse(json);
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

  /** Cap suivi par l'avion (degrés, 0 = nord) au kilométrage donné. */
  function headingAt(km) {
    const a = WorldMap.positionForKm(km);
    const b = WorldMap.positionForKm(km + 50);
    const dLon = (b.lon - a.lon + 540) % 360 - 180;
    const y = Math.sin(dLon * D2R) * Math.cos(b.lat * D2R);
    const x = Math.cos(a.lat * D2R) * Math.sin(b.lat * D2R) -
              Math.sin(a.lat * D2R) * Math.cos(b.lat * D2R) * Math.cos(dLon * D2R);
    return (Math.atan2(y, x) * R2D + 360) % 360;
  }

  /* ------------------------------------------------------------
     API publique de consultation
     ------------------------------------------------------------ */

  /**
   * Vent subi à un kilométrage / une altitude / un instant.
   * Retourne toujours un objet ; `ok:false` = pas de données (vent neutre).
   *   speed    : force du vent (km/h)
   *   dirFrom  : direction d'où vient le vent (degrés)
   *   tail     : composante dans l'axe du vol (>0 vent arrière, <0 vent de face)
   *   cross    : composante latérale (km/h)
   *   heading  : cap de l'avion
   */
  function windAt(km, altFt, timeMs) {
    const none = { ok: false, speed: 0, dirFrom: 0, tail: 0, cross: 0, heading: 0 };
    if (!data) return none;
    const hi = hourIndex(typeof timeMs === 'number' ? timeMs : Date.now());
    if (hi === null || hi < -1 || hi > data.hours) return none;

    const pos = WorldMap.positionForKm(km);
    const n = data.points.length;
    const iA = Math.min(pos.segIndex === undefined ? 0 : pos.segIndex, n - 1);
    const iB = (iA + 1) % n;
    const t = pos.segT === undefined ? 0 : pos.segT;

    const a = uvAtPoint(data.points[iA], altFt, hi);
    const b = uvAtPoint(data.points[iB], altFt, hi);
    let u, v;
    if (a && b)      { u = a.u + (b.u - a.u) * t; v = a.v + (b.v - a.v) * t; }
    else if (a)      { u = a.u; v = a.v; }
    else if (b)      { u = b.u; v = b.v; }
    else return none;

    const heading = headingAt(km);
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
  function factorFor(km, altFt, timeMs, airspeedKmh) {
    if (!CONFIG.WEATHER.ENABLED) return 1;
    const w = windAt(km, altFt, timeMs);
    if (!w.ok) return 1;
    return 1 + ratioFor(w.tail, airspeedKmh);
  }

  /** Vent + effet, prêt pour l'affichage (badge HUD). */
  function summaryFor(player) {
    const airspeed = CONFIG.speedForAlt(player.altitude) * State.speedMult(player);
    const w = windAt(player.totalKm, player.altitude, Date.now());
    const ratio = w.ok ? ratioFor(w.tail, airspeed) : 0;
    return {
      ok: w.ok && CONFIG.WEATHER.ENABLED,
      speed: w.speed, dirFrom: w.dirFrom, tail: w.tail, cross: w.cross,
      heading: w.heading, ratio,
      airspeed, ground: airspeed * (1 + ratio),
      stale: !data || (Date.now() - data.fetchedAt > STALE_MS),
    };
  }

  /** Conditions au sol (nuages, pluie, code météo) à la position du joueur. */
  function conditionsAt(km, timeMs) {
    const none = { ok: false, cloud: 0, precip: 0, code: 0 };
    if (!data) return none;
    const hi = hourIndex(typeof timeMs === 'number' ? timeMs : Date.now());
    if (hi === null || hi < -1 || hi > data.hours) return none;
    const pos = WorldMap.positionForKm(km);
    const n = data.points.length;
    const iA = Math.min(pos.segIndex || 0, n - 1);
    const iB = (iA + 1) % n;
    const t = pos.segT || 0;
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
   * Grille de prévisions pour le panneau météo :
   * pour chaque altitude palier et chaque heure à venir, le vent et son effet.
   *   { t0, hours, alts: [ft], rows: [ { ft, cells: [ {tail, speed, ratio} ] } ] }
   */
  function forecastGrid(player, hoursAhead) {
    const H = hoursAhead || 48;
    const alts = [5000, 10000, 15000, 20000, 25000, 30000, 34000, 38000];
    const mult = State.speedMult(player);
    // Heure pleine courante (UTC local du navigateur)
    const start = new Date(); start.setMinutes(0, 0, 0);
    const t0 = start.getTime();
    const km = player.totalKm;

    const rows = alts.map(ft => {
      const airspeed = CONFIG.speedForAlt(ft) * mult;
      const cells = [];
      for (let h = 0; h < H; h++) {
        const w = windAt(km, ft, t0 + h * 3600000);
        cells.push(w.ok
          ? { ok: true, tail: w.tail, speed: w.speed, dirFrom: w.dirFrom, ratio: ratioFor(w.tail, airspeed) }
          : { ok: false, tail: 0, speed: 0, dirFrom: 0, ratio: 0 });
      }
      return { ft, airspeed, cells };
    });

    return { t0, hours: H, alts, rows, ok: !!data };
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
    return data
      ? { fetchedAt: data.fetchedAt, hours: data.hours, t0: data.t0,
          points: data.points.length,
          stale: Date.now() - data.fetchedAt > STALE_MS,
          error: lastError }
      : null;
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
    windAt, ratioFor, factorFor, summaryFor, conditionsAt,
    forecastGrid, bestWindow, headingAt, info, error,
    LEVELS, _setData,
  };
})();
