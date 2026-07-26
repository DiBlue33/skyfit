/* ============================================================
   SkyFit — Point d'entrée
   ============================================================ */

const Main = (() => {

  let tickInterval = null;
  let worldInterval = null;

  function init() {
    State.load();
    Weather.init();     // 🌬️ vents réels : cache local puis rafraîchissement en fond
    Scene.init();
    UI.bind();
    Sync.startLoop();
    startWorldLoop();   // 👥 les autres pilotes volent aussi sur cet appareil

    // Toujours passer par l'écran d'accueil (connexion par code PIN)
    Auth.showHome();
  }

  /** Vrai si une partie est en cours (l'accueil est refermé). */
  function isPlaying() {
    const home = document.getElementById('home-screen');
    return !!home && !home.classList.contains('open');
  }

  /**
   * 👥 Boucle « monde » : fait avancer les avions des AUTRES pilotes en
   * temps réel, sans attendre qu'ils ouvrent leur profil. Tourne aussi
   * depuis l'écran d'accueil pour que le classement général reste vivant.
   * La prédiction n'est jamais publiée (cf. Engine.simulateOthers).
   */
  function startWorldLoop() {
    if (worldInterval) return;
    worldInterval = setInterval(worldTick, CONFIG.TICK_MS);
  }

  function worldTick() {
    const playing = isPlaying();
    const me = playing ? State.current() : null;
    const moved = Engine.simulateOthers(me ? me.name : null);
    if (!moved.length) return;
    if (playing) UI.refreshScoreboard();   // le HUD est déjà rafraîchi par la boucle de jeu
    else Auth.refreshHome();
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
    UI.streakReminder();   // 🔥 rappel si la série est en sursis

    startLoop();
  }

  function startLoop() {
    if (tickInterval) clearInterval(tickInterval);
    tickInterval = setInterval(() => {
      const p = State.current();
      if (!p) return;
      const res = Engine.simulate(p, (Date.now() - p.lastTick) / 1000);
      UI.refreshHUD();
      if (res && res.route) UI.flightEvents(res.route);   // 🛬 arrivées & changements de cap
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
