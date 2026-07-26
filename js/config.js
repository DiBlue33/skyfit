/* ============================================================
   SkyFit — Configuration & équilibrage du jeu
   ============================================================
   Équilibrage "Équilibré" :
   - ~30 min de sport/jour maintiennent l'altitude
   - Sans sport, descente au minimum en ~2,5 jours depuis le plafond
   ============================================================ */

const CONFIG = {
  // --- Altitude (en pieds) ---
  // Chaque avion a désormais SON plafond opérationnel réel (voir PLANES).
  // ALT_REF est l'altitude de référence historique : toute l'économie
  // d'altitude (montée, décroissance, altitude de départ) est exprimée en
  // proportion du plafond puis remise à l'échelle sur cette référence, afin
  // que la dynamique reste rigoureusement identique d'un avion à l'autre.
  ALT_MIN: 0,             // plancher : à 0 ft, c'est le CRASH 💥
  ALT_REF: 38000,         // référence d'équilibrage (ancien plafond unique)
  ALT_START_RATIO: 0.13,  // altitude de décollage = 13 % du plafond

  // --- Perte d'altitude ---
  // 500 ft/h sur 38 000 ft de plafond ⇒ 76 h de vol plané avant le crash.
  // Mise à l'échelle du plafond : ce délai est le même pour tous les avions.
  DECAY_FT_PER_HOUR: 500, // perte de base par heure, à ALT_REF

  // --- Kérosène ---
  // L'avion brûle automatiquement son kérosène pour monter.
  BURN_RATE_L_PER_HOUR: 600,  // litres brûlés par heure quand la réserve > 0
  CLIMB_FT_PER_LITRE: 40,     // pieds gagnés par litre brûlé, à ALT_REF
  KERO_TANK_MAX: 4000,        // capacité max de la réserve (litres)

  // --- Vitesse (km/h) ---
  // Modèle réaliste : chaque avion a sa vraie vitesse de croisière, atteinte
  // à son plafond. Plus bas, il vole à une fraction de cette croisière —
  // d'où l'intérêt de monter. (0 km/h en cas de crash, géré par le moteur.)
  CRUISE_FLOOR_RATIO: 0.35,   // part de la croisière conservée au ras du sol

  // --- Points ---
  KM_PER_POINT: 10,    // 10 km parcourus = 1 point

  // --- Séries de jours consécutifs 🔥 (streaks) ---
  // Chaque jour de suite avec au moins une séance de sport augmente
  // le rendement en kérosène. Sauter un jour remet la série à zéro.
  STREAK: {
    BONUS_PER_DAY: 0.10, // +10 % par jour de série (jour 1 = ×1,0)
    MAX_MULT: 2.0,       // plafond : ×2 (atteint au 11e jour)
  },

  // --- Météo & vents réels 🌬️ ---
  // Les vents sont récupérés sur Open-Meteo par niveau de pression et
  // appliqués selon le cap de l'avion : vent de dos = plus vite,
  // vent de face = plus lentement. Effet borné pour rester jouable.
  WEATHER: {
    ENABLED: true,
    MAX_RATIO: 0.25,     // effet max sur la vitesse : ±25 %
    HOURS_AHEAD: 48,     // horizon des prévisions affichées (J+1 / J+2)
  },

  // --- Activités sportives (litres de kérosène par minute) ---
  // Rendements calés sur l'intensité de l'effort
  ACTIVITIES: [
    { id: 'running',    name: 'Running',     icon: '🏃', keroPerMin: 10 },
    { id: 'musculation',name: 'Musculation', icon: '🏋️', keroPerMin: 8  },
    { id: 'velo',       name: 'Vélo',        icon: '🚲', keroPerMin: 5  }, // vélo de ville (déplacements)
    { id: 'natation',   name: 'Natation',    icon: '🏊', keroPerMin: 11 },
    { id: 'padel',      name: 'Padel',       icon: '🏓', keroPerMin: 7  },
    { id: 'tennis',     name: 'Tennis',      icon: '🎾', keroPerMin: 8  },
    { id: 'pilates',    name: 'Pilates',     icon: '🤸', keroPerMin: 8  }, // aussi intense que la muscu (validé par Jade)
    { id: 'yoga',       name: 'Yoga',        icon: '🧘', keroPerMin: 4  },
    // Bonus nutrition : gain fixe, une seule fois par jour
    { id: 'creatine',   name: 'Créatine',    icon: '💊', img: 'assets/icons/creatine.png',
      fixed: true, keroBonus: 50, oncePerDay: true },
  ],

  // Anciennes activités retirées (affichage du journal historique)
  LEGACY_ACTIVITIES: {
    randonnee: { icon: '🥾', name: 'Randonnée' },
    autre:     { icon: '💪', name: 'Autre sport' },
  },

  // --- Boutique : avions ---
  // cruise  : vitesse de croisière réelle (km/h vraie, atteinte au plafond)
  // ceiling : plafond opérationnel réel (ft)
  // width   : largeur d'affichage à l'écran (en vw, bornée en px)
  // Les valeurs restent dans l'enveloppe de vol réelle de chaque appareil,
  // choisies en haut de fourchette pour que la boutique reste croissante.
  PLANES: [
    { id: 'cessna',    name: 'Cessna 172',        cost: 0,      cruise: 226,  ceiling: 14000, width: 13,
      desc: "L'avion-école des premiers décollages.",
      prop: { left: 94.22, top: 14.18, width: 5.78, height: 67.38 } },
    { id: 'tbm700',    name: 'TBM 700',           cost: 500,    cruise: 555,  ceiling: 31000, width: 14,
      desc: 'Turbopropulseur pressurisé, deux fois plus rapide que le Cessna.',
      // Hélice animée : position/taille de l'overlay en % du sprite
      prop: { left: 90.96, top: 37.91, width: 9.3, height: 62.75 } },
    { id: 'a220',      name: 'Airbus A220',       cost: 2000,   cruise: 828,  ceiling: 41000, width: 19,
      desc: 'Le premier vrai jet du parc : la haute altitude s\'ouvre enfin.' },
    { id: 'b737',      name: 'Boeing 737',        cost: 6000,   cruise: 842,  ceiling: 41000, width: 20,
      desc: 'Le best-seller du ciel, valeur sûre du moyen-courrier.' },
    { id: 'a320',      name: 'Airbus A320',       cost: 15000,  cruise: 850,  ceiling: 39800, width: 21,
      desc: 'La ligne majeure européenne, un cran au-dessus du 737.' },
    { id: 'a330',      name: 'Airbus A330',       cost: 25000,  cruise: 880,  ceiling: 41100, width: 23,
      desc: 'Long-courrier élégant, taillé pour les traversées.' },
    { id: 'falcon900', name: 'Falcon 900',        cost: 40000,  cruise: 900,  ceiling: 51000, width: 17,
      desc: 'Jet d\'affaires : le plus haut plafond du parc, hors Concorde.' },
    { id: 'a380',      name: 'Airbus A380',       cost: 80000,  cruise: 920,  ceiling: 43000, width: 25,
      desc: 'Le géant des airs, et la croisière subsonique la plus rapide.' },
    { id: 'concorde',  name: 'Concorde',          cost: 180000, cruise: 2150, ceiling: 60000, width: 26,
      desc: 'Supersonique mythique. Mach 2, hors catégorie.' },
  ],

  // --- Boutique : améliorations à niveaux ---
  UPGRADES: [
    {
      id: 'yield', name: 'Rendement kérosène', icon: '⛽',
      desc: '+15 % de kérosène gagné par séance, par niveau.',
      maxLevel: 5, baseCost: 500, costMult: 2.2, effectPerLevel: 0.15,
    },
    {
      id: 'aero', name: 'Aérodynamisme', icon: '🪽',
      desc: '-10 % de perte d\'altitude, par niveau.',
      maxLevel: 5, baseCost: 600, costMult: 2.2, effectPerLevel: 0.10,
    },
    {
      id: 'tank', name: 'Réservoir agrandi', icon: '🛢️',
      desc: '+1 000 L de capacité de réserve, par niveau.',
      maxLevel: 4, baseCost: 400, costMult: 2.0, effectPerLevel: 1000,
    },
  ],

  // --- Boutique : décors ---
  DECORS: [
    { id: 'day',    name: 'Ciel de jour',      cost: 0 },
    { id: 'sunset', name: 'Coucher de soleil', cost: 1500 },
    { id: 'night',  name: 'Nuit étoilée',      cost: 3000 },
    { id: 'aurora', name: 'Aurore boréale',    cost: 8000 },
  ],

  // --- Simulation ---
  SIM_STEP_S: 60,            // pas de simulation hors-ligne (secondes)
  MAX_OFFLINE_DAYS: 60,      // au-delà, on plafonne la simulation
  TICK_MS: 1000,             // tick temps réel (1 s)

  SAVE_KEY: 'skyfit_save_v1',
};

