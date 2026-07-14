/* ============================================================
   SkyFit — Interface : HUD, modales, boutique, sélection joueur
   ============================================================ */

const UI = (() => {

  const $ = (id) => document.getElementById(id);
  const fmt = (n) => Math.floor(n).toLocaleString('fr-FR');

  let selectedActivity = 'running';
  let shopTab = 'planes';
  let lastAlt = null;

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

    // Distance & points
    $('total-km').textContent = fmt(p.totalKm);
    $('points').textContent = fmt(State.availablePoints(p));

    // Altimètre
    const t = (p.altitude - CONFIG.ALT_MIN) / (CONFIG.ALT_MAX - CONFIG.ALT_MIN);
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

    // Vitesse (nulle si l'avion est au sol)
    const speed = p.crashed ? 0 : CONFIG.speedForAlt(p.altitude) * State.speedMult(p);
    $('speed-value').textContent = fmt(speed);

    // Scène (un avion qui a déjà crashé reste marqué à vie)
    Scene.update(p.altitude, speed);
    Scene.setCondition(p.crashed, (p.crashes || 0) > 0);

    // Panneau CRASH
    const overlay = $('crash-overlay');
    overlay.classList.toggle('show', !!p.crashed);
    if (p.crashed) {
      $('crash-record').innerHTML = p.bestKm > 0
        ? `🏆 Ton record à battre : <b>${fmt(p.bestKm)} km</b> (crash n°${p.crashes})`
        : `Fais une séance de sport pour repartir à ${fmt(CONFIG.ALT_START)} ft !`;
    }

    refreshScoreboard();
    lastAlt = p.altitude;
  }

  // Classement général : trié par record (meilleure tentative)
  function refreshScoreboard() {
    const me = State.current();
    const record = (p) => Math.max(p.bestKm || 0, p.totalKm || 0);
    const players = State.allPlayers()
      .slice()
      .sort((a, b) => record(b) - record(a));
    const medals = ['🥇', '🥈', '🥉'];
    $('scoreboard').innerHTML = players.map((p, i) => `
      <div class="score-row ${p.name === me.name ? 'me' : ''}">
        <span><span class="medal">${medals[i] || '•'}</span>${escapeHtml(p.name)}${p.crashed ? ' 💥' : ''}</span>
        <span>${fmt(p.totalKm)} km
          <span class="score-record">🏆 ${fmt(record(p))}</span></span>
      </div>`).join('');
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  /* ---------- Modales génériques ---------- */

  function openModal(id) { $(id).classList.add('open'); }
  function closeModal(id) { $(id).classList.remove('open'); }

  /* ---------- Modale activité ---------- */

  function buildActivityGrid() {
    $('activity-grid').innerHTML = CONFIG.ACTIVITIES.map(a => `
      <button class="activity-choice ${a.id === selectedActivity ? 'selected' : ''}"
              data-activity="${a.id}" type="button">
        <span class="emoji">${a.icon}</span>${a.name}
      </button>`).join('');
    $('activity-grid').querySelectorAll('.activity-choice').forEach(btn => {
      btn.addEventListener('click', () => {
        selectedActivity = btn.dataset.activity;
        buildActivityGrid();
        refreshGainPreview();
      });
    });
  }

  function refreshGainPreview() {
    const p = State.current();
    const act = CONFIG.ACTIVITIES.find(a => a.id === selectedActivity);
    const minutes = parseInt($('duration-slider').value, 10);
    $('duration-value').textContent = minutes;
    const litres = Math.round(act.keroPerMin * minutes * State.keroYield(p));
    const climb = Math.round(litres * CONFIG.CLIMB_FT_PER_LITRE);
    $('gain-preview').innerHTML =
      `⛽ Cette séance rapportera <b>${fmt(litres)} L</b> de kérosène,` +
      ` soit jusqu'à <b>+${fmt(climb)} ft</b> d'altitude.`;
  }

  function confirmActivity() {
    const p = State.current();
    const minutes = parseInt($('duration-slider').value, 10);
    const res = Engine.logActivity(p, selectedActivity, minutes);
    closeModal('modal-activity');
    const act = CONFIG.ACTIVITIES.find(a => a.id === selectedActivity);
    if (res.tookOff) {
      toast(`🛫 REDÉCOLLAGE ! ${minutes} min de ${act.name.toLowerCase()} : +${fmt(res.litres)} L. ` +
        `Nouvelle tentative depuis ${fmt(CONFIG.ALT_START)} ft — bats ton record !`, 6000);
    } else {
      toast(`${act.icon} Bravo ! ${minutes} min de ${act.name.toLowerCase()} : +${fmt(res.litres)} L de kérosène. En montée ! ▲`);
    }
    refreshHUD();
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
      const act = CONFIG.ACTIVITIES.find(a => a.id === e.activityId) ||
        { icon: '💪', name: e.activityId };
      const time = new Date(e.date).toLocaleTimeString('fr-FR',
        { hour: '2-digit', minute: '2-digit' });
      const mine = me && e.player === me.name;
      html += `
        <div class="journal-row ${mine ? 'me' : ''}">
          <span class="j-time">${time}</span>
          <span class="j-icon">${act.icon}</span>
          <span class="j-text"><b>${escapeHtml(e.player)}</b> — ${act.name}, ${e.minutes} min</span>
          <span class="j-gain">+${fmt(e.kero)} L ⛽</span>
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
        return shopItem(plane.name, plane.desc, current ? 'owned-current' : '', btn);
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
    } else {
      html = CONFIG.DECORS.map(d => {
        const owned = p.ownedDecors.includes(d.id);
        const current = p.currentDecor === d.id;
        const canBuy = State.availablePoints(p) >= d.cost;
        let btn;
        if (current) btn = `<button class="btn small ghost" disabled type="button">Actif ✓</button>`;
        else if (owned) btn = `<button class="btn small" data-buy-decor="${d.id}" type="button">Activer</button>`;
        else btn = `<button class="btn small warm" data-buy-decor="${d.id}" ${canBuy ? '' : 'disabled'} type="button">★ ${fmt(d.cost)}</button>`;
        return shopItem(d.name, '', current ? 'owned-current' : '', btn);
      }).join('');
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
    $('shop-content').querySelectorAll('[data-buy-decor]').forEach(b =>
      b.addEventListener('click', () => {
        if (Engine.buyDecor(p, b.dataset.buyDecor)) {
          Scene.setDecor(p.currentDecor);
          toast('🌄 Nouveau décor activé !');
        }
        refreshShop(); refreshHUD();
      }));
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
        `puis s'est <b>CRASHÉ</b> ! Fais du sport pour redécoller.`, 9000);
      return;
    }
    const altTxt = Math.abs(sum.altDelta) < 100
      ? `a gardé une altitude stable ✈️`
      : sum.altDelta > 0
        ? `a grimpé de ${fmt(sum.altDelta)} ft ▲`
        : `a perdu ${fmt(-sum.altDelta)} ft ▼`;
    toast(`🛫 Pendant ton absence (${timeTxt}), ton avion a parcouru <b>${fmt(sum.km)} km</b> et ${altTxt}`, 7000);
  }

  /* ---------- Écouteurs ---------- */

  function bind() {
    $('btn-add-activity').addEventListener('click', () => {
      buildActivityGrid();
      refreshGainPreview();
      openModal('modal-activity');
    });
    // Bouton du panneau CRASH : ouvre directement l'ajout de séance
    $('btn-crash-restart').addEventListener('click', () => {
      buildActivityGrid();
      refreshGainPreview();
      openModal('modal-activity');
    });
    $('duration-slider').addEventListener('input', refreshGainPreview);
    $('btn-confirm-activity').addEventListener('click', confirmActivity);

    $('btn-shop').addEventListener('click', () => {
      refreshShop();
      openModal('modal-shop');
    });

    $('btn-journal').addEventListener('click', () => {
      refreshJournal();
      openModal('modal-journal');
    });
    document.querySelectorAll('.shop-tab').forEach(tab =>
      tab.addEventListener('click', () => { shopTab = tab.dataset.tab; refreshShop(); }));

    document.querySelectorAll('.modal-close').forEach(btn =>
      btn.addEventListener('click', () => closeModal(btn.dataset.close)));
    document.querySelectorAll('.modal-backdrop').forEach(bd =>
      bd.addEventListener('click', (e) => { if (e.target === bd) bd.classList.remove('open'); }));

    // Déconnexion : retour à l'écran d'accueil
    $('btn-switch-player').addEventListener('click', () => Auth.logout());
  }

  return { bind, refreshHUD, toast, offlineSummary };
})();
