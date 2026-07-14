/* ============================================================
   SkyFit — Menu administrateur TEMPORAIRE (tests)
   ------------------------------------------------------------
   Pour retirer complètement l'admin :
   1. supprimer ce fichier et sa balise <script> dans index.html
   2. supprimer le bouton #btn-admin et la modale #modal-admin
      dans index.html
   ============================================================ */

const Admin = (() => {

  const $ = (id) => document.getElementById(id);
  const fmt = (n) => Math.floor(n).toLocaleString('fr-FR');

  function open() {
    const p = State.current();
    if (!p) return;
    $('admin-alt-slider').value = Math.round(p.altitude);
    $('admin-alt-value').textContent = fmt(p.altitude);
    $('modal-admin').classList.add('open');
  }

  function bind() {
    $('btn-admin').addEventListener('click', open);

    $('admin-alt-slider').addEventListener('input', () => {
      $('admin-alt-value').textContent = fmt($('admin-alt-slider').value);
    });

    document.querySelectorAll('[data-admin]').forEach(btn =>
      btn.addEventListener('click', () => handle(btn.dataset.admin, btn.dataset.val)));
  }

  function handle(action, val) {
    const p = State.current();
    if (!p) return;
    const n = parseFloat(val || '0');

    switch (action) {
      case 'points':
        p.bonusPoints = (p.bonusPoints || 0) + n;
        UI.toast(`🔧 +${fmt(n)} points`);
        break;

      case 'points-reset':
        p.bonusPoints = 0;
        p.pointsSpent = 0;
        UI.toast('🔧 Points remis à zéro (dépenses annulées)');
        break;

      case 'kero':
        p.kerosene = Math.min(State.tankCapacity(p), p.kerosene + n);
        UI.toast(`🔧 +${fmt(n)} L de kérosène`);
        break;

      case 'kero-full':
        p.kerosene = State.tankCapacity(p);
        UI.toast('🔧 Réservoir plein');
        break;

      case 'kero-empty':
        p.kerosene = 0;
        UI.toast('🔧 Réservoir vidé');
        break;

      case 'alt-apply':
        p.altitude = Math.max(CONFIG.ALT_MIN,
          Math.min(CONFIG.ALT_MAX, parseInt($('admin-alt-slider').value, 10)));
        UI.toast(`🔧 Altitude réglée à ${fmt(p.altitude)} ft`);
        break;

      case 'time': {
        // Simule n heures de vol (kérosène brûlé, altitude, km, points)
        const res = Engine.simulate(p, n * 3600);
        UI.toast(`🔧 +${fmt(n)} h simulées : ${fmt(res.km)} km, ` +
          `${res.altDelta >= 0 ? '+' : ''}${fmt(res.altDelta)} ft`);
        break;
      }

      case 'km':
        p.totalKm += n;
        p.lifetimeKm += n;
        if (p.totalKm > p.bestKm) p.bestKm = p.totalKm;
        p.points = p.lifetimeKm / CONFIG.KM_PER_POINT;
        UI.toast(`🔧 +${fmt(n)} km`);
        break;

      case 'crash':
        if (p.crashed) { UI.toast('🔧 Déjà au sol !'); break; }
        p.altitude = CONFIG.ALT_MIN;
        p.kerosene = 0;
        Engine.simulate(p, 2); // déclenche le crash proprement
        UI.toast('🔧 💥 Crash provoqué');
        break;

      case 'unlock-all':
        p.ownedPlanes = CONFIG.PLANES.map(pl => pl.id);
        p.ownedDecors = CONFIG.DECORS.map(d => d.id);
        CONFIG.UPGRADES.forEach(u => { p.upgrades[u.id] = u.maxLevel; });
        UI.toast('🔧 Tout est débloqué !');
        break;

      case 'reset-player':
        if (!confirm(`Réinitialiser complètement le pilote « ${p.name} » ?`)) return;
        // Repart de zéro en conservant le nom
        Object.assign(p, {
          lastTick: Date.now(),
          altitude: CONFIG.ALT_START,
          kerosene: 200,
          crashed: false, crashes: 0,
          totalKm: 0, bestKm: 0, lifetimeKm: 0,
          points: 0, pointsSpent: 0, bonusPoints: 0,
          ownedPlanes: ['cessna'], currentPlane: 'cessna',
          ownedDecors: ['day'], currentDecor: 'day',
          upgrades: { yield: 0, aero: 0, tank: 0 },
          activityLog: [], totalSportMinutes: 0,
        });
        Scene.setPlane(p.currentPlane);
        Scene.setDecor(p.currentDecor);
        Scene.setCondition(false, false);
        UI.toast('🔧 Pilote réinitialisé');
        break;
    }

    State.save();
    UI.refreshHUD();
  }

  document.addEventListener('DOMContentLoaded', bind);

  return { open };
})();
