/* ============================================================
   SkyFit — Gestion de l'état et des profils (sauvegarde locale)
   ============================================================ */

const State = (() => {

  function newPlayer(name) {
    return {
      name: name,
      createdAt: Date.now(),
      lastTick: Date.now(),        // dernier instant simulé
      altitude: CONFIG.ALT_START,  // ft
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
      // Journal des séances
      activityLog: [],             // { activityId, minutes, kero, date }
      totalSportMinutes: 0,
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

  // Nettoie les sauvegardes issues d'anciennes versions
  // (ex : identifiants d'avions/décors qui n'existent plus)
  function migrate() {
    const planeIds = CONFIG.PLANES.map(p => p.id);
    const decorIds = CONFIG.DECORS.map(d => d.id);
    Object.values(data.players).forEach(p => {
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
    });
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

  // Multiplicateur de vitesse de l'avion possédé
  function speedMult(p) {
    const plane = CONFIG.PLANES.find(pl => pl.id === p.currentPlane);
    return plane ? plane.speedMult : 1;
  }

  return {
    load, save, raw, addPlayer, selectPlayer, current, allPlayers, playerNames,
    availablePoints, tankCapacity, keroYield, decayFactor, speedMult,
  };
})();
