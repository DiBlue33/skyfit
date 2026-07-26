/* ============================================================
   SkyFit — Séries de jours consécutifs 🔥 (streaks)
   ------------------------------------------------------------
   Une « série » = des jours calendaires consécutifs comportant
   au moins une séance de SPORT (la créatine et les succès ne
   comptent pas : ce sont des bonus, pas de l'effort).

   Chaque jour de série augmente le rendement du kérosène :
       jour 1 → ×1,0   jour 2 → ×1,1   …   jour 11+ → ×2,0

   La série est « en sursis » quand elle tient grâce à hier mais
   que rien n'a encore été enregistré aujourd'hui : le joueur a
   jusqu'à minuit pour la sauver.
   ============================================================ */

const Streak = (() => {

  /* ---------- Outils de dates (robustes au changement d'heure) ---------- */

  function startOfDay(ts) {
    const d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  function prevDay(ts) {
    const d = new Date(ts);
    d.setDate(d.getDate() - 1);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  /** Une activité entretient-elle la série ? (sport uniquement) */
  function counts(activityId) {
    // Événements de jeu (succès, escale, roue) : ce n'est pas du sport
    if ((CONFIG.META_ENTRIES || {})[activityId]) return false;
    const act = CONFIG.ACTIVITIES.find(a => a.id === activityId);
    if (act && act.fixed) return false;   // créatine & futurs bonus fixes
    return true;                          // sports actuels + anciens (legacy)
  }

  /** Ensemble des jours (minuit, ms) comportant au moins une séance. */
  function activeDays(player) {
    const set = new Set();
    (player && player.activityLog ? player.activityLog : []).forEach(e => {
      if (!e || !counts(e.activityId)) return;
      const ts = Number(e.date);
      if (!isFinite(ts)) return;
      set.add(startOfDay(ts));
    });
    return set;
  }

  /** Longueur de la série qui se termine le jour de `ts` (ce jour inclus). */
  function runEndingAt(set, ts) {
    let n = 0;
    let cur = startOfDay(ts);
    while (set.has(cur)) { n++; cur = prevDay(cur); }
    return n;
  }

  /* ---------- Série en cours ---------- */

  /**
   * État de la série du joueur.
   * @returns { days, mult, pending, alive }
   *   days    : nombre de jours consécutifs
   *   mult    : multiplicateur de kérosène associé
   *   pending : série vivante mais rien enregistré aujourd'hui
   *   alive   : days > 0
   */
  function current(player, now) {
    const ref = (typeof now === 'number' && isFinite(now)) ? now : Date.now();
    const set = activeDays(player);
    const today = startOfDay(ref);

    if (set.has(today)) {
      const days = runEndingAt(set, today);
      return { days, mult: multiplier(days), pending: false, alive: true };
    }
    const yesterday = prevDay(today);
    if (set.has(yesterday)) {
      const days = runEndingAt(set, yesterday);
      return { days, mult: multiplier(days), pending: true, alive: true };
    }
    return { days: 0, mult: 1, pending: false, alive: false };
  }

  /**
   * Série qui résulterait de l'enregistrement d'une séance le jour de `ts`.
   * Sert à calculer le bonus AVANT d'ajouter la séance au journal.
   */
  function forSession(player, ts, activityId) {
    const set = activeDays(player);
    if (counts(activityId)) {
      // La séance à venir rend ce jour actif
      set.add(startOfDay(ts));
      return runEndingAt(set, ts);
    }
    // Bonus fixe (créatine) : il profite de la série sans la prolonger
    return current(player, ts).days;
  }

  /** Multiplicateur de kérosène pour une série de n jours. */
  function multiplier(days) {
    if (!(days > 1)) return 1;
    const S = CONFIG.STREAK;
    return Math.min(S.MAX_MULT, 1 + (days - 1) * S.BONUS_PER_DAY);
  }

  /** Nombre de jours nécessaires pour atteindre le multiplicateur maximal. */
  function daysForMaxMult() {
    const S = CONFIG.STREAK;
    return Math.round(1 + (S.MAX_MULT - 1) / S.BONUS_PER_DAY);
  }

  /** Plus longue série jamais réalisée (journal + record mémorisé). */
  function best(player) {
    const days = Array.from(activeDays(player)).sort((a, b) => a - b);
    let record = 0, run = 0, prev = null;
    for (const d of days) {
      run = (prev !== null && prevDay(d) === prev) ? run + 1 : 1;
      prev = d;
      if (run > record) record = run;
    }
    return Math.max(record, (player && player.bestStreak) || 0);
  }

  /* ---------- Affichage ---------- */

  const fmtMult = (m) => '×' + m.toFixed(1).replace('.', ',');

  /** Petit libellé « 5 jours · ×1,4 » (ou invitation à démarrer). */
  function label(player, now) {
    const s = current(player, now);
    if (!s.alive) return '🔥 Aucune série en cours';
    const j = s.days > 1 ? 'jours' : 'jour';
    return `🔥 ${s.days} ${j} d'affilée · ${fmtMult(s.mult)} kérosène`;
  }

  return {
    counts, activeDays, current, forSession, multiplier,
    daysForMaxMult, best, label, fmtMult, startOfDay, prevDay,
  };
})();
