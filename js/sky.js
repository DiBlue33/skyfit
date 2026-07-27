/* ============================================================
   SkyFit — Ciel dynamique (v3.1)
   ============================================================
   Le décor ne s'achète plus : il se DÉDUIT de la situation réelle de
   l'avion. Quatre entrées, toutes déjà disponibles sans une seule
   requête réseau supplémentaire :

     1. la position (Routes.geo) → hauteur du soleil + biome survolé
     2. l'heure courante          → hauteur du soleil
     3. l'altitude                → assombrissement vers la stratosphère
     4. la météo en cache         → couverture, pluie, orages

   Tout ce module est PUR et défensif : `state()` ne lève jamais, même
   sans position, sans météo et avec une altitude aberrante. C'est
   indispensable car il tourne à chaque rafraîchissement du HUD.
   ============================================================ */

const Sky = (() => {

  const DEG = Math.PI / 180;

  /* ------------------------------------------------------------
     1. Hauteur du soleil — algorithme NOAA simplifié
     ------------------------------------------------------------
     Précision de l'ordre du demi-degré, très largement suffisante :
     on s'en sert pour choisir une couleur, pas pour naviguer.
     Aucune dépendance externe, aucun appel réseau.
     ------------------------------------------------------------ */

  /** Jour julien depuis J2000.0, en jours fractionnaires. */
  function julianDays(ms) {
    return ms / 86400000 - 10957.5;   // 10957.5 j entre 1970-01-01 et J2000.0
  }

  /**
   * Hauteur du soleil au-dessus de l'horizon, en degrés.
   * Négatif = sous l'horizon (crépuscule puis nuit).
   * @param {number} lat latitude en degrés
   * @param {number} lon longitude en degrés (est positif)
   * @param {number} ms  instant, en millisecondes epoch
   */
  function solarElevation(lat, lon, ms) {
    if (!isFinite(lat) || !isFinite(lon) || !isFinite(ms)) return 0;
    const d = julianDays(ms);

    // Position du Soleil sur l'écliptique
    const g = (357.529 + 0.98560028 * d) * DEG;            // anomalie moyenne
    const q = (280.459 + 0.98564736 * d) * DEG;            // longitude moyenne
    const L = q + (1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * DEG;
    const e = (23.439 - 0.00000036 * d) * DEG;             // obliquité

    // Déclinaison et ascension droite
    const sinDec = Math.sin(e) * Math.sin(L);
    const dec = Math.asin(sinDec);
    let ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));  // radians

    // Temps sidéral de Greenwich → angle horaire local
    let gmst = 18.697374558 + 24.06570982441908 * d;              // heures
    gmst = ((gmst % 24) + 24) % 24;
    const lst = gmst * 15 * DEG + lon * DEG;                      // radians
    let H = lst - ra;
    // Ramener dans [-π, π] pour éviter les sauts aux bords
    H = Math.atan2(Math.sin(H), Math.cos(H));

    const phi = lat * DEG;
    const sinAlt = Math.sin(phi) * Math.sin(dec) +
                   Math.cos(phi) * Math.cos(dec) * Math.cos(H);
    return Math.asin(Math.max(-1, Math.min(1, sinAlt))) / DEG;
  }

  /**
   * Heure solaire locale (0–24) : midi = soleil au méridien.
   * Sert à distinguer le soleil de minuit de la nuit polaire, qui ont
   * la même hauteur solaire mais pas du tout le même sens.
   */
  function solarHour(lon, ms) {
    if (!isFinite(lon) || !isFinite(ms)) return 12;
    const utcH = (ms / 3600000) % 24;
    const h = utcH + lon / 15;
    return ((h % 24) + 24) % 24;
  }

  /* ------------------------------------------------------------
     2. Palette du ciel selon la hauteur du soleil
     ------------------------------------------------------------
     Une table de paliers interpolée en RVB. Les seuils suivent les
     définitions aéronautiques réelles : -18° nuit noire, -12° aube
     astronomique, -6° aube nautique, -0.833° lever/coucher officiel
     (réfraction comprise).
     ------------------------------------------------------------ */

  const SUN_STOPS = [
    { e: -90,    top: '#03060f', bot: '#080e1f', cloud: '#46567a', star: 1.00, key: 'nuit' },
    { e: -18,    top: '#040814', bot: '#0b1428', cloud: '#4e5f85', star: 1.00, key: 'nuit' },
    { e: -12,    top: '#071129', bot: '#152242', cloud: '#63769e', star: 0.80, key: 'aube_astro' },
    { e:  -6,    top: '#101f45', bot: '#31406d', cloud: '#8593b8', star: 0.40, key: 'aube_nautique' },
    { e:  -3,    top: '#1d2f5c', bot: '#5d4f7e', cloud: '#a894b6', star: 0.18, key: 'crepuscule' },
    { e:  -0.833,top: '#2f4276', bot: '#b06a72', cloud: '#e0a9a2', star: 0.06, key: 'crepuscule' },
    { e:   1,    top: '#3d5288', bot: '#ff9d5c', cloud: '#ffc9a0', star: 0.00, key: 'lever' },
    { e:   4,    top: '#5578ad', bot: '#ffc078', cloud: '#ffe0bd', star: 0.00, key: 'dore' },
    { e:   9,    top: '#4f92d4', bot: '#e2eefb', cloud: '#ffffff', star: 0.00, key: 'matin' },
    { e:  20,    top: '#4aa3e8', bot: '#bfe3ff', cloud: '#ffffff', star: 0.00, key: 'jour' },
    { e:  90,    top: '#3f9ae6', bot: '#cfe9ff', cloud: '#ffffff', star: 0.00, key: 'jour' },
  ];

  function hexToRgb(h) {
    const n = parseInt(h.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgbToHex(c) {
    const b = (v) => Math.max(0, Math.min(255, Math.round(v)));
    return '#' + ((1 << 24) + (b(c[0]) << 16) + (b(c[1]) << 8) + b(c[2]))
      .toString(16).slice(1);
  }
  function mixHex(a, b, t) {
    const A = hexToRgb(a), B = hexToRgb(b);
    return rgbToHex([A[0] + (B[0] - A[0]) * t,
                     A[1] + (B[1] - A[1]) * t,
                     A[2] + (B[2] - A[2]) * t]);
  }
  function clamp01(x) { return Math.max(0, Math.min(1, x)); }

  /** Interpole la palette pour une hauteur de soleil donnée. */
  function palette(elev) {
    const e = isFinite(elev) ? Math.max(-90, Math.min(90, elev)) : 20;
    let i = 0;
    while (i < SUN_STOPS.length - 2 && SUN_STOPS[i + 1].e < e) i++;
    const a = SUN_STOPS[i], b = SUN_STOPS[i + 1];
    const span = b.e - a.e;
    const t = span > 0 ? clamp01((e - a.e) / span) : 0;
    return {
      top:   mixHex(a.top, b.top, t),
      bottom: mixHex(a.bot, b.bot, t),
      cloud: mixHex(a.cloud, b.cloud, t),
      stars: a.star + (b.star - a.star) * t,
      key: t < 0.5 ? a.key : b.key,
    };
  }

  /* Libellés lisibles, pour le HUD et le panneau météo. */
  const PHASE_NAMES = {
    nuit:          { name: 'Nuit',                icon: '🌙' },
    aube_astro:    { name: 'Aube astronomique',   icon: '🌌' },
    aube_nautique: { name: 'Aube nautique',       icon: '🌒' },
    crepuscule:    { name: 'Crépuscule',          icon: '🌆' },
    lever:         { name: 'Lever / coucher',     icon: '🌅' },
    dore:          { name: 'Heure dorée',         icon: '🌇' },
    matin:         { name: 'Plein jour',          icon: '🌤️' },
    jour:          { name: 'Plein jour',          icon: '☀️' },
  };

  /* ------------------------------------------------------------
     3. Biome survolé
     ------------------------------------------------------------
     Modèle grossier volontaire : une liste de boîtes lon/lat, premier
     match gagnant, océan par défaut. Il ne s'agit pas de cartographie
     mais de teinter l'horizon de façon plausible sous l'avion. Les
     boîtes spécifiques (massifs) passent AVANT les boîtes générales.
     ------------------------------------------------------------ */

  const BIOMES = {
    ocean:    { name: 'Océan',           icon: '🌊', horizon: '#1f5f8b' },
    banquise: { name: 'Banquise',        icon: '🧊', horizon: '#cfe6f2' },
    toundra:  { name: 'Toundra',         icon: '🌫️', horizon: '#7f8f8a' },
    taiga:    { name: 'Forêt boréale',   icon: '🌲', horizon: '#2f5145' },
    montagne: { name: 'Montagnes',       icon: '🏔️', horizon: '#7d8a99' },
    plaine:   { name: 'Plaines',         icon: '🌾', horizon: '#5d7a4a' },
    desert:   { name: 'Désert',          icon: '🏜️', horizon: '#c9a061' },
    savane:   { name: 'Savane',          icon: '🦁', horizon: '#a08b45' },
    jungle:   { name: 'Forêt tropicale', icon: '🌴', horizon: '#2f6b3a' },
  };

  // [lonMin, lonMax, latMin, latMax, biome]
  const BOXES = [
    // --- Îles et massifs, en premier : ils débordent des ensembles généraux ---
    [ -25,  -13,  62,  67, 'toundra'],    // Islande (AVANT le Groenland, qui déborde)
    [ 5.8,   16,  44,  48, 'montagne'],   // Alpes (Lyon, à 5,08°, reste en plaine)
    [  -8,    3,  42,43.3, 'montagne'],   // Pyrénées (Toulouse et Biarritz restent en plaine)
    [  72,  100,  30,  40, 'montagne'],   // Himalaya / Tibet (Delhi à 28,6° reste en plaine)
    [-122, -105,  35,  55, 'montagne'],   // Rocheuses
    [ -80,  -65, -40,   2, 'montagne'],   // Andes
    [  36,   48,  36,  44, 'montagne'],   // Caucase
    [ 165,  179, -47, -34, 'montagne'],   // Nouvelle-Zélande

    // --- Zones froides ---
    /* Groenland : le cap Farvel est à 59,8° N, mais la calotte ne commence
       vraiment que vers 62°. Une borne basse à 59° faisait passer pour de
       la banquise l'Atlantique ouvert au sud de l'Islande, que traversent
       toutes les routes vers la côte ouest américaine. */
    [ -55,  -20,  62,  84, 'banquise'],   // Groenland
    [   4,   32,  58,  71, 'taiga'],      // Scandinavie (Stockholm à 59,7°)
    [  32,  180,  58,  78, 'taiga'],      // Sibérie
    [-141,  -55,  50,  72, 'taiga'],      // Canada boréal
    [-170, -141,  55,  72, 'toundra'],    // Alaska

    // --- Zones tempérées ---
    [ -10,   40,  34,  58, 'plaine'],     // Europe (Alger à 36,7° incluse)
    [  40,  100,  45,  58, 'plaine'],     // Steppes russes
    [ 100,  122,  22,  45, 'plaine'],     // Chine de l'Est (Hong Kong à 22,3°)
    [ 129,  146,  30,  46, 'plaine'],     // Japon
    [-100,  -60,  25,  50, 'plaine'],     // Amérique du Nord de l'Est
    [ -65,  -40, -38, -15, 'plaine'],     // Pampa / Sud brésilien
    [ 145,  154, -39, -11, 'plaine'],     // Côte est australienne (Sydney)

    // --- Zones arides ---
    [ -17,   35,  18,  34, 'desert'],     // Sahara (Casablanca à 33,4°)
    [  35,   60,  15,  38, 'desert'],     // Arabie / Moyen-Orient
    [  46,   75,  25,  45, 'desert'],     // Iran / Asie centrale
    [-125, -114,  32,  42, 'desert'],     // Mojave / Californie du Sud (Los Angeles)
    [-118,  -95,  17,  35, 'desert'],     // Mexique (Mexico à 19,4°)
    [ 113,  145, -32, -18, 'desert'],     // Outback australien
    [  12,   25, -30, -17, 'desert'],     // Namib / Kalahari

    // --- Zones chaudes ---
    [ -18,   35,   5,  18, 'savane'],     // Sahel (Dakar)
    [  20,   42, -35,   5, 'savane'],     // Afrique australe (Johannesburg à -26,1°)
    [   8,   30, -10,   6, 'jungle'],     // Bassin du Congo
    [  68,   92,   8,  30, 'jungle'],     // Inde (Delhi, Bombay)
    [  92,  122,  -9,  22, 'jungle'],     // Asie du Sud-Est (Bangkok, Singapour)
    [ -78,  -45, -16,   6, 'jungle'],     // Amazonie
    [ -95,  -76,   7,  19, 'jungle'],     // Amérique centrale
    [ -50,  -34, -16,  -2, 'savane'],     // Cerrado brésilien
  ];

  /** Biome survolé, océan par défaut. Ne lève jamais. */
  function biomeAt(lon, lat) {
    if (!isFinite(lon) || !isFinite(lat)) return 'ocean';
    // Ramener la longitude dans [-180, 180]
    let x = ((((lon + 180) % 360) + 360) % 360) - 180;
    const y = Math.max(-90, Math.min(90, lat));
    if (y >= 72 || y <= -60) return 'banquise';   // calottes polaires
    for (let i = 0; i < BOXES.length; i++) {
      const b = BOXES[i];
      if (x >= b[0] && x <= b[1] && y >= b[2] && y <= b[3]) return b[4];
    }
    return 'ocean';
  }

  /* ------------------------------------------------------------
     4. Phénomènes rares
     ------------------------------------------------------------
     Ils remplacent les anciens décors payants : on ne les achète plus,
     on les OBSERVE en volant au bon endroit au bon moment. Chaque
     phénomène est donc une raison concrète d'ouvrir telle route.
     ------------------------------------------------------------ */

  const PHENOMENA = [
    {
      id: 'aurore', name: 'Aurore boréale', icon: '🌌',
      hint: 'Voler au nord du 55ᵉ parallèle en pleine nuit (Reykjavik, Stockholm, Moscou).',
      kero: 900, points: 700,
      test: (c) => Math.abs(c.lat) >= 55 && c.solarElev < -6 && c.cloud < 70,
    },
    /* ⚠️ Pas de « soleil de minuit » ni de « nuit polaire » au sens strict :
       ils exigent de dépasser le cercle polaire (66,56°) et la destination
       la plus septentrionale du jeu est Reykjavik, à 63,99°. Vérifié par le
       calcul : à minuit solaire le 21 juin le soleil y est encore à -2,6°.
       On célèbre donc les phénomènes RÉELLEMENT atteignables sur le réseau. */
    {
      id: 'nuit_blanche', name: 'Nuit blanche', icon: '🌝',
      hint: 'Être à Reykjavik ou Stockholm en pleine nuit d\'été : il ne fait jamais vraiment noir.',
      kero: 1200, points: 1100,
      test: (c) => Math.abs(c.lat) >= 58 && c.solarElev > -8 &&
                   (c.solarHour >= 22 || c.solarHour <= 2),
    },
    {
      id: 'soleil_rasant', name: 'Soleil rasant', icon: '🌗',
      hint: 'Survoler le grand nord en plein midi d\'hiver : le soleil peine à quitter l\'horizon.',
      kero: 1200, points: 1100,
      test: (c) => Math.abs(c.lat) >= 58 && c.solarElev < 8 && c.solarElev > -4 &&
                   c.solarHour >= 10 && c.solarHour <= 14,
    },
    {
      id: 'mer_nuages', name: 'Mer de nuages', icon: '☁️',
      hint: 'Voler au-dessus de 25 000 ft avec une couverture nuageuse quasi totale sous l\'avion.',
      kero: 500, points: 400,
      test: (c) => c.altitude >= 25000 && c.cloud >= 85,
    },
    {
      id: 'orage_dessous', name: 'Orage vu d\'en haut', icon: '⛈️',
      hint: 'Dominer une cellule orageuse depuis la haute altitude (au-dessus de 28 000 ft).',
      kero: 1000, points: 900,
      test: (c) => c.altitude >= 28000 && c.code >= 95,
    },
    {
      id: 'voie_lactee', name: 'Voie lactée', icon: '✨',
      hint: 'Nuit noire, ciel dégagé, au-dessus de l\'océan : aucune lumière à des centaines de kilomètres.',
      kero: 800, points: 650,
      test: (c) => c.solarElev < -18 && c.cloud < 20 && c.biome === 'ocean',
    },
    {
      id: 'stratosphere', name: 'Ciel noir de stratosphère', icon: '🛰️',
      hint: 'Monter au-dessus de 45 000 ft en plein jour : le bleu vire au noir.',
      kero: 1500, points: 1400,
      test: (c) => c.altitude >= 45000 && c.solarElev > 5,
    },
    {
      id: 'banquise', name: 'Survol de la banquise', icon: '🧊',
      hint: 'Passer au-dessus du Groenland ou d\'une calotte polaire en plein jour.',
      kero: 700, points: 600,
      test: (c) => c.biome === 'banquise' && c.solarElev > 0,
    },
    {
      id: 'desert_couchant', name: 'Désert au couchant', icon: '🏜️',
      hint: 'Survoler le Sahara, l\'Arabie ou l\'Outback pile à l\'heure dorée.',
      kero: 700, points: 600,
      test: (c) => c.biome === 'desert' && c.solarElev > -3 && c.solarElev < 6,
    },
  ];

  function phenomenonById(id) {
    return PHENOMENA.find(p => p.id === id) || null;
  }

  /* ------------------------------------------------------------
     5. État complet du ciel
     ------------------------------------------------------------ */

  /**
   * Calcule l'état visuel du ciel. Ne lève JAMAIS : toute entrée
   * manquante ou aberrante retombe sur un plein jour à 20°.
   *
   * @param {object} o { lat, lon, altitude, ceiling, now, cloud, precip, code }
   * @returns {object} état complet, prêt à être appliqué par Scene
   */
  function state(o) {
    o = o || {};
    const now = isFinite(o.now) ? o.now : Date.now();
    const lat = isFinite(o.lat) ? o.lat : 48.86;    // défaut : Paris
    const lon = isFinite(o.lon) ? o.lon : 2.35;
    const altitude = isFinite(o.altitude) ? Math.max(0, Math.min(90000, o.altitude)) : 0;
    const cloud = isFinite(o.cloud) ? Math.max(0, Math.min(100, o.cloud)) : 0;
    const code = isFinite(o.code) ? o.code : 0;

    const solarElev = solarElevation(lat, lon, now);
    const sHour = solarHour(lon, now);
    const pal = palette(solarElev);
    const biome = biomeAt(lon, lat);

    /* Assombrissement stratosphérique : au-delà de 25 000 ft le ciel
       perd son bleu diffusé et tire vers le noir. À 55 000 ft (domaine
       du Concorde) il est presque spatial. C'est physiquement vrai, et
       surtout ça récompense visuellement la montée, qui EST la boucle
       de jeu. On n'assombrit pas la nuit : elle est déjà noire. */
    const dayness = clamp01((solarElev + 6) / 12);
    const high = clamp01((altitude - 25000) / 30000) * dayness;
    const top = mixHex(pal.top, '#020512', high * 0.75);
    const bottom = mixHex(pal.bottom, '#0a1c3a', high * 0.45);

    /* En altitude les étoiles réapparaissent même de jour. */
    const stars = clamp01(Math.max(pal.stars, high * 0.55));

    /* L'aurore n'est plus un décor acheté : c'est une condition de vol. */
    const auroraLat = clamp01((Math.abs(lat) - 52) / 12);
    const auroraNight = clamp01((-solarElev - 4) / 8);
    const aurora = clamp01(auroraLat * auroraNight * (1 - cloud / 140));

    const ctx = { lat, lon, altitude, solarElev, solarHour: sHour,
                  cloud, code, biome };
    const phenomena = PHENOMENA.filter(p => {
      try { return !!p.test(ctx); } catch (e) { return false; }
    }).map(p => p.id);

    const ph = PHASE_NAMES[pal.key] || PHASE_NAMES.jour;

    return {
      top, bottom, cloudColor: pal.cloud, stars, aurora,
      solarElev: Math.round(solarElev * 10) / 10,
      solarHour: Math.round(sHour * 10) / 10,
      phase: pal.key, phaseName: ph.name, phaseIcon: ph.icon,
      isNight: solarElev < -0.833,
      biome, biomeName: BIOMES[biome].name, biomeIcon: BIOMES[biome].icon,
      horizon: BIOMES[biome].horizon,
      /* Position du soleil sur l'écran, en % : il monte avec sa hauteur
         réelle et se cache sous l'horizon la nuit. */
      sunY: 88 - clamp01((solarElev + 6) / 66) * 76,
      sunVisible: solarElev > -6,
      moonVisible: solarElev < -4,
      highAltitude: high,
      phenomena,
    };
  }

  /** État du ciel pour un joueur donné, à partir de sa route et de la météo. */
  function forPlayer(player, ts) {
    const now = isFinite(ts) ? ts : Date.now();
    let lat, lon, geo = null;
    try {
      if (typeof Routes !== 'undefined') geo = Routes.geo(player);
      if (geo) { lat = geo.lat; lon = geo.lon; }
    } catch (e) { /* route inconnue : on retombe sur Paris */ }

    /* `conditionsAt` a besoin de la situation de vol COMPLÈTE (route et
       avancement) pour interpoler entre deux points de relevé — pas
       seulement des coordonnées. Sans cache, il répond ok:false. */
    let cloud = 0, precip = 0, code = 0;
    try {
      if (typeof Weather !== 'undefined' && Weather.conditionsAt && geo) {
        const c = Weather.conditionsAt(geo, now);
        if (c && c.ok) {
          cloud = isFinite(c.cloud) ? c.cloud : 0;
          precip = isFinite(c.precip) ? c.precip : 0;
          code = isFinite(c.code) ? c.code : 0;
        }
      }
    } catch (e) { /* cache météo vide : ciel clair */ }

    return state({
      lat, lon, now, cloud, precip, code,
      altitude: player ? player.altitude : 0,
    });
  }

  /* ------------------------------------------------------------
     6. Observation : un phénomène vu devient une découverte
     ------------------------------------------------------------
     Même logique que les premières visites de ville : la première fois
     seulement, on crédite et on trace dans le journal partagé pour que
     l'autre pilote le voie.
     ------------------------------------------------------------ */

  /**
   * Enregistre les phénomènes nouvellement observés.
   * @returns {Array} les phénomènes découverts à cet instant (souvent vide)
   */
  function observe(player, skyState, ts) {
    if (!player || !skyState || !Array.isArray(skyState.phenomena)) return [];
    if (player.crashed) return [];                 // au sol, on ne voit rien
    if (!Array.isArray(player.seenPhenomena)) player.seenPhenomena = [];

    const found = [];
    skyState.phenomena.forEach(id => {
      if (player.seenPhenomena.indexOf(id) >= 0) return;
      const def = phenomenonById(id);
      if (!def) return;
      player.seenPhenomena.push(id);
      const cap = (typeof State !== 'undefined' && State.tankCapacity)
        ? State.tankCapacity(player) : CONFIG.KERO_TANK_MAX;
      player.kerosene = Math.min(cap, (player.kerosene || 0) + def.kero);
      player.bonusPoints = (player.bonusPoints || 0) + def.points;
      logPhenomenon(player, def, ts);
      found.push(def);
    });
    return found;
  }

  /** Trace l'observation dans le journal partagé. */
  function logPhenomenon(player, def, ts) {
    if (!Array.isArray(player.activityLog)) player.activityLog = [];
    player.activityLog.push({
      activityId: 'phenomenon',
      minutes: 0,
      kero: def.kero,
      points: def.points,
      date: (typeof ts === 'number' && isFinite(ts)) ? ts : Date.now(),
      loggedAt: Date.now(),
      phenomenon: def.id,
      phenomenonName: def.name,
      cityIcon: def.icon,
    });
    if (player.activityLog.length > 500) player.activityLog.shift();
  }

  return {
    state, forPlayer, observe,
    solarElevation, solarHour, biomeAt, palette,
    PHENOMENA, BIOMES, PHASE_NAMES, phenomenonById,
  };
})();
