/* ============================================================
   SkyFit — Interface : HUD, modales, boutique, sélection joueur
   ============================================================ */

const UI = (() => {

  const $ = (id) => document.getElementById(id);
  const fmt = (n) => Math.floor(n).toLocaleString('fr-FR');

  let selectedActivity = 'running';
  let shopTab = 'planes';
  let lastAlt = null;
  let lastWindPaint = 0;

  /* ---------- HUD ---------- */

  function refreshHUD() {
    const p = State.current();
    if (!p) return;

    // Kérosène
    const cap = State.tankCapacity(p);
    $('kero-litres').textContent = fmt(p.kerosene);
    $('kero-max').textContent = fmt(cap);
    $('kero-fill').style.width = Math.min(100, (p.kerosene / cap) * 100) + '%';
    $('player-name').textContent = p.name;

    // Bouton « fiche de pilote » : avatar choisi, sinon 👨‍✈️ / 👩‍✈️ par défaut
    // Depuis la v3.2 l'avatar peut être une photo découpée : on passe donc par
    // Profile.avatarHtml(), qui renvoie soit l'emoji, soit une balise <img>.
    const av = $('btn-profile');
    if (av) {
      if (typeof Profile !== 'undefined' && Profile.avatarHtml) {
        av.innerHTML = Profile.avatarHtml(p);
      } else {
        av.textContent = p.avatar || '👨‍✈️';
      }
    }

    // Série de jours consécutifs 🔥
    refreshStreakBadge(p);

    // Distance & points
    $('total-km').textContent = fmt(p.totalKm);
    $('points').textContent = fmt(State.availablePoints(p));

    // Altimètre
    // La jauge se lit en pourcentage du plafond de l'avion piloté : un Cessna
    // « plein pot » à 14 000 ft affiche donc le même cadran plein qu'un A380.
    const ceiling = State.ceiling(p);
    const t = (p.altitude - CONFIG.ALT_MIN) / (ceiling - CONFIG.ALT_MIN);
    const circ = 351.86;
    $('alt-progress').style.strokeDashoffset = circ * (1 - t);
    $('alt-progress').style.stroke =
      t > 0.75 ? '#27ae60' : t > 0.35 ? '#2e86de' : t > 0.12 ? '#e67e22' : '#e74c3c';
    $('alt-value').textContent = fmt(p.altitude);

    const trendEl = $('alt-trend');
    if (p.crashed) {
      trendEl.textContent = '💥 au sol';
      trendEl.className = 'alt-trend down';
    } else if (p.kerosene > 0) {
      trendEl.textContent = '▲ montée';
      trendEl.className = 'alt-trend up';
    } else {
      trendEl.textContent = '▼ descente';
      trendEl.className = 'alt-trend down';
    }

    // Vitesse affichée = vitesse SOL, vent compris (0 si l'avion est au sol)
    const airspeed = p.crashed ? 0 : State.airspeed(p);
    const speed = p.crashed ? 0 : airspeed * Weather.factorFor(Routes.geo(p), p.altitude, Date.now(), airspeed);
    $('speed-value').textContent = fmt(speed);

    // 🗺️ Route active : cap suivi et distance restante
    refreshRouteChip(p);

    // Vent 🌬️ + ciel 🌅 : rafraîchis toutes les 5 s, pas à chaque tick.
    // Le ciel se déduit de la position, de l'heure, de l'altitude et de la
    // météo — il n'y a plus de décor acheté à appliquer.
    if (Date.now() - lastWindPaint > 5000) {
      lastWindPaint = Date.now();
      WeatherUI.refreshBadge(p);
      WeatherUI.refreshScene(p);
      paintSky(p);
    }

    // Scène (un avion qui a déjà crashé reste marqué à vie)
    Scene.update(p.altitude, speed, ceiling);
    Scene.setCondition(p.crashed, (p.crashes || 0) > 0);

    // Panneau CRASH
    const overlay = $('crash-overlay');
    overlay.classList.toggle('show', !!p.crashed);
    if (p.crashed) {
      $('crash-record').innerHTML = p.bestKm > 0
        ? `🏆 Ton record à battre : <b>${fmt(p.bestKm)} km</b> (crash n°${p.crashes})`
        : `Fais une séance de sport pour repartir à ${fmt(CONFIG.startAltFor(p))} ft !`;
    }

    refreshScoreboard();
    Achievements.updateBadge();
    Wheel.refreshButton();     // 🎡 pastille « tour disponible » + compte à rebours
    lastAlt = p.altitude;
  }

  /* ---------- Ciel dynamique 🌅 ---------- */

  /**
   * Recalcule le ciel à partir de la situation de vol RÉELLE — position sur
   * la route, heure solaire locale, altitude, couverture nuageuse — puis
   * l'applique à la scène. Signale au passage les phénomènes rares observés
   * pour la première fois (aurore, mer de nuages, stratosphère…).
   *
   * Tout est encapsulé dans des try/catch : cette fonction tourne toutes les
   * 5 s et une route inconnue ou un cache météo vide ne doit jamais figer
   * le HUD.
   */
  function paintSky(p) {
    if (!p || typeof Sky === 'undefined') return;

    let s = null;
    try { s = Sky.forPlayer(p); } catch (e) { return; }
    if (!s) return;
    Scene.applySky(s);

    // Phénomènes rares : crédités une seule fois par pilote.
    let found = [];
    try { found = Sky.observe(p, s) || []; } catch (e) { found = []; }
    if (!found.length) return;

    State.save();
    Sync.push(p);

    // Espacés pour que deux découvertes simultanées ne s'écrasent pas.
    found.forEach((ph, i) => {
      setTimeout(() => {
        toast(`${ph.icon} <b>${ph.name}</b> — phénomène observé !<br>` +
              `<small>${escapeHtml(ph.hint || '')}</small><br>` +
              `+${fmt(ph.kero)} L ⛽ · +${fmt(ph.points)} ★`, 7500);
      }, i * 1400);
    });
  }

  /* ---------- Route active 🗺️ ---------- */

  /** Bandeau de route sous la distance : LFPG ↔ ville, cap et km restants. */
  function refreshRouteChip(p) {
    const el = $('route-chip');
    if (!el) return;
    const g = Routes.geo(p);
    const dest = g.outbound ? g.to : Routes.BASE;
    const pend = Routes.pending(p);
    const main = p.crashed
      ? `<span class="rc-leg">💥 au sol à ${escapeHtml(Routes.BASE.icao)}</span>`
      : `<span class="rc-leg">${g.outbound ? '→' : '←'} ${dest.icon || '📍'} ${escapeHtml(dest.city)}</span>
         <span class="rc-km">${fmt(g.kmToNext)} km</span>`;
    el.innerHTML =
      `<span class="rc-route">${escapeHtml(g.route.label)}</span>${main}` +
      (pend ? `<span class="rc-pending" title="Effectif au prochain passage à la verticale de ${escapeHtml(Routes.BASE.icao)}">⏳ ${escapeHtml(pend.icao)}</span>` : '');
    el.title = `Route active : ${g.route.label} (${fmt(g.route.km)} km par trajet)`
      + (pend ? ` — changement pour ${pend.label} au prochain passage à ${Routes.BASE.icao}.` : '');
  }

  /**
   * Événements de vol renvoyés par Engine.simulate : arrivées, premières
   * visites (prime de kérosène) et changement de route effectif.
   */
  function flightEvents(ev) {
    if (!ev) return;
    if (ev.switched) {
      const r = Routes.byId(ev.switched);
      if (r) toast(`🧭 Nouveau cap depuis ${Routes.BASE.icao} : <b>${r.label}</b> — direction ${r.icon} ${r.city} !`, 5200);
      Weather.refresh(true);   // les relevés de vent suivent la nouvelle route
    }
    (ev.firstVisits || []).forEach((v, i) => {
      const r = Routes.byCity(v.city);
      setTimeout(() => {
        toast(`${r ? r.icon : '📍'} PREMIÈRE VISITE : <b>${v.city}</b> ! ` +
          `Prime de bienvenue : +${fmt(v.kero)} L de kérosène ⛽`, 6500);
        const anchor = $('total-km') || $('hud-kero');
        if (anchor) keroseneRain(anchor.getBoundingClientRect(), 10);
        Achievements.updateBadge();
      }, 400 + i * 900);
    });
  }

  /* ---------- Série 🔥 ---------- */

  /** Pastille de série dans le HUD kérosène. */
  function refreshStreakBadge(p) {
    const el = $('streak-badge');
    if (!el) return;
    const s = Streak.current(p);

    el.classList.toggle('off', !s.alive);
    el.classList.toggle('at-risk', !!s.pending);
    el.classList.toggle('maxed', s.mult >= CONFIG.STREAK.MAX_MULT);

    if (!s.alive) {
      el.innerHTML = `<span class="sb-flame">🔥</span>
        <span class="sb-text"><span class="sb-long">Aucune série — lance-la aujourd'hui !</span>` +
        `<span class="sb-short">Lance ta série !</span></span>`;
      el.title = 'Fais une séance chaque jour : ta série augmente le kérosène gagné.';
      return;
    }
    const j = s.days > 1 ? 'jours' : 'jour';
    el.innerHTML = `<span class="sb-flame">🔥</span>
      <span class="sb-text"><b>${s.days}</b>&nbsp;<span class="sb-long">${j} d'affilée</span><span class="sb-short">j</span></span>
      <span class="sb-mult">${Streak.fmtMult(s.mult)} ⛽</span>` +
      (s.pending
        ? '<span class="sb-warn"><span class="sb-long">à confirmer aujourd\'hui !</span>' +
          '<span class="sb-short">à confirmer !</span></span>'
        : '');
    el.title = s.pending
      ? `Série de ${s.days} ${j} : enregistre une séance avant minuit pour ne pas la perdre !`
      : `Série de ${s.days} ${j} : +${Math.round((s.mult - 1) * 100)} % de kérosène sur chaque séance.`;
  }

  /** Rappel à la connexion : série en sursis ou perdue. */
  function streakReminder() {
    const p = State.current();
    if (!p) return;
    const s = Streak.current(p);
    if (s.pending && s.days >= 2) {
      setTimeout(() => toast(
        `🔥 Ta série de <b>${s.days} jours</b> tient encore ! ` +
        `Enregistre une séance avant minuit pour la prolonger (${Streak.fmtMult(s.mult)} de kérosène).`,
        7000), 2600);
    }
  }

  /** Petite animation quand la série gagne un jour. */
  function streakPop() {
    const el = $('streak-badge');
    if (!el) return;
    el.classList.remove('pop');
    void el.offsetWidth;         // relance l'animation
    el.classList.add('pop');
    setTimeout(() => el.classList.remove('pop'), 1200);
  }

  /* ---------- Classement (haut droite) ---------- */

  const SCORE_OPEN_KEY = 'skyfit.scoreOpen';

  /**
   * Le classement est repliable depuis la v2.9 : sur les écrans peu hauts
   * il empiétait sur l'altimètre du bas. Le choix est mémorisé, et le
   * bloc démarre replié quand la fenêtre est vraiment courte.
   */
  function scoreOpenDefault() {
    const saved = localStorage.getItem(SCORE_OPEN_KEY);
    if (saved !== null) return saved === '1';
    return window.innerHeight > 700;
  }

  function setScoreOpen(open, remember) {
    const block = $('score-block');
    const btn = $('btn-score-toggle');
    if (!block || !btn) return;
    block.classList.toggle('collapsed', !open);
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (remember) localStorage.setItem(SCORE_OPEN_KEY, open ? '1' : '0');
  }

  function toggleScore() {
    const block = $('score-block');
    if (!block) return;
    setScoreOpen(block.classList.contains('collapsed'), true);
  }

  // Classement général : trié par record (meilleure tentative)
  function refreshScoreboard() {
    const me = State.current();
    const record = (p) => Math.max(p.bestKm || 0, p.totalKm || 0);
    const players = State.allPlayers()
      .slice()
      .sort((a, b) => record(b) - record(a));
    const medals = ['🥇', '🥈', '🥉'];
    $('scoreboard').innerHTML = players.map((p, i) => {
      const s = Streak.current(p);
      const flame = s.alive
        ? `<span class="score-streak ${s.pending ? 'pending' : ''}"
             title="${s.days} jours d'affilée">🔥${s.days}</span>` : '';
      return `
      <div class="score-row ${me && p.name === me.name ? 'me' : ''}"
           data-pilot="${escapeHtml(p.name)}" role="button" tabindex="0"
           title="Voir la fiche de pilote de ${escapeHtml(p.name)}">
        <span><span class="medal">${medals[i] || '•'}</span>${escapeHtml(p.name)}${p.crashed ? ' 💥' : ''}${flame}</span>
        <span>${fmt(p.totalKm)} km
          <span class="score-record">🏆 ${fmt(record(p))}</span></span>
      </div>`;
    }).join('');

    // v2.9 : un clic sur une ligne ouvre la fiche du pilote concerné.
    $('scoreboard').querySelectorAll('[data-pilot]').forEach(row => {
      const go = () => Profile.open(row.dataset.pilot);
      row.addEventListener('click', go);
      row.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
      });
    });
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  /* ---------- Modales génériques ---------- */

  function openModal(id) { $(id).classList.add('open'); }
  function closeModal(id) {
    const el = $(id);
    if (el) el.classList.remove('open');
  }

  /* ---------- Modale activité ---------- */

  function buildActivityGrid() {
    $('activity-grid').innerHTML = CONFIG.ACTIVITIES.map(a => `
      <button class="activity-choice ${a.id === selectedActivity ? 'selected' : ''}"
              data-activity="${a.id}" type="button">
        ${a.img ? `<img class="act-img" src="${a.img}" alt="">`
                : `<span class="emoji">${a.icon}</span>`}${a.name}
      </button>`).join('');
    $('activity-grid').querySelectorAll('.activity-choice').forEach(btn => {
      btn.addEventListener('click', () => {
        selectedActivity = btn.dataset.activity;
        buildActivityGrid();
        refreshGainPreview();
      });
    });
  }

  /** Remplit les champs date/heure avec « maintenant ». */
  function resetSessionWhen() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    $('session-date').value =
      `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    $('session-time').value = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  }

  /** Timestamp (ms) du début de séance choisi, ou maintenant si invalide. */
  function sessionWhen() {
    const d = $('session-date').value, t = $('session-time').value;
    const ts = new Date(`${d}T${t || '12:00'}`).getTime();
    return isFinite(ts) ? ts : Date.now();
  }

  function refreshGainPreview() {
    const p = State.current();
    const act = CONFIG.ACTIVITIES.find(a => a.id === selectedActivity);

    // Série 🔥 telle qu'elle sera APRÈS cette séance (bonus inclus)
    const when = sessionWhen();
    const streakDays = Streak.forSession(p, when, act.id);
    const streakMult = Streak.multiplier(streakDays);
    const streakLine = streakDays > 1
      ? `<br><small class="gp-streak">🔥 Série de ${streakDays} jours : ` +
        `bonus ${Streak.fmtMult(streakMult)} déjà compté` +
        (streakMult >= CONFIG.STREAK.MAX_MULT ? ' (bonus maximal !)' : '') + '</small>'
      : '';

    // Bonus fixe (créatine) : pas de durée
    $('duration-row').style.display = act.fixed ? 'none' : '';
    if (act.fixed) {
      const litres = Math.round(act.keroBonus * State.keroYield(p) * streakMult);
      $('gain-preview').innerHTML =
        `💊 La dose du jour : <b>+${fmt(litres)} L</b> de kérosène` +
        (act.oncePerDay ? ' <small>(une prise par jour)</small>' : '') + '.' +
        streakLine;
      return;
    }

    const minutes = parseInt($('duration-slider').value, 10);
    $('duration-value').textContent = minutes;
    const litres = Math.round(act.keroPerMin * minutes * State.keroYield(p) * streakMult);
    const climb = Math.round(litres * CONFIG.climbFtPerLitre(State.current()));
    // Heure de fin déduite du début + durée
    const start = new Date(when);
    const end = new Date(start.getTime() + minutes * 60000);
    const hm = (d) => d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    $('gain-preview').innerHTML =
      `⛽ Cette séance rapportera <b>${fmt(litres)} L</b> de kérosène,` +
      ` soit jusqu'à <b>+${fmt(climb)} ft</b> d'altitude.` +
      `<br><small>🕒 De ${hm(start)} à ${hm(end)}</small>` +
      streakLine;
  }

  function confirmActivity() {
    const p = State.current();
    const minutes = parseInt($('duration-slider').value, 10);
    // Point de départ de l'animation : le bouton Valider (avant fermeture)
    const btnRect = $('btn-confirm-activity').getBoundingClientRect();
    const res = Engine.logActivity(p, selectedActivity, minutes, sessionWhen());
    closeModal('modal-activity');
    const act = CONFIG.ACTIVITIES.find(a => a.id === selectedActivity);

    if (res.alreadyToday) {
      toast(`${act.icon} Doucement ! La ${act.name.toLowerCase()}, c'est une seule prise par jour. 😄`);
      refreshHUD();
      return;
    }

    const doneTxt = act.fixed
      ? `${act.name} avalée`
      : `${minutes} min de ${act.name.toLowerCase()}`;
    if (res.tookOff) {
      toast(`🛫 REDÉCOLLAGE ! ${doneTxt} : +${fmt(res.litres)} L. ` +
        `Nouvelle tentative depuis ${fmt(CONFIG.startAltFor(State.current()))} ft — bats ton record !`, 6000);
    } else if (act.fixed) {
      toast(`${act.icon} ${doneTxt} : +${fmt(res.litres)} L de kérosène. Bonus du jour ! ▲`);
    } else {
      toast(`${act.icon} Bravo ! ${doneTxt} : +${fmt(res.litres)} L de kérosène. En montée ! ▲`);
    }
    keroseneRain(btnRect, act.fixed ? 5 : Math.min(16, 6 + Math.round(minutes / 15)));
    refreshHUD();

    // 🔥 La série vient de grandir : message dédié + animation de la pastille
    if (res.streakUp && res.streak > 1) {
      streakPop();
      setTimeout(() => {
        const maxed = res.streakMult >= CONFIG.STREAK.MAX_MULT;
        const extra = res.streakBonus > 0
          ? ` (+${fmt(res.streakBonus)} L de bonus)` : '';
        toast(
          `🔥 Série de ${res.streak} jours d'affilée !${extra} ` +
          (maxed
            ? `Bonus kérosène au maximum : ${Streak.fmtMult(res.streakMult)} 🏅`
            : `Rendement kérosène : ${Streak.fmtMult(res.streakMult)}. Ne la casse pas !`),
          5200);
      }, 1400);
    }
  }

  /**
   * Pluie de kérosène : des ⛽ s'envolent du point de départ vers la
   * jauge de kérosène (en bas à droite depuis la v2.8), puis la jauge « pulse ».
   */
  function keroseneRain(fromRect, count) {
    const target = $('hud-kero').getBoundingClientRect();
    const tx = target.left + target.width * 0.5;
    const ty = target.top + target.height * 0.55;
    const sx = fromRect.left + fromRect.width / 2;
    const sy = fromRect.top + fromRect.height / 2;

    for (let i = 0; i < count; i++) {
      const el = document.createElement('span');
      el.className = 'kero-fly';
      el.textContent = '⛽';
      // Petit éparpillement au départ
      const ox = (Math.random() - 0.5) * 140;
      const oy = (Math.random() - 0.5) * 80;
      el.style.left = (sx + ox) + 'px';
      el.style.top = (sy + oy) + 'px';
      document.body.appendChild(el);

      const dx = tx - (sx + ox);
      const dy = ty - (sy + oy);
      const anim = el.animate([
        { transform: 'translate(0, 0) scale(0.6)', opacity: 0 },
        { transform: 'translate(0, -14px) scale(1.15)', opacity: 1, offset: 0.18 },
        { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 40}px) scale(1)`, opacity: 1, offset: 0.6 },
        { transform: `translate(${dx}px, ${dy}px) scale(0.35)`, opacity: 0.2 },
      ], {
        duration: 750 + Math.random() * 350,
        delay: i * 55,
        easing: 'cubic-bezier(0.35, 0.1, 0.25, 1)',
        fill: 'both',
      });
      anim.onfinish = () => {
        el.remove();
        // Pulse de la jauge à chaque arrivée
        const hud = $('hud-kero');
        hud.classList.remove('kero-pulse');
        void hud.offsetWidth;
        hud.classList.add('kero-pulse');
      };
    }
  }

  /* ---------- Journal des activités ---------- */

  function refreshJournal() {
    const me = State.current();
    // Fusionne les journaux de tous les pilotes, du plus récent au plus ancien
    const entries = State.allPlayers()
      .flatMap(p => (p.activityLog || []).map(e => ({ ...e, player: p.name })))
      .sort((a, b) => b.date - a.date)
      .slice(0, 60);

    if (!entries.length) {
      $('journal-body').innerHTML =
        '<p class="journal-empty">Aucune activité enregistrée pour l\'instant.<br>La première séance lance la course ! 🏁</p>';
      return;
    }

    const dayLabel = (ts) => {
      const d = new Date(ts);
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const day = new Date(d); day.setHours(0, 0, 0, 0);
      const diff = Math.round((today - day) / 86400000);
      if (diff === 0) return "Aujourd'hui";
      if (diff === 1) return 'Hier';
      return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    };

    let html = '', lastDay = null;
    for (const e of entries) {
      const label = dayLabel(e.date);
      if (label !== lastDay) {
        html += `<div class="journal-day">${label}</div>`;
        lastDay = label;
      }
      const isAch = e.activityId === 'achievement';
      const isDisco = e.activityId === 'discovery';
      const isWheel = e.activityId === 'wheel';
      const isQuest = e.activityId === 'quest';
      const isMeta = isAch || isDisco || isWheel || isQuest;
      const act = isAch
        ? { icon: e.achIcon || '🏆', name: `Succès « ${e.achName || '?'} »` }
        : isDisco
        ? { icon: e.cityIcon || '🛬', name: `Première visite : ${e.city || '?'}` }
        : isWheel
        ? { icon: e.prizeIcon || '🎡', name: `Roue de la chance — ${e.prizeLabel || '?'}` }
        : isQuest
        ? { icon: e.questIcon || '🎯', name: `Quête « ${e.questName || '?'} »` }
        : CONFIG.ACTIVITIES.find(a => a.id === e.activityId) ||
          (CONFIG.LEGACY_ACTIVITIES || {})[e.activityId] ||
          { icon: '💪', name: e.activityId };
      const time = new Date(e.date).toLocaleTimeString('fr-FR',
        { hour: '2-digit', minute: '2-digit' });
      const mine = me && e.player === me.name;
      const iconHtml = act.img
        ? `<img class="j-img" src="${act.img}" alt="">`
        : act.icon;
      const detail = e.minutes > 0
        ? `${escapeHtml(act.name)}, ${e.minutes} min`
        : escapeHtml(act.name);
      // Série au moment de la séance (enregistrée depuis la v2.1)
      const streakChip = (!isMeta && e.streak > 1)
        ? `<span class="j-streak" title="${e.streak}e jour d'affilée">🔥${e.streak}</span>` : '';
      // Gains : litres, et points quand l'entrée en rapporte (roue 🎡)
      const gains = [];
      if (e.kero > 0 || !e.pts) gains.push(`+${fmt(e.kero)} L ⛽`);
      if (e.pts > 0) gains.push(`+${fmt(e.pts)} ★`);
      html += `
        <div class="journal-row ${mine ? 'me' : ''}">
          <span class="j-time">${time}</span>
          <span class="j-icon">${iconHtml}</span>
          <span class="j-text"><b>${escapeHtml(e.player)}</b> — ${detail}${streakChip}</span>
          <span class="j-gain">${gains.join('<br>')}</span>
        </div>`;
    }
    $('journal-body').innerHTML = html;
  }

  /* ---------- Boutique ---------- */

  function refreshShop() {
    const p = State.current();
    $('shop-points').textContent = fmt(State.availablePoints(p));
    document.querySelectorAll('.shop-tab').forEach(tab =>
      tab.classList.toggle('active', tab.dataset.tab === shopTab));

    let html = '';
    if (shopTab === 'planes') {
      html = CONFIG.PLANES.map(plane => {
        const owned = p.ownedPlanes.includes(plane.id);
        const current = p.currentPlane === plane.id;
        const canBuy = State.availablePoints(p) >= plane.cost;
        let btn;
        if (current) btn = `<button class="btn small ghost" disabled type="button">En vol ✓</button>`;
        else if (owned) btn = `<button class="btn small" data-buy-plane="${plane.id}" type="button">Piloter</button>`;
        else btn = `<button class="btn small warm" data-buy-plane="${plane.id}" ${canBuy ? '' : 'disabled'} type="button">★ ${fmt(plane.cost)}</button>`;
        // Fiche technique : croisière et plafond réels, plus l'écart de vitesse
        // par rapport à l'appareil actuellement piloté.
        const mine = CONFIG.planeOf(p);
        let delta = '';
        if (!current) {
          const pct = Math.round((plane.cruise / mine.cruise - 1) * 100);
          if (pct !== 0) {
            delta = `<span class="plane-delta ${pct > 0 ? 'up' : 'down'}">` +
                    `${pct > 0 ? '+' : ''}${pct} % vs ${mine.name}</span>`;
          }
        }
        const specs = `<div class="plane-specs">` +
          `<span>🛫 ${fmt(plane.cruise)} km/h</span>` +
          `<span>⛰️ ${fmt(plane.ceiling)} ft</span>${delta}</div>`;
        return shopItem(plane.name, plane.desc + specs, current ? 'owned-current' : '', btn);
      }).join('');
    } else if (shopTab === 'upgrades') {
      html = CONFIG.UPGRADES.map(up => {
        const level = p.upgrades[up.id] || 0;
        const maxed = level >= up.maxLevel;
        const cost = Engine.upgradeCost(up, level);
        const canBuy = !maxed && State.availablePoints(p) >= cost;
        const btn = maxed
          ? `<button class="btn small ghost" disabled type="button">Max ✓</button>`
          : `<button class="btn small warm" data-buy-upgrade="${up.id}" ${canBuy ? '' : 'disabled'} type="button">★ ${fmt(cost)}</button>`;
        return shopItem(`${up.icon} ${up.name}`,
          up.desc + `<div class="level">Niveau ${level} / ${up.maxLevel}</div>`, '', btn);
      }).join('');
    } else if (shopTab === 'routes') {
      html = routesShopHtml(p);
    } else {
      // Onglet « Ciel » : purement informatif depuis la v3.1 — il n'y a plus
      // rien à acheter, le décor se déduit du vol en cours.
      html = skyShopHtml(p);
    }
    $('shop-content').innerHTML = html;

    // Actions
    $('shop-content').querySelectorAll('[data-buy-plane]').forEach(b =>
      b.addEventListener('click', () => {
        if (Engine.buyPlane(p, b.dataset.buyPlane)) {
          Scene.setPlane(p.currentPlane);
          toast('✈️ Nouvel avion en vol !');
        }
        refreshShop(); refreshHUD();
      }));
    $('shop-content').querySelectorAll('[data-buy-upgrade]').forEach(b =>
      b.addEventListener('click', () => {
        if (Engine.buyUpgrade(p, b.dataset.buyUpgrade)) toast('⚙️ Amélioration achetée !');
        refreshShop(); refreshHUD();
      }));
    $('shop-content').querySelectorAll('[data-buy-route]').forEach(b =>
      b.addEventListener('click', () => {
        const res = Engine.buyRoute(p, b.dataset.buyRoute);
        if (res.ok) {
          toast(`🗺️ Route <b>${res.route.label}</b> ouverte ! Envoie ton avion vers ${res.route.icon} ${res.route.city}.`, 5200);
          keroseneRain(b.getBoundingClientRect(), 4);
        } else if (res.reason === 'points') {
          toast('★ Pas assez de points pour ouvrir cette route.');
        }
        refreshShop(); refreshHUD();
      }));
    $('shop-content').querySelectorAll('[data-set-route]').forEach(b =>
      b.addEventListener('click', () => {
        const res = Engine.setRoute(p, b.dataset.setRoute);
        if (res.ok && res.immediate && !res.already) {
          toast(`🧭 Cap sur ${res.route.icon} ${res.route.city} — décollage de ${Routes.BASE.icao} !`, 5000);
          Weather.refresh(true);
        } else if (res.ok && !res.immediate) {
          const eta = res.eta && res.eta.hours
            ? ` (environ ${res.eta.hours < 1 ? Math.round(res.eta.hours * 60) + ' min' : res.eta.hours.toFixed(1).replace('.', ',') + ' h'}, ${fmt(res.eta.km)} km)`
            : '';
          toast(`⏳ Changement demandé : ton avion prendra la route <b>${res.route.label}</b> ` +
            `au prochain passage à la verticale de ${Routes.BASE.icao}${eta}.`, 6500);
        }
        refreshShop(); refreshHUD();
      }));
    $('shop-content').querySelectorAll('[data-cancel-route]').forEach(b =>
      b.addEventListener('click', () => {
        Engine.cancelPendingRoute(p);
        toast('↩️ Changement de route annulé : l\'avion garde son cap actuel.');
        refreshShop(); refreshHUD();
      }));
  }

  /* ---------- Boutique : onglet Routes 🗺️ ---------- */

  function routesShopHtml(p) {
    const groups = Routes.byRegion();
    const pend = Routes.pending(p);
    const g = Routes.geo(p);
    const atBase = p.crashed || (g.outbound && g.legKm <= 1);

    let head = `
      <div class="shop-note">
        🛫 Base : <b>${escapeHtml(Routes.BASE.name)} (${Routes.BASE.icao})</b>.
        Ton avion fait des aller-retours sur la route active. Un changement de cap
        ${atBase ? 'est immédiat (avion au sol)' : `sera effectif <b>au prochain passage à la verticale de ${Routes.BASE.icao}</b>`}.
      </div>`;
    if (pend) {
      const eta = Engine.etaToBase(p);
      head += `
        <div class="shop-note pending">
          ⏳ En attente : <b>${escapeHtml(pend.label)}</b>
          ${eta.hours ? ` — retour à ${Routes.BASE.icao} dans ~${eta.hours < 1 ? Math.round(eta.hours * 60) + ' min' : eta.hours.toFixed(1).replace('.', ',') + ' h'} (${fmt(eta.km)} km)` : ''}
          <button class="btn small ghost" data-cancel-route="1" type="button">Annuler</button>
        </div>`;
    }

    const body = groups.map(grp => {
      const items = grp.routes.map(r => {
        const owned = Routes.isOwned(p, r.id);
        const current = p.currentRoute === r.id;
        const waiting = pend && pend.id === r.id;
        const canBuy = State.availablePoints(p) >= r.cost;
        const visited = Routes.hasVisited(p, r.city);
        let btn;
        if (current) btn = `<button class="btn small ghost" disabled type="button">En vol ✓</button>`;
        else if (waiting) btn = `<button class="btn small ghost" disabled type="button">⏳ en attente</button>`;
        else if (owned) btn = `<button class="btn small" data-set-route="${r.id}" type="button">Décoller</button>`;
        else btn = `<button class="btn small warm" data-buy-route="${r.id}" ${canBuy ? '' : 'disabled'} type="button">★ ${fmt(r.cost)}</button>`;
        const desc =
          `${escapeHtml(r.icao)} · ${fmt(r.km)} km par trajet · ${fmt(r.km * 2)} km l'aller-retour` +
          `<div class="level">${visited ? '✅ ville déjà visitée' : '🎁 première visite : prime de kérosène + succès'}</div>`;
        return shopItem(`${r.icon} ${escapeHtml(r.city)}`, desc,
          current ? 'owned-current' : '', btn);
      }).join('');
      return `<div class="shop-group">${escapeHtml(grp.region)}</div>${items}`;
    }).join('');

    return head + body;
  }

  /* ---------- Boutique : onglet Ciel 🌅 ---------- */

  /**
   * Le ciel ne s'achète plus : il se mérite. Cet onglet montre l'état réel
   * du ciel survolé et la liste des phénomènes rares, avec pour chacun
   * l'indice qui dit où et quand aller le chercher.
   */
  function skyShopHtml(p) {
    if (typeof Sky === 'undefined') return `<div class="shop-note">Ciel indisponible.</div>`;

    let s = null;
    try { s = Sky.forPlayer(p); } catch (e) { s = null; }

    const head = s ? `
      <div class="shop-note">
        🌅 Le décor n'est plus un achat : il suit ta position, l'heure locale
        et la météo réelle. En ce moment tu survoles
        <b>${s.biomeIcon} ${escapeHtml(s.biomeName)}</b>, il y fait
        <b>${s.phaseIcon} ${escapeHtml(s.phaseName)}</b>
        (soleil à ${s.solarElev.toFixed(1).replace('.', ',')}°,
        ${Math.floor(s.solarHour)} h ${String(Math.round((s.solarHour % 1) * 60)).padStart(2, '0')} solaire).
      </div>` : `
      <div class="shop-note">
        🌅 Le décor suit ta position, l'heure locale et la météo réelle.
      </div>`;

    const seen = Array.isArray(p.seenPhenomena) ? p.seenPhenomena : [];
    const items = Sky.PHENOMENA.map(ph => {
      const got = seen.includes(ph.id);
      const btn = got
        ? `<button class="btn small ghost" disabled type="button">Observé ✓</button>`
        : `<button class="btn small ghost" disabled type="button">🔒</button>`;
      const desc = `${escapeHtml(ph.hint)}` +
        `<div class="level">${got ? '✅ déjà observé' : `🎁 +${fmt(ph.kero)} L ⛽ · +${fmt(ph.points)} ★ à la découverte`}</div>`;
      return shopItem(`${ph.icon} ${escapeHtml(ph.name)}`, desc, got ? 'owned-current' : '', btn);
    }).join('');

    return head +
      `<div class="shop-group">Phénomènes — ${seen.length} / ${Sky.PHENOMENA.length}</div>` +
      items;
  }

  function shopItem(name, desc, cls, btnHtml) {
    return `
      <div class="shop-item ${cls}">
        <div class="info">
          <div class="name">${name}</div>
          ${desc ? `<div class="desc">${desc}</div>` : ''}
        </div>
        ${btnHtml}
      </div>`;
  }

  /* ---------- Toast ---------- */

  let toastTimer = null;
  function toast(msg, ms = 4200) {
    const el = $('toast');
    el.innerHTML = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), ms);
  }

  function offlineSummary(sum) {
    const h = sum.seconds / 3600;
    const timeTxt = h >= 24
      ? `${Math.floor(h / 24)} j ${Math.round(h % 24)} h`
      : h >= 1 ? `${Math.floor(h)} h ${Math.round((h % 1) * 60)} min`
      : `${Math.round(sum.seconds / 60)} min`;
    if (sum.crashed) {
      toast(`💥 Pendant ton absence (${timeTxt}), ton avion a parcouru <b>${fmt(sum.km)} km</b>… ` +
        `puis s'est <b>CRASHÉ</b> ! Fais du sport pour redécoller depuis ${Routes.BASE.icao}.`, 9000);
      return;
    }
    // 🗺️ Escales atteintes pendant l'absence
    const rt = sum.route || {};
    let routeTxt = '';
    const firsts = rt.firstVisits || [];
    if (firsts.length) {
      const names = firsts.map(v => {
        const r = Routes.byCity(v.city);
        return `${r ? r.icon + ' ' : ''}<b>${v.city}</b>`;
      }).join(', ');
      const kero = firsts.reduce((s, v) => s + (v.kero || 0), 0);
      routeTxt = ` — découverte de ${names} : +${fmt(kero)} L de prime ⛽`;
    } else if (rt.arrivals && rt.arrivals.length) {
      routeTxt = ` — ${rt.arrivals.length} atterrissage(s) à destination 🛬`;
    }
    if (rt.switched) {
      const r = Routes.byId(rt.switched);
      if (r) routeTxt += ` — nouveau cap pris : <b>${r.label}</b> 🧭`;
    }
    const altTxt = Math.abs(sum.altDelta) < 100
      ? `a gardé une altitude stable ✈️`
      : sum.altDelta > 0
        ? `a grimpé de ${fmt(sum.altDelta)} ft ▲`
        : `a perdu ${fmt(-sum.altDelta)} ft ▼`;
    // 🌬️ Effet moyen du vent réel sur la distance parcourue hors ligne
    let windTxt = '';
    if (typeof sum.wind === 'number' && Math.abs(sum.wind) >= 0.02) {
      const p = Math.round(Math.abs(sum.wind) * 100);
      windTxt = sum.wind > 0
        ? ` — porté par un vent arrière (<b>+${p} %</b> de distance) 🌬️`
        : ` — malgré un vent de face (<b>−${p} %</b> de distance) 🌬️`;
    }
    toast(`🛫 Pendant ton absence (${timeTxt}), ton avion a parcouru <b>${fmt(sum.km)} km</b> et ${altTxt}${windTxt}${routeTxt}`,
      routeTxt ? 9000 : 7000);
  }

  /* ---------- Écouteurs ---------- */

  function bind() {
    $('btn-add-activity').addEventListener('click', () => {
      buildActivityGrid();
      resetSessionWhen();
      refreshGainPreview();
      openModal('modal-activity');
    });
    // Bouton du panneau CRASH : ouvre directement l'ajout de séance
    $('btn-crash-restart').addEventListener('click', () => {
      buildActivityGrid();
      resetSessionWhen();
      refreshGainPreview();
      openModal('modal-activity');
    });
    $('duration-slider').addEventListener('input', refreshGainPreview);
    $('session-date').addEventListener('change', refreshGainPreview);
    $('session-time').addEventListener('change', refreshGainPreview);
    $('btn-confirm-activity').addEventListener('click', confirmActivity);

    $('btn-shop').addEventListener('click', () => {
      refreshShop();
      openModal('modal-shop');
    });

    $('btn-journal').addEventListener('click', () => {
      refreshJournal();
      openModal('modal-journal');
    });

    $('btn-wheel').addEventListener('click', () => Wheel.open());
    document.querySelectorAll('.shop-tab').forEach(tab =>
      tab.addEventListener('click', () => { shopTab = tab.dataset.tab; refreshShop(); }));

    // Certaines croix (carte, détail d'un jour) n'ont pas de data-close et
    // gèrent leur propre fermeture : on retombe alors sur la modale parente.
    document.querySelectorAll('.modal-close').forEach(btn =>
      btn.addEventListener('click', () => {
        if (btn.dataset.close) { closeModal(btn.dataset.close); return; }
        const bd = btn.closest('.modal-backdrop');
        if (bd) bd.classList.remove('open');
      }));
    document.querySelectorAll('.modal-backdrop').forEach(bd =>
      bd.addEventListener('click', (e) => { if (e.target === bd) bd.classList.remove('open'); }));

    // Météo & vents 🌬️ (badge du HUD + panneau de prévisions)
    WeatherUI.bind();

    // Fiche de pilote 🎫 (v2.8)
    $('btn-profile').addEventListener('click', () => Profile.open());

    // Classement repliable (v2.9)
    const scoreBtn = $('btn-score-toggle');
    if (scoreBtn) {
      scoreBtn.addEventListener('click', toggleScore);
      setScoreOpen(scoreOpenDefault(), false);
    }

    // Déconnexion : retour à l'écran d'accueil
    $('btn-switch-player').addEventListener('click', () => Auth.logout());
  }

  return { bind, refreshHUD, refreshShop, refreshScoreboard, toast,
           offlineSummary, keroseneRain, streakReminder, flightEvents,
           setScoreOpen, toggleScore };
})();
