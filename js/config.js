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

    /* --- Turbulences (v3.0.1) -------------------------------------
       ⚠️ Un vent fort NE PROVOQUE PAS de turbulences : un jet-stream
       de 250 km/h bien établi est parfaitement lisse. Ce qui secoue
       l'avion, c'est le CISAILLEMENT VERTICAL (variation du vecteur
       vent d'un niveau de pression au suivant) et la CONVECTION
       (orages, averses). L'ancien seuil « vent > 110 km/h » laissait
       donc l'avion se balancer en permanence dès qu'il montait.
       Unité du cisaillement : km/h par tranche de 1 000 ft.        */
    TURB: {
      SHEAR: [6, 12, 20],   // seuils légères / modérées / fortes
      LOW_ALT_FT: 5000,     // sous cette altitude, les rafales comptent
      LOW_WIND: [45, 70],   // légères / modérées près du sol
      CODES: {              // codes Open-Meteo → niveau de turbulence
        95: 3, 96: 3, 99: 3,             // orages
        80: 2, 81: 2, 82: 3,             // averses
        63: 1, 65: 2, 66: 2, 67: 2,      // pluie soutenue / verglaçante
      },
      LABELS: ['calme', 'légères', 'modérées', 'fortes'],
    },
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
    quest:       { icon: '🎯', name: 'Quête accomplie' },
    phenomenon:  { icon: '🌌', name: 'Phénomène observé' },
    training:    { icon: '🎓', name: 'Formation validée' },
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

  // --- Quêtes 🎯 (v3.0) ---
  // Deux familles :
  //   • CHAINS  : carrières permanentes. Une seule étape visible à la fois,
  //     récompenses croissantes. Elles tirent le joueur vers le
  //     développement (lignes, flotte, endurance, altitude, compagnie).
  //   • WEEKLY  : 3 quêtes tirées le lundi (une facile, une moyenne, une
  //     difficile), IDENTIQUES pour les deux pilotes — le tirage est
  //     déterministe à partir du lundi de la semaine. Le panneau fait donc
  //     aussi office de duel. Bonus si les trois sont bouclées.
  //
  // Équilibrage : une semaine parfaite rapporte ≈ 1 600 L et ≈ 2 000 pts,
  // soit à peine plus qu'une heure de running — les quêtes récompensent
  // l'assiduité, jamais au point de remplacer le sport.
  QUESTS: {
    // Récompense par palier de difficulté, + bonus « 3 sur 3 »
    WEEKLY_REWARD: {
      facile:    { kero: 200, points: 150 },
      moyenne:   { kero: 400, points: 400 },
      difficile: { kero: 650, points: 800 },
    },
    WEEKLY_BONUS: { kero: 350, points: 650 },

    TIERS: [
      { id: 'facile',    name: 'Facile',    color: '#2ecc71' },
      { id: 'moyenne',   name: 'Moyenne',   color: '#f39c12' },
      { id: 'difficile', name: 'Difficile', color: '#e74c3c' },
    ],

    FAMILIES: {
      sport: { icon: '🏃', name: 'Sport' },
      vol:   { icon: '✈️', name: 'Vol' },
      eco:   { icon: '💰', name: 'Compagnie' },
    },

    /* --- Carrières permanentes (chaînes) --------------------------- */
    CHAINS: [
      {
        id: 'reseau', icon: '🗺️', name: 'Réseau',
        desc: 'Étendre le réseau de lignes au départ de Paris.',
        steps: [
          { name: 'Deuxième destination', desc: 'Posséder 2 lignes au départ de LFPG.',
            metric: 'routesOwned', goal: 2, unit: 'lignes', kero: 300, points: 200 },
          { name: 'Premières escales', desc: 'Visiter 3 villes différentes.',
            metric: 'citiesVisited', goal: 3, unit: 'villes', kero: 500, points: 400 },
          { name: 'Hors de France', desc: 'Se poser dans 2 régions du monde.',
            metric: 'regionsVisited', goal: 2, unit: 'régions', kero: 800, points: 800 },
          { name: 'Long-courrier', desc: 'Ouvrir une ligne de plus de 2 000 km.',
            metric: 'longestRoute', goal: 2000, unit: 'km', kero: 1200, points: 1500 },
          { name: 'Réseau structuré', desc: 'Posséder 10 lignes.',
            metric: 'routesOwned', goal: 10, unit: 'lignes', kero: 1800, points: 3000 },
          { name: 'Tour du monde', desc: 'Visiter 20 villes différentes.',
            metric: 'citiesVisited', goal: 20, unit: 'villes', kero: 2500, points: 6000 },
          { name: 'Compagnie mondiale', desc: 'Se poser dans les 5 régions du globe.',
            metric: 'regionsVisited', goal: 5, unit: 'régions', kero: 3500, points: 12000 },
        ],
      },
      {
        id: 'flotte', icon: '✈️', name: 'Flotte',
        desc: 'Agrandir le hangar, appareil après appareil.',
        steps: [
          { name: 'Deuxième appareil', desc: 'Posséder 2 avions.',
            metric: 'planesOwned', goal: 2, unit: 'avions', kero: 400, points: 250 },
          { name: 'Passage au jet', desc: 'Posséder 3 avions.',
            metric: 'planesOwned', goal: 3, unit: 'avions', kero: 700, points: 600 },
          { name: 'Hangar garni', desc: 'Posséder 5 avions.',
            metric: 'planesOwned', goal: 5, unit: 'avions', kero: 1200, points: 1600 },
          { name: 'Flotte long-courrier', desc: 'Posséder 7 avions.',
            metric: 'planesOwned', goal: 7, unit: 'avions', kero: 2000, points: 4000 },
          { name: 'Collection complète', desc: 'Posséder les 9 appareils du hangar.',
            metric: 'planesOwned', goal: 9, unit: 'avions', kero: 3500, points: 10000 },
        ],
      },
      {
        id: 'endurance', icon: '💪', name: 'Endurance',
        desc: 'Installer une pratique sportive durable.',
        steps: [
          { name: 'Mise en route', desc: 'Enregistrer 10 séances de sport.',
            metric: 'totalSessions', goal: 10, unit: 'séances', kero: 350, points: 200 },
          { name: 'Régularité', desc: 'Tenir une série de 5 jours consécutifs.',
            metric: 'bestStreak', goal: 5, unit: 'jours', kero: 600, points: 500 },
          { name: 'Polyvalence', desc: 'Pratiquer 4 disciplines différentes.',
            metric: 'distinctSports', goal: 4, unit: 'sports', kero: 900, points: 900 },
          { name: '20 heures de sport', desc: "Cumuler 20 heures d'activité.",
            metric: 'sportHours', goal: 20, unit: 'h', kero: 1400, points: 1800 },
          { name: "Deux semaines d'affilée", desc: 'Tenir une série de 14 jours consécutifs.',
            metric: 'bestStreak', goal: 14, unit: 'jours', kero: 2000, points: 3500 },
          { name: '60 heures de sport', desc: "Cumuler 60 heures d'activité.",
            metric: 'sportHours', goal: 60, unit: 'h', kero: 2800, points: 7000 },
          { name: '150 heures de sport', desc: "Cumuler 150 heures d'activité.",
            metric: 'sportHours', goal: 150, unit: 'h', kero: 4000, points: 15000 },
        ],
      },
      {
        id: 'altitude', icon: '🛫', name: 'Altitude',
        desc: 'Repousser le plafond, palier après palier.',
        steps: [
          { name: 'Niveau de vol 150', desc: 'Atteindre 15 000 ft.',
            metric: 'maxAltitude', goal: 15000, unit: 'ft', kero: 400, points: 300 },
          { name: 'Niveau de vol 250', desc: 'Atteindre 25 000 ft.',
            metric: 'maxAltitude', goal: 25000, unit: 'ft', kero: 700, points: 700 },
          { name: 'Niveau de vol 350', desc: 'Atteindre 35 000 ft.',
            metric: 'maxAltitude', goal: 35000, unit: 'ft', kero: 1200, points: 1600 },
          { name: 'Niveau de vol 450', desc: 'Atteindre 45 000 ft.',
            metric: 'maxAltitude', goal: 45000, unit: 'ft', kero: 2000, points: 3500 },
          { name: 'Stratosphère', desc: 'Atteindre 58 000 ft (Concorde).',
            metric: 'maxAltitude', goal: 58000, unit: 'ft', kero: 3500, points: 9000 },
        ],
      },
      {
        id: 'compagnie', icon: '🏢', name: 'Compagnie',
        desc: 'Investir les points dans la structure.',
        steps: [
          { name: 'Premiers travaux', desc: "Acheter 1 niveau d'amélioration.",
            metric: 'upgradeLevels', goal: 1, unit: 'niv.', kero: 300, points: 200 },
          { name: 'Atelier actif', desc: "Cumuler 4 niveaux d'améliorations.",
            metric: 'upgradeLevels', goal: 4, unit: 'niv.', kero: 600, points: 600 },
          { name: 'Chasseur de ciels', desc: 'Observer 2 phénomènes célestes en vol.',
            metric: 'phenomenaSeen', goal: 2, unit: 'phénom.', kero: 900, points: 1000 },
          { name: 'Flotte optimisée', desc: "Cumuler 8 niveaux d'améliorations.",
            metric: 'upgradeLevels', goal: 8, unit: 'niv.', kero: 1500, points: 2200 },
          { name: 'Album céleste', desc: 'Observer 4 phénomènes célestes différents.',
            metric: 'phenomenaSeen', goal: 4, unit: 'phénom.', kero: 2200, points: 4500 },
          { name: 'Tout au maximum', desc: 'Porter les 3 améliorations à leur maximum.',
            metric: 'upgradeLevels', goal: 14, unit: 'niv.', kero: 3200, points: 9000 },
        ],
      },
    ],

    /* --- Vivier hebdomadaire --------------------------------------- */
    // Un tirage par palier (facile / moyenne / difficile), en évitant
    // deux quêtes de la même famille dans la semaine.
    WEEKLY: [
      /* ---- Facile ---- */
      { id: 'w_sess3',   family: 'sport', tier: 'facile', icon: '🏃',
        name: 'Trois séances', desc: 'Enregistrer 3 séances de sport.',
        metric: 'wSessions', goal: 3, unit: 'séances' },
      { id: 'w_min90',   family: 'sport', tier: 'facile', icon: '⏱️',
        name: 'Une heure et demie', desc: 'Cumuler 90 minutes de sport.',
        metric: 'wMinutes', goal: 90, unit: 'min' },
      { id: 'w_days2',   family: 'sport', tier: 'facile', icon: '📅',
        name: 'Deux jours actifs', desc: 'Faire du sport 2 jours différents.',
        metric: 'wDays', goal: 2, unit: 'jours' },
      { id: 'w_sports2', family: 'sport', tier: 'facile', icon: '🔀',
        name: 'Deux disciplines', desc: 'Pratiquer 2 sports différents.',
        metric: 'wSports', goal: 2, unit: 'sports' },
      { id: 'w_crea3',   family: 'sport', tier: 'facile', icon: '💊',
        name: 'Cure de créatine', desc: 'Prendre 3 doses de créatine.',
        metric: 'wCreatine', goal: 3, unit: 'doses' },
      { id: 'w_km8000',  family: 'vol',   tier: 'facile', icon: '🧭',
        name: 'Huit mille', desc: 'Parcourir 8 000 km cette semaine.',
        metric: 'wKm', goal: 8000, unit: 'km' },
      { id: 'w_base2',   family: 'vol',   tier: 'facile', icon: '🗼',
        name: 'Retour à la base', desc: 'Repasser 2 fois à la verticale de LFPG.',
        metric: 'wBase', goal: 2, unit: 'passages' },
      { id: 'w_land2',   family: 'vol',   tier: 'facile', icon: '🛬',
        name: 'Deux atterrissages', desc: 'Se poser 2 fois à destination.',
        metric: 'wLandings', goal: 2, unit: 'arrivées' },
      { id: 'w_alt60',   family: 'vol',   tier: 'facile', icon: '📈',
        name: 'Montée en croisière', desc: 'Monter à 60 % du plafond de son avion.',
        metric: 'wAltPct', goal: 60, unit: '%' },
      { id: 'w_kero1500',family: 'eco',   tier: 'facile', icon: '⛽',
        name: 'Plein partiel', desc: 'Gagner 1 500 L de kérosène.',
        metric: 'wKero', goal: 1500, unit: 'L' },
      { id: 'w_wheel3',  family: 'eco',   tier: 'facile', icon: '🎡',
        name: 'Trois tours de roue', desc: 'Lancer la roue 3 jours différents.',
        metric: 'wWheelDays', goal: 3, unit: 'jours' },
      { id: 'w_ach1',    family: 'eco',   tier: 'facile', icon: '🏆',
        name: 'Un succès de plus', desc: 'Réclamer 1 succès.',
        metric: 'wAchievements', goal: 1, unit: 'succès' },

      /* ---- Moyenne ---- */
      { id: 'w_sess5',   family: 'sport', tier: 'moyenne', icon: '🏃',
        name: 'Cinq séances', desc: 'Enregistrer 5 séances de sport.',
        metric: 'wSessions', goal: 5, unit: 'séances' },
      { id: 'w_min180',  family: 'sport', tier: 'moyenne', icon: '⏱️',
        name: 'Trois heures', desc: 'Cumuler 180 minutes de sport.',
        metric: 'wMinutes', goal: 180, unit: 'min' },
      { id: 'w_days4',   family: 'sport', tier: 'moyenne', icon: '📅',
        name: 'Quatre jours actifs', desc: 'Faire du sport 4 jours différents.',
        metric: 'wDays', goal: 4, unit: 'jours' },
      { id: 'w_sports3', family: 'sport', tier: 'moyenne', icon: '🔀',
        name: 'Trois disciplines', desc: 'Pratiquer 3 sports différents.',
        metric: 'wSports', goal: 3, unit: 'sports' },
      { id: 'w_long1',   family: 'sport', tier: 'moyenne', icon: '🔥',
        name: 'Séance longue', desc: 'Faire une séance de 60 minutes ou plus.',
        metric: 'wLong', goal: 1, unit: 'séance' },
      { id: 'w_km20000', family: 'vol',   tier: 'moyenne', icon: '🧭',
        name: 'Vingt mille', desc: 'Parcourir 20 000 km cette semaine.',
        metric: 'wKm', goal: 20000, unit: 'km' },
      { id: 'w_land5',   family: 'vol',   tier: 'moyenne', icon: '🛬',
        name: 'Cinq atterrissages', desc: 'Se poser 5 fois à destination.',
        metric: 'wLandings', goal: 5, unit: 'arrivées' },
      { id: 'w_alt85',   family: 'vol',   tier: 'moyenne', icon: '📈',
        name: 'Haute croisière', desc: 'Monter à 85 % du plafond de son avion.',
        metric: 'wAltPct', goal: 85, unit: '%' },
      { id: 'w_city1',   family: 'vol',   tier: 'moyenne', icon: '🌍',
        name: 'Nouvelle escale', desc: 'Découvrir une ville jamais visitée.',
        metric: 'wCities', goal: 1, unit: 'ville' },
      { id: 'w_base6',   family: 'vol',   tier: 'moyenne', icon: '🗼',
        name: 'Navette', desc: 'Repasser 6 fois à la verticale de LFPG.',
        metric: 'wBase', goal: 6, unit: 'passages' },
      { id: 'w_kero3500',family: 'eco',   tier: 'moyenne', icon: '⛽',
        name: 'Gros plein', desc: 'Gagner 3 500 L de kérosène.',
        metric: 'wKero', goal: 3500, unit: 'L' },
      { id: 'w_wheel5',  family: 'eco',   tier: 'moyenne', icon: '🎡',
        name: 'Cinq tours de roue', desc: 'Lancer la roue 5 jours différents.',
        metric: 'wWheelDays', goal: 5, unit: 'jours' },
      { id: 'w_ach2',    family: 'eco',   tier: 'moyenne', icon: '🏆',
        name: 'Deux succès', desc: 'Réclamer 2 succès.',
        metric: 'wAchievements', goal: 2, unit: 'succès' },
      { id: 'w_spend2000',family:'eco',   tier: 'moyenne', icon: '🛒',
        name: 'Investissement', desc: 'Dépenser 2 000 points en boutique.',
        metric: 'wSpent', goal: 2000, unit: 'pts' },
      { id: 'w_route1',  family: 'eco',   tier: 'moyenne', icon: '🗺️',
        name: 'Nouvelle ligne', desc: 'Ouvrir une nouvelle ligne.',
        metric: 'wRoutes', goal: 1, unit: 'ligne' },

      /* ---- Difficile ---- */
      { id: 'w_sess7',   family: 'sport', tier: 'difficile', icon: '🏃',
        name: 'Sept séances', desc: 'Enregistrer 7 séances de sport.',
        metric: 'wSessions', goal: 7, unit: 'séances' },
      { id: 'w_min300',  family: 'sport', tier: 'difficile', icon: '⏱️',
        name: 'Cinq heures', desc: 'Cumuler 300 minutes de sport.',
        metric: 'wMinutes', goal: 300, unit: 'min' },
      { id: 'w_days6',   family: 'sport', tier: 'difficile', icon: '📅',
        name: 'Six jours actifs', desc: 'Faire du sport 6 jours différents.',
        metric: 'wDays', goal: 6, unit: 'jours' },
      { id: 'w_sports4', family: 'sport', tier: 'difficile', icon: '🔀',
        name: 'Quatre disciplines', desc: 'Pratiquer 4 sports différents.',
        metric: 'wSports', goal: 4, unit: 'sports' },
      { id: 'w_long2',   family: 'sport', tier: 'difficile', icon: '🔥',
        name: 'Deux séances longues', desc: 'Faire 2 séances de 60 minutes ou plus.',
        metric: 'wLong', goal: 2, unit: 'séances' },
      { id: 'w_km40000', family: 'vol',   tier: 'difficile', icon: '🧭',
        name: 'Quarante mille', desc: 'Parcourir 40 000 km cette semaine.',
        metric: 'wKm', goal: 40000, unit: 'km' },
      { id: 'w_land10',  family: 'vol',   tier: 'difficile', icon: '🛬',
        name: 'Dix atterrissages', desc: 'Se poser 10 fois à destination.',
        metric: 'wLandings', goal: 10, unit: 'arrivées' },
      { id: 'w_alt98',   family: 'vol',   tier: 'difficile', icon: '📈',
        name: 'Au plafond', desc: 'Monter à 98 % du plafond de son avion.',
        metric: 'wAltPct', goal: 98, unit: '%' },
      { id: 'w_city2',   family: 'vol',   tier: 'difficile', icon: '🌍',
        name: 'Deux nouvelles escales', desc: 'Découvrir 2 villes jamais visitées.',
        metric: 'wCities', goal: 2, unit: 'villes' },
      { id: 'w_kero6000',family: 'eco',   tier: 'difficile', icon: '⛽',
        name: 'Ravitaillement massif', desc: 'Gagner 6 000 L de kérosène.',
        metric: 'wKero', goal: 6000, unit: 'L' },
      { id: 'w_wheel7',  family: 'eco',   tier: 'difficile', icon: '🎡',
        name: 'Semaine parfaite à la roue', desc: 'Lancer la roue les 7 jours.',
        metric: 'wWheelDays', goal: 7, unit: 'jours' },
      { id: 'w_ach4',    family: 'eco',   tier: 'difficile', icon: '🏆',
        name: 'Quatre succès', desc: 'Réclamer 4 succès.',
        metric: 'wAchievements', goal: 4, unit: 'succès' },
      { id: 'w_spend8000',family:'eco',   tier: 'difficile', icon: '🛒',
        name: 'Gros investissement', desc: 'Dépenser 8 000 points en boutique.',
        metric: 'wSpent', goal: 8000, unit: 'pts' },
      { id: 'w_upg2',    family: 'eco',   tier: 'difficile', icon: '🔧',
        name: 'Atelier ouvert', desc: "Acheter 2 niveaux d'améliorations.",
        metric: 'wUpgrades', goal: 2, unit: 'niveaux' },
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

  // --- Décors ---
  // Supprimés en v3.1 : le ciel n'est plus un article de boutique mais le
  // reflet de la situation de vol réelle (position, heure solaire locale,
  // altitude, météo). Voir js/sky.js.

  // --- Grades de pilote 🎫 (v2.8, refondu en v3.5) ---
  // Un grade se gagne quand LES TROIS conditions sont remplies : assez
  // d'heures de vol, assez de trajets terminés, et assez de villes
  // DIFFÉRENTES desservies.
  //
  // ⚠️ v3.5 — pourquoi cette refonte. Jusqu'ici « heures de vol » valait
  // lifetimeKm / 800 : ce n'était pas du temps mais de la distance déguisée.
  // Mesuré sur le vrai moteur (voir sim_grades.js), un A320 régulier
  // enregistrait ainsi 18 à 22 « heures » par journée réelle et un Concorde
  // 58 — l'échelle récompensait l'avion possédé, pas l'assiduité, et
  // Légende du ciel tombait en quelques semaines.
  //
  // Désormais une heure de grade = une heure réellement passée en l'air
  // (player.flightSeconds, alimenté par Engine.simulate). Le plafond
  // physique est donc 24 h par jour, et rien ne s'accumule quand l'avion
  // est au sol après un crash. L'échelle devient un calendrier :
  //   Pilote privé ½ journée · Copilote junior ~5 j · Confirmé ~2,5 sem.
  //   Commandant de bord ~6 sem. · Instructeur ~2,5 mois
  //   Chef pilote ~4 mois · Légende du ciel ~6 mois (4 300 h)
  //
  // Les trajets restent volontairement modestes : ils sont très inégaux
  // selon la ligne (mesuré : 25,7 trajets/jour sur LFPG↔EGLL contre 0,53
  // sur LFPG↔YSSY, soit un facteur 48). Le vrai second axe, lui, est neutre
  // vis-à-vis de la longueur des lignes : le nombre de villes distinctes.
  // Il pousse à ouvrir des routes, donc à dépenser des points, donc à faire
  // du sport.
  GRADES: [
    { id: 'eleve',      name: 'Élève-pilote',           icon: '🎓', hours: 0,    trips: 0,  cities: 0 },
    { id: 'prive',      name: 'Pilote privé',           icon: '🛩️', hours: 12,   trips: 2,  cities: 1 },
    { id: 'copi_jr',    name: 'Copilote junior',        icon: '🧑‍✈️', hours: 110,  trips: 6,  cities: 3 },
    { id: 'copi_conf',  name: 'Copilote confirmé',      icon: '✈️', hours: 400,  trips: 15, cities: 6 },
    { id: 'cdb',        name: 'Commandant de bord',     icon: '🎖️', hours: 1000, trips: 30, cities: 10 },
    { id: 'instructeur',name: 'Commandant instructeur', icon: '🏅', hours: 1800, trips: 50, cities: 15 },
    { id: 'chef',       name: 'Chef pilote',            icon: '👑', hours: 2850, trips: 70, cities: 20 },
    { id: 'legende',    name: 'Légende du ciel',        icon: '🌟', hours: 4300, trips: 90, cities: 26 },
  ],

  // --- Simulation ---
  SIM_STEP_S: 60,            // pas de simulation hors-ligne (secondes)
  MAX_OFFLINE_DAYS: 60,      // au-delà, on plafonne la simulation
  TICK_MS: 1000,             // tick temps réel (1 s)

  SAVE_KEY: 'skyfit_save_v1',

  /* Grands resets, dans l'ORDRE CHRONOLOGIQUE. Le dernier est celui en
     vigueur ; tout profil resté en arrière est remis à zéro au chargement,
     une seule fois, y compris s'il revient du cloud.
       v3.6 « 2026-07-28-arbre » : arrivée de l'arbre des compétences.
       v3.7 « 2026-08-02-envol » : fin de la phase de test, le menu admin est
             retiré et les compteurs gonflés pendant le développement sont
             effacés. C'était censé être le vrai départ.
       v3.7.1 « 2026-08-02-page-blanche » : les remises à zéro en boucle
             (voir ci-dessous) ont laissé les deux profils dans un état
             incertain. Demandé par Diego : on repart proprement, à égalité,
             une fois le défaut corrigé. Celui-ci est le vrai départ.

     ⚠️ POURQUOI UNE LISTE ET NON UNE SEULE VALEUR (corrigé le 02/08/2026)
     La version précédente comparait simplement `p.resetStamp !== RESET_STAMP`.
     Un appareil resté sur la v3.6 lisait donc « 2026-08-02-envol », ne le
     reconnaissait pas, remettait le profil à zéro et le publiait ; l'appareil
     à jour lisait en retour « 2026-07-28-arbre », ne le reconnaissait pas non
     plus, et remettait à zéro à son tour. Deux téléphones d'une version
     d'écart s'effaçaient mutuellement, indéfiniment. Avec une liste ordonnée,
     un tampon INCONNU est traité comme venant du futur et laissé intact :
     une version ancienne ne peut plus effacer le travail d'une version
     récente. N'AJOUTER une entrée que pour vouloir réellement tout effacer. */
  RESET_HISTORY: [
    '2026-07-28-arbre',
    '2026-08-02-envol',
    '2026-08-02-page-blanche',
  ],

  /* Tampon de cache des IMAGES. Le `?v=` posé sur les <script>/<link> dans
     index.html ne protège que le code : les sprites d'avions sont chargés par
     du JS, leur URL n'a pas de tampon, et un navigateur qui a déjà mis en cache
     un PNG retouché continue d'afficher l'ancien. À incrémenter dès qu'un
     fichier de assets/planes/ change. */
  ASSET_V: '20260728b',
};

/* ------------------------------------------------------------
   Modèle de vol : tout part de l'avion piloté
   ------------------------------------------------------------ */

/** Fiche de l'avion, avec repli sur le Cessna si l'id est inconnu. */
CONFIG.planeById = function (id) {
  return CONFIG.PLANES.find(pl => pl.id === id) || CONFIG.PLANES[0];
};

/** Fiche de l'avion actuellement piloté par ce joueur. */
/* Tampon du reset en vigueur — dernier élément de l'historique. */
CONFIG.RESET_STAMP = CONFIG.RESET_HISTORY[CONFIG.RESET_HISTORY.length - 1] || '';

/**
 * Ce profil doit-il subir un grand reset ?
 * Oui uniquement s'il porte un tampon STRICTEMENT antérieur au tampon en
 * vigueur (ou aucun tampon du tout). Un tampon inconnu vient forcément
 * d'une version plus récente que celle qui tourne ici : on n'y touche pas,
 * sinon deux appareils décalés d'une version s'effacent mutuellement.
 */
CONFIG.needsReset = function (player) {
  const hist = CONFIG.RESET_HISTORY || [];
  if (!hist.length) return false;
  const stamp = player && player.resetStamp;
  const i = hist.indexOf(stamp);
  if (stamp && i === -1) return false;   // tampon du futur : intouchable
  return i < hist.length - 1;            // absent (-1) ou plus ancien
};

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

/**
 * Heures de vol RÉELLES : temps effectivement passé en l'air.
 *
 * ⚠️ Ne jamais revenir à un calcul dérivé de lifetimeKm (c'était le cas
 * jusqu'en v3.5, avec GRADE_REF_SPEED) : la distance dépend de l'avion et
 * de l'altitude, donc deux pilotes également assidus n'avançaient pas au
 * même rythme sur l'échelle des grades. Ici le compteur est du temps, il
 * ne peut pas dépasser 24 h par jour, et il s'arrête quand l'avion est au
 * sol. Alimenté pas à pas par Engine.simulate().
 */
CONFIG.flightHours = function (player) {
  return ((player && player.flightSeconds) || 0) / 3600;
};

/** Nombre de trajets terminés (arrivées à destination). */
CONFIG.tripsOf = function (player) {
  return (player && player.landings) || 0;
};

/** Nombre de villes DIFFÉRENTES desservies (neutre vis-à-vis des distances). */
CONFIG.citiesOf = function (player) {
  const v = player && player.visited;
  return Array.isArray(v) ? v.length : 0;
};

/** Index du grade actuel dans CONFIG.GRADES (le plus haut atteint). */
CONFIG.gradeIndex = function (player) {
  const h = CONFIG.flightHours(player);
  const t = CONFIG.tripsOf(player);
  const c = CONFIG.citiesOf(player);
  let idx = 0;
  CONFIG.GRADES.forEach((g, i) => {
    if (h >= g.hours && t >= g.trips && c >= (g.cities || 0)) idx = i;
  });
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
