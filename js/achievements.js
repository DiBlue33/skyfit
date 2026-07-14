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

  const CITY_ICONS = {
    'Rome': '🏛️', 'Le Caire': '🐪', 'Dubaï': '🌆', 'Bombay': '🕌',
    'Bangkok': '🛕', 'Tokyo': '⛩️', 'Honolulu': '🌺', 'Los Angeles': '🎬',
    'Mexico': '🌵', 'New York': '🗽', 'Dakar': '🦁', 'Paris': '🗼',
  };

  function slug(s) {
    return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '_');
  }

  function buildDefs() {
    const defs = [];

    // --- Voyages : atteindre chaque escale en une seule tentative ---
    WorldMap.stops().forEach(stop => {
      const isParis = stop.name === 'Paris';
      defs.push({
        id: 'visit_' + slug(stop.name),
        group: 'Voyages',
        icon: CITY_ICONS[stop.name] || '📍',
        name: isParis ? 'Tour du monde complet !' : `Visite à ${stop.name}`,
        desc: isParis
          ? `Revenir à Paris : ${fmt(stop.km)} km en une seule tentative`
          : `Atteindre ${stop.name} (${fmt(stop.km)} km) sans crasher`,
        reward: isParis ? 500 : 100,
        test: (p) => bestRun(p) >= stop.km,
        prog: (p) => [Math.min(bestRun(p), stop.km), stop.km],
      });
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
        id: 'ceiling', group: 'Divers', icon: '🚀',
        name: 'Plafond du monde',
        desc: `Atteindre l'altitude maximale : ${fmt(CONFIG.ALT_MAX)} ft`,
        reward: 200,
        test: (p) => (p.maxAltitude || 0) >= CONFIG.ALT_MAX - 1,
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

    const groups = ['Voyages', 'Assiduité', 'Flotte', 'Décors', 'Divers'];
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

  return { open, claim, claimableCount, updateBadge };
})();
