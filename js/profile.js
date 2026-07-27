/* ============================================================
   SkyFit — Fiche de pilote 🎫 (v2.8, croisée en v2.9)
   ------------------------------------------------------------
   Une page « passeport » qui rassemble tout ce qu'un pilote a
   accompli, en six blocs :

     1. Licence de pilote — avatar, indicatif, numéro de licence,
        date d'inscription, grade, et les tampons verts des avions
        débloqués (comme les tampons d'un passeport).
     2. Chiffres clés & records
     3. Carnet de vol — villes visitées, région par région
     4. Vitrine des succès — 3 derniers réclamés + 3 épinglés
     5. Mon hangar — flotte et décors possédés
     6. Personnalisation — avatar, indicatif, code PIN

   Tout est recalculé à l'ouverture depuis l'état du joueur :
   rien de nouveau n'est stocké, sauf `avatar`, `callsign` et
   `pinnedAchievements` (champs plats, conservés par Firebase).

   v2.9 — la fiche est désormais *croisée* : on peut consulter
   celle de l'autre pilote via l'onglet en haut de la modale ou
   en cliquant sur son nom dans le classement. Une fiche qui
   n'est pas la sienne est strictement en lecture seule : ni
   épinglage, ni avatar, ni indicatif, ni code PIN.
   ============================================================ */

