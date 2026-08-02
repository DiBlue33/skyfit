/* ============================================================
   SkyFit — Bilan de la semaine 📈 (v3.8)
   ------------------------------------------------------------
   Deux rôles :

   1. TENIR LES COMPTES. Les km, les points et le temps de vol
      n'existent qu'en total courant. Sans photo prise le lundi,
      impossible de dire ce qu'UNE semaine a rapporté. Ce module
      prend cette photo, et archive la semaine écoulée dès que le
      lundi suivant arrive.

   2. RACONTER. Le panneau affiche la semaine des DEUX pilotes côte
      à côte, désigne le vainqueur, et permet de remonter dans les
      semaines passées.

   Le calcul lui-même vit dans js/config.js (CONFIG.weekReport), et
   pas ici : l'émetteur de notifications tourne sur GitHub Actions,
   sans DOM ni State, et doit annoncer exactement les mêmes chiffres
   que ceux affichés à l'écran.
   ============================================================ */

const Weekly = (() => {

  const $ = (id) => document.getElementById(id);

  /* ------------------------------------------------------------
     1. Tenue des comptes
     ------------------------------------------------------------ */

  /** Total des points GAGNÉS : la boutique ne doit pas faire reculer le bilan. */
  const gagnes = (p) => (Number(p.points) || 0) + (Number(p.pointsSpent) || 0);

  /** Photographie les compteurs cumulés au début de la semaine `ws`. */
  function snapshot(p, ws) {
    p.weekKey     = ws;
    p.wsKm        = Number(p.lifetimeKm) || 0;
    p.wsPoints    = gagnes(p);
    p.wsFlight    = Number(p.flightSeconds) || 0;
    p.wsLandings  = Number(p.landings) || 0;
  }

  /**
   * Bascule hebdomadaire du pilote `p`. À appeler AVANT le rattrapage
   * hors ligne (Engine.catchUp).
   *
   * Pourquoi avant : au retour après trois jours d'absence, le rattrapage
   * crédite d'un coup tous les kilomètres parcourus pendant ce temps. Si
   * la bascule passait après, ces kilomètres-là — dont une partie
   * appartient à la semaine en cours — seraient archivés dans la semaine
   * précédente. En basculant avant, la semaine archivée contient
   * exactement ce qui avait été crédité tant que le jeu tournait, et le
   * hors-ligne est porté au crédit de la semaine du retour. Ce n'est pas
   * au kilomètre près pour qui disparaît une semaine entière, mais c'est
   * déterministe et ça ne compte jamais deux fois.
   *
   * Ne touche QUE le pilote en cours de partie : l'autre profil fait sa
   * propre bascule sur son propre téléphone. Modifier le profil du
   * conjoint ici le ferait gagner la fusion de synchro et écraserait son
   * appareil — c'est exactement l'accident de la v3.7.
   *
   * @returns {boolean} vrai si une semaine vient d'être archivée.
   */
  function sync(p) {
    if (!p) return false;
    const cur = CONFIG.weekStart(Date.now());
    const prev = Number(p.weekKey) || 0;

    if (!prev) { snapshot(p, cur); return false; }   // premier lancement
    if (prev === cur) return false;                   // même semaine, rien à faire
    if (prev > cur) { snapshot(p, cur); return false; } // horloge reculée : on repart proprement

    const r = CONFIG.weekReport(p, prev);
    if (!Array.isArray(p.weekLog)) p.weekLog = [];
    if (!p.weekLog.some(w => Number(w.key) === prev)) {
      p.weekLog.unshift({
        key: prev,
        sessions: r.sessions,
        minutes: r.minutes,
        days: r.days,
        kero: Math.round(r.kero),
        km: Math.round(r.km || 0),
        points: Math.round(r.points || 0),
        flightMin: Math.round(r.flightMin || 0),
        landings: Math.round(r.landings || 0),
      });
      p.weekLog = p.weekLog.slice(0, 26);
    }
    snapshot(p, cur);
    return true;
  }

  /** Un bilan de semaine terminée attend-il d'être lu ? */
  function hasNew(p) {
    if (!p || !Array.isArray(p.weekLog) || !p.weekLog.length) return false;
    return Number(p.weekLog[0].key) > (Number(p.weekSeen) || 0);
  }

  /** Pastille 📈 sur le bouton, comme celles des quêtes et de la roue. */
  function updateBadge() {
    const el = $('weekly-badge');
    if (!el) return;
    el.textContent = hasNew(State.current()) ? '•' : '';
  }

  /* ------------------------------------------------------------
     2. Rendu
     ------------------------------------------------------------ */

  let shown = null;   // lundi de la semaine affichée

  const nf = (n) => Math.round(n).toLocaleString('fr-FR');

  /** « 3 h 20 » plutôt que « 200 min » : personne ne pense en minutes. */
  function duree(min) {
    const m = Math.round(Number(min) || 0);
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60), r = m % 60;
    return r ? `${h} h ${String(r).padStart(2, '0')}` : `${h} h`;
  }

  function actInfo(id) {
    return CONFIG.ACTIVITIES.find(a => a.id === id) ||
      (CONFIG.LEGACY_ACTIVITIES || {})[id] ||
      { icon: '💪', name: id };
  }

  function libelle(ws) {
    const a = new Date(ws);
    const b = new Date(CONFIG.weekEnd(ws) - 86400000);
    const opt = { day: 'numeric', month: 'long' };
    const meme = a.getMonth() === b.getMonth();
    return `${a.toLocaleDateString('fr-FR', meme ? { day: 'numeric' } : opt)}` +
           ` – ${b.toLocaleDateString('fr-FR', opt)}`;
  }

  /** Carte d'un pilote. `part` = sa part des minutes du duo, pour la barre. */
  function carte(r, part, gagnant) {
    const color = Stats.colorOf(r.name);
    const sports = r.sports.slice(0, 4).map(s => {
      const a = actInfo(s.id);
      const w = r.minutes ? Math.round(s.minutes / r.minutes * 100) : 0;
      return `
        <div class="wk-sport">
          <span class="wk-si">${a.img ? `<img src="${a.img}" alt="">` : a.icon}</span>
          <span class="wk-sn">${a.name}</span>
          <span class="wk-sbar"><i style="width:${w}%;background:${color}"></i></span>
          <span class="wk-sv">${duree(s.minutes)}</span>
        </div>`;
    }).join('');

    const chiffre = (label, val) => `
      <div class="wk-stat"><span class="wk-sl">${label}</span><span class="wk-sv2">${val}</span></div>`;

    return `
      <div class="wk-card ${gagnant ? 'win' : ''}" style="--pc:${color}">
        <div class="wk-head">
          <span class="wk-name">${r.name}</span>
          ${gagnant ? '<span class="wk-crown">👑</span>' : ''}
        </div>
        <div class="wk-hours"><span data-count="${r.minutes}" data-suffix=" min">0</span></div>
        <div class="wk-sub">${duree(r.minutes)} de sport · ${r.sessions} séance${r.sessions > 1 ? 's' : ''}</div>
        <div class="wk-bar"><i style="width:${part}%;background:${color}"></i></div>
        <div class="wk-stats">
          ${chiffre('Jours actifs', `${r.days}/7`)}
          ${chiffre('Kérosène', `${nf(r.kero)} L`)}
          ${chiffre('Distance', r.km == null ? '—' : `${nf(r.km)} km`)}
          ${chiffre('Points', r.points == null ? '—' : nf(r.points))}
        </div>
        ${r.best ? `<div class="wk-best">🥇 Plus longue séance —
          ${actInfo(r.best.activityId).name}, ${duree(r.best.minutes)}</div>` : ''}
        ${sports || '<p class="wk-none">Aucune séance cette semaine 😴</p>'}
      </div>`;
  }

  function render() {
    const ws = shown;
    const first = CONFIG.weekStart(Date.now());
    const pilotes = State.allPlayers();
    const reports = pilotes.map(p => CONFIG.weekReport(p, ws));
    const total = reports.reduce((a, r) => a + r.minutes, 0);
    const { winner, tie } = CONFIG.weekWinner(reports);
    const enCours = ws === first;

    $('wk-title').textContent = libelle(ws);
    $('wk-next').disabled = enCours;
    // Ne pas remonter avant la première semaine dont on ait une trace.
    const plusVieille = pilotes.reduce((min, p) => {
      const l = (p.weekLog || []);
      const k = l.length ? Number(l[l.length - 1].key) : Number(p.weekKey) || first;
      return Math.min(min, k || first);
    }, first);
    $('wk-prev').disabled = ws <= plusVieille;

    const banniere = !total
      ? `<div class="wk-verdict none">Semaine blanche pour tout le monde.
           ${enCours ? 'Il est encore temps 😉' : ''}</div>`
      : tie
        ? `<div class="wk-verdict tie">🤝 Égalité parfaite — ${duree(winner.minutes)} chacun.</div>`
        : `<div class="wk-verdict" style="--pc:${Stats.colorOf(winner.name)}">
             ${enCours ? '🏁 En tête' : '🏆 Vainqueur de la semaine'} :
             <b>${winner.name}</b>, ${duree(winner.minutes)} de sport.</div>`;

    $('wk-body').innerHTML = banniere +
      `<div class="wk-cards">` +
      reports.map(r => carte(r,
        total ? Math.round(r.minutes / total * 100) : 0,
        !!winner && !tie && r.name === winner.name)).join('') +
      `</div>` +
      (enCours ? `<p class="wk-foot">La semaine se referme dimanche à minuit.
        Le bilan complet arrive dimanche soir par notification.</p>` : '');

    Stats.animate($('wk-body'));
  }

  function move(n) {
    const first = CONFIG.weekStart(Date.now());
    const next = CONFIG.weekShift(shown, n);
    if (next > first) return;
    shown = next;
    render();
  }

  /* ------------------------------------------------------------
     3. Ouverture
     ------------------------------------------------------------ */

  function open() {
    const p = State.current();
    if (!p) return;
    /* Ouvrir sur la dernière semaine TERMINÉE si son bilan n'a pas encore
       été lu : c'est ce que le joueur vient chercher le lundi matin. */
    const dernier = (p.weekLog || [])[0];
    shown = (dernier && Number(dernier.key) > (Number(p.weekSeen) || 0))
      ? Number(dernier.key)
      : CONFIG.weekStart(Date.now());

    if (dernier) {
      p.weekSeen = Math.max(Number(p.weekSeen) || 0, Number(dernier.key) || 0);
      p.updatedAt = Date.now();
      State.save();
    }
    updateBadge();
    render();
    const m = $('modal-weekly');
    if (m) m.classList.add('open');
  }

  function bind() {
    const b = $('btn-weekly');
    if (b) b.addEventListener('click', open);
    const prev = $('wk-prev'), next = $('wk-next');
    if (prev) prev.addEventListener('click', () => move(-1));
    if (next) next.addEventListener('click', () => move(1));
  }

  document.addEventListener('DOMContentLoaded', bind);

  return { sync, hasNew, updateBadge, open, render,
           // points d'entrée réservés aux suites de tests
           _snapshot: snapshot, _duree: duree };
})();
