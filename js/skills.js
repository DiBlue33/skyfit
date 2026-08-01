/* ============================================================
   SkyFit — Arbre des compétences 🎓 (v3.6)
   ------------------------------------------------------------
   Une seconde monnaie, les ROUES DENTÉES ⚙, totalement séparée
   des points. Les points viennent des kilomètres (donc du sport) ;
   les roues dentées viennent de l'EXPLORATION :
     • première arrivée dans une ville      (2 à 6 selon la région)
     • premier déblocage d'un avion         (10)
     • première observation d'un phénomène  (5)
     • toutes les destinations visitées     (bonus final)

   Elles servent uniquement à débloquer les qualifications de
   l'arbre. Pour piloter un avion il faut DEUX choses :
     1. la qualification de type (QT) débloquée ici ;
     2. le prix en points payé à la boutique.

   Le budget est fermé : la somme de toutes les roues dentées
   obtenables est exactement égale au coût total de l'arbre. Le
   tout dernier nœud disponible — la QT Concorde — se débloque
   donc avec la toute dernière roue dentée gagnée.
   Voir Skills.budget() et test_skills.js.
   ============================================================ */

const Skills = (() => {

  /* ------------------------------------------------------------
     Gains de roues dentées
     ------------------------------------------------------------ */

  // Première arrivée dans une ville, selon l'éloignement de la région.
  const CITY_GEARS = {
    'France': 2,
    'Europe': 3,
    'Afrique & Moyen-Orient': 4,
    'Amériques': 5,
    'Asie & Océanie': 6,
  };

  // Premier déblocage d'un avion. Le Cessna est offert au départ ;
  // le Concorde est le dernier achat possible, ses roues dentées
  // n'auraient plus rien à financer — les deux sont donc exclus.
  const PLANE_GEARS = 10;
  const PLANE_REWARDED = ['tbm700', 'a220', 'b737', 'a320', 'a330', 'falcon900', 'a380'];

  // Première observation d'un phénomène céleste (voir js/sky.js).
  const PHENOMENON_GEARS = 5;

  /* ------------------------------------------------------------
     Construction de l'arbre
     ------------------------------------------------------------ */

  const NODES = [];

  function node(def) {
    def.requires = def.requires || [];
    def.cost = def.cost || 0;
    NODES.push(def);
    return def.id;
  }

  /** Ajoute N modules parallèles et renvoie la liste de leurs ids. */
  function modules(prefix, names, cost, requires, group, icon) {
    return names.map((name, i) => node({
      id: prefix + '-' + (i + 1),
      name: name,
      short: 'Module ' + (i + 1),
      icon: icon || '📘',
      cost: cost,
      requires: requires,
      group: group,
      kind: 'module',
    }));
  }

  /* --- Tronc commun : de la licence privée au TBM 700 --------- */

  node({
    id: 'ppl', name: 'PPL — Licence de pilote privé', icon: '🎓', cost: 0,
    requires: [], group: 'trunk', kind: 'licence', grants: 'cessna',
    desc: 'Le point de départ. Vous savez faire voler un Cessna 172 : le reste s\'apprend en l\'air.',
  });

  const ATPL_MODULES = [
    'Droit aérien',
    'Connaissance générale de l\'aéronef',
    'Masse et centrage',
    'Performances',
    'Préparation et suivi du vol',
    'Performances humaines',
    'Météorologie',
    'Navigation générale',
    'Radionavigation',
    'Procédures opérationnelles',
    'Principes du vol',
  ];
  const atpl = modules('atpl', ATPL_MODULES, 2, ['ppl'], 'trunk');

  node({
    id: 'cpl', name: 'CPL — Licence de pilote professionnel', icon: '💼', cost: 6,
    requires: atpl, group: 'trunk', kind: 'licence',
    desc: 'Les 11 modules de l\'ATPL théorique validés, vous pouvez être payé pour voler.',
  });
  node({
    id: 'ir', name: 'IR — Qualification de vol aux instruments', icon: '🧭', cost: 6,
    requires: ['cpl'], group: 'trunk', kind: 'licence',
    desc: 'Voler sans voir dehors. Indispensable dès que la météo se gâte.',
  });
  node({
    id: 'me', name: 'ME — Qualification multimoteur', icon: '🔁', cost: 5,
    requires: ['ir'], group: 'trunk', kind: 'licence',
    desc: 'Deux moteurs, deux fois plus de pannes à gérer.',
  });
  node({
    id: 'mcc', name: 'MCC — Travail en équipage', icon: '🤝', cost: 5,
    requires: ['me'], group: 'trunk', kind: 'licence',
    desc: 'Apprendre à voler à deux dans le même cockpit : la porte d\'entrée de la ligne.',
  });
  node({
    id: 'qt-tbm700', name: 'QT TBM 700', icon: '🛩️', cost: 8,
    requires: ['mcc'], group: 'trunk', kind: 'qt', grants: 'tbm700',
    desc: 'Première qualification de type. Le turbopropulseur qui vous sort enfin de l\'école.',
  });

  /* --- Trois branches moyen-courrier -------------------------- */

  const TYPE_MODULES = [
    'Systèmes avion',
    'Moteurs et carburant',
    'Performances et masse-centrage',
    'Automatismes et FMS',
    'Procédures anormales et d\'urgence',
  ];

  /**
   * Branche complète pour un type : 5 modules théoriques, une
   * formation pratique (simulateur + lignes), puis la QT.
   */
  function branch(planeId, opts) {
    const plane = CONFIG.planeById ? CONFIG.planeById(planeId) : null;
    const label = (plane && plane.name) || planeId;
    const th = modules('th-' + planeId, opts.modules || TYPE_MODULES,
      opts.moduleCost, opts.requires, planeId, '📗');
    node({
      id: 'prat-' + planeId, name: 'Formation pratique ' + label, icon: '🕹️',
      cost: opts.pratCost, requires: th, group: planeId, kind: 'pratique',
      desc: 'Simulateur de vol complet puis vols de ligne sous supervision.',
    });
    node({
      id: 'qt-' + planeId, name: 'QT ' + label, icon: '✅',
      cost: opts.qtCost, requires: ['prat-' + planeId], group: planeId,
      kind: 'qt', grants: planeId,
      desc: 'Qualification de type ' + label + ' : vous pouvez désormais l\'acheter en boutique.',
    });
    return 'qt-' + planeId;
  }

  const MEDIUM = ['a220', 'b737', 'a320'];
  MEDIUM.forEach(id => branch(id, {
    requires: ['qt-tbm700'], moduleCost: 3, pratCost: 6, qtCost: 8,
  }));

  /* --- Jonction : le passage au long-courrier ----------------- */

  node({
    id: 'lc', name: 'Formation long-courrier', icon: '🌍', cost: 12,
    requires: MEDIUM.map(id => 'qt-' + id), group: 'junction', kind: 'licence',
    desc: 'ETOPS, navigation océanique et gestion de la fatigue sur les vols de plus de 8 heures. '
        + 'Exige les trois qualifications moyen-courrier.',
  });

  /* --- Trois branches long-courrier --------------------------- */

  const LONG = ['a330', 'falcon900', 'a380'];
  LONG.forEach(id => branch(id, {
    requires: ['lc'], moduleCost: 4, pratCost: 8, qtCost: 10,
  }));

  /* --- Dernier étage : le Concorde ---------------------------- */

  const CONCORDE_MODULES = [
    'Vol supersonique et onde de choc',
    'Structure et échauffement cinétique',
    'Moteurs Olympus et postcombustion',
    'Transfert de carburant et centrage supersonique',
    'Procédures transatlantiques Mach 2',
  ];
  branch('concorde', {
    requires: LONG.map(id => 'qt-' + id),
    modules: CONCORDE_MODULES, moduleCost: 7, pratCost: 15, qtCost: 21,
  });

  const BY_ID = {};
  NODES.forEach(n => { BY_ID[n.id] = n; });

  // Avion -> nœud qui l'autorise
  const QT_BY_PLANE = {};
  NODES.forEach(n => { if (n.grants) QT_BY_PLANE[n.grants] = n.id; });

  /* ------------------------------------------------------------
     Budget : les gains doivent couvrir l'arbre à la roue près
     ------------------------------------------------------------ */

  const TREE_COST = NODES.reduce((s, n) => s + n.cost, 0);

  function routeGears() {
    if (typeof Routes === 'undefined') return 0;
    return Routes.all().reduce((s, r) => s + (CITY_GEARS[r.region] || 0), 0);
  }
  function planeGears() { return PLANE_REWARDED.length * PLANE_GEARS; }
  function phenomenonGears() {
    const n = (typeof Sky !== 'undefined' && Sky.PHENOMENA) ? Sky.PHENOMENA.length : 0;
    return n * PHENOMENON_GEARS;
  }

  /**
   * Bonus « toutes les destinations visitées ». Il est DÉRIVÉ :
   * c'est exactement ce qui manque pour financer le dernier nœud
   * de l'arbre. Ajouter une ville ou un phénomène plus tard
   * rééquilibre donc le budget tout seul, sans retoucher l'arbre.
   */
  function capstoneGears() {
    return Math.max(0, TREE_COST - routeGears() - planeGears() - phenomenonGears());
  }

  function budget() {
    const detail = {
      routes: routeGears(),
      planes: planeGears(),
      phenomena: phenomenonGears(),
      capstone: capstoneGears(),
    };
    return {
      income: detail.routes + detail.planes + detail.phenomena + detail.capstone,
      cost: TREE_COST,
      detail: detail,
      nodes: NODES.length,
    };
  }

  /* ------------------------------------------------------------
     État du joueur
     ------------------------------------------------------------ */

  function list(player) {
    if (!player) return ['ppl'];
    if (!Array.isArray(player.skills)) {
      player.skills = player.skills ? Object.values(player.skills) : [];
    }
    if (player.skills.indexOf('ppl') < 0) player.skills.unshift('ppl');
    return player.skills;
  }

  function isUnlocked(player, id) {
    if (id === 'ppl') return true;
    return list(player).indexOf(id) >= 0;
  }

  /** Roues dentées encore disponibles. */
  function available(player) {
    if (!player) return 0;
    return Math.max(0, Math.floor((player.gears || 0) - (player.gearsSpent || 0)));
  }

  /** Prérequis manquants pour un nœud (liste de nœuds). */
  function missing(player, id) {
    const n = BY_ID[id];
    if (!n) return [];
    return n.requires.filter(r => !isUnlocked(player, r)).map(r => BY_ID[r]).filter(Boolean);
  }

  function canUnlock(player, id) {
    const n = BY_ID[id];
    if (!n) return { ok: false, reason: 'inconnue' };
    if (isUnlocked(player, id)) return { ok: false, reason: 'déjà', node: n };
    const miss = missing(player, id);
    if (miss.length) return { ok: false, reason: 'prérequis', node: n, missing: miss };
    if (available(player) < n.cost) return { ok: false, reason: 'roues', node: n };
    return { ok: true, node: n };
  }

  function unlock(player, id) {
    const check = canUnlock(player, id);
    if (!check.ok) return check;
    const n = check.node;
    player.gearsSpent = (player.gearsSpent || 0) + n.cost;
    list(player).push(id);
    logTraining(player, n);
    if (typeof State !== 'undefined' && State.save) State.save();
    return { ok: true, node: n, unlocked: true };
  }

  /* ------------------------------------------------------------
     Autorisation de vol
     ------------------------------------------------------------ */

  /** Nœud qui autorise cet avion (null si aucun). */
  function qtFor(planeId) {
    const id = QT_BY_PLANE[planeId];
    return id ? BY_ID[id] : null;
  }

  /** Le pilote a-t-il la qualification de type de cet avion ? */
  function canFly(player, planeId) {
    const id = QT_BY_PLANE[planeId];
    if (!id) return true;            // avion sans QT déclarée : pas de verrou
    return isUnlocked(player, id);
  }

  /* ------------------------------------------------------------
     Gains
     ------------------------------------------------------------ */

  function grant(player, amount) {
    if (!player || !amount) return 0;
    player.gears = (player.gears || 0) + amount;
    return amount;
  }

  /** Première arrivée dans une ville. Renvoie les roues gagnées. */
  function awardCity(player, city) {
    const r = (typeof Routes !== 'undefined' && Routes.byCity) ? Routes.byCity(city) : null;
    const gain = r ? (CITY_GEARS[r.region] || 0) : 0;
    grant(player, gain);
    return gain + awardAllCities(player);
  }

  /** Bonus unique : toutes les destinations du catalogue visitées. */
  function awardAllCities(player) {
    if (!player || player.gearCapstone) return 0;
    if (typeof Routes === 'undefined') return 0;
    const all = Routes.all();
    const seen = Array.isArray(player.visited) ? player.visited : [];
    if (!all.length || seen.length < all.length) return 0;
    if (!all.every(r => seen.indexOf(r.city) >= 0)) return 0;
    player.gearCapstone = 1;
    return grant(player, capstoneGears());
  }

  /** Premier déblocage d'un avion. */
  function awardPlane(player, planeId) {
    if (PLANE_REWARDED.indexOf(planeId) < 0) return 0;
    return grant(player, PLANE_GEARS);
  }

  /** Première observation d'un phénomène céleste. */
  function awardPhenomenon(player) {
    return grant(player, PHENOMENON_GEARS);
  }

  /* ------------------------------------------------------------
     Journal
     ------------------------------------------------------------ */

  function logTraining(player, n) {
    if (!player) return;
    if (!Array.isArray(player.activityLog)) player.activityLog = [];
    player.activityLog.push({
      activityId: 'training',
      minutes: 0,
      kero: 0,
      gears: n.cost,
      date: Date.now(),
      loggedAt: Date.now(),
      label: n.name,
      skill: n.id,
    });
    if (player.activityLog.length > 500) player.activityLog.shift();
  }

  /* ------------------------------------------------------------
     Vue d'ensemble (interface)
     ------------------------------------------------------------ */

  /** Colonnes de l'arbre, dans l'ordre d'affichage. */
  function groups() {
    const label = id => {
      const p = CONFIG.planeById ? CONFIG.planeById(id) : null;
      return (p && p.name) || id;
    };
    return [
      { id: 'trunk', title: 'Tronc commun', icon: '🎓', row: 0 },
      { id: 'a220', title: label('a220'), icon: '✈️', row: 1 },
      { id: 'b737', title: label('b737'), icon: '✈️', row: 1 },
      { id: 'a320', title: label('a320'), icon: '✈️', row: 1 },
      { id: 'junction', title: 'Long-courrier', icon: '🌍', row: 2 },
      { id: 'a330', title: label('a330'), icon: '✈️', row: 3 },
      { id: 'falcon900', title: label('falcon900'), icon: '✈️', row: 3 },
      { id: 'a380', title: label('a380'), icon: '✈️', row: 3 },
      { id: 'concorde', title: label('concorde'), icon: '🚀', row: 4 },
    ].map(g => ({ ...g, nodes: NODES.filter(n => n.group === g.id) }));
  }

  function progress(player) {
    const done = NODES.filter(n => isUnlocked(player, n.id));
    return {
      unlocked: done.length,
      total: NODES.length,
      spent: done.reduce((s, n) => s + n.cost, 0),
      cost: TREE_COST,
      gears: (player && player.gears) || 0,
      available: available(player),
    };
  }

  /** Prochain nœud accessible (aide à l'affichage du HUD). */
  function next(player) {
    return NODES.find(n => !isUnlocked(player, n.id) && !missing(player, n.id).length) || null;
  }

  return {
    NODES, CITY_GEARS, PLANE_GEARS, PHENOMENON_GEARS, PLANE_REWARDED,
    byId: id => BY_ID[id] || null,
    all: () => NODES,
    groups, progress, next, budget, capstoneGears,
    isUnlocked, canUnlock, unlock, missing, available,
    canFly, qtFor,
    awardCity, awardPlane, awardPhenomenon, awardAllCities,
  };
})();
