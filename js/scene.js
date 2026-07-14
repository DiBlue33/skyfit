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
    plane.innerHTML =
      `<img class="plane-img" src="assets/planes/${def.id}.png" alt="${def.name}"
            onerror="this.onerror=null;this.src='assets/planes/cessna.png'">`;
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

  return { init, setDecor, setPlane, setCondition, update };
})();
