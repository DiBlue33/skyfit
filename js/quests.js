/* ============================================================
   SkyFit — Quêtes 🎯 (v3.0)
   ------------------------------------------------------------
   Deux mécaniques complémentaires :

   • CARRIÈRES (permanentes) — 5 chaînes de progression. Une seule
     étape est visible à la fois : on réclame, l'étape suivante
     apparaît, la récompense grimpe. Elles poussent au développement
     (lignes, flotte, endurance, altitude, compagnie).

   • HEBDOMADAIRES — 3 quêtes (facile / moyenne / difficile) tirées
     le lundi. Le tirage est DÉTERMINISTE : il ne dépend que du lundi
     de la semaine, donc les deux pilotes reçoivent exactement les
     mêmes quêtes et le panneau fait aussi office de duel.

   Robustesse : aucune progression n'est comptée « à l'événement ».
   Tout est RECALCULÉ à la volée depuis le journal (daté) et depuis
   un instantané des compteurs pris le lundi. Une séance ajoutée
   depuis le téléphone de l'autre pilote, ou une escale franchie
   navigateur fermé, comptent donc de la même façon.

   Rien n'est jamais perdu : une quête terminée mais non réclamée
   avant le lundi suivant est créditée d'office au tirage suivant.
   ============================================================ */

