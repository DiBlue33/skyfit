/* ============================================================
   SkyFit — Statistiques 📊 & Calendrier des séances 📅
   ------------------------------------------------------------
   - Statistiques du pilote connecté : heures par sport (compteurs
     animés), sport préféré, créatine ingérée, jour et heure favoris
   - Calendrier mensuel COMMUN à tous les pilotes, avec cartouches
     colorées façon agenda (Jade en rose, Diego en bleu)
   ============================================================ */

const Stats = (() => {

  const $ = (id) => document.getElementById(id);

  // Couleur de chaque pilote (par prénom, sinon palette)
  const NAME_COLORS = [
    [/jade/i, '#e84393'],   // rose
    [/di[eé]go/i, '#2e86de'], // bleu
  ];
  const FALLBACK_COLORS = ['#27ae60', '#8e44ad', '#e67e22', '#16a085'];

  function playerColor(name) {
    for (const [re, color] of NAME_COLORS) {
      if (re.test(name)) return color;
    }
    const idx = State.allPlayers().findIndex(p => p.name === name);
    return FALLBACK_COLORS[Math.max(0, idx) % FALLBACK_COLORS.length];
  }

  // Séances de sport uniquement (ni succès, ni bonus nutrition)
  function sportSessions(p) {
    return (p.activityLog || []).filter(e =>
      e.activityId !== 'achievement' && e.activityId !== 'creatine');
  }

  function actInfo(id) {
    return CONFIG.ACTIVITIES.find(a => a.id === id) ||
      (CONFIG.LEGACY_ACTIVITIES || {})[id] ||
      { icon: '💪', name: id };
  }

  /* ---------- Compteurs animés ---------- */

  function animateCounters(root) {
    root.querySelectorAll('[data-count]').forEach((el, i) => {
      const target = parseFloat(el.dataset.count);
      const decimals = parseInt(el.dataset.decimals || '0', 10);
      const suffix = el.dataset.suffix || '';
      const dur = 1100 + Math.random() * 300;
      const start = performance.now() + i * 90; // léger décalage en cascade
      el.textContent = (0).toFixed(decimals).replace('.', ',') + suffix;
      function tick(now) {
        const t = Math.min(1, Math.max(0, (now - start) / dur));
        const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
        const val = target * eased;
        el.textContent = val.toFixed(decimals).replace('.', ',')
          .replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + suffix;
        if (t < 1) requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    });
  }

  /* ---------- Statistiques ---------- */

  function renderStats() {
    const p = State.current();
    if (!p) return;
    const sessions = sportSessions(p);

    // Minutes par sport
    const minutesBySport = {};
    sessions.forEach(e => {
      minutesBySport[e.activityId] = (minutesBySport[e.activityId] || 0) + (e.minutes || 0);
    });
    const sports = Object.entries(minutesBySport)
      .sort((a, b) => b[1] - a[1]);

    // Sport préféré / jour / heure favoris
    const fav = sports[0] ? actInfo(sports[0][0]) : null;
    const dayCount = {}, hourCount = {};
    sessions.forEach(e => {
      const d = new Date(e.date);
      dayCount[d.getDay()] = (dayCount[d.getDay()] || 0) + 1;
      hourCount[d.getHours()] = (hourCount[d.getHours()] || 0) + 1;
    });
    const best = (obj) => Object.entries(obj).sort((a, b) => b[1] - a[1])[0];
    const DAYS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
    const favDay = best(dayCount);
    const favHour = best(hourCount);
    const doses = (p.activityLog || []).filter(e => e.activityId === 'creatine').length;

    // Cartes résumé
    $('stats-cards').innerHTML = `
      <div class="stat-card">
        <div class="sc-label">Sport préféré</div>
        <div class="sc-value">${fav ? fav.icon + ' ' + fav.name : '—'}</div>
      </div>
      <div class="stat-card">
        <div class="sc-label">Créatine ingérée</div>
        <div class="sc-value"><span data-count="${doses * 5}" data-suffix=" g">0</span> 💊</div>
      </div>
      <div class="stat-card">
        <div class="sc-label">Jour préféré</div>
        <div class="sc-value">${favDay ? DAYS[favDay[0]] : '—'}</div>
      </div>
      <div class="stat-card">
        <div class="sc-label">Heure préférée</div>
        <div class="sc-value">${favHour ? favHour[0] + ' h' : '—'}</div>
      </div>`;

    // Heures par sport (compteurs animés)
    $('stats-sports').innerHTML = sports.length ? sports.map(([id, min]) => {
      const a = actInfo(id);
      const hours = min / 60;
      const iconHtml = a.img ? `<img class="ss-img" src="${a.img}" alt="">` : a.icon;
      return `
        <div class="stat-sport">
          <span class="ss-icon">${iconHtml}</span>
          <span class="ss-name">${a.name}</span>
          <span class="ss-hours"><span data-count="${hours.toFixed(1)}"
            data-decimals="1" data-suffix=" h">0</span></span>
        </div>`;
    }).join('')
      : '<p class="stats-empty">Aucune séance pour l\'instant — la première lance les compteurs ! 🏁</p>';
  }

  /* ---------- Calendrier ---------- */

  let calMonth = null; // Date au 1er du mois affiché

  function sessionsByDay() {
    // Toutes les séances de TOUS les pilotes (calendrier commun)
    const map = {};
    State.allPlayers().forEach(p => {
      const color = playerColor(p.name);
      (p.activityLog || []).forEach(e => {
        if (e.activityId === 'achievement') return;
        const d = new Date(e.date);
        const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
        (map[key] = map[key] || []).push({
          time: d.getHours() * 60 + d.getMinutes(),
          hm: d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
          act: actInfo(e.activityId),
          minutes: e.minutes || 0,
          player: p.name,
          color,
        });
      });
    });
    Object.values(map).forEach(list => list.sort((a, b) => a.time - b.time));
    return map;
  }

  function renderCalendar() {
    const y = calMonth.getFullYear(), m = calMonth.getMonth();
    $('cal-title').textContent = calMonth
      .toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
      .replace(/^./, c => c.toUpperCase());

    const byDay = sessionsByDay();
    const firstIdx = (new Date(y, m, 1).getDay() + 6) % 7; // lundi = 0
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const today = new Date();
    const isToday = (d) => d === today.getDate() &&
      m === today.getMonth() && y === today.getFullYear();

    let html = ['L', 'M', 'M', 'J', 'V', 'S', 'D']
      .map(d => `<div class="cal-head">${d}</div>`).join('');
    for (let i = 0; i < firstIdx; i++) html += '<div class="cal-cell empty"></div>';

    for (let d = 1; d <= daysInMonth; d++) {
      const list = byDay[`${y}-${m}-${d}`] || [];
      const chips = list.slice(0, 3).map(s => `
        <span class="cal-chip" style="background:${s.color}"
          title="${s.player} — ${s.act.name}${s.minutes ? ', ' + s.minutes + ' min' : ''} à ${s.hm}">
          ${s.hm} ${s.act.img ? '💊' : s.act.icon}</span>`).join('');
      const more = list.length > 3
        ? `<span class="cal-more">+${list.length - 3}</span>` : '';
      html += `
        <div class="cal-cell ${isToday(d) ? 'today' : ''}">
          <span class="cal-date">${d}</span>
          ${chips}${more}
        </div>`;
    }
    $('cal-grid').innerHTML = html;

    // Légende des pilotes
    $('cal-legend').innerHTML = State.allPlayers().map(p => `
      <span class="cal-key"><span class="dot" style="background:${playerColor(p.name)}"></span>
      ${p.name}</span>`).join('');
  }

  function changeMonth(delta) {
    calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + delta, 1);
    renderCalendar();
  }

  /* ---------- Ouverture ---------- */

  function open() {
    const now = new Date();
    calMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    renderStats();
    renderCalendar();
    $('modal-stats').classList.add('open');
    animateCounters($('modal-stats'));
  }

  function bind() {
    $('btn-stats').addEventListener('click', open);
    $('cal-prev').addEventListener('click', () => changeMonth(-1));
    $('cal-next').addEventListener('click', () => changeMonth(1));
  }

  document.addEventListener('DOMContentLoaded', bind);

  return { open };
})();
