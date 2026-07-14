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
      return { km: 0, altDelta: 0, crashed: false };
    }
    if (seconds <= 0) return { km: 0, altDelta: 0, crashed: false };

    const startAlt = player.altitude;
    let remaining = seconds;
    let kmGained = 0;
    let justCrashed = false;

    const decayPerS = (CONFIG.DECAY_FT_PER_HOUR * State.decayFactor(player)) / 3600;
    const burnPerS  = CONFIG.BURN_RATE_L_PER_HOUR / 3600;   // L/s
    const mult      = State.speedMult(player);

    while (remaining > 0) {
      const dt = Math.min(CONFIG.SIM_STEP_S, remaining);
      remaining -= dt;

      // 1) Montée : brûler du kérosène si disponible
      if (player.kerosene > 0) {
        const burned = Math.min(player.kerosene, burnPerS * dt);
        player.kerosene -= burned;
        player.altitude += burned * CONFIG.CLIMB_FT_PER_LITRE;
      }

      // 2) Descente naturelle (toujours active)
      player.altitude -= decayPerS * dt;
      if (player.altitude > CONFIG.ALT_MAX) player.altitude = CONFIG.ALT_MAX;

      // 3) CRASH : altitude tombée à 0
      if (player.altitude <= CONFIG.ALT_MIN) {
        player.altitude = CONFIG.ALT_MIN;
        justCrashed = true;
        break;
      }

      // 4) Distance parcourue pendant ce pas
      const speedKmh = CONFIG.speedForAlt(player.altitude) * mult;
      kmGained += speedKmh * (dt / 3600);
    }

    player.totalKm += kmGained;
    player.lifetimeKm += kmGained;
    if (player.totalKm > player.bestKm) player.bestKm = player.totalKm;
    player.points = player.lifetimeKm / CONFIG.KM_PER_POINT;
    player.lastTick = Date.now();

    if (justCrashed) doCrash(player);

    return { km: kmGained, altDelta: player.altitude - startAlt, crashed: justCrashed };
  }

  /** Crash : le record est archivé, le score de la tentative repart à 0. */
  function doCrash(player) {
    player.crashed = true;
    player.crashes += 1;
    player.kerosene = 0;
    if (player.totalKm > player.bestKm) player.bestKm = player.totalKm;
    player.totalKm = 0;   // le score recommence à zéro
    State.save();
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

    const summaryWorthy = elapsedS >= 120;
    const res = simulate(player, elapsedS);

    return summaryWorthy
      ? { seconds: elapsedS, km: res.km, altDelta: res.altDelta, crashed: res.crashed }
      : null;
  }

  /**
   * Enregistre une séance de sport : ajoute du kérosène.
   * Si l'avion est crashé, la séance le fait REDÉCOLLER.
   * Retourne { litres ajoutés, tookOff }.
   */
  function logActivity(player, activityId, minutes) {
    const act = CONFIG.ACTIVITIES.find(a => a.id === activityId);
    if (!act || !(minutes > 0)) return { litres: 0, tookOff: false };

    let tookOff = false;
    if (player.crashed) {
      player.crashed = false;
      player.altitude = CONFIG.ALT_START;
      player.lastTick = Date.now();
      tookOff = true;
    }

    const litres = act.keroPerMin * minutes * State.keroYield(player);
    const cap = State.tankCapacity(player);
    const added = Math.min(litres, cap - player.kerosene);
    player.kerosene = Math.min(cap, player.kerosene + litres);

    // Défense : Firebase peut avoir supprimé la liste si elle était vide
    if (!Array.isArray(player.activityLog)) player.activityLog = [];
    player.activityLog.push({
      activityId, minutes,
      kero: Math.round(added),
      date: Date.now(),
    });
    if (player.activityLog.length > 200) player.activityLog.shift();
    player.totalSportMinutes += minutes;

    State.save();
    return { litres: added, tookOff };
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

  return { simulate, catchUp, logActivity, upgradeCost, buyPlane, buyDecor, buyUpgrade };
})();