const Quests = (() => {

  const $ = (id) => document.getElementById(id);
  const fmt = (n) => Math.floor(n).toLocaleString('fr-FR');
  const Q = () => CONFIG.QUESTS;
  const DAY = 86400000;
  const BONUS_ID = '_bonus';

  /* ------------------------------------------------------------
     Repères de temps
     ------------------------------------------------------------ */

  /** Lundi 00:00 (heure locale) de la semaine contenant `ts`. */
  function weekStart(ts) {
    const d = new Date(typeof ts === 'number' ? ts : Date.now());
    d.setHours(0, 0, 0, 0);
    const dow = (d.getDay() + 6) % 7;   // 0 = lundi … 6 = dimanche
    d.setDate(d.getDate() - dow);
    return d.getTime();
  }

  /** Lundi suivant (robuste au changement d'heure : on vise le mardi). */
  function weekEnd(ws) {
    return weekStart(ws + 8 * DAY);
  }

  function dayKey(ts) {
    const d = new Date(ts);
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  }

  /** Temps restant avant le tirage suivant, en clair. */
  function timeLeft(now) {
    const ms = weekEnd(weekStart(now || Date.now())) - (now || Date.now());
    const h = Math.max(0, Math.floor(ms / 3600000));
    const d = Math.floor(h / 24);
    if (d >= 1) return `${d} j ${h % 24} h`;
    if (h >= 1) return `${h} h`;
    return `${Math.max(1, Math.floor(ms / 60000))} min`;
  }

  /* ------------------------------------------------------------
     Tirage déterministe de la semaine
     ------------------------------------------------------------ */

  function hash(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
    return h >>> 0;
  }

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /**
   * Les 3 quêtes de la semaine du lundi `ws` : une par palier, en
   * évitant deux quêtes de la même famille. Même semaine → même liste,
   * pour tous les pilotes et sur tous les appareils.
   */
  function draw(ws) {
    const rnd = mulberry32(hash('skyfit-quests-' + ws));
    const picks = [];
    Q().TIERS.forEach(tier => {
      const pool = Q().WEEKLY.filter(q => q.tier === tier.id);
      if (!pool.length) return;
      const start = Math.floor(rnd() * pool.length);
      let chosen = null;
      for (let k = 0; k < pool.length; k++) {
        const cand = pool[(start + k) % pool.length];
        if (!picks.some(q => q.family === cand.family)) { chosen = cand; break; }
      }
      picks.push(chosen || pool[start]);
    });
    return picks;
  }

  /** Quêtes de la semaine en cours (ou d'une semaine donnée). */
  function weekly(ts) {
    return draw(weekStart(ts));
  }

  /* ------------------------------------------------------------
     Mesures
     ------------------------------------------------------------ */

  const isMeta = (id) => !!(CONFIG.META_ENTRIES || {})[id];

  /** Séance de sport « réelle » : ni événement de jeu, ni bonus fixe. */
  function isSport(e) {
    if (!e || isMeta(e.activityId)) return false;
    const act = CONFIG.ACTIVITIES.find(a => a.id === e.activityId);
    return !(act && act.fixed);
  }

  function upgradeLevels(p) {
    const u = p.upgrades || {};
    return CONFIG.UPGRADES.reduce((a, up) => a + (Number(u[up.id]) || 0), 0);
  }

  /** Mesures permanentes (chaînes) : valeurs absolues du profil. */
  function permMetrics(p) {
    const sport = (p.activityLog || []).filter(isSport);
    const routes = Array.isArray(p.ownedRoutes) ? p.ownedRoutes : [];
    let longest = 0;
    routes.forEach(id => {
      const r = Routes.byId(id);
      if (r && r.km > longest) longest = r.km;
    });
    let best = Number(p.bestStreak) || 0;
    try {
      if (typeof Streak !== 'undefined' && Streak.best) best = Math.max(best, Streak.best(p) || 0);
    } catch (e) { /* la série reste celle du profil */ }
    return {
      routesOwned:    routes.length,
      citiesVisited:  (p.visited || []).length,
      regionsVisited: Routes.regionsVisited ? Routes.regionsVisited(p) : 0,
      longestRoute:   longest,
      planesOwned:    (p.ownedPlanes || []).length,
      decorsOwned:    (p.ownedDecors || []).length,
      upgradeLevels:  upgradeLevels(p),
      totalSessions:  Number(p.totalSessions) || sport.length,
      sportHours:     (Number(p.totalSportMinutes) || 0) / 60,
      distinctSports: new Set(sport.map(e => e.activityId)).size,
      bestStreak:     best,
      maxAltitude:    Number(p.maxAltitude) || 0,
    };
  }

  /**
   * Mesures de la semaine `ws`.
   * - tout ce qui est daté vient du journal (exact, même hors ligne) ;
   * - les compteurs cumulés viennent de l'écart avec l'instantané du lundi.
   */
  function weekMetrics(p, ws) {
    const we = weekEnd(ws);
    const log = (p.activityLog || []).filter(e =>
      e && typeof e.date === 'number' && e.date >= ws && e.date < we);
    const sport = log.filter(isSport);
    const ceil = CONFIG.ceilingFor(p) || 1;
    const delta = (cur, snap) => Math.max(0, (Number(cur) || 0) - (Number(snap) || 0));
    return {
      wSessions:     sport.length,
      wMinutes:      sport.reduce((a, e) => a + (Number(e.minutes) || 0), 0),
      wSports:       new Set(sport.map(e => e.activityId)).size,
      wLong:         sport.filter(e => (Number(e.minutes) || 0) >= 60).length,
      wDays:         new Set(sport.map(e => dayKey(e.date))).size,
      wCreatine:     log.filter(e => e.activityId === 'creatine').length,
      wKero:         log.reduce((a, e) => a + (Number(e.kero) || 0), 0),
      wWheelDays:    new Set(log.filter(e => e.activityId === 'wheel')
                                .map(e => dayKey(e.date))).size,
      wCities:       log.filter(e => e.activityId === 'discovery').length,
      wAchievements: log.filter(e => e.activityId === 'achievement').length,
      wKm:           delta(p.lifetimeKm, p.qsKm),
      wLandings:     delta(p.landings, p.qsLandings),
      wBase:         delta(p.baseTouches, p.qsBase),
      wSpent:        delta(p.pointsSpent, p.qsSpent),
      wRoutes:       delta((p.ownedRoutes || []).length, p.qsRoutes),
      wUpgrades:     delta(upgradeLevels(p), p.qsUpg),
      wAltPct:       Math.min(100, Math.round((Number(p.questAltMax) || 0) / ceil * 100)),
    };
  }

  /** Avancement [courant, objectif] d'une quête pour un pilote donné. */
  function progress(p, def, ws) {
    if (!p || !def) return [0, 1];
    const src = def.tier
      ? weekMetrics(p, typeof ws === 'number' ? ws : weekStart(p.questWeek || Date.now()))
      : permMetrics(p);
    const cur = Number(src[def.metric]) || 0;
    return [Math.min(cur, def.goal), def.goal];
  }

  const done = (p, def, ws) => {
    const [cur, max] = progress(p, def, ws);
    return cur >= max;
  };

  /* ------------------------------------------------------------
     Cycle hebdomadaire : instantané, tirage, crédit d'office
     ------------------------------------------------------------ */

  function snapshot(p) {
    p.qsKm       = Number(p.lifetimeKm) || 0;
    p.qsLandings = Number(p.landings) || 0;
    p.qsBase     = Number(p.baseTouches) || 0;
    p.qsSpent    = Number(p.pointsSpent) || 0;
    p.qsRoutes   = (p.ownedRoutes || []).length;
    p.qsUpg      = upgradeLevels(p);
  }

  function claimedMap(p) {
    if (!p.questClaimed || typeof p.questClaimed !== 'object') p.questClaimed = {};
    return p.questClaimed;
  }

  function chainMap(p) {
    if (!p.chainStep || typeof p.chainStep !== 'object') p.chainStep = {};
    return p.chainStep;
  }

  /** Récompense d'une quête hebdomadaire selon son palier. */
  function weeklyReward(def) {
    return Q().WEEKLY_REWARD[def.tier] || { kero: 0, points: 0 };
  }

  /** Crédite kérosène + points et trace l'entrée dans le journal partagé. */
  function grant(p, label, icon, reward) {
    const cap = State.tankCapacity(p);
    const kero = Math.max(0, Math.round(Number(reward.kero) || 0));
    const pts  = Math.max(0, Math.round(Number(reward.points) || 0));
    const added = Math.min(kero, Math.max(0, cap - p.kerosene));
    if (kero > 0) p.kerosene = Math.min(cap, p.kerosene + kero);
    // Les points passent par bonusPoints : `points` est recalculé à chaque tick.
    if (pts > 0) p.bonusPoints = (Number(p.bonusPoints) || 0) + pts;

    if (!Array.isArray(p.activityLog)) p.activityLog = [];
    p.activityLog.push({
      activityId: 'quest',
      questName: label,
      questIcon: icon || '🎯',
      minutes: 0,
      kero: Math.round(added),
      pts: pts,
      date: Date.now(),
    });
    if (p.activityLog.length > 500) p.activityLog.shift();
    p.questsDone = (Number(p.questsDone) || 0) + 1;
    return { kero: Math.round(added), points: pts };
  }

  /**
   * Solde la semaine `ws` : toute quête terminée mais non réclamée est
   * créditée d'office. Aucune récompense n'est jamais perdue.
   */
  function settle(p, ws) {
    const credited = [];
    const map = claimedMap(p);
    const list = draw(ws);
    list.forEach(def => {
      if (map[def.id]) return;
      if (!done(p, def, ws)) return;
      const g = grant(p, def.name, def.icon, weeklyReward(def));
      map[def.id] = Date.now();
      credited.push({ name: def.name, icon: def.icon, kero: g.kero, points: g.points });
    });
    // Bonus « 3 sur 3 »
    if (!map[BONUS_ID] && list.length && list.every(d => map[d.id])) {
      const g = grant(p, 'Semaine parfaite', '🎖️', Q().WEEKLY_BONUS);
      map[BONUS_ID] = Date.now();
      p.perfectWeeks = (Number(p.perfectWeeks) || 0) + 1;
      credited.push({ name: 'Semaine parfaite', icon: '🎖️', kero: g.kero, points: g.points });
    }
    return credited;
  }

  /**
   * Vérifie le calendrier : au passage d'un lundi, solde la semaine
   * écoulée puis réarme l'instantané et le tirage.
   * @returns {Array} quêtes créditées d'office (pour l'annonce)
   */
  function checkWeek(p, now) {
    if (!p) return [];
    const ws = weekStart(now || Date.now());
    if (p.questWeek === ws) return [];

    let credited = [];
    const prev = Number(p.questWeek);
    if (prev > 0 && prev < ws) credited = settle(p, prev);

    p.questWeek = ws;
    p.questClaimed = {};
    p.questAltMax = Number(p.altitude) || 0;
    snapshot(p);
    return credited;
  }

  /* ------------------------------------------------------------
     Réclamations
     ------------------------------------------------------------ */

  /** Réclame une quête hebdomadaire (ou le bonus « 3 sur 3 »). */
  function claim(id, btnEl) {
    const p = State.current();
    if (!p) return false;
    checkWeek(p);
    const map = claimedMap(p);
    const list = draw(p.questWeek);

    let label, icon, reward;
    if (id === BONUS_ID) {
      if (map[BONUS_ID] || !list.every(d => map[d.id])) return false;
      label = 'Semaine parfaite'; icon = '🎖️'; reward = Q().WEEKLY_BONUS;
      p.perfectWeeks = (Number(p.perfectWeeks) || 0) + 1;
    } else {
      const def = list.find(d => d.id === id);
      if (!def || map[id] || !done(p, def, p.questWeek)) return false;
      label = def.name; icon = def.icon; reward = weeklyReward(def);
    }

    const g = grant(p, label, icon, reward);
    map[id] = Date.now();
    finish(p, `${icon} ${label} : +${fmt(g.kero)} L` +
               (g.points > 0 ? ` et +${fmt(g.points)} ★` : ''), btnEl);
    return true;
  }

  /** Réclame l'étape courante d'une carrière et fait apparaître la suivante. */
  function claimChain(chainId, btnEl) {
    const p = State.current();
    if (!p) return false;
    const chain = Q().CHAINS.find(c => c.id === chainId);
    if (!chain) return false;
    const map = chainMap(p);
    const idx = Number(map[chainId]) || 0;
    const step = chain.steps[idx];
    if (!step || !done(p, step)) return false;

    const g = grant(p, `${chain.name} — ${step.name}`, chain.icon,
                    { kero: step.kero, points: step.points });
    map[chainId] = idx + 1;
    finish(p, `${chain.icon} ${step.name} : +${fmt(g.kero)} L` +
               (g.points > 0 ? ` et +${fmt(g.points)} ★` : ''), btnEl);
    return true;
  }

  /** Sauvegarde, synchro, annonce et rafraîchissement après une réclamation. */
  function finish(p, message, btnEl) {
    State.save();
    if (typeof Sync !== 'undefined' && Sync.push) Sync.push(p);
    if (typeof UI !== 'undefined') {
      if (UI.toast) UI.toast(message);
      if (btnEl && UI.keroseneRain) UI.keroseneRain(btnEl.getBoundingClientRect(), 8);
      if (UI.refreshHUD) UI.refreshHUD();
    }
    render();
    updateBadge();
  }

  /* ------------------------------------------------------------
     Pastille & suivi permanent
     ------------------------------------------------------------ */

  /** Nombre de récompenses en attente de clic. */
  function claimableCount(p) {
    if (!p) return 0;
    let n = 0;
    const map = (p.questClaimed && typeof p.questClaimed === 'object') ? p.questClaimed : {};
    const ws = Number(p.questWeek) || weekStart(Date.now());
    const list = draw(ws);
    list.forEach(def => { if (!map[def.id] && done(p, def, ws)) n++; });
    if (!map[BONUS_ID] && list.length && list.every(d => map[d.id])) n++;
    const chains = (p.chainStep && typeof p.chainStep === 'object') ? p.chainStep : {};
    Q().CHAINS.forEach(c => {
      const step = c.steps[Number(chains[c.id]) || 0];
      if (step && done(p, step)) n++;
    });
    return n;
  }

  function updateBadge() {
    const el = $('quest-badge');
    if (!el) return;
    const n = claimableCount(State.current());
    el.textContent = n;
    el.style.display = n > 0 ? 'flex' : 'none';
  }

  /**
   * Appelé à chaque tick : mémorise le plafond atteint dans la semaine
   * et bascule de semaine le moment venu. Ne sauvegarde que si utile.
   */
  let tickCount = 0;

  function refresh(force) {
    const p = State.current();
    if (!p) return;
    // Le suivi du plafond est appelé à chaque seconde : on le garde très léger
    // et on ne recalcule la pastille (qui relit le journal) qu'une fois sur dix.
    const alt0 = Number(p.altitude) || 0;
    if (alt0 > (Number(p.questAltMax) || 0)) p.questAltMax = alt0;
    if (!force && (tickCount++ % 10) !== 0) return;

    let dirty = false;
    const credited = checkWeek(p);
    if (credited.length) {
      dirty = true;
      const total = credited.reduce((a, c) => a + c.kero, 0);
      if (typeof UI !== 'undefined' && UI.toast) {
        UI.toast(`🎯 Semaine soldée : ${credited.length} quête(s) créditée(s), ` +
                 `+${fmt(total)} L`);
      }
    } else if (p.questWeek !== weekStart(Date.now())) {
      dirty = true;   // premier armement du profil
    }
    const alt = Number(p.altitude) || 0;
    if (alt > (Number(p.questAltMax) || 0)) { p.questAltMax = alt; dirty = true; }
    if (dirty) {
      State.save();
      if (credited.length && typeof Sync !== 'undefined' && Sync.push) Sync.push(p);
    }
    updateBadge();
  }

  /** Rappel à la connexion : quêtes prêtes à être réclamées. */
  function reminder() {
    const p = State.current();
    if (!p) return;
    const n = claimableCount(p);
    if (n > 0 && typeof UI !== 'undefined' && UI.toast) {
      setTimeout(() => UI.toast(
        `🎯 ${n} récompense${n > 1 ? 's' : ''} de quête à réclamer !`), 2600);
    }
  }

  /* ------------------------------------------------------------
     Interface
     ------------------------------------------------------------ */

  function esc(s) {
    return String(s).replace(/[&<>"]/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  function bar(cur, max, cls) {
    const pct = max > 0 ? Math.min(100, cur / max * 100) : 0;
    return `<div class="q-bar ${cls || ''}"><div class="q-bar-fill" style="width:${pct}%"></div></div>`;
  }

  function num(v, unit) {
    const s = (unit === 'h') ? (Math.round(v * 10) / 10).toLocaleString('fr-FR') : fmt(v);
    return unit ? `${s} ${unit}` : s;
  }

  /** Barre de comparaison avec l'autre pilote (duel). */
  function rivals(me, def, ws) {
    const others = State.allPlayers().filter(o => o.name !== (me && me.name));
    if (!others.length) return '';
    return others.map(o => {
      const [cur, max] = progress(o, def, ws);
      const ok = cur >= max;
      return `<div class="q-rival ${ok ? 'ok' : ''}">
          <span class="q-rival-name">${esc(o.name)}</span>
          ${bar(cur, max, 'rival')}
          <span class="q-rival-val">${ok ? '✓' : num(cur, def.unit)}</span>
        </div>`;
    }).join('');
  }

  function weeklyCard(p, def, ws, map) {
    const [cur, max] = progress(p, def, ws);
    const ok = cur >= max;
    const claimed = !!map[def.id];
    const rw = weeklyReward(def);
    const tier = Q().TIERS.find(t => t.id === def.tier) || { name: def.tier, color: '#888' };
    const action = claimed
      ? '<span class="q-done">✓ Réclamée</span>'
      : ok
        ? `<button class="btn small warm q-claim" data-quest="${def.id}" type="button">🎁 Réclamer</button>`
        : `<span class="q-reward">⛽ ${fmt(rw.kero)} L · ★ ${fmt(rw.points)}</span>`;
    return `
      <div class="q-card ${claimed ? 'claimed' : ok ? 'ready' : ''}">
        <div class="q-head">
          <span class="q-icon">${def.icon}</span>
          <span class="q-title">
            <span class="q-name">${esc(def.name)}</span>
            <span class="q-desc">${esc(def.desc)}</span>
          </span>
          <span class="q-tier" style="--tier:${tier.color}">${tier.name}</span>
        </div>
        <div class="q-prog">
          ${bar(cur, max)}
          <span class="q-val">${num(cur, def.unit)} / ${num(max, def.unit)}</span>
        </div>
        ${rivals(p, def, ws)}
        <div class="q-foot">${action}</div>
      </div>`;
  }

  function chainCard(p, chain, map) {
    const idx = Number(map[chain.id]) || 0;
    const total = chain.steps.length;
    if (idx >= total) {
      return `
        <div class="q-card chain complete">
          <div class="q-head">
            <span class="q-icon">${chain.icon}</span>
            <span class="q-title">
              <span class="q-name">${esc(chain.name)}</span>
              <span class="q-desc">Carrière terminée — ${total} / ${total} étapes ✓</span>
            </span>
          </div>
        </div>`;
    }
    const step = chain.steps[idx];
    const [cur, max] = progress(p, step);
    const ok = cur >= max;
    const action = ok
      ? `<button class="btn small warm q-claim-chain" data-chain="${chain.id}" type="button">🎁 Réclamer</button>`
      : `<span class="q-reward">⛽ ${fmt(step.kero)} L · ★ ${fmt(step.points)}</span>`;
    return `
      <div class="q-card chain ${ok ? 'ready' : ''}">
        <div class="q-head">
          <span class="q-icon">${chain.icon}</span>
          <span class="q-title">
            <span class="q-name">${esc(chain.name)} · ${esc(step.name)}</span>
            <span class="q-desc">${esc(step.desc)}</span>
          </span>
          <span class="q-step">${idx + 1}/${total}</span>
        </div>
        <div class="q-prog">
          ${bar(cur, max)}
          <span class="q-val">${num(cur, step.unit)} / ${num(max, step.unit)}</span>
        </div>
        <div class="q-foot">${action}</div>
      </div>`;
  }

  function render() {
    const body = $('quests-body');
    if (!body) return;
    const p = State.current();
    if (!p) { body.innerHTML = ''; return; }
    checkWeek(p);
    const ws = Number(p.questWeek) || weekStart(Date.now());
    const map = claimedMap(p);
    const chains = chainMap(p);
    const list = draw(ws);

    const allDone = list.every(d => map[d.id] || done(p, d, ws));
    const bonusClaimed = !!map[BONUS_ID];
    const bonusReady = !bonusClaimed && list.every(d => map[d.id]);
    const bonus = Q().WEEKLY_BONUS;

    let html = `
      <div class="q-section">
        <div class="q-section-head">
          <span>🗓️ Cette semaine</span>
          <span class="q-timer">Nouveau tirage dans ${timeLeft()}</span>
        </div>
        <p class="q-hint">Les deux pilotes reçoivent exactement les mêmes quêtes :
           à vous de finir premier. Une quête terminée mais non réclamée est
           créditée d'office au tirage suivant.</p>`;
    list.forEach(def => { html += weeklyCard(p, def, ws, map); });
    html += `
        <div class="q-card bonus ${bonusClaimed ? 'claimed' : bonusReady ? 'ready' : ''}">
          <div class="q-head">
            <span class="q-icon">🎖️</span>
            <span class="q-title">
              <span class="q-name">Semaine parfaite</span>
              <span class="q-desc">Boucler les 3 quêtes de la semaine.</span>
            </span>
          </div>
          <div class="q-foot">${
            bonusClaimed ? '<span class="q-done">✓ Réclamé</span>'
            : bonusReady ? `<button class="btn small warm q-claim" data-quest="${BONUS_ID}" type="button">🎁 Réclamer</button>`
            : `<span class="q-reward">${allDone ? 'Réclamez d\'abord les 3 quêtes · ' : ''}⛽ ${fmt(bonus.kero)} L · ★ ${fmt(bonus.points)}</span>`
          }</div>
        </div>
      </div>
      <div class="q-section">
        <div class="q-section-head"><span>🎖️ Carrières</span></div>
        <p class="q-hint">Cinq parcours au long cours. Une étape à la fois,
           des récompenses de plus en plus grosses.</p>`;
    Q().CHAINS.forEach(c => { html += chainCard(p, c, chains); });
    html += '</div>';

    body.innerHTML = html;
    body.querySelectorAll('.q-claim').forEach(b =>
      b.addEventListener('click', () => claim(b.dataset.quest, b)));
    body.querySelectorAll('.q-claim-chain').forEach(b =>
      b.addEventListener('click', () => claimChain(b.dataset.chain, b)));
  }

  function open() {
    render();
    const m = $('modal-quests');
    if (m) m.classList.add('open');
  }

  function bind() {
    const btn = $('btn-quests');
    if (btn) btn.addEventListener('click', open);
  }

  document.addEventListener('DOMContentLoaded', bind);

  return {
    open, render, claim, claimChain, checkWeek, refresh, reminder,
    claimableCount, updateBadge, weekly, progress, timeLeft,
    // points d'entrée réservés aux suites de tests
    _weekStart: weekStart, _weekEnd: weekEnd, _draw: draw,
    _perm: permMetrics, _week: weekMetrics, _settle: settle,
  };
})();
