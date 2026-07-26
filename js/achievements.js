/* ============================================================
   SkyFit — Succès (achievements) 🏆
   ------------------------------------------------------------
   Trois états par succès :
   - verrouillé : la condition (test) n'est pas remplie
   - débloqué   : condition remplie, bonus à réclamer d'un clic
   - réclamé    : bonus encaissé (stocké dans claimedAchievements)
   Le déblocage est recalculé à la volée depuis les stats du
   joueur : rien à migrer, et la synchro ne transporte que les
   réclamations.
   ============================================================ */

const Achievements = (() => {

  const $ = (id) => document.getElementById(id);
  const fmt = (n) => Math.floor(n).toLocaleString('fr-FR');

  // Distance de la meilleure tentative (course en cours comprise)
  const bestRun = (p) => Math.max(p.bestKm || 0, p.totalKm || 0);

  /* ---------- Définition des succès ---------- */

  function slug(s) {
    return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '_');
  }

  /** Récompense d'une visite : proportionnelle à la distance, arrondie à 25 L. */
  function visitReward(km) {
    return 25 * Math.round(Math.max(50, Math.min(1200, km / 12)) / 25);
  }

  const VOYAGE_GROUPS = Routes.REGIONS.map(r => 'Voyages · ' + r);

  function buildDefs() {
    const defs = [];

    // --- Voyages : se poser dans chaque ville du réseau (v2.3) ---
    Routes.all().slice()
      .sort((a, b) => a.km - b.km)
      .forEach(r => {
        defs.push({
          id: 'visit_' + slug(r.city),
          group: 'Voyages · ' + r.region,
          icon: r.icon,
          name: `Visite à ${r.city}`,
          desc: `Se poser à ${r.city} (${r.icao}) — ${fmt(r.km)} km depuis ${Routes.BASE.city}`,
          reward: visitReward(r.km),
          test: (p) => Routes.hasVisited(p, r.city),
        });
      });

    // --- Réseau : ampleur du carnet de vol ---
    const CITY_STEPS = [[3, 150, '🧭'], [10, 400, '🗺️'], [20, 900, '🌐'], [35, 2000, '🛰️']];
    CITY_STEPS.forEach(([n, reward, icon]) => defs.push({
      id: 'cities_' + n,
      group: 'Réseau',
      icon,
      name: `${n} villes visitées`,
      desc: `Se poser dans ${n} villes différentes du réseau`,
      reward,
      test: (p) => (p.visited || []).length >= n,
      prog: (p) => [Math.min((p.visited || []).length, n), n],
    }));

    defs.push({
      id: 'world_tour',
      group: 'Réseau',
      icon: '🌍',
      name: 'Tour du monde complet !',
      desc: `Visiter au moins une ville dans chacune des ${Routes.REGIONS.length} régions du réseau`,
      reward: 1500,
      test: (p) => Routes.regionsVisited(p) >= Routes.REGIONS.length,
      prog: (p) => [Routes.regionsVisited(p), Routes.REGIONS.length],
    });

    defs.push({
      id: 'landings_100',
      group: 'Réseau',
      icon: '🛬',
      name: '100 atterrissages',
      desc: 'Arriver 100 fois à destination',
      reward: 500,
      test: (p) => (p.landings || 0) >= 100,
      prog: (p) => [Math.min(p.landings || 0, 100), 100],
    });

    // --- Assiduité : nombre de séances ---
    const SESSION_STEPS = [
      [10, 50, '🥉'], [25, 100, '🥈'], [50, 150, '🥇'],
      [100, 250, '🏅'], [500, 500, '🎖️'], [1000, 1000, '👑'],
    ];
    SESSION_STEPS.forEach(([n, reward, icon]) => defs.push({
      id: 'sessions_' + n,
      group: 'Assiduité',
      icon,
      name: `${n} séances`,
      desc: `Enregistrer ${n} activités sportives`,
      reward,
      test: (p) => (p.totalSessions || 0) >= n,
      prog: (p) => [Math.min(p.totalSessions || 0, n), n],
    }));

    // Minutes de sport cumulées
    [[1000, 150, '⏱️'], [5000, 400, '🔥']].forEach(([n, reward, icon]) => defs.push({
      id: 'minutes_' + n,
      group: 'Assiduité',
      icon,
      name: `${fmt(n)} minutes de sport`,
      desc: `Cumuler ${fmt(n)} minutes d'activité`,
      reward,
      test: (p) => (p.totalSportMinutes || 0) >= n,
      prog: (p) => [Math.min(p.totalSportMinutes || 0, n), n],
    }));

    // --- Séries de jours consécutifs 🔥 ---
    const STREAK_STEPS = [
      [3, 75, '🔥', 'Mise en route'],
      [7, 200, '🔥', 'Semaine parfaite'],
      [14, 400, '🔥', 'Quinzaine en or'],
      [30, 800, '🔥', 'Un mois sans faillir'],
      [100, 2000, '🔥', 'Centurion'],
    ];
    STREAK_STEPS.forEach(([n, reward, icon, title]) => defs.push({
      id: 'streak_' + n,
      group: 'Séries',
      icon,
      name: `${title} — ${n} jours`,
      desc: `Faire du sport ${n} jours consécutifs`,
      reward,
      test: (p) => Streak.best(p) >= n,
      prog: (p) => [Math.min(Streak.best(p), n), n],
    }));

    // --- Flotte : posséder chaque avion ---
    CONFIG.PLANES.filter(pl => pl.cost > 0).forEach(pl => defs.push({
      id: 'plane_' + pl.id,
      group: 'Flotte',
      icon: '✈️',
      name: `Pilote de ${pl.name}`,
      desc: `Acheter le ${pl.name}`,
      reward: 100,
      test: (p) => (p.ownedPlanes || []).includes(pl.id),
    }));

    // --- Décors ---
    CONFIG.DECORS.filter(d => d.cost > 0).forEach(d => defs.push({
      id: 'decor_' + d.id,
      group: 'Décors',
      icon: d.id === 'sunset' ? '🌇' : d.id === 'night' ? '🌃' : '🌌',
      name: d.name,
      desc: `Débloquer le décor « ${d.name} »`,
      reward: 75,
      test: (p) => (p.ownedDecors || []).includes(d.id),
    }));

    // --- Divers ---
    defs.push(
      {
        id: 'first_crash', group: 'Divers', icon: '💥',
        name: 'Baptême du feu',
        desc: 'Subir son premier crash (ça arrive aux meilleurs)',
        reward: 50,
        test: (p) => (p.crashes || 0) >= 1,
      },
      {
        // Chaque avion a son propre plafond depuis la v2.6 : ce succès reste
        // volontairement une altitude ABSOLUE, donc réservé aux jets.
        id: 'ceiling', group: 'Divers', icon: '🚀',
        name: 'Plafond du monde',
        desc: `Atteindre ${fmt(CONFIG.ALT_REF)} ft — il faut un vrai jet`,
        reward: 200,
        test: (p) => (p.maxAltitude || 0) >= CONFIG.ALT_REF - 1,
        prog: (p) => [Math.min(p.maxAltitude || 0, CONFIG.ALT_REF), CONFIG.ALT_REF],
      },
      {
        id: 'stratosphere', group: 'Divers', icon: '🛰️',
        name: 'Stratosphère',
        desc: 'Atteindre 55 000 ft — seul le Concorde en est capable',
        reward: 500,
        test: (p) => (p.maxAltitude || 0) >= 55000,
        prog: (p) => [Math.min(p.maxAltitude || 0, 55000), 55000],
      },
      {
        id: 'record_50k', group: 'Divers', icon: '🏆',
        name: 'Record : 50 000 km',
        desc: 'Parcourir 50 000 km en une seule tentative',
        reward: 200,
        test: (p) => bestRun(p) >= 50000,
        prog: (p) => [Math.min(bestRun(p), 50000), 50000],
      },
      {
        id: 'lifetime_100k', group: 'Divers', icon: '🌍',
        name: 'Globe-trotteur',
        desc: 'Cumuler 100 000 km à vie (toutes tentatives)',
        reward: 300,
        test: (p) => (p.lifetimeKm || 0) >= 100000,
        prog: (p) => [Math.min(p.lifetimeKm || 0, 100000), 100000],
      },
      {
        id: 'first_creatine', group: 'Divers', icon: '💊',
        name: 'Complément apprécié',
        desc: 'Prendre sa première dose de créatine',
        reward: 30,
        test: (p) => (p.activityLog || []).some(e => e.activityId === 'creatine'),
      },
    );

    return defs;
  }

  let DEFS = null;
  function defs() {
    if (!DEFS) DEFS = buildDefs();
    return DEFS;
  }

  /* ---------- États ---------- */

  function status(p, def) {
    if (p.claimedAchievements && p.claimedAchievements[def.id]) return 'claimed';
    return def.test(p) ? 'unlocked' : 'locked';
  }

  function claimableCount(p) {
    if (!p) return 0;
    return defs().filter(d => status(p, d) === 'unlocked').length;
  }

  /** Réclame le bonus d'un succès débloqué. */
  function claim(id, btnEl) {
    const p = State.current();
    if (!p) return;
    const def = defs().find(d => d.id === id);
    if (!def || status(p, def) !== 'unlocked') return;

    if (!p.claimedAchievements) p.claimedAchievements = {};
    p.claimedAchievements[id] = Date.now();
    const cap = State.tankCapacity(p);
    const added = Math.min(def.reward, Math.max(0, cap - p.kerosene));
    p.kerosene = Math.min(cap, p.kerosene + def.reward);

    // Trace dans le journal des activités (visible par tous les pilotes)
    if (!Array.isArray(p.activityLog)) p.activityLog = [];
    p.activityLog.push({
      activityId: 'achievement',
      achName: def.name,
      achIcon: def.icon,
      minutes: 0,
      kero: Math.round(added),
      date: Date.now(),
    });
    if (p.activityLog.length > 200) p.activityLog.shift();

    State.save();
    Sync.push(p);

    UI.toast(`🏆 Succès « ${def.name} » : +${fmt(added)} L de kérosène !`);
    if (btnEl) UI.keroseneRain(btnEl.getBoundingClientRect(), 6);
    render();
    UI.refreshHUD();
  }

  /* ---------- Interface ---------- */

  function render() {
    const p = State.current();
    if (!p) return;

    const groups = VOYAGE_GROUPS.concat(
      ['Réseau', 'Assiduité', 'Séries', 'Flotte', 'Décors', 'Divers']);
    const all = defs();
    const claimed = all.filter(d => status(p, d) === 'claimed').length;
    $('ach-summary').textContent =
      `${claimed} / ${all.length} succès débloqués et réclamés`;

    let html = '';
    for (const g of groups) {
      const list = all.filter(d => d.group === g);
      if (!list.length) continue;
      html += `<div class="ach-group">${g}</div>`;
      for (const def of list) {
        const st = status(p, def);
        let progHtml = '';
        if (st === 'locked' && def.prog) {
          const [cur, max] = def.prog(p);
          const pct = Math.min(100, cur / max * 100);
          progHtml = `
            <div class="ach-bar"><div class="ach-bar-fill" style="width:${pct}%"></div></div>
            <div class="ach-prog">${fmt(cur)} / ${fmt(max)}</div>`;
        }
        const action =
          st === 'claimed' ? '<span class="ach-done">✓ Réclamé</span>' :
          st === 'unlocked'
            ? `<button class="btn small warm ach-claim" data-ach="${def.id}" type="button">⛽ +${fmt(def.reward)} L</button>`
            : '<span class="ach-lock">🔒</span>';
        html += `
          <div class="ach-row ${st}">
            <span class="ach-icon">${def.icon}</span>
            <span class="ach-info">
              <span class="ach-name">${def.name}</span>
              <span class="ach-desc">${def.desc}</span>
              ${progHtml}
            </span>
            ${action}
          </div>`;
      }
    }
    $('ach-body').innerHTML = html;
    $('ach-body').querySelectorAll('.ach-claim').forEach(btn =>
      btn.addEventListener('click', () => claim(btn.dataset.ach, btn)));
  }

  function open() {
    render();
    $('modal-achievements').classList.add('open');
  }

  /** Pastille sur le bouton 🏆 : nombre de bonus à réclamer. */
  function updateBadge() {
    const p = State.current();
    const el = $('ach-badge');
    if (!el) return;
    const n = p ? claimableCount(p) : 0;
    el.textContent = n;
    el.style.display = n > 0 ? 'flex' : 'none';
  }

  function bind() {
    $('btn-achievements').addEventListener('click', open);
  }

  document.addEventListener('DOMContentLoaded', bind);

  // `_defs` : point d'entrée pour les suites de tests uniquement.
  return { open, claim, claimableCount, updateBadge, _defs: defs };
})();
