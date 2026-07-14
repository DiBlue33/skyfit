/* ============================================================
   SkyFit — Point d'entrée
   ============================================================ */

const Main = (() => {

  let tickInterval = null;

  function init() {
    State.load();
    Scene.init();
    UI.bind();
    Sync.startLoop();

    // Toujours passer par l'écran d'accueil (connexion par code PIN)
    Auth.showHome();
  }

  function startWithPlayer(name) {
    const p = State.selectPlayer(name);
    if (!p) { Auth.showHome(); return; }

    // Rattrapage du temps passé navigateur fermé
    const summary = Engine.catchUp(p);
    State.save();
    Sync.push(p);

    Scene.setPlane(p.currentPlane);
    Scene.setDecor(p.currentDecor);
    UI.refreshHUD();

    if (summary) UI.offlineSummary(summary);

    startLoop();
  }

  function startLoop() {
    if (tickInterval) clearInterval(tickInterval);
    tickInterval = setInterval(() => {
      const p = State.current();
      if (!p) return;
      Engine.simulate(p, (Date.now() - p.lastTick) / 1000);
      UI.refreshHUD();
    }, CONFIG.TICK_MS);

    if (startLoop.bound) return;
    startLoop.bound = true;

    // Sauvegarde régulière + à la fermeture
    setInterval(() => State.save(), 15000);
    window.addEventListener('beforeunload', () => {
      const p = State.current();
      if (p) { p.lastTick = Date.now(); State.save(); }
    });

    // Quand l'onglet redevient visible, rattraper le temps passé caché
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        const p = State.current();
        if (p) {
          const summary = Engine.catchUp(p);
          State.save();
          UI.refreshHUD();
          if (summary && summary.seconds >= 600) UI.offlineSummary(summary);
        }
      }
    });
  }

  /** Arrête la boucle de jeu (déconnexion). */
  function stopLoop() {
    if (tickInterval) { clearInterval(tickInterval); tickInterval = null; }
  }

  document.addEventListener('DOMContentLoaded', init);

  return { startWithPlayer, stopLoop };
})();
