/* ============================================================
   SkyFit — Système de routes (v2.3)
   ------------------------------------------------------------
   Tous les vols partent de PARIS CHARLES-DE-GAULLE (LFPG).
   Une route = une liaison LFPG ↔ ville, achetée en boutique
   avec des points, possédée à vie.

   L'avion fait des ALLER-RETOUR sur sa route active, sans fin.
   Demander une autre route ne prend effet qu'à la prochaine
   VERTICALE DE LFPG (comme un vrai plan de vol : on ne change
   pas de destination en plein Atlantique).

   Repères :
     legKm  = distance parcourue depuis LFPG le long de la route
              (0 = à la verticale de LFPG, route.km = à destination)
     legDir = 0 → aller (LFPG → ville), 1 → retour (ville → LFPG)
   ============================================================ */

const Routes = (() => {

  const D2R = Math.PI / 180;
  const R2D = 180 / Math.PI;
  const R_EARTH = 6371;

  /* ------------------------------------------------------------
     Base de départ
     ------------------------------------------------------------ */
  const BASE = {
    icao: 'LFPG', city: 'Paris', name: 'Paris Charles-de-Gaulle',
    lon: 2.5479, lat: 49.0097, icon: '🗼',
  };

  /** Route offerte au décollage : le premier saut de puce vers Lyon. */
  const DEFAULT_ROUTE = 'lfll';

  const REGIONS = [
    'France',
    'Europe',
    'Afrique & Moyen-Orient',
    'Amériques',
    'Asie & Océanie',
  ];

  /* ------------------------------------------------------------
     Catalogue — 44 destinations, coût croissant avec la distance
     et avec l'éloignement du continent.
     ⚠️ Les noms de villes servent d'identifiant aux succès
     « Visite à … » : ne pas les renommer.
     ------------------------------------------------------------ */
  const CATALOG = [
    /* --- France : court-courrier, l'école de pilotage --- */
    { id: 'lfll', icao: 'LFLL', city: 'Lyon',        lon:   5.0811, lat:  45.7256, region: 'France', icon: '🦁', cost: 0 },
    { id: 'lfrb', icao: 'LFRB', city: 'Brest',       lon:  -4.4186, lat:  48.4479, region: 'France', icon: '⚓', cost: 500 },
    { id: 'lfbd', icao: 'LFBD', city: 'Bordeaux',    lon:  -0.7156, lat:  44.8283, region: 'France', icon: '🍷', cost: 550 },
    { id: 'lfbo', icao: 'LFBO', city: 'Toulouse',    lon:   1.3638, lat:  43.6293, region: 'France', icon: '🚀', cost: 600 },
    { id: 'lfml', icao: 'LFML', city: 'Marseille',   lon:   5.2153, lat:  43.4366, region: 'France', icon: '⛵', cost: 650 },
    { id: 'lfbz', icao: 'LFBZ', city: 'Biarritz',    lon:  -1.5233, lat:  43.4684, region: 'France', icon: '🏄', cost: 700 },
    { id: 'lfmn', icao: 'LFMN', city: 'Nice',        lon:   7.2151, lat:  43.6653, region: 'France', icon: '🌴', cost: 700 },
    { id: 'lfkj', icao: 'LFKJ', city: 'Ajaccio',     lon:   8.8029, lat:  41.9236, region: 'France', icon: '🏝️', cost: 950 },

    /* --- Europe --- */
    { id: 'egll', icao: 'EGLL', city: 'Londres',     lon:  -0.4543, lat:  51.4700, region: 'Europe', icon: '🎡', cost: 450 },
    { id: 'eham', icao: 'EHAM', city: 'Amsterdam',   lon:   4.7639, lat:  52.3086, region: 'Europe', icon: '🌷', cost: 500 },
    { id: 'eddf', icao: 'EDDF', city: 'Francfort',   lon:   8.5705, lat:  50.0333, region: 'Europe', icon: '🏦', cost: 600 },
    { id: 'lebl', icao: 'LEBL', city: 'Barcelone',   lon:   2.0785, lat:  41.2971, region: 'Europe', icon: '🏖️', cost: 1100 },
    { id: 'loww', icao: 'LOWW', city: 'Vienne',      lon:  16.5697, lat:  48.1103, region: 'Europe', icon: '🎻', cost: 1300 },
    { id: 'lepa', icao: 'LEPA', city: 'Palma',       lon:   2.7388, lat:  39.5517, region: 'Europe', icon: '🐚', cost: 1400 },
    { id: 'lemd', icao: 'LEMD', city: 'Madrid',      lon:  -3.5610, lat:  40.4719, region: 'Europe', icon: '💃', cost: 1400 },
    { id: 'lirf', icao: 'LIRF', city: 'Rome',        lon:  12.2389, lat:  41.8003, region: 'Europe', icon: '🏛️', cost: 1400 },
    { id: 'lppt', icao: 'LPPT', city: 'Lisbonne',    lon:  -9.1342, lat:  38.7742, region: 'Europe', icon: '🐟', cost: 1900 },
    { id: 'essa', icao: 'ESSA', city: 'Stockholm',   lon:  17.9186, lat:  59.6519, region: 'Europe', icon: '❄️', cost: 2000 },
    { id: 'lgav', icao: 'LGAV', city: 'Athènes',     lon:  23.9445, lat:  37.9364, region: 'Europe', icon: '🏺', cost: 2700 },
    { id: 'ltfm', icao: 'LTFM', city: 'Istanbul',    lon:  28.7419, lat:  41.2619, region: 'Europe', icon: '🕌', cost: 2900 },
    { id: 'bikf', icao: 'BIKF', city: 'Reykjavik',   lon: -22.6056, lat:  63.9850, region: 'Europe', icon: '🌋', cost: 2900 },
    { id: 'uuee', icao: 'UUEE', city: 'Moscou',      lon:  37.4146, lat:  55.9726, region: 'Europe', icon: '🪆', cost: 3200 },

    /* --- Afrique & Moyen-Orient --- */
    { id: 'daag', icao: 'DAAG', city: 'Alger',        lon:   3.2154, lat:  36.6910, region: 'Afrique & Moyen-Orient', icon: '🌙', cost: 2200 },
    { id: 'gmmn', icao: 'GMMN', city: 'Casablanca',   lon:  -7.5895, lat:  33.3675, region: 'Afrique & Moyen-Orient', icon: '🕌', cost: 3100 },
    { id: 'heca', icao: 'HECA', city: 'Le Caire',     lon:  31.4056, lat:  30.1219, region: 'Afrique & Moyen-Orient', icon: '🐪', cost: 5100 },
    { id: 'gobd', icao: 'GOBD', city: 'Dakar',        lon: -17.0733, lat:  14.6700, region: 'Afrique & Moyen-Orient', icon: '🦁', cost: 6700 },
    { id: 'omdb', icao: 'OMDB', city: 'Dubaï',        lon:  55.3644, lat:  25.2528, region: 'Afrique & Moyen-Orient', icon: '🌆', cost: 8400 },
    { id: 'faor', icao: 'FAOR', city: 'Johannesburg', lon:  28.2460, lat: -26.1392, region: 'Afrique & Moyen-Orient', icon: '🦒', cost: 14000 },

    /* --- Amériques --- */
    { id: 'cyul', icao: 'CYUL', city: 'Montréal',     lon: -73.7408, lat:  45.4706, region: 'Amériques', icon: '🍁', cost: 11000 },
    { id: 'kjfk', icao: 'KJFK', city: 'New York',     lon: -73.7789, lat:  40.6398, region: 'Amériques', icon: '🗽', cost: 11500 },
    { id: 'kmia', icao: 'KMIA', city: 'Miami',        lon: -80.2870, lat:  25.7952, region: 'Amériques', icon: '🌺', cost: 14500 },
    { id: 'klax', icao: 'KLAX', city: 'Los Angeles',  lon: -118.4081, lat: 33.9425, region: 'Amériques', icon: '🎬', cost: 18000 },
    { id: 'mmmx', icao: 'MMMX', city: 'Mexico',       lon: -99.0721, lat:  19.4363, region: 'Amériques', icon: '🌵', cost: 18500 },
    { id: 'sbgr', icao: 'SBGR', city: 'São Paulo',    lon: -46.4731, lat: -23.4356, region: 'Amériques', icon: '⚽', cost: 19000 },
    { id: 'saez', icao: 'SAEZ', city: 'Buenos Aires', lon: -58.5358, lat: -34.8222, region: 'Amériques', icon: '💃', cost: 22000 },

    /* --- Asie & Océanie --- */
    { id: 'vidp', icao: 'VIDP', city: 'Delhi',        lon:  77.1003, lat:  28.5562, region: 'Asie & Océanie', icon: '🛕', cost: 14500 },
    { id: 'vabb', icao: 'VABB', city: 'Bombay',       lon:  72.8679, lat:  19.0887, region: 'Asie & Océanie', icon: '🕌', cost: 15500 },
    { id: 'zbaa', icao: 'ZBAA', city: 'Pékin',        lon: 116.5847, lat:  40.0799, region: 'Asie & Océanie', icon: '🐉', cost: 18000 },
    { id: 'vtbs', icao: 'VTBS', city: 'Bangkok',      lon: 100.7501, lat:  13.6900, region: 'Asie & Océanie', icon: '🛕', cost: 21000 },
    { id: 'vhhh', icao: 'VHHH', city: 'Hong Kong',    lon: 113.9145, lat:  22.3089, region: 'Asie & Océanie', icon: '🏙️', cost: 21000 },
    { id: 'rjtt', icao: 'RJTT', city: 'Tokyo',        lon: 139.7811, lat:  35.5533, region: 'Asie & Océanie', icon: '⛩️', cost: 21500 },
    { id: 'wsss', icao: 'WSSS', city: 'Singapour',    lon: 103.9893, lat:   1.3592, region: 'Asie & Océanie', icon: '🦁', cost: 23500 },
    { id: 'phnl', icao: 'PHNL', city: 'Honolulu',     lon: -157.9224, lat: 21.3187, region: 'Asie & Océanie', icon: '🌺', cost: 26500 },
    { id: 'yssy', icao: 'YSSY', city: 'Sydney',       lon: 151.1772, lat: -33.9461, region: 'Asie & Océanie', icon: '🦘', cost: 37500 },
  ];

  /* ------------------------------------------------------------
     Géométrie sphérique
     ------------------------------------------------------------ */

  function toVec(p) {
    const la = p.lat * D2R, lo = p.lon * D2R;
    return [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
  }

  function toLonLat(v) {
    const n = Math.hypot(v[0], v[1], v[2]) || 1;
    const x = v[0] / n, y = v[1] / n, z = v[2] / n;
    return [Math.atan2(y, x) * R2D, Math.asin(Math.max(-1, Math.min(1, z))) * R2D];
  }

  /** Distance orthodromique en km. */
  function haversine(a, b) {
    const dLat = (b.lat - a.lat) * D2R, dLon = (b.lon - a.lon) * D2R;
    const s = Math.sin(dLat / 2) ** 2 +
              Math.cos(a.lat * D2R) * Math.cos(b.lat * D2R) * Math.sin(dLon / 2) ** 2;
    return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(s)));
  }

  /** Point à la fraction t du grand cercle a→b. */
  function slerp(a, b, t) {
    const va = toVec(a), vb = toVec(b);
    let dot = va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2];
    dot = Math.max(-1, Math.min(1, dot));
    const om = Math.acos(dot);
    if (om < 1e-9) return [a.lon, a.lat];
    const s = Math.sin(om);
    const k1 = Math.sin((1 - t) * om) / s, k2 = Math.sin(t * om) / s;
    return toLonLat([va[0] * k1 + vb[0] * k2, va[1] * k1 + vb[1] * k2, va[2] * k1 + vb[2] * k2]);
  }

  /** Cap initial (degrés, 0 = nord) pour aller de a vers b. */
  function bearing(a, b) {
    const dLon = ((b.lon - a.lon + 540) % 360 - 180) * D2R;
    const la1 = a.lat * D2R, la2 = b.lat * D2R;
    const y = Math.sin(dLon) * Math.cos(la2);
    const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dLon);
    return (Math.atan2(y, x) * R2D + 360) % 360;
  }

  /* ------------------------------------------------------------
     Préparation du catalogue : distances + index
     ------------------------------------------------------------ */
  const BY_ID = {};
  const BY_CITY = {};
  CATALOG.forEach(r => {
    r.km = Math.round(haversine(BASE, r));
    r.label = BASE.icao + ' ↔ ' + r.icao;
    // Nombre de points de relevé météo : plus la route est longue, plus on
    // en prend (Open-Meteo accepte plusieurs coordonnées par requête).
    r.samples = Math.max(3, Math.min(12, Math.round(r.km / 900) + 2));
    BY_ID[r.id] = r;
    BY_CITY[r.city] = r;
  });

  function all() { return CATALOG; }
  function byId(id) { return BY_ID[id] || null; }
  function byCity(city) { return BY_CITY[city] || null; }

  /** Catalogue groupé par région, dans l'ordre de progression. */
  function byRegion() {
    return REGIONS.map(region => ({
      region,
      routes: CATALOG.filter(r => r.region === region).sort((a, b) => a.km - b.km),
    })).filter(g => g.routes.length);
  }

  /** Toutes les villes du catalogue (source des succès de visite). */
  function cities() {
    return CATALOG.map(r => ({ city: r.city, icao: r.icao, icon: r.icon, km: r.km, region: r.region }));
  }

  /* ------------------------------------------------------------
     État du joueur
     ------------------------------------------------------------ */

  /** Route active du joueur (toujours une route valide). */
  function active(player) {
    if (!player) return BY_ID[DEFAULT_ROUTE];
    return BY_ID[player.currentRoute] || BY_ID[DEFAULT_ROUTE];
  }

  /** Route demandée mais pas encore effective (null si aucune). */
  function pending(player) {
    if (!player || !player.pendingRoute) return null;
    if (player.pendingRoute === player.currentRoute) return null;
    return BY_ID[player.pendingRoute] || null;
  }

  function isOwned(player, id) {
    if (id === DEFAULT_ROUTE) return true;
    return !!(player && Array.isArray(player.ownedRoutes) && player.ownedRoutes.indexOf(id) >= 0);
  }

  function owned(player) {
    return CATALOG.filter(r => isOwned(player, r.id));
  }

  function hasVisited(player, city) {
    return !!(player && Array.isArray(player.visited) && player.visited.indexOf(city) >= 0);
  }

  /* ------------------------------------------------------------
     Position & cap
     ------------------------------------------------------------ */

  /**
   * Situation de vol pour une route / un avancement donné.
   *   { route, from, to, lon, lat, heading, t, legKm, legDir,
   *     kmToNext, kmRound, outbound }
   */
  function geoAt(routeId, legKm, legDir) {
    const route = BY_ID[routeId] || BY_ID[DEFAULT_ROUTE];
    const len = route.km || 1;
    const km = Math.max(0, Math.min(len, legKm || 0));
    const t = km / len;
    const outbound = (legDir || 0) === 0;
    const [lon, lat] = slerp(BASE, route, t);
    const here = { lon, lat };
    const target = outbound ? route : BASE;
    // Près du point d'arrivée le cap devient instable : on le prend en amont.
    const ref = outbound
      ? (t > 0.999 ? slerp(BASE, route, 0.999) : null)
      : (t < 0.001 ? slerp(BASE, route, 0.001) : null);
    const heading = bearing(ref ? { lon: ref[0], lat: ref[1] } : here, target);
    return {
      route, from: outbound ? BASE : route, to: target,
      lon, lat, heading, t, legKm: km, legDir: outbound ? 0 : 1,
      outbound,
      kmToNext: Math.round(outbound ? len - km : km),
      kmRound: len * 2,
    };
  }

  /** Situation de vol du joueur. */
  function geo(player) {
    const r = active(player);
    return geoAt(r.id, player ? player.legKm : 0, player ? player.legDir : 0);
  }

  /**
   * Points de relevé météo le long d'une route (LFPG → ville, bornes incluses).
   * Toujours le même nombre pour une route donnée, pour que l'ordre des
   * coordonnées envoyées à Open-Meteo corresponde à l'interpolation.
   */
  function samplePoints(routeId) {
    const route = BY_ID[routeId] || BY_ID[DEFAULT_ROUTE];
    const n = route.samples;
    const pts = [];
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const [lon, lat] = slerp(BASE, route, t);
      pts.push({
        name: i === 0 ? BASE.city : (i === n - 1 ? route.city : 'en route ' + i),
        lon, lat, t,
      });
    }
    return pts;
  }

  /** Tracé de la route pour la carte : liste de [lon, lat]. */
  function path(routeId, steps) {
    const route = BY_ID[routeId] || BY_ID[DEFAULT_ROUTE];
    const n = Math.max(8, steps || Math.min(96, Math.round(route.km / 120) + 8));
    const pts = [];
    for (let i = 0; i <= n; i++) pts.push(slerp(BASE, route, i / n));
    return pts;
  }

  /* ------------------------------------------------------------
     Avance de l'avion
     ------------------------------------------------------------ */

  /**
   * Fait avancer le joueur de `km` le long de sa route, aller-retour compris.
   * Modifie player.legKm / legDir / currentRoute / pendingRoute.
   * Retourne les événements rencontrés :
   *   { arrivals: ['New York', …], baseTouches: n, switched: 'kjfk'|null }
   * `arrivals` peut contenir plusieurs fois la même ville (plusieurs A/R).
   */
  function advance(player, km) {
    const ev = { arrivals: [], baseTouches: 0, switched: null };
    if (!player) return ev;
    if (typeof player.legKm !== 'number' || !isFinite(player.legKm)) player.legKm = 0;
    if (player.legDir !== 1) player.legDir = 0;

    let rest = Number(km) || 0;
    if (rest <= 0) return ev;

    let guard = 0;
    while (rest > 1e-9 && guard++ < 100000) {
      const len = active(player).km || 1;
      if (player.legKm > len) player.legKm = len;   // route raccourcie entre-temps
      const remainingLeg = player.legDir === 0 ? len - player.legKm : player.legKm;

      if (rest < remainingLeg) {
        player.legKm += (player.legDir === 0 ? rest : -rest);
        rest = 0;
        break;
      }

      rest -= remainingLeg;
      if (player.legDir === 0) {
        // Arrivée à destination : on note la visite et on fait demi-tour.
        player.legKm = len;
        player.legDir = 1;
        ev.arrivals.push(active(player).city);
      } else {
        // Verticale LFPG : seul moment où un changement de route s'applique.
        player.legKm = 0;
        player.legDir = 0;
        ev.baseTouches++;
        if (player.pendingRoute && player.pendingRoute !== player.currentRoute
            && BY_ID[player.pendingRoute]) {
          player.currentRoute = player.pendingRoute;
          ev.switched = player.currentRoute;
        }
        player.pendingRoute = null;
      }
    }
    return ev;
  }

  /** Remise à zéro après un crash : on redécolle de LFPG, route conservée. */
  function resetToBase(player) {
    if (!player) return;
    player.legKm = 0;
    player.legDir = 0;
    player.pendingRoute = null;
  }

  /* ------------------------------------------------------------
     Divers
     ------------------------------------------------------------ */

  function totalCost() { return CATALOG.reduce((s, r) => s + r.cost, 0); }

  /** Nombre de régions dont au moins une ville a été visitée. */
  function regionsVisited(player) {
    const set = {};
    CATALOG.forEach(r => { if (hasVisited(player, r.city)) set[r.region] = true; });
    return Object.keys(set).length;
  }

  return {
    BASE, REGIONS, DEFAULT_ROUTE,
    all, byId, byCity, byRegion, cities,
    active, pending, isOwned, owned, hasVisited, regionsVisited,
    geo, geoAt, samplePoints, path,
    advance, resetToBase, totalCost,
    haversine, slerp, bearing,
  };
})();
