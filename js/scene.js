/* ============================================================
   SkyFit — Scène 2D : ciel, nuages, avion (SVG cartoon)
   ============================================================ */

const Scene = (() => {

  // --- Dégradés de ciel par décor ---
  const DECOR_STYLES = {
    day:    { top: '#4aa3e8', bottom: '#bfe3ff', cloud: '#ffffff', stars: false },
    sunset: { top: '#6a4c93', bottom: '#ffb677', cloud: '#ffd9c0', stars: false },
    night:  { top: '#0b1d3a', bottom: '#27406b', cloud: '#9fb4d8', stars: true  },
    aurora: { top: '#03121f', bottom: '#0e4d4a', cloud: '#a8d8cf', stars: true  },
  };

  // Les avions sont des images détourées (assets/planes/<id>.png),
  // générées par scripts/process_assets.py à partir des sources.

  let cloudLayer, plane, skyEl, starsEl;
  let cloudSeed = 0;

  function init() {
    skyEl = document.getElementById('sky');
    cloudLayer = document.getElementById('clouds');
    plane = document.getElementById('plane');
    starsEl = document.getElementById('stars');
    spawnInitialClouds();
  }

  function makeCloud(startInside) {
    const c = document.createElement('div');
    c.className = 'cloud';
    const scale = 0.5 + Math.random() * 1.1;
    const top = 5 + Math.random() * 80;
    const dur = 18 + Math.random() * 30; // sera modulé par la vitesse via CSS var
    c.style.top = top + '%';
    c.style.setProperty('--scale', scale.toFixed(2));
    c.style.setProperty('--dur', dur.toFixed(1) + 's');
    if (startInside) c.style.setProperty('--delay', (-Math.random() * dur).toFixed(1) + 's');
    c.innerHTML = `
      <svg viewBox="0 0 120 60" width="${Math.round(90 * scale)}">
        <g fill="var(--cloud-color)" opacity="0.9">
          <ellipse cx="40" cy="40" rx="30" ry="16"/>
          <ellipse cx="70" cy="34" rx="26" ry="18"/>
          <ellipse cx="95" cy="42" rx="20" ry="12"/>
        </g>
      </svg>`;
    c.addEventListener('animationiteration', () => {
      // varie la hauteur à chaque passage
      c.style.top = (5 + Math.random() * 80) + '%';
    });
    return c;
  }

  function spawnInitialClouds() {
    cloudLayer.innerHTML = '';
    for (let i = 0; i < 9; i++) {
      cloudLayer.appendChild(makeCloud(true));
    }
  }

  function setDecor(decorId) {
    const st = DECOR_STYLES[decorId] || DECOR_STYLES.day;
    skyEl.style.setProperty('--sky-top', st.top);
    skyEl.style.setProperty('--sky-bottom', st.bottom);
    skyEl.style.setProperty('--cloud-color', st.cloud);
    skyEl.classList.toggle('decor-aurora', decorId === 'aurora');
    starsEl.style.display = st.stars ? 'block' : 'none';
    if (st.stars && !starsEl.hasChildNodes()) {
      for (let i = 0; i < 60; i++) {
        const s = document.createElement('div');
        s.className = 'star';
        s.style.left = Math.random() * 100 + '%';
        s.style.top = Math.random() * 100 + '%';
        s.style.animationDelay = (Math.random() * 4) + 's';
        starsEl.appendChild(s);
      }
    }
  }

  function setPlane(planeId) {
    const def = CONFIG.PLANES.find(p => p.id === planeId) || CONFIG.PLANES[0];
    let html =
      `<img class="plane-img" src="assets/planes/${def.id}.png" alt="${def.name}"
            onerror="this.onerror=null;this.src='assets/planes/cessna.png'">`;
    // Hélice animée (spritesheet 3 frames superposée au sprite)
    if (def.prop) {
      html += `<div class="prop-overlay" style="
        left:${def.prop.left}%; top:${def.prop.top}%;
        width:${def.prop.width}%; height:${def.prop.height}%;
        background-image:url('assets/planes/${def.id}_prop.png')"></div>`;
    }
    plane.innerHTML = html;
    // Taille à l'écran proportionnelle à l'avion (bornée en pixels)
    const vw = def.width || 18;
    plane.style.width = `clamp(${vw * 9}px, ${vw}vw, ${vw * 15}px)`;
  }

  /**
   * Met à jour la position verticale de l'avion et la vitesse des nuages.
   * @param altFt altitude actuelle
   * @param speedKmh vitesse actuelle
   */
  function update(altFt, speedKmh) {
    // Position verticale : ALT_MIN => bas de l'écran, ALT_MAX => haut
    const t = (altFt - CONFIG.ALT_MIN) / (CONFIG.ALT_MAX - CONFIG.ALT_MIN);
    const topPct = 72 - t * 55; // de 72 % (bas) à 17 % (haut)
    plane.style.top = topPct + '%';

    // Vitesse des nuages : plus on va vite, plus le défilement est rapide
    const speedFactor = Math.max(0.35, speedKmh / 500);
    skyEl.style.setProperty('--speed-factor', speedFactor.toFixed(2));
  }

  /**
   * État visuel de l'avion :
   * - crashed : au sol, grisé et penché
   * - damaged : a déjà crashé au moins une fois → reste grisé en vol
   */
  function setCondition(isCrashed, isDamaged) {
    plane.classList.toggle('crashed', isCrashed);
    plane.classList.toggle('damaged', !isCrashed && isDamaged);
  }

  /* ------------------------------------------------------------
     Météo réelle : couverture nuageuse, pluie, turbulences
     ------------------------------------------------------------ */

  let rainLayer = null;
  let lastRainOn = null;

  function ensureRain() {
    if (rainLayer) return rainLayer;
    rainLayer = document.createElement('div');
    rainLayer.id = 'rain';
    for (let i = 0; i < 70; i++) {
      const d = document.createElement('i');
      d.style.left = (Math.random() * 110 - 5) + '%';
      d.style.setProperty('--delay', (-Math.random() * 1.2).toFixed(2) + 's');
      d.style.setProperty('--dur', (0.5 + Math.random() * 0.5).toFixed(2) + 's');
      d.style.setProperty('--len', (10 + Math.random() * 18).toFixed(0) + 'px');
      rainLayer.appendChild(d);
    }
    skyEl.appendChild(rainLayer);
    return rainLayer;
  }

  /**
   * Applique la météo réelle à la scène.
   * @param w { ok, ratio, windSpeed, cross, cloud (0-100 ou null), precip (mm), code }
   */
  function setWeather(w) {
    if (!skyEl) return;
    if (!w || !w.ok) {
      skyEl.classList.remove('wx-overcast', 'wx-windy', 'wx-turb');
      skyEl.style.removeProperty('--wind-factor');
      skyEl.style.removeProperty('--cloud-opacity');
      if (rainLayer) rainLayer.classList.remove('on');
      lastRainOn = false;
      return;
    }

    // 1) Défilement des nuages : accéléré par le vent arrière, freiné de face
    skyEl.style.setProperty('--wind-factor', (1 + w.ratio).toFixed(2));

    // 2) Couverture nuageuse réelle : densité et opacité des nuages
    if (typeof w.cloud === 'number') {
      const c = Math.max(0, Math.min(100, w.cloud)) / 100;
      skyEl.style.setProperty('--cloud-opacity', (0.35 + 0.65 * c).toFixed(2));
      skyEl.classList.toggle('wx-overcast', c > 0.7);
    }

    // 3) Pluie
    const rainOn = (w.precip || 0) > 0.05;
    if (rainOn !== lastRainOn) {
      ensureRain().classList.toggle('on', rainOn);
      lastRainOn = rainOn;
    }

    // 4) Turbulences : vent fort ou orage → léger tremblement de l'avion
    const turb = w.windSpeed > 110 || Math.abs(w.cross || 0) > 70 || (w.code >= 95);
    skyEl.classList.toggle('wx-turb', !!turb);
    skyEl.classList.toggle('wx-windy', w.windSpeed > 70);
    if (plane) plane.classList.toggle('turbulence', !!turb);
  }

  return { init, setDecor, setPlane, setCondition, update, setWeather };
})();
