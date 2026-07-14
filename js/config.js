/* ============================================================
   SkyFit — Configuration & équilibrage du jeu
   ============================================================
   Équilibrage "Équilibré" :
   - ~30 min de sport/jour maintiennent l'altitude
   - Sans sport, descente au minimum en ~2,5 jours depuis le plafond
   ============================================================ */

const CONFIG = {
  // --- Altitude (en pieds) ---
  ALT_MIN: 0,             // plancher : à 0 ft, c'est le CRASH 💥
  ALT_START: 5000,        // altitude après un décollage
  ALT_MAX: 38000,         // plafond

  // --- Perte d'altitude ---
  DECAY_FT_PER_HOUR: 500, // perte de base par heure (s'applique en continu)

  // --- Kérosène ---
  // L'avion brûle automatiquement son kérosène pour monter.
  BURN_RATE_L_PER_HOUR: 600,  // litres brûlés par heure quand la réserve > 0
  CLIMB_FT_PER_LITRE: 40,     // pieds gagnés par litre brûlé
  KERO_TANK_MAX: 4000,        // capacité max de la réserve (litres)

  // --- Vitesse (km/h) en fonction de l'altitude ---
  // (0 km/h en cas de crash, géré par le moteur)
  SPEED_AT_MIN: 150,   // vitesse au ras du sol (0 ft)
  SPEED_AT_MAX: 950,   // vitesse à 38 000 ft

  // --- Points ---
  KM_PER_POINT: 10,    // 10 km parcourus = 1 point

  // --- Activités sportives (litres de kérosène par minute) ---
  ACTIVITIES: [
    { id: 'running',    name: 'Running',     icon: '🏃', keroPerMin: 10 },
    { id: 'musculation',name: 'Musculation', icon: '🏋️', keroPerMin: 8  },
    { id: 'velo',       name: 'Vélo',        icon: '🚴', keroPerMin: 9  },
    { id: 'natation',   name: 'Natation',    icon: '🏊', keroPerMin: 11 },
    { id: 'randonnee',  name: 'Randonnée',   icon: '🥾', keroPerMin: 7  },
    { id: 'autre',      name: 'Autre sport', icon: '💪', keroPerMin: 8  },
  ],

  // --- Boutique : avions (multiplicateur de vitesse) ---
  // width : largeur d'affichage à l'écran (en vw, bornée en px)
  PLANES: [
    { id: 'cessna',    name: 'Cessna 172',        cost: 0,      speedMult: 1.0,  width: 13,
      desc: "L'avion-école des premiers décollages." },
    { id: 'tbm700',    name: 'TBM 700',           cost: 500,    speedMult: 1.15, width: 14,
      desc: 'Turbopropulseur rapide. +15 % de vitesse.',
      // Hélice animée : position/taille de l'overlay en % du sprite
      prop: { left: 90.96, top: 37.91, width: 9.3, height: 62.75 } },
    { id: 'a220',      name: 'Airbus A220',       cost: 2000,   speedMult: 1.35, width: 19,
      desc: 'Moyen-courrier moderne. +35 % de vitesse.' },
    { id: 'b737',      name: 'Boeing 737',        cost: 6000,   speedMult: 1.55, width: 20,
      desc: 'Le best-seller du ciel. +55 % de vitesse.' },
    { id: 'a320',      name: 'Airbus A320',       cost: 15000,  speedMult: 1.75, width: 21,
      desc: 'Ligne majeure. +75 % de vitesse.' },
    { id: 'a330',      name: 'Airbus A330',       cost: 25000,  speedMult: 1.85, width: 23,
      desc: 'Long-courrier élégant. +85 % de vitesse.' },
    { id: 'falcon900', name: 'Falcon 900',        cost: 35000,  speedMult: 2.0,  width: 17,
      desc: 'Jet présidentiel. Vitesse x2.' },
    { id: 'a380',      name: 'Airbus A380',       cost: 80000,  speedMult: 2.2,  width: 25,
      desc: 'Le géant des airs. Vitesse x2,2.' },
    { id: 'concorde',  name: 'Concorde',          cost: 180000, speedMult: 2.6,  width: 26,
      desc: 'Supersonique mythique. Vitesse x2,6.' },
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

// Vitesse (km/h) pour une altitude donnée, hors multiplicateur d'avion
CONFIG.speedForAlt = function (altFt) {
  const t = (altFt - CONFIG.ALT_MIN) / (CONFIG.ALT_MAX - CONFIG.ALT_MIN);
  return CONFIG.SPEED_AT_MIN + t * (CONFIG.SPEED_AT_MAX - CONFIG.SPEED_AT_MIN);
};