/* ------------------------------------------------------------
   Modèle de vol : tout part de l'avion piloté
   ------------------------------------------------------------ */

/** Fiche de l'avion, avec repli sur le Cessna si l'id est inconnu. */
CONFIG.planeById = function (id) {
  return CONFIG.PLANES.find(pl => pl.id === id) || CONFIG.PLANES[0];
};

/** Fiche de l'avion actuellement piloté par ce joueur. */
CONFIG.planeOf = function (player) {
  return CONFIG.planeById(player && player.currentPlane);
};

/** Plafond opérationnel (ft) de l'avion piloté. */
CONFIG.ceilingFor = function (player) {
  return CONFIG.planeOf(player).ceiling;
};

/**
 * Vitesse air (km/h) à une altitude donnée pour un avion donné.
 * Au plafond → 100 % de la croisière ; au sol → CRUISE_FLOOR_RATIO.
 * `plane` peut être une fiche d'avion ou directement un joueur.
 */
CONFIG.speedAt = function (altFt, planeOrPlayer) {
  const plane = planeOrPlayer && planeOrPlayer.cruise
    ? planeOrPlayer
    : CONFIG.planeOf(planeOrPlayer);
  const t = Math.max(0, Math.min(1, altFt / plane.ceiling));
  const floor = CONFIG.CRUISE_FLOOR_RATIO;
  return plane.cruise * (floor + (1 - floor) * t);
};

/** Perte d'altitude de base (ft/h), proportionnelle au plafond. */
CONFIG.decayFtPerHour = function (player) {
  return CONFIG.DECAY_FT_PER_HOUR * CONFIG.ceilingFor(player) / CONFIG.ALT_REF;
};

/** Gain d'altitude par litre brûlé (ft/L), proportionnel au plafond. */
CONFIG.climbFtPerLitre = function (player) {
  return CONFIG.CLIMB_FT_PER_LITRE * CONFIG.ceilingFor(player) / CONFIG.ALT_REF;
};

/** Altitude de remise en vol après un crash (ft), arrondie à la centaine. */
CONFIG.startAltFor = function (player) {
  return Math.round(CONFIG.ceilingFor(player) * CONFIG.ALT_START_RATIO / 100) * 100;
};
