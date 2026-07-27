/* ============================================================
   SkyFit — Gestion de l'état et des profils (sauvegarde locale)
   ============================================================ */

const State = (() => {

  function newPlayer(name) {
    return {
      name: name,
      createdAt: Date.now(),
      lastTick: Date.now(),        // dernier instant simulé
      altitude: CONFIG.startAltFor({ currentPlane: 'cessna' }), // ft
      kerosene: 200,               // petit plein de bienvenue (L)
      crashed: false,
      crashes: 0,                  // nombre de crashs subis
      pinHash: null,               // empreinte du code PIN (défini via Auth)
      totalKm: 0,                  // km de la TENTATIVE en cours (remis à 0 au crash)
      bestKm: 0,                   // record : meilleure tentative (classement général)
      lifetimeKm: 0,               // km cumulés à vie (source des points, jamais remis à 0)
      points: 0,
      pointsSpent: 0,
      // Progression boutique
      ownedPlanes: ['cessna'],
      currentPlane: 'cessna',
      ownedDecors: ['day'],
      currentDecor: 'day',
      upgrades: { yield: 0, aero: 0, tank: 0 },
      // Réseau de routes (v2.3) — départ de LFPG, Lyon offert
      ownedRoutes: [Routes.DEFAULT_ROUTE],
      currentRoute: Routes.DEFAULT_ROUTE,
      pendingRoute: null,          // route demandée, effective à la verticale LFPG
      legKm: 0,                    // km parcourus depuis LFPG sur la route active
      legDir: 0,                   // 0 = aller (LFPG → ville), 1 = retour
      visited: [],                 // villes déjà atteintes (ordre chronologique)
      landings: 0,                 // nombre d'arrivées à destination
      baseTouches: 0,              // nombre de passages à la verticale de LFPG
      // Journal des séances
      activityLog: [],             // { activityId, minutes, kero, date }
      totalSportMinutes: 0,
      totalSessions: 0,            // nombre total de séances (jamais tronqué)
      maxAltitude: CONFIG.startAltFor({ currentPlane: 'cessna' }), // plus haute altitude atteinte
      bestStreak: 0,               // plus longue série de jours consécutifs 🔥
      // Roue de la chance 🎡 (v2.7) — champs plats : Firebase les conserve
      wheelLast: 0,                // horodatage du dernier tour (0 = jamais)
      wheelSpins: 0,               // nombre total de tours joués
      wheelJackpots: 0,            // nombre de jackpots décrochés
      // Quêtes 🎯 (v3.0) — champs plats + instantané du lundi
      questWeek: 0,                // lundi 00:00 de la semaine armée (0 = jamais)
      questClaimed: {},            // id de quête hebdo -> date de réclamation
      chainStep: {},               // id de carrière -> nombre d'étapes réclamées
      questAltMax: 0,              // plafond atteint depuis le début de la semaine
      questsDone: 0,               // nombre total de quêtes accomplies
      perfectWeeks: 0,             // semaines « 3 sur 3 » bouclées
      qsKm: 0,                     // instantané du lundi : km à vie
      qsLandings: 0,               //                       arrivées
      qsBase: 0,                   //                       passages LFPG
      qsSpent: 0,                  //                       points dépensés
      qsRoutes: 0,                 //                       lignes possédées
      qsUpg: 0,                    //                       niveaux d'améliorations
      // Fiche de pilote 🎫 (v2.8)
      avatar: '',                  // emoji choisi ('' = valeur par défaut selon le nom)
      callsign: '',                // indicatif radio libre, ex. « SKY01 »
      pinnedAchievements: [],      // 3 succès épinglés sur la vitrine
      claimedAchievements: {},     // id de succès -> date de réclamation
    };
  }

  let data = null; // { players: {name -> player}, currentPlayer: name|null }

  function load() {
    try {
      const raw = localStorage.getItem(CONFIG.SAVE_KEY);
      data = raw ? JSON.parse(raw) : null;
    } catch (e) {
      console.warn('Sauvegarde illisible, réinitialisation.', e);
      data = null;
    }
    if (!data || typeof data !== 'object' || !data.players) {
      data = { players: {}, currentPlayer: null };
    }
    migrate();
    return data;
  }

  // Nettoie les sauvegardes issues d'anciennes versions ET les profils
  // revenant du cloud : Firebase supprime les listes vides et les null,
  // il faut donc recréer les champs manquants (sinon : plantages).
  function migrate() {
    const planeIds = CONFIG.PLANES.map(p => p.id);
    const decorIds = CONFIG.DECORS.map(d => d.id);
    const routeIds = Routes.all().map(r => r.id);
    Object.values(data.players).forEach(p => {
      // Listes potentiellement perdues/déformées par Firebase
      if (!Array.isArray(p.activityLog)) {
        p.activityLog = p.activityLog ? Object.values(p.activityLog) : [];
      }
      if (!Array.isArray(p.ownedPlanes)) {
        p.ownedPlanes = p.ownedPlanes ? Object.values(p.ownedPlanes) : [];
      }
      if (!Array.isArray(p.ownedDecors)) {
        p.ownedDecors = p.ownedDecors ? Object.values(p.ownedDecors) : [];
      }
      if (!p.upgrades || typeof p.upgrades !== 'object') {
        p.upgrades = { yield: 0, aero: 0, tank: 0 };
      }
      p.ownedPlanes = (p.ownedPlanes || []).filter(id => planeIds.includes(id));
      if (!p.ownedPlanes.includes('cessna')) p.ownedPlanes.unshift('cessna');
      if (!planeIds.includes(p.currentPlane)) p.currentPlane = 'cessna';
      p.ownedDecors = (p.ownedDecors || []).filter(id => decorIds.includes(id));
      if (!p.ownedDecors.includes('day')) p.ownedDecors.unshift('day');
      if (!decorIds.includes(p.currentDecor)) p.currentDecor = 'day';
      if (typeof p.bonusPoints !== 'number') p.bonusPoints = 0;
      // Mécanique de crash (ajoutée en v1.3)
      if (typeof p.crashed !== 'boolean') p.crashed = false;
      if (typeof p.crashes !== 'number') p.crashes = 0;
      if (typeof p.lifetimeKm !== 'number') p.lifetimeKm = p.totalKm || 0;
      if (typeof p.bestKm !== 'number') p.bestKm = p.totalKm || 0;
      // Code PIN (v1.4) : les anciens profils en créeront un à la connexion
      if (typeof p.pinHash !== 'string') p.pinHash = null;
      // Horodatage de synchro (v1.5)
      if (typeof p.updatedAt !== 'number') p.updatedAt = p.lastTick || Date.now();
      // Succès (v1.8) — Firebase supprime les objets vides
      if (!p.claimedAchievements || typeof p.claimedAchievements !== 'object') {
        p.claimedAchievements = {};
      }
      if (typeof p.totalSessions !== 'number') p.totalSessions = p.activityLog.length;
      if (typeof p.maxAltitude !== 'number') p.maxAltitude = Math.max(p.altitude || 0, CONFIG.startAltFor(p));
      // Séries de jours consécutifs (v2.1) — recalculées depuis le journal
      if (typeof p.bestStreak !== 'number') p.bestStreak = 0;
      // Roue de la chance (v2.7)
      if (typeof p.wheelLast !== 'number') p.wheelLast = 0;
      if (typeof p.wheelSpins !== 'number') p.wheelSpins = 0;
      if (typeof p.wheelJackpots !== 'number') p.wheelJackpots = 0;
      // Quêtes (v3.0) — Firebase supprime les objets vides : on les recrée
      if (typeof p.questWeek !== 'number') p.questWeek = 0;
      if (!p.questClaimed || typeof p.questClaimed !== 'object') p.questClaimed = {};
      if (!p.chainStep || typeof p.chainStep !== 'object') p.chainStep = {};
      if (typeof p.questAltMax !== 'number') p.questAltMax = 0;
      if (typeof p.questsDone !== 'number') p.questsDone = 0;
      if (typeof p.perfectWeeks !== 'number') p.perfectWeeks = 0;
      ['qsKm', 'qsLandings', 'qsBase', 'qsSpent', 'qsRoutes', 'qsUpg'].forEach(k => {
        if (typeof p[k] !== 'number' || !isFinite(p[k])) p[k] = 0;
      });
      // Fiche de pilote (v2.8) — champs plats + liste que Firebase peut vider
      if (typeof p.avatar !== 'string') p.avatar = '';
      if (typeof p.callsign !== 'string') p.callsign = '';
      if (!Array.isArray(p.pinnedAchievements)) {
        p.pinnedAchievements = p.pinnedAchievements ? Object.values(p.pinnedAchievements) : [];
      }
      p.pinnedAchievements = p.pinnedAchievements.filter(id => typeof id === 'string').slice(0, 3);
      // Réseau de routes (v2.3)
      migrateRoutes(p, routeIds);
      // Plafond propre à chaque avion (v2.6) : un profil qui volait au-dessus
      // du plafond réel de son appareil est ramené à ce plafond, une fois.
      const ceil = CONFIG.ceilingFor(p);
      if (typeof p.altitude === 'number' && p.altitude > ceil) p.altitude = ceil;
    });
  }

  /* ------------------------------------------------------------
     Anciennes escales du tour du monde (v1 → v2.2) avec leur
     kilométrage cumulé : sert une seule fois à créditer les villes
     déjà visitées par les pilotes existants.
     ------------------------------------------------------------ */
  const LEGACY_STOPS = [
    ['Rome', 1105], ['Le Caire', 3237], ['Dubaï', 5663], ['Bombay', 7595],
    ['Bangkok', 10597], ['Tokyo', 15200], ['Honolulu', 21405],
    ['Los Angeles', 25526], ['Mexico', 28016], ['New York', 31375], ['Dakar', 37523],
  ];

  function migrateRoutes(p, routeIds) {
    const first = !Array.isArray(p.visited) && !p.visited;

    if (!Array.isArray(p.ownedRoutes)) {
      p.ownedRoutes = p.ownedRoutes ? Object.values(p.ownedRoutes) : [];
    }
    if (!Array.isArray(p.visited)) {
      p.visited = p.visited ? Object.values(p.visited) : [];
    }
    p.ownedRoutes = p.ownedRoutes.filter(id => routeIds.includes(id));
    if (!p.ownedRoutes.includes(Routes.DEFAULT_ROUTE)) {
      p.ownedRoutes.unshift(Routes.DEFAULT_ROUTE);
    }
    if (!routeIds.includes(p.currentRoute)) p.currentRoute = Routes.DEFAULT_ROUTE;
    if (!p.ownedRoutes.includes(p.currentRoute)) p.currentRoute = Routes.DEFAULT_ROUTE;
    if (p.pendingRoute && !routeIds.includes(p.pendingRoute)) p.pendingRoute = null;
    if (typeof p.legKm !== 'number' || !isFinite(p.legKm) || p.legKm < 0) p.legKm = 0;
    if (p.legDir !== 1) p.legDir = 0;
    if (typeof p.landings !== 'number') p.landings = 0;
    if (typeof p.baseTouches !== 'number') p.baseTouches = 0;

    // Reprise de l'historique : villes atteintes du temps du tour du monde,
    // pour ne pas retirer aux pilotes des succès déjà gagnés.
    if (first) {
      /** Ville déjà atteinte sous l'ancien tour du monde : visite + route offerte. */
      const grant = (city) => {
        const r = Routes.byCity(city);
        if (!r) return;
        if (!p.visited.includes(city)) p.visited.push(city);
        if (!p.ownedRoutes.includes(r.id)) p.ownedRoutes.push(r.id);
      };

      const best = Math.max(p.bestKm || 0, p.totalKm || 0);
      LEGACY_STOPS.forEach(([city, km]) => { if (best >= km) grant(city); });

      // Succès de visite déjà réclamés : la ville a bel et bien été survolée,
      // même si le score de la tentative a été remis à zéro par un crash.
      const CITIES = Routes.all().map(r => r.city);
      Object.keys(p.claimedAchievements || {}).forEach(id => {
        if (id.indexOf('visit_') !== 0) return;
        const city = CITIES.find(c => 'visit_' + slug(c) === id);
        if (city) grant(city);
      });
    }
  }

  function slug(s) {
    return String(s).toLowerCase().normalize('NFD')
      .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_');
  }

  /**
   * Sauvegarde locale.
   * @param touchedPlayer joueur à estampiller (updatedAt) — par défaut
   *        le joueur courant. L'horodatage sert à la synchro en ligne.
   * @param skipStamp true pour sauvegarder sans modifier updatedAt
   *        (utilisé quand on intègre des données venant du cloud).
   */
  function save(touchedPlayer, skipStamp) {
    if (!skipStamp) {
      const t = touchedPlayer || current();
      if (t) t.updatedAt = Date.now();
    }
    try {
      localStorage.setItem(CONFIG.SAVE_KEY, JSON.stringify(data));
    } catch (e) {
      console.error('Impossible de sauvegarder :', e);
    }
  }

  /** Accès direct aux données (utilisé par la synchro). */
  function raw() { return data; }

  function addPlayer(name) {
    name = (name || '').trim();
    if (!name) return null;
    if (!data.players[name]) {
      data.players[name] = newPlayer(name);
    }
    save();
    return data.players[name];
  }

  function selectPlayer(name) {
    if (!data.players[name]) return null;
    data.currentPlayer = name;
    save();
    return data.players[name];
  }

  function current() {
    return data.currentPlayer ? data.players[data.currentPlayer] : null;
  }

  function allPlayers() {
    return Object.values(data.players);
  }

  function playerNames() {
    return Object.keys(data.players);
  }

  // Points disponibles (gagnés + bonus admin - dépensés)
  function availablePoints(p) {
    return Math.floor(p.points + (p.bonusPoints || 0) - p.pointsSpent);
  }

  // Capacité du réservoir avec améliorations
  function tankCapacity(p) {
    const up = CONFIG.UPGRADES.find(u => u.id === 'tank');
    return CONFIG.KERO_TANK_MAX + (p.upgrades.tank || 0) * up.effectPerLevel;
  }

  // Multiplicateur de rendement kérosène
  function keroYield(p) {
    const up = CONFIG.UPGRADES.find(u => u.id === 'yield');
    return 1 + (p.upgrades.yield || 0) * up.effectPerLevel;
  }

  // Facteur de perte d'altitude (1 = perte normale)
  function decayFactor(p) {
    const up = CONFIG.UPGRADES.find(u => u.id === 'aero');
    return Math.max(0.3, 1 - (p.upgrades.aero || 0) * up.effectPerLevel);
  }

  // Vitesse air (km/h) : croisière de l'avion piloté, atténuée sous son plafond
  function airspeed(p) {
    return CONFIG.speedAt(p.altitude, p);
  }

  // Plafond opérationnel (ft) de l'avion piloté
  function ceiling(p) {
    return CONFIG.ceilingFor(p);
  }

  return {
    load, save, raw, migrate, addPlayer, selectPlayer, current, allPlayers,
    playerNames, availablePoints, tankCapacity, keroYield, decayFactor, airspeed, ceiling,
  };
})();
