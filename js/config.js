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

  // Entrées du journal qui ne sont PAS des séances : événements de jeu
  // (succès réclamé, escale découverte, roue de la chance). Elles
  // n'entretiennent pas la série 🔥 et ne comptent pas dans les
  // statistiques sportives — sinon on « ferait du sport » en atterrissant.
  META_ENTRIES: {
    achievement: { icon: '🏆', name: 'Succès réclamé' },
    discovery:   { icon: '🛬', name: 'Escale découverte' },
    wheel:       { icon: '🎡', name: 'Roue de la chance' },
  },

  // --- Roue de la chance 🎡 ---
  // Un tour par jour calendaire (remise à zéro à minuit).
  // La somme des poids fait 100 : chaque poids EST le pourcentage de chance.
  // Équilibrage : espérance ≈ 214 L et ≈ 206 points par jour, soit environ
  // deux tiers d'une séance de 30 min de running. La roue récompense la
  // présence quotidienne sans jamais remplacer le sport — et le jackpot
  // (3 %) tombe en moyenne une fois par mois.
  WHEEL: {
    SPIN_MS: 5200,          // durée de l'animation de rotation
    TURNS: 6,               // tours complets avant de ralentir
    PRIZES: [
      { id: 'kero_s',  icon: '⛽', label: '150 L',   kero: 150,  points: 0,    weight: 22, color: '#f5b041' },
      { id: 'pts_m',   icon: '★',  label: '250 pts', kero: 0,    points: 250,  weight: 14, color: '#2e86de' },
      { id: 'kero_l',  icon: '⛽', label: '600 L',   kero: 600,  points: 0,    weight: 10, color: '#d35400' },
      { id: 'pts_s',   icon: '★',  label: '100 pts', kero: 0,    points: 100,  weight: 20, color: '#5dade2' },
      { id: 'jackpot', icon: '💎', label: 'JACKPOT', kero: 1500, points: 2500, weight: 3,  color: '#f1c40f',
        jackpot: true },
      { id: 'kero_m',  icon: '⛽', label: '300 L',   kero: 300,  points: 0,    weight: 16, color: '#e67e22' },
      { id: 'pts_l',   icon: '★',  label: '600 pts', kero: 0,    points: 600,  weight: 8,  color: '#1b6ca8' },
      { id: 'combo',   icon: '🎁', label: '400 L + 400 pts', kero: 400, points: 400, weight: 7, color: '#8e44ad' },
    ],
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

  // --- Grades de pilote 🎫 (v2.8) ---
  // Un grade se gagne quand LES DEUX conditions sont remplies : assez
  // d'heures de vol (dérivées des km à vie) ET assez de trajets terminés.
  // Voler beaucoup sur une même ligne ne suffit donc pas : il faut aussi
  // ouvrir des routes et se poser.
  GRADE_REF_SPEED: 800,      // km/h de référence pour convertir les km en heures
  GRADES: [
    { id: 'eleve',      name: 'Élève-pilote',           icon: '🎓', hours: 0,    trips: 0 },
    { id: 'prive',      name: 'Pilote privé',           icon: '🛩️', hours: 10,   trips: 2 },
    { id: 'copi_jr',    name: 'Copilote junior',        icon: '🧑‍✈️', hours: 50,   trips: 10 },
    { id: 'copi_conf',  name: 'Copilote confirmé',      icon: '✈️', hours: 150,  trips: 30 },
    { id: 'cdb',        name: 'Commandant de bord',     icon: '🎖️', hours: 400,  trips: 75 },
    { id: 'instructeur',name: 'Commandant instructeur', icon: '🏅', hours: 1000, trips: 150 },
    { id: 'chef',       name: 'Chef pilote',            icon: '👑', hours: 2500, trips: 300 },
    { id: 'legende',    name: 'Légende du ciel',        icon: '🌟', hours: 6000, trips: 600 },
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

/* ------------------------------------------------------------
   Grades de pilote 🎫 (v2.8)
   ------------------------------------------------------------ */

/** Heures de vol estimées : km à vie convertis à vitesse de référence. */
CONFIG.flightHours = function (player) {
  const km = (player && player.lifetimeKm) || 0;
  return km / CONFIG.GRADE_REF_SPEED;
};

/** Nombre de trajets terminés (arrivées à destination). */
CONFIG.tripsOf = function (player) {
  return (player && player.landings) || 0;
};

/** Index du grade actuel dans CONFIG.GRADES (le plus haut atteint). */
CONFIG.gradeIndex = function (player) {
  const h = CONFIG.flightHours(player);
  const t = CONFIG.tripsOf(player);
  let idx = 0;
  CONFIG.GRADES.forEach((g, i) => { if (h >= g.hours && t >= g.trips) idx = i; });
  return idx;
};

/** Fiche du grade actuel. */
CONFIG.gradeOf = function (player) {
  return CONFIG.GRADES[CONFIG.gradeIndex(player)];
};

/** Fiche du grade suivant, ou null si le sommet est atteint. */
CONFIG.nextGrade = function (player) {
  return CONFIG.GRADES[CONFIG.gradeIndex(player) + 1] || null;
};
