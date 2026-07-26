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
      return { km: 0, altDelta: 0, crashed: false, wind: 0 };
    }
    if (seconds <= 0) return { km: 0, altDelta: 0, crashed: false, wind: 0 };

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
          windFactor = Weather.factorFor(kmNow, player.altitude, simTime, airspeed);
          windRefTime = simTime; windRefKm = kmNow; windRefAlt = player.altitude;
        }
      }

      const speedKmh = airspeed * windFactor;
      const step = speedKmh * (dt / 3600);
      kmGained += step;
      windSumKm += step;
      windSumRatio += (windFactor - 1) * step;
    }

    // Effet moyen du vent sur la distance de ce pas de simulation
    const avgWind = windSumKm > 0 ? windSumRatio / windSumKm : 0;

    player.totalKm += kmGained;
    player.lifetimeKm += kmGained;
    if (player.totalKm > player.bestKm) player.bestKm = player.totalKm;
    player.points = player.lifetimeKm / CONFIG.KM_PER_POINT;
    player.lastTick = Date.now();

    if (justCrashed) doCrash(player);

    return { km: kmGained, altDelta: player.altitude - startAlt, crashed: justCrashed, wind: avgWind };
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
      ? { seconds: elapsedS, km: res.km, altDelta: res.altDelta, crashed: res.crashed, wind: res.wind }
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

  return { simulate, catchUp, logActivity, upgradeCost, buyPlane, buyDecor, buyUpgrade };
})();
