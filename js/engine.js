/* ============================================================
   SkyFit — Moteur de simulation
   ------------------------------------------------------------
   Le même code simule le temps réel (tick de 1 s) et le temps
   écoulé navigateur fermé (rattrapage au chargement).
   ============================================================ */

const Engine = (() => {

  /**
   * Fait avancer la simulation d'un joueur de `seconds` secondes.
   * - Brûle du kérosène pour monter tant que la réserve > 0
   * - Applique la perte d'altitude en continu
   * - Intègre la distance parcourue selon la vitesse (liée à l'altitude)
   */
  function simulate(player, seconds) {
    // Avion au sol après un crash : le temps passe mais rien n'avance
    if (player.crashed) {
      player.lastTick = Date.now();
      return { km: 0, altDelta: 0, crashed: false, wind: 0, route: noRouteEvents() };
    }
    if (seconds <= 0) return { km: 0, altDelta: 0, crashed: false, wind: 0, route: noRouteEvents() };

    const startAlt = player.altitude;
    let remaining = seconds;
    let kmGained = 0;
    let justCrashed = false;

    const decayPerS = (CONFIG.DECAY_FT_PER_HOUR * State.decayFactor(player)) / 3600;
    const burnPerS  = CONFIG.BURN_RATE_L_PER_HOUR / 3600;   // L/s
    const mult      = State.speedMult(player);

    // 🌬️ Vent : la composante dans l'axe du vol modifie la vitesse sol.
    // Recalculé par paliers (temps / distance / altitude) pour rester rapide
    // même sur un rattrapage de plusieurs jours.
    const windOn = CONFIG.WEATHER.ENABLED && typeof Weather !== 'undefined';
    let simTime = player.lastTick || Date.now();
    let windFactor = 1;
    let windRefTime = -Infinity, windRefKm = 0, windRefAlt = -Infinity;
    let windSumKm = 0, windSumRatio = 0;   // moyenne pondérée pour le résumé

    // 🗺️ Événements de route rencontrés pendant ce pas de simulation
    const routeEvents = noRouteEvents();

    while (remaining > 0) {
      const dt = Math.min(CONFIG.SIM_STEP_S, remaining);
      remaining -= dt;
      simTime += dt * 1000;

      // 1) Montée : brûler du kérosène si disponible
      if (player.kerosene > 0) {
        const burned = Math.min(player.kerosene, burnPerS * dt);
        player.kerosene -= burned;
        player.altitude += burned * CONFIG.CLIMB_FT_PER_LITRE;
      }

      // 2) Descente naturelle (toujours active)
      player.altitude -= decayPerS * dt;
      if (player.altitude > CONFIG.ALT_MAX) player.altitude = CONFIG.ALT_MAX;
      if (player.altitude > (player.maxAltitude || 0)) player.maxAltitude = player.altitude;

      // 3) CRASH : altitude tombée à 0
      if (player.altitude <= CONFIG.ALT_MIN) {
        player.altitude = CONFIG.ALT_MIN;
        justCrashed = true;
        break;
      }

      // 4) Distance parcourue pendant ce pas (vitesse air puis vitesse sol)
      const airspeed = CONFIG.speedForAlt(player.altitude) * mult;

      if (windOn) {
        const kmNow = player.totalKm + kmGained;
        if (simTime - windRefTime >= 900000 ||          // 15 min de simulation
            Math.abs(kmNow - windRefKm) >= 150 ||       // 150 km parcourus
            Math.abs(player.altitude - windRefAlt) >= 2000) {
          windFactor = Weather.factorFor(Routes.geo(player), player.altitude, simTime, airspeed);
          windRefTime = simTime; windRefKm = kmNow; windRefAlt = player.altitude;
        }
      }

      const speedKmh = airspeed * windFactor;
      const step = speedKmh * (dt / 3600);
      kmGained += step;
      windSumKm += step;
      windSumRatio += (windFactor - 1) * step;

      // 5) Avancement le long de la route active (aller-retour sans fin)
      const ev = Routes.advance(player, step);
      if (ev.baseTouches) {
        routeEvents.baseTouches += ev.baseTouches;
        player.baseTouches = (player.baseTouches || 0) + ev.baseTouches;
      }
      if (ev.switched) routeEvents.switched = ev.switched;
      if (ev.arrivals.length) {
        player.landings = (player.landings || 0) + ev.arrivals.length;
        ev.arrivals.forEach(city => {
          routeEvents.arrivals.push(city);
          if (!Array.isArray(player.visited)) player.visited = [];
          if (player.visited.indexOf(city) < 0) {
            // 🎉 Première visite : prime de kérosène généreuse (une seule fois)
            player.visited.push(city);
            const bonus = arrivalBonus(player, city);
            player.kerosene = Math.min(State.tankCapacity(player), player.kerosene + bonus);
            routeEvents.firstVisits.push({ city, kero: bonus });
            logDiscovery(player, city, bonus, simTime);
          }
        });
      }
    }

    // Effet moyen du vent sur la distance de ce pas de simulation
    const avgWind = windSumKm > 0 ? windSumRatio / windSumKm : 0;

    player.totalKm += kmGained;
    player.lifetimeKm += kmGained;
    if (player.totalKm > player.bestKm) player.bestKm = player.totalKm;
    player.points = player.lifetimeKm / CONFIG.KM_PER_POINT;
    player.lastTick = Date.now();

    if (justCrashed) doCrash(player);

    return {
      km: kmGained, altDelta: player.altitude - startAlt,
      crashed: justCrashed, wind: avgWind, route: routeEvents,
    };
  }

  function noRouteEvents() {
    return { arrivals: [], firstVisits: [], baseTouches: 0, switched: null };
  }

  /**
   * Prime de PREMIÈRE visite d'une ville : proportionnelle à l'éloignement,
   * plafonnée aux trois quarts du réservoir pour rester utile.
   */
  function arrivalBonus(player, city) {
    const r = Routes.byCity(city);
    const km = r ? r.km : 500;
    return Math.round(Math.min(State.tankCapacity(player) * 0.75,
                               Math.max(200, km * 0.3)));
  }

  /** Trace la découverte dans le journal partagé (visible par l'autre pilote). */
  function logDiscovery(player, city, kero, ts) {
    const r = Routes.byCity(city);
    if (!Array.isArray(player.activityLog)) player.activityLog = [];
    player.activityLog.push({
      activityId: 'discovery',
      minutes: 0,
      kero: Math.round(kero),
      date: (typeof ts === 'number' && isFinite(ts)) ? ts : Date.now(),
      loggedAt: Date.now(),
      city: city,
      cityIcon: r ? r.icon : '📍',
    });
    if (player.activityLog.length > 500) player.activityLog.shift();
  }

  /** Crash : le record est archivé, le score de la tentative repart à 0. */
  function doCrash(player) {
    player.crashed = true;
    player.crashes += 1;
    player.kerosene = 0;
    if (player.totalKm > player.bestKm) player.bestKm = player.totalKm;
    player.totalKm = 0;   // le score recommence à zéro
    Routes.resetToBase(player);   // on repart de LFPG, route conservée
    // En mode fantôme, on n'estampille jamais le profil de l'autre pilote :
    // sa version réelle doit rester prioritaire à la fusion.
    if (ghost) State.save(null, true);
    else State.save();
  }

  /* ============================================================
     👥 Pilotes « fantômes » — les AUTRES profils continuent de voler
     ------------------------------------------------------------
     Sans cela, l'avion de l'autre pilote reste figé tant qu'il n'a pas
     ouvert son profil : il fallait se connecter à son compte pour le
     voir avancer. On rejoue donc ici, en local, exactement la même
     simulation pour tous les autres profils.

     Règle d'or : c'est une PRÉDICTION d'affichage.
       • `updatedAt` n'est jamais touché → rien n'est publié dans le
         cloud (`pushNewer` ne pousse que du plus récent), donc la
         version réelle de l'appareil de l'autre pilote gagne toujours
         à la fusion et corrige la prédiction.
       • Le cumul est mémorisé (`ghostLog`) pour que le pilote retrouve
         son résumé « pendant ton absence » à sa prochaine connexion.
     ============================================================ */

  let ghost = false;            // vrai pendant la simulation d'un autre profil
  let lastGhostSave = 0;        // sauvegarde locale throttlée
  const ghostLog = {};          // nom -> cumul non encore consulté

  function blankGhost() {
    return { seconds: 0, km: 0, altDelta: 0, crashed: false,
             windKm: 0, windSum: 0, route: noRouteEvents() };
  }

  function noteGhost(name, seconds, res) {
    const g = ghostLog[name] || (ghostLog[name] = blankGhost());
    g.seconds += seconds;
    g.km += res.km;
    g.altDelta += res.altDelta;
    g.crashed = g.crashed || res.crashed;
    g.windKm += res.km;
    g.windSum += res.wind * res.km;
    g.route.baseTouches += res.route.baseTouches;
    if (res.route.switched) g.route.switched = res.route.switched;
    g.route.arrivals.push(...res.route.arrivals);
    g.route.firstVisits.push(...res.route.firstVisits);
    // Bornes de sécurité : ce cumul vit en mémoire tant que le pilote
    // ne se connecte pas sur cet appareil.
    if (g.route.arrivals.length > 60) g.route.arrivals.splice(0, g.route.arrivals.length - 60);
    if (g.route.firstVisits.length > 30) g.route.firstVisits.splice(0, g.route.firstVisits.length - 30);
  }

  /** Récupère (et vide) le cumul fantôme d'un pilote qui se connecte. */
  function takeGhost(name) {
    const g = ghostLog[name];
    if (!g) return null;
    delete ghostLog[name];
    g.wind = g.windKm > 0 ? g.windSum / g.windKm : 0;
    return g;
  }

  /**
   * Fait avancer tous les profils SAUF celui passé en paramètre.
   * @param exceptName pilote déjà simulé par la boucle de jeu (ou null)
   * @returns [{ name, km, altDelta, crashed, route }] pour les pilotes ayant bougé
   */
  function simulateOthers(exceptName) {
    const now = Date.now();
    const capS = CONFIG.MAX_OFFLINE_DAYS * 86400;
    const moved = [];
    ghost = true;
    try {
      State.allPlayers().forEach(p => {
        if (!p || !p.name || p.name === exceptName) return;
        let elapsedS = (now - (p.lastTick || now)) / 1000;
        if (!isFinite(elapsedS) || elapsedS <= 0) return;   // horloge en arrière
        if (elapsedS < 0.25) return;                        // rien de neuf
        if (elapsedS > capS) elapsedS = capS;
        const res = simulate(p, elapsedS);
        noteGhost(p.name, elapsedS, res);
        moved.push({ name: p.name, km: res.km, altDelta: res.altDelta,
                     crashed: res.crashed, route: res.route });
      });
    } finally {
      ghost = false;
    }
    // Sauvegarde locale SANS estampiller : la prédiction ne part pas au cloud.
    // Throttlée à 10 s — si l'onglet se ferme entre-temps rien n'est perdu :
    // le `lastTick` resté en arrière fera simplement le rattrapage au retour.
    if (moved.length && now - lastGhostSave > 10000) {
      lastGhostSave = now;
      State.save(null, true);
    }
    return moved;
  }

  /**
   * Rattrape le temps écoulé depuis le dernier tick (navigateur fermé).
   * Retourne un résumé pour affichage, ou null si < 2 minutes.
   */
  function catchUp(player) {
    const now = Date.now();
    let elapsedS = (now - player.lastTick) / 1000;
    if (elapsedS < 0) elapsedS = 0; // horloge modifiée
    const capS = CONFIG.MAX_OFFLINE_DAYS * 86400;
    if (elapsedS > capS) elapsedS = capS;

    const res = simulate(player, elapsedS);

    // Ce pilote a peut-être déjà volé « en fantôme » pendant qu'un autre
    // profil était en jeu sur cet appareil : on recolle les deux morceaux
    // pour qu'il retrouve un résumé complet.
    const g = takeGhost(player.name);
    const seconds  = elapsedS + (g ? g.seconds : 0);
    const km       = res.km + (g ? g.km : 0);
    const altDelta = res.altDelta + (g ? g.altDelta : 0);
    const windKm   = res.km + (g ? g.windKm : 0);
    const windSum  = res.wind * res.km + (g ? g.windSum : 0);
    const route    = g ? {
      arrivals:    g.route.arrivals.concat(res.route.arrivals),
      firstVisits: g.route.firstVisits.concat(res.route.firstVisits),
      baseTouches: g.route.baseTouches + res.route.baseTouches,
      switched:    res.route.switched || g.route.switched,
    } : res.route;

    return seconds >= 120
      ? { seconds, km, altDelta, crashed: res.crashed || (g ? g.crashed : false),
          wind: windKm > 0 ? windSum / windKm : 0, route }
      : null;
  }

  /**
   * Enregistre une séance de sport : ajoute du kérosène.
   * Si l'avion est crashé, la séance le fait REDÉCOLLER.
   * Retourne { litres ajoutés, tookOff }.
   */
  function logActivity(player, activityId, minutes, when) {
    const act = CONFIG.ACTIVITIES.find(a => a.id === activityId);
    if (!act) return { litres: 0, tookOff: false };
    if (act.fixed) minutes = 0;
    else if (!(minutes > 0)) return { litres: 0, tookOff: false };

    // Date/heure de début de la séance (choisie par le joueur, sinon maintenant)
    const ts = (typeof when === 'number' && isFinite(when)) ? when : Date.now();

    // Bonus limités à une prise par jour (ex : créatine) — jour de la séance
    if (act.oncePerDay) {
      const day = new Date(ts).toDateString();
      const already = (player.activityLog || []).some(e =>
        e.activityId === activityId && new Date(e.date).toDateString() === day);
      if (already) return { litres: 0, tookOff: false, alreadyToday: true };
    }

    let tookOff = false;
    if (player.crashed) {
      player.crashed = false;
      player.altitude = CONFIG.ALT_START;
      player.lastTick = Date.now();
      tookOff = true;
    }

    // 🔥 Série de jours consécutifs : état AVANT et APRÈS cette séance
    const before = Streak.current(player, ts).days;
    const streakDays = Streak.forSession(player, ts, activityId);
    const streakMult = Streak.multiplier(streakDays);

    const base = (act.fixed ? act.keroBonus : act.keroPerMin * minutes) *
      State.keroYield(player);
    const litres = base * streakMult;
    const streakBonus = litres - base;   // litres dus à la série
    const cap = State.tankCapacity(player);
    const added = Math.min(litres, cap - player.kerosene);
    player.kerosene = Math.min(cap, player.kerosene + litres);

    // Défense : Firebase peut avoir supprimé la liste si elle était vide
    if (!Array.isArray(player.activityLog)) player.activityLog = [];
    player.activityLog.push({
      activityId, minutes,
      kero: Math.round(added),
      date: ts,             // début de la séance
      loggedAt: Date.now(), // moment de l'enregistrement
      streak: streakDays,   // série au moment de la séance 🔥
    });
    if (player.activityLog.length > 500) player.activityLog.shift();
    player.totalSportMinutes += minutes;
    player.totalSessions = (player.totalSessions || 0) + 1;

    // Record de série (mémorisé : le journal est plafonné à 500 entrées)
    const record = Streak.best(player);
    if (record > (player.bestStreak || 0)) player.bestStreak = record;

    State.save();
    return {
      litres: added, tookOff,
      streak: streakDays,
      streakMult,
      streakBonus: Math.max(0, Math.round(streakBonus)),
      streakUp: streakDays > before,   // un jour de plus dans la série
      streakRecord: player.bestStreak > 0 && streakDays >= player.bestStreak,
    };
  }

  // --- Achats boutique ---

  function upgradeCost(upgrade, level) {
    return Math.round(upgrade.baseCost * Math.pow(upgrade.costMult, level));
  }

  function buyPlane(player, planeId) {
    const plane = CONFIG.PLANES.find(p => p.id === planeId);
    if (!plane) return false;
    if (!player.ownedPlanes.includes(planeId)) {
      if (State.availablePoints(player) < plane.cost) return false;
      player.pointsSpent += plane.cost;
      player.ownedPlanes.push(planeId);
    }
    player.currentPlane = planeId;
    State.save();
    return true;
  }

  function buyDecor(player, decorId) {
    const decor = CONFIG.DECORS.find(d => d.id === decorId);
    if (!decor) return false;
    if (!player.ownedDecors.includes(decorId)) {
      if (State.availablePoints(player) < decor.cost) return false;
      player.pointsSpent += decor.cost;
      player.ownedDecors.push(decorId);
    }
    player.currentDecor = decorId;
    State.save();
    return true;
  }

  function buyUpgrade(player, upgradeId) {
    const up = CONFIG.UPGRADES.find(u => u.id === upgradeId);
    if (!up) return false;
    const level = player.upgrades[upgradeId] || 0;
    if (level >= up.maxLevel) return false;
    const cost = upgradeCost(up, level);
    if (State.availablePoints(player) < cost) return false;
    player.pointsSpent += cost;
    player.upgrades[upgradeId] = level + 1;
    State.save();
    return true;
  }

  /* --- Routes (v2.3) --- */

  /** Achat définitif d'une route. Ne la rend pas active pour autant. */
  function buyRoute(player, routeId) {
    const r = Routes.byId(routeId);
    if (!r) return { ok: false, reason: 'inconnue' };
    if (Routes.isOwned(player, routeId)) return { ok: true, bought: false, route: r };
    if (State.availablePoints(player) < r.cost) return { ok: false, reason: 'points', route: r };
    if (!Array.isArray(player.ownedRoutes)) player.ownedRoutes = [Routes.DEFAULT_ROUTE];
    player.pointsSpent += r.cost;
    player.ownedRoutes.push(routeId);
    State.save();
    return { ok: true, bought: true, route: r };
  }

  /**
   * Demande d'envoi de l'avion sur une route.
   * Le changement n'est effectif qu'à la prochaine VERTICALE DE LFPG —
   * sauf si l'avion y est déjà (ou au sol après un crash).
   */
  function setRoute(player, routeId) {
    const r = Routes.byId(routeId);
    if (!r) return { ok: false, reason: 'inconnue' };
    if (!Routes.isOwned(player, routeId)) return { ok: false, reason: 'non_achetee', route: r };

    if (player.currentRoute === routeId) {
      player.pendingRoute = null;
      State.save();
      return { ok: true, immediate: true, already: true, route: r };
    }
    const atBase = player.crashed || (player.legDir === 0 && (player.legKm || 0) <= 1);
    if (atBase) {
      player.currentRoute = routeId;
      player.pendingRoute = null;
      player.legKm = 0;
      player.legDir = 0;
      State.save();
      return { ok: true, immediate: true, route: r };
    }
    player.pendingRoute = routeId;
    State.save();
    return { ok: true, immediate: false, route: r, eta: etaToBase(player) };
  }

  /** Annule une demande de changement de route encore en attente. */
  function cancelPendingRoute(player) {
    player.pendingRoute = null;
    State.save();
  }

  /** Distance et durée estimées jusqu'au prochain passage à la verticale de LFPG. */
  function etaToBase(player) {
    const g = Routes.geo(player);
    const len = g.route.km || 1;
    const km = g.outbound ? (len - g.legKm) + len : g.legKm;
    const speed = player.crashed
      ? 0
      : CONFIG.speedForAlt(player.altitude) * State.speedMult(player);
    return { km: Math.round(km), hours: speed > 0 ? km / speed : null };
  }

  return {
    simulate, catchUp, simulateOthers, logActivity, upgradeCost,
    buyPlane, buyDecor, buyUpgrade,
    buyRoute, setRoute, cancelPendingRoute, etaToBase, arrivalBonus,
  };
})();