const Profile = (() => {

  const $ = (id) => document.getElementById(id);
  const fmt = (n) => Math.floor(n).toLocaleString('fr-FR');

  /** Nom du pilote actuellement affiché dans la modale (null = moi). */
  let viewedName = null;

  /** Le pilote dont la fiche est à l'écran. */
  function viewed() {
    if (!viewedName) return State.current();
    const found = State.allPlayers().find(p => p.name === viewedName);
    return found || State.current();
  }

  /** Vrai si la fiche affichée est celle du joueur connecté. */
  function isMine(p) {
    const me = State.current();
    return !!(me && p && me.name === p.name);
  }

  /** Palette proposée dans la personnalisation. */
  const AVATAR_CHOICES = [
    '👨‍✈️', '👩‍✈️', '🧑‍✈️', '🦸', '🦸‍♀️', '🐧', '🦅', '🦉',
    '🐱', '🐼', '🚀', '🛸', '⭐', '🌙', '🎩', '🥽',
  ];

  function normalize(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  /** Avatar affiché : celui choisi, sinon le défaut lié au prénom. */
  function avatarOf(p) {
    if (!p) return '🧑‍✈️';
    if (p.avatar) return p.avatar;
    const n = normalize(p.name);
    if (n.indexOf('jade') === 0) return '👩‍✈️';
    if (n.indexOf('diego') === 0) return '👨‍✈️';
    return '🧑‍✈️';
  }

  /** Numéro de licence stable : dérivé du nom et de la date d'inscription. */
  function licenceNumber(p) {
    const s = `${p.name}|${p.createdAt || 0}`;
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = (((h << 5) + h) ^ s.charCodeAt(i)) >>> 0;
    const digits = String(h % 1000000).padStart(6, '0');
    const initial = (normalize(p.name)[0] || 'x').toUpperCase();
    return `FR-${initial}${digits}`;
  }

  function dateFr(ts) {
    if (!ts) return '—';
    return new Date(ts).toLocaleDateString('fr-FR',
      { day: '2-digit', month: 'long', year: 'numeric' });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  /** Durée lisible : « 128 h 30 » ou « 42 min ». */
  function hoursLabel(h) {
    if (h < 1) return `${Math.round(h * 60)} min`;
    let whole = Math.floor(h);
    let mins = Math.round((h - whole) * 60);
    if (mins === 60) { whole += 1; mins = 0; }   // évite « 249 h 60 »
    return `${fmt(whole)} h ${String(mins).padStart(2, '0')}`;
  }

  /* ------------------------------------------------------------
     1. Licence de pilote
     ------------------------------------------------------------ */

  /**
   * Progression vers le grade suivant : la plus contraignante des deux
   * conditions (heures de vol / trajets) donne le pourcentage affiché.
   */
  function gradeProgress(p) {
    const next = CONFIG.nextGrade(p);
    if (!next) return null;
    const cur = CONFIG.GRADES[CONFIG.gradeIndex(p)];
    const h = CONFIG.flightHours(p);
    const t = CONFIG.tripsOf(p);
    const ph = next.hours > cur.hours
      ? (h - cur.hours) / (next.hours - cur.hours) : 1;
    const pt = next.trips > cur.trips
      ? (t - cur.trips) / (next.trips - cur.trips) : 1;
    return {
      next,
      pct: Math.max(0, Math.min(100, Math.min(ph, pt) * 100)),
      hoursLeft: Math.max(0, next.hours - h),
      tripsLeft: Math.max(0, next.trips - t),
    };
  }

  function renderLicence(p) {
    const grade = CONFIG.gradeOf(p);
    const prog = gradeProgress(p);
    const owned = p.ownedPlanes || [];

    // Tampons de passeport : un par avion, vert si débloqué
    const stamps = CONFIG.PLANES.map(pl => {
      const has = owned.includes(pl.id);
      return `<div class="pf-stamp ${has ? 'got' : 'todo'}"
                   title="${escapeHtml(pl.name)}${has ? ' — débloqué' : ' — non débloqué'}">
                <span class="st-name">${escapeHtml(pl.name)}</span>
                <span class="st-mark">${has ? '✔' : '·'}</span>
              </div>`;
    }).join('');

    const gradeLine = prog
      ? `<div class="pf-grade-bar"><div class="pf-grade-fill" style="width:${prog.pct.toFixed(1)}%"></div></div>
         <div class="pf-grade-next">
           Prochain grade : ${prog.next.icon} <b>${escapeHtml(prog.next.name)}</b> —
           ${prog.hoursLeft > 0 ? `encore ${hoursLabel(prog.hoursLeft)} de vol` : 'heures de vol ✔'}
           · ${prog.tripsLeft > 0 ? `${fmt(prog.tripsLeft)} trajet${prog.tripsLeft > 1 ? 's' : ''}` : 'trajets ✔'}
         </div>`
      : '<div class="pf-grade-next">🏆 Grade maximal atteint. Rien au-dessus, sinon les étoiles.</div>';

    return `
      <div class="pf-licence">
        <div class="pf-lic-head">
          <div class="pf-lic-avatar">${avatarOf(p)}</div>
          <div class="pf-lic-id">
            <div class="pf-lic-title">Licence de pilote de ligne</div>
            <div class="pf-lic-name">${escapeHtml(p.name)}</div>
            ${p.callsign ? `<div class="pf-lic-call">Indicatif « ${escapeHtml(p.callsign)} »</div>` : ''}
            <div class="pf-lic-meta">
              <span>N° ${licenceNumber(p)}</span>
              <span>Breveté le ${dateFr(p.createdAt)}</span>
            </div>
          </div>
          <div class="pf-lic-grade">
            <div class="pf-grade-icon">${grade.icon}</div>
            <div class="pf-grade-name">${escapeHtml(grade.name)}</div>
          </div>
        </div>
        <div class="pf-grade-stats">
          <span>🕐 ${hoursLabel(CONFIG.flightHours(p))} de vol</span>
          <span>🛬 ${fmt(CONFIG.tripsOf(p))} trajet${CONFIG.tripsOf(p) > 1 ? 's' : ''}</span>
        </div>
        ${gradeLine}
        <div class="pf-stamps-title">Qualifications machine — ${owned.length} / ${CONFIG.PLANES.length}</div>
        <div class="pf-stamps">${stamps}</div>
      </div>`;
  }

  /* ------------------------------------------------------------
     2. Chiffres clés & records
     ------------------------------------------------------------ */

  function renderKeyFigures(p) {
    const plane = CONFIG.planeOf(p);
    const cells = [
      ['🛫', 'Tentative en cours', `${fmt(p.totalKm)} km`],
      ['🏆', 'Record de tentative', `${fmt(Math.max(p.bestKm || 0, p.totalKm || 0))} km`],
      ['🌍', 'Distance à vie', `${fmt(p.lifetimeKm)} km`],
      ['★', 'Points disponibles', fmt(State.availablePoints(p))],
      ['📈', 'Altitude max atteinte', `${fmt(p.maxAltitude)} ft`],
      ['💥', 'Crashs', fmt(p.crashes || 0)],
      ['🏃', 'Séances enregistrées', fmt(p.totalSessions || 0)],
      ['⏱️', 'Sport cumulé', hoursLabel((p.totalSportMinutes || 0) / 60)],
      ['🔥', 'Plus longue série', `${fmt(p.bestStreak || 0)} jour${(p.bestStreak || 0) > 1 ? 's' : ''}`],
      ['🎡', 'Tours de roue', `${fmt(p.wheelSpins || 0)} · ${fmt(p.wheelJackpots || 0)} 💎`],
      ['✈️', 'Appareil actuel', plane.name],
      ['🛬', 'Passages à LFPG', fmt(p.baseTouches || 0)],
    ];
    return `
      <h3 class="pf-h3">📊 Chiffres clés &amp; records</h3>
      <div class="pf-figures">
        ${cells.map(([i, label, value]) => `
          <div class="pf-fig">
            <div class="pf-fig-icon">${i}</div>
            <div class="pf-fig-label">${label}</div>
            <div class="pf-fig-value">${escapeHtml(value)}</div>
          </div>`).join('')}
      </div>`;
  }

  /* ------------------------------------------------------------
     3. Carnet de vol
     ------------------------------------------------------------ */

  function renderLogbook(p) {
    const all = Routes.all();
    const visited = p.visited || [];
    const total = all.length;

    let html = `
      <h3 class="pf-h3">📖 Carnet de vol — ${visited.length} / ${total} villes</h3>
      <div class="pf-log-bar"><div class="pf-log-fill"
           style="width:${(visited.length / total * 100).toFixed(1)}%"></div></div>`;

    Routes.REGIONS.forEach(region => {
      const list = all.filter(r => r.region === region);
      const done = list.filter(r => visited.includes(r.city)).length;
      html += `<div class="pf-log-region">${escapeHtml(region)} — ${done} / ${list.length}</div>
        <div class="pf-log-cities">` +
        list.map(r => {
          const ok = visited.includes(r.city);
          return `<span class="pf-city ${ok ? 'seen' : 'unseen'}"
                        title="${escapeHtml(r.icao)} — ${fmt(r.km)} km">${r.icon} ${escapeHtml(r.city)}</span>`;
        }).join('') + '</div>';
    });
    return html;
  }

  /* ------------------------------------------------------------
     4. Vitrine des succès
     ------------------------------------------------------------ */

  /** Succès réclamés, du plus récent au plus ancien. */
  function claimedList(p) {
    const claims = p.claimedAchievements || {};
    return Achievements._defs()
      .filter(d => claims[d.id])
      .sort((a, b) => (claims[b.id] || 0) - (claims[a.id] || 0));
  }

  /** `mine` : sur la fiche d'un autre pilote, pas de bouton d'épinglage. */
  function achCard(def, ts, pinned, mine) {
    const pin = mine
      ? `<button class="pf-pin" data-pin="${def.id}" type="button"
                 title="${pinned ? 'Retirer de la vitrine' : 'Épingler sur la vitrine'}">${pinned ? '📌' : '📍'}</button>`
      : (pinned ? '<span class="pf-pin static">📌</span>' : '');
    return `
      <div class="pf-ach ${pinned ? 'pinned' : ''}">
        <span class="pf-ach-icon">${def.icon}</span>
        <span class="pf-ach-body">
          <b>${escapeHtml(def.name)}</b>
          <small>${ts ? dateFr(ts) : ''}</small>
        </span>
        ${pin}
      </div>`;
  }

  function renderTrophies(p) {
    const all = Achievements._defs();
    const claimed = claimedList(p);
    const claims = p.claimedAchievements || {};
    const pins = (p.pinnedAchievements || []).filter(id => claims[id]);
    const mine = isMine(p);

    const pinnedDefs = pins.map(id => all.find(d => d.id === id)).filter(Boolean);
    const recent = claimed.filter(d => !pins.includes(d.id)).slice(0, 3);

    let html = `<h3 class="pf-h3">🏆 Vitrine des succès — ${claimed.length} / ${all.length}</h3>`;

    html += '<div class="pf-ach-sub">📌 Épinglés (3 max)</div>';
    html += pinnedDefs.length
      ? `<div class="pf-ach-list">${pinnedDefs.map(d => achCard(d, claims[d.id], true, mine)).join('')}</div>`
      : (mine
        ? '<div class="pf-empty">Aucun succès épinglé — clique sur 📍 pour en mettre un en vitrine.</div>'
        : '<div class="pf-empty">Aucun succès épinglé sur cette vitrine.</div>');

    html += '<div class="pf-ach-sub">🕐 Derniers réclamés</div>';
    html += recent.length
      ? `<div class="pf-ach-list">${recent.map(d => achCard(d, claims[d.id], false, mine)).join('')}</div>`
      : '<div class="pf-empty">Aucun succès réclamé pour l\'instant.</div>';

    return html;
  }

  /** Épingle / désépingle un succès (3 au maximum, le plus ancien saute). */
  function togglePin(id) {
    const p = State.current();
    if (!p || !isMine(viewed())) return;   // jamais sur la fiche d'un autre
    if (!Array.isArray(p.pinnedAchievements)) p.pinnedAchievements = [];
    const i = p.pinnedAchievements.indexOf(id);
    if (i >= 0) {
      p.pinnedAchievements.splice(i, 1);
    } else {
      p.pinnedAchievements.push(id);
      while (p.pinnedAchievements.length > 3) p.pinnedAchievements.shift();
    }
    State.save(p);
    Sync.push(p);
    render();
  }

  /* ------------------------------------------------------------
     5. Mon hangar
     ------------------------------------------------------------ */

  function renderHangar(p) {
    const ownedP = p.ownedPlanes || [];
    const ownedD = p.ownedDecors || [];

    const planes = CONFIG.PLANES.map(pl => {
      const has = ownedP.includes(pl.id);
      const cur = pl.id === p.currentPlane;
      return `
        <div class="pf-plane ${has ? 'owned' : 'locked'} ${cur ? 'current' : ''}">
          <div class="pf-plane-name">${escapeHtml(pl.name)} ${cur ? '<span class="pf-tag">en vol</span>' : ''}</div>
          <div class="pf-plane-specs">
            <span>🚀 ${fmt(pl.cruise)} km/h</span>
            <span>📈 ${fmt(pl.ceiling)} ft</span>
            <span>${has ? '✅ débloqué' : `🔒 ${fmt(pl.cost)} pts`}</span>
          </div>
        </div>`;
    }).join('');

    const decors = CONFIG.DECORS.map(d => {
      const has = ownedD.includes(d.id);
      const cur = d.id === p.currentDecor;
      return `<span class="pf-decor ${has ? 'owned' : 'locked'} ${cur ? 'current' : ''}">
                ${has ? '✅' : '🔒'} ${escapeHtml(d.name)}</span>`;
    }).join('');

    const title = isMine(p) ? 'Mon hangar' : `Le hangar de ${escapeHtml(p.name)}`;
    return `
      <h3 class="pf-h3">🏗️ ${title} — ${ownedP.length} / ${CONFIG.PLANES.length} appareils</h3>
      <div class="pf-planes">${planes}</div>
      <div class="pf-log-region">Décors — ${ownedD.length} / ${CONFIG.DECORS.length}</div>
      <div class="pf-decors">${decors}</div>`;
  }

  /* ------------------------------------------------------------
     6. Personnalisation
     ------------------------------------------------------------ */

  function renderCustom(p) {
    const cur = avatarOf(p);
    const choices = AVATAR_CHOICES.map(e =>
      `<button class="pf-av ${e === cur ? 'sel' : ''}" data-avatar="${e}" type="button">${e}</button>`
    ).join('');

    return `
      <h3 class="pf-h3">🎨 Personnalisation</h3>
      <div class="pf-custom-label">Avatar affiché dans le HUD</div>
      <div class="pf-avatars">${choices}</div>

      <div class="pf-custom-label">Indicatif radio (facultatif, 8 caractères max)</div>
      <div class="pf-inline">
        <input id="pf-callsign" type="text" maxlength="8" placeholder="SKY01"
               value="${escapeHtml(p.callsign || '')}">
        <button class="btn small" id="pf-callsign-save" type="button">Enregistrer</button>
      </div>

      <div class="pf-custom-label">Code PIN à 4 chiffres</div>
      <div class="pf-pin-form">
        <input id="pf-pin-old" type="password" inputmode="numeric" maxlength="4" placeholder="Actuel">
        <input id="pf-pin-new" type="password" inputmode="numeric" maxlength="4" placeholder="Nouveau">
        <input id="pf-pin-confirm" type="password" inputmode="numeric" maxlength="4" placeholder="Confirmer">
        <button class="btn small" id="pf-pin-save" type="button">Changer</button>
      </div>
      <div class="pf-msg" id="pf-pin-msg"></div>`;
  }

  /* ------------------------------------------------------------
     Onglets pilotes (v2.9)
     ------------------------------------------------------------
     Une rangée d'onglets — un par pilote enregistré — permet de
     passer de sa propre fiche à celle de l'autre sans quitter la
     modale. Avec un seul pilote, la rangée disparaît.
     ------------------------------------------------------------ */

  function renderTabs(p) {
    const players = State.allPlayers();
    if (players.length < 2) return '';
    const me = State.current();
    return `
      <div class="pf-tabs" id="pf-tabs">
        ${players.map(q => `
          <button class="pf-tab ${q.name === p.name ? 'sel' : ''}"
                  data-pilot="${escapeHtml(q.name)}" type="button">
            <span class="pf-tab-av">${avatarOf(q)}</span>
            <span class="pf-tab-name">${escapeHtml(q.name)}</span>
            ${me && q.name === me.name ? '<span class="pf-tab-you">moi</span>' : ''}
          </button>`).join('')}
      </div>`;
  }

  /* ------------------------------------------------------------
     Assemblage & interactions
     ------------------------------------------------------------ */

  function render() {
    const p = viewed();
    const body = $('profile-body');
    if (!p || !body) return;
    const mine = isMine(p);

    const title = $('profile-title');
    if (title) {
      title.textContent = mine
        ? '🎫 Ma fiche de pilote'
        : `🎫 Fiche de pilote — ${p.name}`;
    }

    body.innerHTML =
      renderTabs(p) +
      (mine ? '' : `<div class="pf-readonly">👀 Tu consultes la fiche de
        <b>${escapeHtml(p.name)}</b> — lecture seule.</div>`) +
      renderLicence(p) +
      renderKeyFigures(p) +
      renderLogbook(p) +
      renderTrophies(p) +
      renderHangar(p) +
      (mine ? renderCustom(p) : '');

    bindBody();
  }

  function bindBody() {
    const body = $('profile-body');
    if (!body) return;

    body.querySelectorAll('[data-pilot]').forEach(btn =>
      btn.addEventListener('click', () => {
        viewedName = btn.dataset.pilot;
        render();
        body.scrollTop = 0;
      }));

    body.querySelectorAll('[data-pin]').forEach(btn =>
      btn.addEventListener('click', () => togglePin(btn.dataset.pin)));

    body.querySelectorAll('[data-avatar]').forEach(btn =>
      btn.addEventListener('click', () => {
        const p = State.current();
        if (!p) return;
        p.avatar = btn.dataset.avatar;
        State.save(p);
        Sync.push(p);
        UI.refreshHUD();
        render();
      }));

    const saveCall = $('pf-callsign-save');
    if (saveCall) saveCall.addEventListener('click', () => {
      const p = State.current();
      const input = $('pf-callsign');
      if (!p || !input) return;
      p.callsign = input.value.trim().slice(0, 8);
      State.save(p);
      Sync.push(p);
      UI.toast(p.callsign ? `📻 Indicatif « ${p.callsign} » enregistré.` : '📻 Indicatif effacé.');
      render();
    });

    const savePin = $('pf-pin-save');
    if (savePin) savePin.addEventListener('click', () => {
      const msg = $('pf-pin-msg');
      const res = Auth.changePin(
        $('pf-pin-old').value, $('pf-pin-new').value, $('pf-pin-confirm').value);
      if (res.ok) {
        ['pf-pin-old', 'pf-pin-new', 'pf-pin-confirm'].forEach(id => { $(id).value = ''; });
        msg.className = 'pf-msg ok';
        msg.textContent = '✅ Code modifié.';
        UI.toast('🔐 Nouveau code enregistré.');
      } else {
        msg.className = 'pf-msg err';
        msg.textContent = '❌ ' + res.error;
      }
    });
  }

  /**
   * Ouvre la fiche. Sans argument : la mienne. Avec un nom de pilote
   * (ou l'objet joueur) : la sienne, en lecture seule.
   */
  function open(who) {
    const name = who && typeof who === 'object' ? who.name : who;
    viewedName = name || null;
    render();
    const modal = $('modal-profile');
    if (modal) modal.classList.add('open');
    const body = $('profile-body');
    if (body) body.scrollTop = 0;
  }

  return { open, render, avatarOf, licenceNumber, gradeProgress, viewed, isMine };
})();
