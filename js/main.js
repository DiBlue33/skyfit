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
    PWA.init();         // 📲 installable sur l'écran d'accueil + notifications
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

    // 📈 Bascule hebdomadaire AVANT le rattrapage : sinon les kilomètres
    // parcourus hors ligne, crédités d'un bloc juste après, iraient
    // gonfler l'archive de la semaine précédente (voir Weekly.sync).
    const nouveauBilan = Weekly.sync(p);

    // Rattrapage du temps passé navigateur fermé
    const summary = Engine.catchUp(p);
    State.save();
    Sync.push(p);

    // Cet appareil enverra désormais ses alertes à CE pilote. Sur un
    // téléphone partagé, se connecter suffit à reprendre la main sur les
    // notifications : le navigateur n'a qu'un abonnement par appareil.
    PWA.syncSubscription(p.name);

    Scene.setPlane(p.currentPlane);
    UI.refreshHUD();   // peint aussi le ciel via Sky.forPlayer()

    Quests.refresh(true);  // 🎯 arme la semaine et solde les quêtes en attente

    if (summary) UI.offlineSummary(summary);
    UI.streakReminder();   // 🔥 rappel si la série est en sursis
    Wheel.reminder();      // 🎡 rappel si le tour du jour est disponible
    Quests.reminder();     // 🎯 rappel si des récompenses attendent
    Weekly.updateBadge();  // 📈 pastille si le bilan de la semaine est neuf

    // Le lundi, le bilan de la semaine écoulée s'ouvre de lui-même : c'est
    // un rendez-vous, et un rendez-vous qu'il faut penser à honorer n'en
    // est pas un. Après le reste des rappels, pour ne pas les recouvrir.
    if (nouveauBilan) setTimeout(() => Weekly.open(), 900);

    startLoop();
  }

  function startLoop() {
    if (tickInterval) clearInterval(tickInterval);
    tickInterval = setInterval(() => {
      const p = State.current();
      if (!p) return;
      const res = Engine.simulate(p, (Date.now() - p.lastTick) / 1000);
      UI.refreshHUD();
      Quests.refresh();   // 🎯 plafond de la semaine, bascule du lundi, pastille
      // 📈 Une partie laissée ouverte peut franchir minuit du dimanche :
      // sans ce passage, la semaine ne se refermerait jamais.
      if (Weekly.sync(p)) { Weekly.updateBadge(); Weekly.open(); }
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
