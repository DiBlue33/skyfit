/* ============================================================
   SkyFit — Scène 2D : ciel, nuages, avion (SVG cartoon)
   ============================================================ */

const Scene = (() => {

  // Depuis la v3.1 le ciel ne vient plus d'un décor acheté mais de la
  // situation réelle de vol : c'est Sky.state() qui produit les couleurs,
  // et applySky() ci-dessous se contente de les poser sur le DOM.

  // Les avions sont des images détourées (assets/planes/<id>.png),
  // générées par scripts/process_assets.py à partir des sources.

  let cloudLayer, plane, skyEl, starsEl;
  let sunEl = null, horizonEl = null;
  let cloudSeed = 0;

  function init() {
    skyEl = document.getElementById('sky');
    cloudLayer = document.getElementById('clouds');
    plane = document.getElementById('plane');
    starsEl = document.getElementById('stars');
    spawnInitialClouds();
  }

  /* ------------------------------------------------------------------
     Nuages « vapeur » (v3.4 — direction A de la maquette comparative).

     Jusqu'à la v3.3 un nuage était TROIS ellipses fixes de la même couleur :
     le même motif répété neuf fois, un contour net d'autocollant, aucun
     volume. Ici la silhouette est tirée au sort (4 à 7 lobes le long d'une
     crête en cloche), puis DÉFORMÉE par un bruit fractal : les bords
     s'effilochent et se fondent dans le ciel.

     ⚠️ Le `baseFrequency` est ANISOTROPE (x ≪ y). C'est tout le truc : avec
     un bruit isotrope les filaments partent dans tous les sens et le nuage
     a l'air rongé ; en étirant le bruit à l'horizontale ils s'alignent sur
     le vent et on lit de la vapeur.
     ------------------------------------------------------------------ */

  /* Deux filtres de turbulence par nuage × neuf nuages : c'est le seul poste
     de la scène qui peut faire tousser un téléphone. Sur petit écran on
     retire l'écharpe diffuse et on descend d'un octave. */
  function lightMode() {
    return !!(window.matchMedia && window.matchMedia('(max-width: 640px)').matches);
  }

  function cloudShape() {
    const n = 4 + Math.floor(Math.random() * 4);
    const peak = 0.3 + Math.random() * 0.45;      // où se trouve le sommet
    const lobes = [];
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0.5 : i / (n - 1);
      // hauteur en cloche autour du sommet → crête bombée, jamais plate
      const bell = Math.exp(-Math.pow((t - peak) / 0.42, 2));
      lobes.push({
        cx: 26 + t * 148 + (Math.random() - 0.5) * 13,
        cy: 68 - bell * 26 + (Math.random() - 0.5) * 8,
        rx: 16 + bell * 24 + Math.random() * 9,
        ry: 11 + bell * 17 + Math.random() * 6,
      });
    }
    // Base aplatie qui relie les lobes : sans elle on voit les creux entre eux.
    return [{ cx: 100, cy: 70, rx: 82, ry: 15 }].concat(lobes);
  }

  function ellipsesOf(sh) {
    return sh.map(l =>
      `<ellipse cx="${l.cx.toFixed(1)}" cy="${l.cy.toFixed(1)}" ` +
      `rx="${l.rx.toFixed(1)}" ry="${l.ry.toFixed(1)}"/>`).join('');
  }

  function cloudSvg(width) {
    const id = ++cloudSeed;
    const seed = Math.floor(Math.random() * 9999);
    const light = lightMode();
    const body = ellipsesOf(cloudShape());

    // L'écharpe : la même silhouette, beaucoup plus déformée et floue,
    // posée DERRIÈRE le corps. C'est le décalage entre les deux passes qui
    // donne l'impression de matière plutôt que de découpe.
    const veilFilter = light ? '' : `
        <filter id="sfv${id}" x="-70%" y="-110%" width="240%" height="340%">
          <feTurbulence type="fractalNoise" baseFrequency="0.01 0.03"
                        numOctaves="4" seed="${seed + 7}" result="n2"/>
          <feDisplacementMap in="SourceGraphic" in2="n2" scale="58"
                             xChannelSelector="R" yChannelSelector="G"/>
          <feGaussianBlur stdDeviation="5"/>
        </filter>`;
    const veil = light ? '' : `
      <g filter="url(#sfv${id})" opacity="0.28">
        <g fill="var(--cloud-body)">${body}</g>
      </g>`;

    return `
      <svg viewBox="0 0 200 100" width="${width}" height="${Math.round(width * 0.5)}"
           style="overflow:visible" aria-hidden="true">
        <defs>
          <filter id="sfb${id}" x="-55%" y="-85%" width="210%" height="300%">
            <feTurbulence type="fractalNoise" baseFrequency="0.016 0.045"
                          numOctaves="${light ? 3 : 4}" seed="${seed}" result="n"/>
            <feDisplacementMap in="SourceGraphic" in2="n" scale="36"
                               xChannelSelector="R" yChannelSelector="G"/>
            <feGaussianBlur stdDeviation="2.6"/>
          </filter>${veilFilter}
          <linearGradient id="sfg${id}" x1="0.12" y1="1" x2="0.88" y2="0.05">
            <stop offset="0%"   stop-color="var(--cloud-shade)"/>
            <stop offset="48%"  stop-color="var(--cloud-body)"/>
            <stop offset="100%" stop-color="var(--cloud-rim)"/>
          </linearGradient>
        </defs>${veil}
      <g filter="url(#sfb${id})" opacity="0.95">
        <g fill="url(#sfg${id})">${body}</g>
      </g></svg>`;
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
    c.innerHTML = cloudSvg(Math.round(120 * scale));
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

  /* Les étoiles sont créées une seule fois puis pilotées en opacité :
     les recréer à chaque rafraîchissement ferait scintiller tout le champ
     d'un coup, et coûterait 60 nœuds DOM plusieurs fois par seconde. */
  function ensureStars() {
    if (!starsEl || starsEl.hasChildNodes()) return;
    for (let i = 0; i < 60; i++) {
      const s = document.createElement('div');
      s.className = 'star';
      s.style.left = Math.random() * 100 + '%';
      s.style.top = Math.random() * 100 + '%';
      s.style.animationDelay = (Math.random() * 4) + 's';
      starsEl.appendChild(s);
    }
  }

  /* Astre solaire / lunaire — refondu en v3.4 pour passer du soleil « en
     étoile » (secteurs nets en conic-gradient, très dessin animé) à un astre
     réaliste, assorti aux nuages vapeur.

     Ce qui fait le réalisme, dans l'ordre d'importance :
       1. plus aucun rayon à bord net — la lumière diffusée par l'atmosphère
          n'a pas de contour ;
       2. un bloom à décroissance en plusieurs paliers, qui blanchit le ciel
          autour de l'astre au lieu de s'arrêter sur un bord visible ;
       3. un disque petit et surexposé : un vrai soleil est brûlé au centre,
          c'est le halo qui donne l'intensité, pas la taille du disque ;
       4. l'aplatissement vertical près de l'horizon (réfraction).

     Les trois couches gardent leurs noms de la v3.3 (.sun-rays / .sun-halo /
     .sun-core) : seul leur contenu change, les tests restent lisibles.
     ⚠️ Invariant de composition inchangé : #sun n'anime QUE sa position. */
  function ensureSun() {
    if (sunEl || !skyEl) return sunEl;
    sunEl = document.createElement('div');
    sunEl.id = 'sun';
    sunEl.innerHTML =
      '<div class="sun-rays">' + coronaSvg() + '</div>' +
      '<div class="sun-halo"></div><div class="sun-core"></div>';
    skyEl.appendChild(sunEl);
    return sunEl;
  }

  /* La couronne : un anneau de lueur déformé par le MÊME bruit fractal que
     les nuages, pour que l'astre appartienne visuellement au même monde.
     Le dégradé part d'une opacité nulle au centre — c'est un anneau, pas un
     disque : le cœur est dessiné par .sun-core par-dessus. */
  function coronaSvg() {
    return `
      <svg viewBox="0 0 200 200" style="overflow:visible" aria-hidden="true">
        <defs>
          <filter id="sf-corona" x="-45%" y="-45%" width="190%" height="190%">
            <feTurbulence type="fractalNoise" baseFrequency="0.011"
                          numOctaves="3" seed="17" result="cn"/>
            <feDisplacementMap in="SourceGraphic" in2="cn" scale="38"
                               xChannelSelector="R" yChannelSelector="G"/>
            <feGaussianBlur stdDeviation="5"/>
          </filter>
          <radialGradient id="sf-corona-g">
            <stop offset="0%"   stop-color="var(--sun-core)" stop-opacity="0"/>
            <stop offset="30%"  stop-color="var(--sun-core)" stop-opacity="0.42"/>
            <stop offset="55%"  stop-color="var(--sun-warm)" stop-opacity="0.26"/>
            <stop offset="100%" stop-color="var(--sun-warm)" stop-opacity="0"/>
          </radialGradient>
        </defs>
        <circle cx="100" cy="100" r="84" fill="url(#sf-corona-g)"
                filter="url(#sf-corona)"/>
      </svg>`;
  }

  /* Chaleur de l'astre. Plutôt que des paliers, on interpole en continu sur
     la hauteur du soleil : orangé rasant au ras de l'horizon, jaune franc au
     zénith. La lune, elle, a sa propre teinte froide. */
  const SUN_WARM_LOW = [255, 138, 61];    // #ff8a3d — soleil rasant
  const SUN_WARM_HIGH = [255, 217, 121];  // #ffd979 — plein jour
  const SUN_CORE_LOW = [255, 242, 207];   // #fff2cf
  const SUN_CORE_HIGH = [255, 251, 232];  // #fffbe8

  function mixArr(a, b, t) {
    const k = Math.max(0, Math.min(1, t));
    return [0, 1, 2].map(i => Math.round(a[i] + (b[i] - a[i]) * k));
  }

  function rgbStr(c) {
    return `rgb(${c[0]},${c[1]},${c[2]})`;
  }

  function mixRgb(a, b, t) {
    return rgbStr(mixArr(a, b, t));
  }

  function applySunLook(sun, s) {
    const isMoon = !s.sunVisible && s.moonVisible;
    if (isMoon) {
      // Lune : froide, petite, presque sans rayons — juste un halo diffus.
      sun.style.setProperty('--sun-core', '#ffffff');
      sun.style.setProperty('--sun-warm', '#cdd9f0');
      sun.style.setProperty('--ray-op', '0.12');
      sun.style.setProperty('--sun-scale', '0.62');
      sun.style.setProperty('--sun-squash', '1');  // pas de réfraction visible
      // Lumière lunaire : l'ourlet des nuages tire vers le bleu très pâle.
      if (skyEl) skyEl.style.setProperty('--light-tint', '#e6ecf8');
      return;
    }
    // t = 0 quand le soleil rase l'horizon, 1 au-dessus de ~20°.
    const elev = isFinite(s.solarElev) ? s.solarElev : 30;
    const t = Math.max(0, Math.min(1, elev / 20));
    const core = mixArr(SUN_CORE_LOW, SUN_CORE_HIGH, t);
    const warm = mixArr(SUN_WARM_LOW, SUN_WARM_HIGH, t);
    sun.style.setProperty('--sun-core', rgbStr(core));
    sun.style.setProperty('--sun-warm', rgbStr(warm));
    /* Couleur de la LUMIÈRE qui frappe les nuages (v3.4.1). Sans elle,
       --cloud-rim valait exactement --cloud-color : l'ourlet était seulement
       ÉGAL au corps, jamais plus chaud, et les nuages du coucher paraissaient
       délavés. On publie ici un ton à 45 % de chaleur du disque et 55 % de son
       cœur : ≈ #fff0cc en plein jour, ≈ #ffc38e au ras de l'horizon. */
    if (skyEl) {
      skyEl.style.setProperty('--light-tint', rgbStr(mixArr(warm, core, 0.55)));
    }
    // Les rayons s'estompent au ras de l'horizon (lumière rasante diffusée)
    // et le disque y paraît plus gros, comme dans la réalité.
    sun.style.setProperty('--ray-op', (0.55 + 0.45 * t).toFixed(2));
    sun.style.setProperty('--sun-scale', (1.18 - 0.18 * t).toFixed(2));
    // Réfraction atmosphérique (v3.4) : au ras de l'horizon la lumière est
    // courbée et le disque devient mesurablement ovale. C'est un détail que
    // personne ne saurait nommer mais que tout le monde reconnaît.
    sun.style.setProperty('--sun-squash', (0.82 + 0.18 * t).toFixed(2));
  }

  /* Bande d'horizon teintée par le biome survolé (océan, désert…). */
  function ensureHorizon() {
    if (horizonEl || !skyEl) return horizonEl;
    horizonEl = document.createElement('div');
    horizonEl.id = 'horizon';
    // Inséré en premier pour rester DERRIÈRE les nuages et l'avion.
    skyEl.insertBefore(horizonEl, skyEl.firstChild);
    return horizonEl;
  }

  /**
   * Applique un état de ciel calculé par Sky.state().
   * Tolérant : un état absent ou incomplet laisse la scène inchangée
   * plutôt que de la casser (ce code tourne à chaque tick).
   */
  function applySky(s) {
    if (!skyEl || !s) return;

    skyEl.style.setProperty('--sky-top', s.top);
    skyEl.style.setProperty('--sky-bottom', s.bottom);
    skyEl.style.setProperty('--cloud-color', s.cloudColor);

    // Étoiles : opacité continue, donc elles se lèvent progressivement au
    // crépuscule et réapparaissent en haute altitude même de jour.
    const st = Math.max(0, Math.min(1, s.stars || 0));
    if (starsEl) {
      if (st > 0.02) {
        ensureStars();
        starsEl.style.display = 'block';
        starsEl.style.opacity = st.toFixed(3);
      } else {
        starsEl.style.display = 'none';
      }
    }

    // Aurore : plus un décor acheté, mais une intensité liée à la latitude
    // et à la nuit. En dessous de 5 % on l'éteint pour ne pas payer un
    // filtre CSS permanent qui ne se voit pas.
    const au = Math.max(0, Math.min(1, s.aurora || 0));
    skyEl.classList.toggle('sky-aurora', au > 0.05);
    skyEl.style.setProperty('--aurora-opacity', au.toFixed(3));

    // Soleil / lune
    const sun = ensureSun();
    if (sun) {
      const visible = s.sunVisible || s.moonVisible;
      sun.style.display = visible ? 'block' : 'none';
      if (visible) {
        sun.style.top = (s.sunY || 20).toFixed(1) + '%';
        sun.classList.toggle('moon', !s.sunVisible && s.moonVisible);
        applySunLook(sun, s);
      }
    }

    // Horizon coloré par le biome
    const hz = ensureHorizon();
    if (hz) hz.style.setProperty('--horizon-color', s.horizon || '#1f5f8b');

    skyEl.classList.toggle('sky-night', !!s.isNight);
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
  function update(altFt, speedKmh, ceilingFt) {
    // Position verticale : ALT_MIN => bas de l'écran, plafond de l'avion => haut
    const ceiling = ceilingFt || CONFIG.ALT_REF;
    const t = Math.max(0, Math.min(1, (altFt - CONFIG.ALT_MIN) / (ceiling - CONFIG.ALT_MIN)));
    const topPct = 72 - t * 55; // de 72 % (bas) à 17 % (haut)
    plane.style.top = topPct + '%';

    // Vitesse des nuages : plus on va vite, plus le défilement est rapide
    // Défilement des nuages calé sur la croisière de référence du parc, pour
    // qu'un Cessna à 226 km/h reste visiblement plus lent qu'un A380.
    const speedFactor = Math.max(0.30, Math.min(3.5, speedKmh / 500));
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
    // Un avion posé ne subit plus les turbulences : sans ça, l'épave
    // continuait de tanguer au sol.
    if (isCrashed) plane.classList.remove('turb-1', 'turb-2', 'turb-3');
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

  /* Retire les 3 classes de turbulence d'un élément. */
  function clearTurb(el) {
    if (!el) return;
    el.classList.remove('turb-1', 'turb-2', 'turb-3');
  }

  /**
   * Niveau de turbulence appliqué à l'avion : 0 (lisse) à 3 (fortes).
   * Une seule classe à la fois ; un avion posé (crashé) ne bouge plus.
   */
  function setTurbulence(level) {
    const n = Math.max(0, Math.min(3, Math.round(Number(level) || 0)));
    if (skyEl) skyEl.classList.toggle('wx-turb', n >= 2);
    if (!plane) return n;
    const wanted = n > 0 && !plane.classList.contains('crashed') ? 'turb-' + n : null;
    if (wanted && plane.classList.contains(wanted)) return n;  // rien à faire
    clearTurb(plane);
    if (wanted) plane.classList.add(wanted);
    return n;
  }

  /**
   * Applique la météo réelle à la scène.
   * @param w { ok, ratio, windSpeed, cross, turb (0-3),
   *           cloud (0-100 ou null), precip (mm), code }
   */
  function setWeather(w) {
    if (!skyEl) return;
    if (!w || !w.ok) {
      skyEl.classList.remove('wx-overcast', 'wx-windy', 'wx-turb');
      clearTurb(plane);
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

    // 4) Turbulences — le niveau est calculé par Weather.turbulenceAt()
    //    (cisaillement vertical / convection / rafales basses), PAS par la
    //    force du vent : un jet-stream homogène est parfaitement lisse.
    setTurbulence(w.turb || 0);

    // 5) Ciel « venteux » : purement décoratif, là oui la force suffit
    skyEl.classList.toggle('wx-windy', w.windSpeed > 70);
  }

  return { init, applySky, setPlane, setCondition, update, setWeather,
           setTurbulence };
})();
