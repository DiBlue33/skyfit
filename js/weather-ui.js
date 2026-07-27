/* ============================================================
   SkyFit — Affichage météo : badge HUD + panneau de prévisions
   ============================================================ */

const WeatherUI = (() => {

  const $ = (id) => document.getElementById(id);
  const fmt = (n) => Math.round(n).toLocaleString('fr-FR');

  /* --- Codes météo WMO → emoji + libellé --- */
  const WMO = [
    [0, '☀️', 'Ciel dégagé'],
    [1, '🌤️', 'Peu nuageux'],
    [2, '⛅', 'Partiellement nuageux'],
    [3, '☁️', 'Couvert'],
    [45, '🌫️', 'Brouillard'],
    [48, '🌫️', 'Brouillard givrant'],
    [51, '🌦️', 'Bruine faible'],
    [53, '🌦️', 'Bruine'],
    [55, '🌦️', 'Bruine forte'],
    [61, '🌧️', 'Pluie faible'],
    [63, '🌧️', 'Pluie'],
    [65, '🌧️', 'Forte pluie'],
    [71, '🌨️', 'Neige faible'],
    [73, '🌨️', 'Neige'],
    [75, '❄️', 'Forte neige'],
    [80, '🌦️', 'Averses'],
    [81, '🌧️', 'Averses'],
    [82, '⛈️', 'Fortes averses'],
    [95, '⛈️', 'Orage'],
    [96, '⛈️', 'Orage avec grêle'],
    [99, '⛈️', 'Violent orage'],
  ];

  function wmo(code) {
    let best = WMO[0];
    WMO.forEach(e => { if (code >= e[0]) best = e; });
    return { icon: best[1], label: best[2] };
  }

  /** Flèche du vent : elle pointe dans le sens où le vent SOUFFLE. */
  function arrow(dirFrom) {
    const to = (dirFrom + 180) % 360;
    const dirs = ['⬆️', '↗️', '➡️', '↘️', '⬇️', '↙️', '⬅️', '↖️'];
    return dirs[Math.round(to / 45) % 8];
  }

  /** Qualificatif du vent relatif au cap. */
  function kind(tail, speed) {
    if (speed < 5) return { txt: 'air calme', cls: 'neutral' };
    const r = tail / Math.max(1, speed);
    if (r > 0.5)  return { txt: 'vent arrière', cls: 'tail' };
    if (r > 0.15) return { txt: 'vent 3/4 arrière', cls: 'tail' };
    if (r < -0.5) return { txt: 'vent de face', cls: 'head' };
    if (r < -0.15) return { txt: 'vent 3/4 avant', cls: 'head' };
    return { txt: 'vent de travers', cls: 'neutral' };
  }

  function pct(ratio) {
    const n = Math.round(Math.abs(ratio) * 100);
    if (n === 0) return '0 %';                 // évite « −0 % »
    return (ratio >= 0 ? '+' : '−') + n + ' %';
  }

  /* ---------- Badge du HUD ---------- */

  function refreshBadge(p) {
    const el = $('wind-badge');
    if (!el) return;
    if (!CONFIG.WEATHER.ENABLED) { el.style.display = 'none'; return; }

    const w = Weather.summaryFor(p);

    if (!w.ok) {
      el.className = 'wind-badge pending';
      el.innerHTML = '<span class="wb-arrow">🌐</span>' +
        '<span class="wb-main"><span class="wb-long">Vents en cours de relevé…</span>' +
        '<span class="wb-short">vents…</span></span>';
      el.title = 'Les vents réels sont en cours de récupération (Open-Meteo).';
      return;
    }

    const k = kind(w.tail, w.speed);
    const t = Weather.turbulenceAt(Routes.geo(p), p.altitude, Date.now());
    el.className = 'wind-badge ' + k.cls + (w.stale ? ' stale' : '') +
      (t.level >= 2 ? ' shaky' : '');
    el.innerHTML =
      `<span class="wb-arrow" style="--rot:${((w.dirFrom + 180) % 360).toFixed(0)}deg">➤</span>` +
      `<span class="wb-main"><b>${fmt(w.speed)}</b> km/h` +
      `<span class="wb-long"> · ${k.txt}</span></span>` +
      (t.level > 0 ? `<span class="wb-turb" aria-label="turbulences ${t.label}">〰️</span>` : '') +
      `<span class="wb-effect">${pct(w.ratio)}</span>`;
    el.title =
      `${k.txt} : ${fmt(w.speed)} km/h venant du ${fmt(w.dirFrom)}°, ` +
      `composante ${w.tail >= 0 ? 'arrière' : 'de face'} de ${fmt(Math.abs(w.tail))} km/h.\n` +
      `Vitesse air ${fmt(w.airspeed)} km/h → vitesse sol ${fmt(w.ground)} km/h (${pct(w.ratio)}).\n` +
      (t.level > 0
        ? `Turbulences ${t.label} (${t.cause}, cisaillement ${t.shear} km/h/1000 ft) — ` +
          'elles secouent l\'avion mais n\'ont AUCUN effet sur la vitesse.'
        : 'Air calme : aucune turbulence.') +
      (w.stale ? '\n⚠️ Prévisions en cache (hors ligne).' : '') +
      '\nCliquer pour ouvrir la météo.';
  }

  /* ---------- Panneau ---------- */

  function refreshPanel() {
    const p = State.current();
    if (!p) return;

    const info = Weather.info();
    const w = Weather.summaryFor(p);
    const geo = Routes.geo(p);
    const cond = Weather.conditionsAt(geo, Date.now());

    /* --- Bloc « maintenant » --- */
    if (!info) {
      const err = Weather.error();
      $('weather-now').innerHTML =
        '<div class="wx-empty">🌐 Aucune donnée météo pour le moment.<br>' +
        'Les vents réels se chargent automatiquement dès que la connexion le permet ' +
        '— en attendant, l\'avion vole en air calme.' +
        (err ? `<br><span class="wx-err">Dernier essai : ${escape(err)}</span>` : '') +
        '</div>';
      $('weather-levels').innerHTML = '';
      $('weather-advice').innerHTML = '';
      $('weather-grid').innerHTML = '';
      $('weather-source').innerHTML = source(null);
      return;
    }

    const k = kind(w.tail, w.speed);
    const c = cond.ok ? wmo(cond.code) : { icon: '🌐', label: '—' };
    const tb = Weather.turbulenceAt(geo, p.altitude, Date.now());
    const tbIcon = ['🟢', '🟡', '🟠', '🔴'][tb.level] || '🟢';
    $('weather-now').innerHTML = `
      <div class="wx-now">
        <div class="wx-card">
          <div class="wx-card-label">Position · ${escape(geo.route.label)}</div>
          <div class="wx-card-value">${c.icon} ${escape('cap ' + (geo.outbound ? geo.to.city : Routes.BASE.city))}</div>
          <div class="wx-card-sub">${fmt(geo.kmToNext)} km restants · ${escape(c.label)}${cond.ok ? ` · ${fmt(cond.cloud)} % de nuages` : ''}</div>
        </div>
        <div class="wx-card">
          <div class="wx-card-label">Vent à ${fmt(p.altitude)} ft</div>
          <div class="wx-card-value">
            <span class="wb-arrow" style="--rot:${((w.dirFrom + 180) % 360).toFixed(0)}deg">➤</span>
            ${fmt(w.speed)} km/h
          </div>
          <div class="wx-card-sub">${escape(k.txt)} · d'où : ${fmt(w.dirFrom)}° · cap ${fmt(w.heading)}°</div>
        </div>
        <div class="wx-card ${w.ratio >= 0 ? 'good' : 'bad'}">
          <div class="wx-card-label">Effet sur la vitesse</div>
          <div class="wx-card-value">${pct(w.ratio)}</div>
          <div class="wx-card-sub">${fmt(w.airspeed)} → <b>${fmt(w.ground)}</b> km/h au sol</div>
        </div>
        <div class="wx-card wx-turb-card turb-${tb.level}">
          <div class="wx-card-label">Turbulences</div>
          <div class="wx-card-value">${tbIcon} ${escape(tb.label)}</div>
          <div class="wx-card-sub">${tb.level > 0
            ? (tb.cause === 'cisaillement'
                // Éviter « cisaillement · cisaillement 28 km/h » : quand c'est
                // lui la cause, la valeur chiffrée dit déjà tout.
                ? `cisaillement vertical ${tb.shear} km/h / 1 000 ft`
                : `${escape(tb.cause)} · cisaillement ${tb.shear} km/h / 1 000 ft`)
            : 'air lisse · aucun effet sur la vitesse'}</div>
        </div>
      </div>`;

    /* --- Vent par altitude, maintenant --- */
    const grid = Weather.forecastGrid(p, CONFIG.WEATHER.HOURS_AHEAD);
    // Les paliers dépendent du plafond de l'avion : le repère « vous êtes ici »
    // se cale donc sur le palier le plus proche, pas sur un écart fixe.
    let nearest = 0;
    grid.rows.forEach((row, i) => {
      if (Math.abs(row.ft - p.altitude) < Math.abs(grid.rows[nearest].ft - p.altitude)) nearest = i;
    });
    const rows = grid.rows.map((row, i) => {
      const c0 = row.cells[0];
      const kk = kind(c0.tail, c0.speed);
      const here = i === nearest;
      return `<tr class="${here ? 'current' : ''}">
        <th>${fmt(row.ft)} ft</th>
        <td class="wx-arrow"><span class="wb-arrow" style="--rot:${((c0.dirFrom + 180) % 360).toFixed(0)}deg">➤</span></td>
        <td>${fmt(c0.speed)} km/h</td>
        <td class="wx-kind ${kk.cls}">${escape(kk.txt)}</td>
        <td class="wx-eff ${c0.ratio >= 0 ? 'good' : 'bad'}">${pct(c0.ratio)}</td>
        <td class="wx-ground">${fmt(row.airspeed * (1 + c0.ratio))} km/h</td>
      </tr>`;
    }).join('');
    $('weather-levels').innerHTML = `
      <table class="wx-table">
        <thead><tr><th>Altitude</th><th></th><th>Vent</th><th>Type</th><th>Effet</th><th>Vitesse sol</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p class="wx-hint">L'avion monte tant qu'il a du kérosène : plus haut, il vole plus vite —
      mais le vent d'altitude peut lui rendre la tâche facile… ou pénible.</p>`;

    /* --- Conseil : meilleur créneau --- */
    const best = Weather.bestWindow(p, CONFIG.WEATHER.HOURS_AHEAD);
    $('weather-advice').innerHTML = best
      ? `<div class="wx-advice ${best.ratio >= 0 ? 'good' : 'bad'}">
           🎯 Meilleur créneau des ${CONFIG.WEATHER.HOURS_AHEAD} prochaines heures :
           <b>${escape(hourLabel(grid.t0, best.hour))}</b> à <b>${fmt(best.ft)} ft</b>
           → <b>${fmt(best.ground)} km/h</b> au sol (${pct(best.ratio)} de vent).
         </div>`
      : '';

    /* --- Carte de chaleur altitude × heure --- */
    $('weather-grid').innerHTML = heatmap(grid);
    $('weather-source').innerHTML = source(info);
  }

  function hourLabel(t0, h) {
    const d = new Date(t0 + h * 3600000);
    const days = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const dd = new Date(d); dd.setHours(0, 0, 0, 0);
    const diff = Math.round((dd - today) / 86400000);
    const day = diff === 0 ? "aujourd'hui" : diff === 1 ? 'demain' : days[d.getDay()];
    return `${day} ${String(d.getHours()).padStart(2, '0')} h`;
  }

  /** Couleur d'une case : rouge (vent de face) → vert (vent arrière). */
  function cellColor(ratio) {
    const max = CONFIG.WEATHER.MAX_RATIO;
    const t = Math.max(-1, Math.min(1, ratio / max));
    if (t >= 0) return `rgba(39, 174, 96, ${(0.12 + 0.78 * t).toFixed(2)})`;
    return `rgba(231, 76, 60, ${(0.12 + 0.78 * -t).toFixed(2)})`;
  }

  function heatmap(grid) {
    if (!grid.ok) return '';
    const H = grid.hours;
    // En-tête : une étiquette toutes les 6 h
    let head = '<div class="wx-hm-row wx-hm-head"><div class="wx-hm-label"></div>';
    for (let h = 0; h < H; h++) {
      const d = new Date(grid.t0 + h * 3600000);
      head += `<div class="wx-hm-cell wx-hm-hour">${
        d.getHours() % 6 === 0 ? String(d.getHours()).padStart(2, '0') + 'h' : ''}</div>`;
    }
    head += '</div>';

    const body = grid.rows.slice().reverse().map(row => {
      let cells = '';
      row.cells.forEach((c, h) => {
        const style = c.ok ? `background:${cellColor(c.ratio)}` : 'background:rgba(140,150,160,.12)';
        const tip = c.ok
          ? `${hourLabel(grid.t0, h)} · ${fmt(row.ft)} ft · ${fmt(c.speed)} km/h · ${pct(c.ratio)}`
          : `${hourLabel(grid.t0, h)} · pas de donnée`;
        cells += `<div class="wx-hm-cell" style="${style}" title="${escape(tip)}"></div>`;
      });
      return `<div class="wx-hm-row"><div class="wx-hm-label">${fmt(row.ft / 1000)}k</div>${cells}</div>`;
    }).join('');

    // Repères de journée : un libellé par jour civil, large comme sa plage d'heures
    const days = [];
    for (let h = 0; h < H; h++) {
      const key = new Date(grid.t0 + h * 3600000).toDateString();
      const last = days[days.length - 1];
      if (last && last.key === key) last.n++;
      else days.push({ key, n: 1, label: hourLabel(grid.t0, h).split(' ')[0] });
    }
    let sep = '<div class="wx-hm-days">';
    days.forEach(d => { sep += `<span style="flex:${d.n}">${escape(d.label)}</span>`; });
    sep += '</div>';

    return `<div class="wx-hm-wrap"><div class="wx-hm">${head}${body}</div></div>
      ${sep}
      <div class="wx-legend">
        <span class="wx-sw" style="background:${cellColor(-CONFIG.WEATHER.MAX_RATIO)}"></span> vent de face
        <span class="wx-sw" style="background:${cellColor(0)}"></span> neutre
        <span class="wx-sw" style="background:${cellColor(CONFIG.WEATHER.MAX_RATIO)}"></span> vent arrière
      </div>`;
  }

  function source(info) {
    const base = 'Données : <b>Open-Meteo</b> (vents par niveau de pression, 1000 → 200 hPa).';
    if (!info) return `<p class="wx-source">${base}</p>`;
    const age = Math.round((Date.now() - info.fetchedAt) / 60000);
    const when = age < 60 ? `il y a ${age} min` : `il y a ${Math.round(age / 60)} h`;
    return `<p class="wx-source">${base} Relevé ${when}` +
      (info.stale ? ' — <b>cache hors ligne</b>' : '') +
      `, ${info.points} points le long de la route ${escape(info.routeLabel || '')}.` +
      (info.wrongRoute ? '<br><span class="wx-err">Route changée : nouveau relevé en cours…</span>' : '') +
      (info.error ? `<br><span class="wx-err">Dernier essai de mise à jour : ${escape(info.error)}</span>` : '') +
      '</p>';
  }

  function escape(s) {
    return String(s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ---------- Effets visuels dans la scène ---------- */

  function refreshScene(p) {
    if (typeof Scene.setWeather !== 'function') return;
    const geo = Routes.geo(p);
    const w = Weather.summaryFor(p);
    const c = Weather.conditionsAt(geo, Date.now());
    const t = Weather.turbulenceAt(geo, p.altitude, Date.now());
    Scene.setWeather({
      ok: w.ok,
      ratio: w.ratio,
      windSpeed: w.speed,
      cross: w.cross,
      turb: t.level,
      cloud: c.ok ? c.cloud : null,
      precip: c.ok ? c.precip : 0,
      code: c.ok ? c.code : 0,
    });
  }

  /* ---------- Liaison ---------- */

  function bind() {
    const btn = $('wind-badge');
    if (btn) btn.addEventListener('click', open);
    Weather.onUpdate(() => {
      const p = State.current();
      if (!p) return;
      refreshBadge(p);
      refreshScene(p);
      if (document.getElementById('modal-weather').classList.contains('open')) refreshPanel();
    });
  }

  function open() {
    refreshPanel();
    document.getElementById('modal-weather').classList.add('open');
    Weather.refresh(false);
  }

  return { refreshBadge, refreshPanel, refreshScene, bind, open, wmo, arrow };
})();
