/* ============================================================
   SkyFit — Roue de la chance 🎡 (v2.7)
   ------------------------------------------------------------
   Un tour par jour calendaire (remise à zéro à minuit, comme la
   créatine et les séries 🔥). Chaque tour rapporte du kérosène,
   des points, ou les deux (case JACKPOT 💎).

   Règles de conception :
   - La roue ne remplace JAMAIS le sport : son espérance (≈ 214 L
     et ≈ 206 pts par jour) vaut environ deux tiers d'un running
     de 30 min. C'est un rituel de présence, pas une source
     principale de progression.
   - Le gain est appliqué à l'état AU MOMENT DU TIRAGE, puis
     sauvegardé et synchronisé. L'animation ne fait que le
     révéler : fermer la fenêtre en pleine rotation ne peut ni
     perdre ni dupliquer un lot.
   - Les points vont dans `bonusPoints` : `player.points` est
     recalculé à chaque tick depuis `lifetimeKm` et écraserait
     tout crédit direct.
   - Le kérosène est plafonné par la capacité du réservoir ; le
     journal enregistre la quantité RÉELLEMENT ajoutée.
   - Un tour de roue n'entretient pas la série 🔥 et ne fait pas
     redécoller un avion crashé : seul le sport le fait.
   ============================================================ */

const Wheel = (() => {

  const $ = (id) => document.getElementById(id);

  const prizes = () => (CONFIG.WHEEL && CONFIG.WHEEL.PRIZES) || [];
  const SPIN_MS = () => (CONFIG.WHEEL && CONFIG.WHEEL.SPIN_MS) || 5200;
  const TURNS = () => (CONFIG.WHEEL && CONFIG.WHEEL.TURNS) || 6;

  let spinning = false;   // verrou d'animation

  /* ---------- Disponibilité (un tour par jour calendaire) ---------- */

  function startOfDay(ts) {
    const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime();
  }

  /** Le pilote peut-il lancer la roue maintenant ? */
  function available(p, now) {
    if (!p) return false;
    const ref = (typeof now === 'number' && isFinite(now)) ? now : Date.now();
    const last = Number(p.wheelLast) || 0;
    if (!last) return true;
    return startOfDay(last) < startOfDay(ref);
  }

  /** Millisecondes restantes avant le prochain tour (0 si disponible). */
  function nextSpinIn(p, now) {
    const ref = (typeof now === 'number' && isFinite(now)) ? now : Date.now();
    if (available(p, ref)) return 0;
    const midnight = new Date(ref);
    midnight.setHours(24, 0, 0, 0);
    return Math.max(0, midnight.getTime() - ref);
  }

  /** « 3 h 12 » — compte à rebours court pour le bouton du HUD. */
  function countdownLabel(ms) {
    const total = Math.ceil(ms / 60000);           // minutes
    const h = Math.floor(total / 60), m = total % 60;
    if (h > 0) return `${h} h ${String(m).padStart(2, '0')}`;
    return `${m} min`;
  }

  /* ---------- Tirage pondéré ---------- */

  /**
   * Tire un lot. Les poids somment à 100 : chaque poids EST le
   * pourcentage de chance. `rng` est injectable pour les tests.
   * @returns index du lot dans CONFIG.WHEEL.PRIZES
   */
  function draw(rng) {
    const list = prizes();
    if (!list.length) return -1;
    const total = list.reduce((s, p) => s + (p.weight || 0), 0);
    const r = ((typeof rng === 'function' ? rng() : Math.random()) || 0) * total;
    let acc = 0;
    for (let i = 0; i < list.length; i++) {
      acc += list[i].weight || 0;
      if (r < acc) return i;
    }
    return list.length - 1;
  }

  /** Probabilités affichées (en %), pour la fenêtre d'aide. */
  function odds() {
    const list = prizes();
    const total = list.reduce((s, p) => s + (p.weight || 0), 0) || 1;
    return list.map(p => ({ ...p, pct: (p.weight / total) * 100 }));
  }

  /* ---------- Le tour lui-même ---------- */

  /**
   * Lance la roue pour `player` et applique immédiatement le gain.
   * @param player  profil (par défaut : le pilote connecté)
   * @param now     horodatage (tests)
   * @param forced  index de lot imposé (tests) ou fonction rng
   * @returns { index, prize, keroAdded, keroLost, points } ou null si indisponible
   */
  function spin(player, now, forced) {
    const p = player || State.current();
    const ref = (typeof now === 'number' && isFinite(now)) ? now : Date.now();
    if (!p || !available(p, ref)) return null;

    const index = (typeof forced === 'number')
      ? forced
      : draw(typeof forced === 'function' ? forced : undefined);
    const prize = prizes()[index];
    if (!prize) return null;

    // --- Kérosène (plafonné par le réservoir) ---
    const cap = State.tankCapacity(p);
    const kero = prize.kero || 0;
    const keroAdded = Math.min(kero, Math.max(0, cap - p.kerosene));
    if (kero > 0) p.kerosene = Math.min(cap, p.kerosene + kero);

    // --- Points (bonusPoints : `points` est recalculé à chaque tick) ---
    const points = prize.points || 0;
    if (points > 0) p.bonusPoints = (Number(p.bonusPoints) || 0) + points;

    // --- Compteurs & verrou quotidien ---
    p.wheelLast = ref;
    p.wheelSpins = (Number(p.wheelSpins) || 0) + 1;
    if (prize.jackpot) p.wheelJackpots = (Number(p.wheelJackpots) || 0) + 1;

    // --- Journal (événement de jeu : ni série 🔥 ni statistique sportive) ---
    if (!Array.isArray(p.activityLog)) p.activityLog = [];
    p.activityLog.push({
      activityId: 'wheel',
      prizeId: prize.id,
      prizeLabel: prize.label,
      prizeIcon: prize.icon,
      minutes: 0,
      kero: Math.round(keroAdded),
      pts: points,
      date: ref,
    });
    if (p.activityLog.length > 500) p.activityLog.shift();

    State.save();
    if (typeof Sync !== 'undefined' && Sync.push) Sync.push(p);

    return {
      index, prize, keroAdded, points,
      keroLost: Math.max(0, kero - keroAdded),   // réservoir plein
    };
  }

  /* ---------- Rendu SVG de la roue ---------- */

  const CX = 100, CY = 100, R = 96;

  // Angle mesuré dans le sens horaire depuis midi (12 h)
  function pt(angleDeg, radius) {
    const a = (angleDeg - 90) * Math.PI / 180;
    return [CX + radius * Math.cos(a), CY + radius * Math.sin(a)];
  }

  function segmentPath(a0, a1) {
    const [x0, y0] = pt(a0, R);
    const [x1, y1] = pt(a1, R);
    const large = (a1 - a0) > 180 ? 1 : 0;
    return `M ${CX} ${CY} L ${x0.toFixed(2)} ${y0.toFixed(2)} ` +
           `A ${R} ${R} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)} Z`;
  }

  function buildSvg() {
    const list = prizes();
    const step = 360 / list.length;
    let segs = '', labels = '';
    list.forEach((prize, i) => {
      const a0 = i * step, a1 = a0 + step, mid = a0 + step / 2;
      segs += `<path d="${segmentPath(a0, a1)}" fill="${prize.color}"
                     stroke="rgba(255,255,255,0.55)" stroke-width="1"></path>`;
      const [lx, ly] = pt(mid, 60);
      // Texte radial. Dans la moitié basse on retourne le libellé de 180°
      // pour qu'il reste lisible (et on inverse alors icône / texte).
      const flip = mid > 90 && mid < 270;
      const rot = flip ? mid + 180 : mid;
      labels += `
        <g transform="translate(${lx.toFixed(2)} ${ly.toFixed(2)}) rotate(${rot.toFixed(1)})">
          <text class="wheel-seg-icon" y="${flip ? 12 : -9}">${prize.icon}</text>
          <text class="wheel-seg-label" y="${flip ? -6 : 9}">${prize.label}</text>
        </g>`;
    });
    return `
      <svg viewBox="0 0 200 200" class="wheel-svg" aria-hidden="true">
        <g id="wheel-rotor">
          <circle cx="${CX}" cy="${CY}" r="${R + 3}" fill="#0d1b2a"></circle>
          ${segs}
          ${labels}
        </g>
        <circle cx="${CX}" cy="${CY}" r="15" fill="#0d1b2a"
                stroke="rgba(255,255,255,0.7)" stroke-width="2"></circle>
        <text class="wheel-hub" x="${CX}" y="${CY + 6}">✈️</text>
      </svg>`;
  }

  /**
   * Rotation finale (en degrés) amenant le lot `index` sous le repère
   * fixé à midi. Un léger décalage aléatoire évite l'arrêt toujours
   * pile au centre du secteur.
   */
  function rotationFor(index, jitter) {
    const n = prizes().length || 1;
    const step = 360 / n;
    const j = (typeof jitter === 'number' ? jitter : (Math.random() - 0.5)) * (step * 0.55);
    return TURNS() * 360 - (index * step + step / 2) + j;
  }

  /* ---------- Fenêtre ---------- */

  /** Ligne « 3 tours joués · 1 jackpot 💎 » sous le bouton. */
  function statsText(spins, jack) {
    return `${spins} tour${spins > 1 ? 's' : ''} joué${spins > 1 ? 's' : ''}`
         + ` · ${jack} jackpot${jack > 1 ? 's' : ''} 💎`;
  }

  /** Rafraîchit la ligne de statistiques sans redessiner la roue. */
  function refreshStats() {
    const el = $('wheel-stats');
    const p = State.current();
    if (!el || !p) return;
    el.textContent = statsText(Number(p.wheelSpins) || 0, Number(p.wheelJackpots) || 0);
  }

  function render() {
    const p = State.current();
    const host = $('wheel-body');
    if (!host || !p) return;
    const ok = available(p);
    const spins = Number(p.wheelSpins) || 0;
    const jack = Number(p.wheelJackpots) || 0;

    host.innerHTML = `
      <p class="wheel-intro">
        Un tour offert chaque jour, à minuit. Le sort décide : kérosène,
        points… ou les deux si l'aiguille s'arrête sur 💎&nbsp;JACKPOT.
      </p>
      <div class="wheel-stage">
        <div class="wheel-pointer">▼</div>
        ${buildSvg()}
      </div>
      <div class="wheel-result" id="wheel-result"></div>
      <button class="btn warm wheel-go" id="btn-wheel-spin" type="button"
              ${ok ? '' : 'disabled'}>${ok ? '🎡 Lancer la roue'
                : `⏳ Prochain tour dans ${countdownLabel(nextSpinIn(p))}`}</button>
      <div class="wheel-stats" id="wheel-stats">${statsText(spins, jack)}</div>
      <details class="wheel-odds">
        <summary>Chances de gain</summary>
        <ul>${odds().map(o =>
          `<li><span>${o.icon} ${o.label}</span><b>${o.pct.toFixed(0)} %</b></li>`).join('')}</ul>
      </details>`;

    const rotor = document.getElementById('wheel-rotor');
    if (rotor) rotor.style.transform = 'rotate(0deg)';
    const btn = $('btn-wheel-spin');
    if (btn && ok) btn.addEventListener('click', play);
  }

  function play() {
    if (spinning) return;
    const p = State.current();
    const res = spin(p);
    if (!res) { render(); return; }

    spinning = true;
    const btn = $('btn-wheel-spin');
    const rotor = document.getElementById('wheel-rotor');
    const out = $('wheel-result');
    if (btn) { btn.disabled = true; btn.textContent = '🎡 La roue tourne…'; }
    if (out) { out.className = 'wheel-result'; out.textContent = ''; }

    const deg = rotationFor(res.index);
    if (rotor) {
      rotor.style.transition = `transform ${SPIN_MS()}ms cubic-bezier(.15,.85,.25,1)`;
      // Force un reflow pour que la transition parte bien de 0°
      void rotor.getBoundingClientRect();
      rotor.style.transform = `rotate(${deg.toFixed(2)}deg)`;
    }

    setTimeout(() => reveal(res), SPIN_MS());
  }

  function reveal(res) {
    spinning = false;
    const out = $('wheel-result');
    const btn = $('btn-wheel-spin');
    const prize = res.prize;

    const bits = [];
    if (res.keroAdded > 0) bits.push(`+${Math.round(res.keroAdded)} L ⛽`);
    if (res.points > 0) bits.push(`+${res.points} ★`);
    const gain = bits.join(' &nbsp;·&nbsp; ') || 'Réservoir plein — rien à ajouter';

    if (out) {
      out.className = 'wheel-result show' + (prize.jackpot ? ' jackpot' : '');
      out.innerHTML = `
        <div class="wr-title">${prize.jackpot ? '💎 JACKPOT !' : `${prize.icon} ${prize.label}`}</div>
        <div class="wr-gain">${gain}</div>
        ${res.keroLost > 0
          ? `<div class="wr-warn">Réservoir plein : ${Math.round(res.keroLost)} L perdus 💧</div>`
          : ''}`;
    }
    if (btn) {
      btn.disabled = true;
      btn.textContent = `⏳ Prochain tour dans ${countdownLabel(nextSpinIn(State.current()))}`;
    }

    // Effets : pluie de jerricans vers la réserve, toast, HUD à jour
    if (res.keroAdded > 0 && out && UI.keroseneRain) {
      UI.keroseneRain(out.getBoundingClientRect(), prize.jackpot ? 14 : 7);
    }
    if (res.points > 0) pointsPulse();
    UI.toast(prize.jackpot
      ? `💎 JACKPOT ! ${bits.join(' et ')}`
      : `🎡 ${prize.icon} ${prize.label} — ${gain.replace(/&nbsp;/g, ' ')}`, 4200);
    UI.refreshHUD();
    refreshButton();
    refreshStats();
  }

  function pointsPulse() {
    const el = document.querySelector('#hud-stats .points-value');
    if (!el) return;
    el.classList.remove('pts-pulse');
    void el.offsetWidth;
    el.classList.add('pts-pulse');
  }

  function open() {
    render();
    const modal = $('modal-wheel');
    if (modal) modal.classList.add('open');
  }

  /* ---------- Bouton du HUD (pastille + compte à rebours) ---------- */

  function refreshButton() {
    const btn = $('btn-wheel');
    if (!btn) return;
    const p = State.current();
    if (!p) return;
    const ok = available(p);
    btn.classList.toggle('ready', ok);
    btn.title = ok
      ? 'Roue de la chance : un tour vous attend !'
      : `Roue de la chance — prochain tour dans ${countdownLabel(nextSpinIn(p))}`;
    const dot = btn.querySelector('.wheel-dot');
    if (dot) dot.style.display = ok ? '' : 'none';
  }

  /** Invitation discrète à la connexion, si le tour du jour est libre. */
  function reminder() {
    const p = State.current();
    if (p && available(p)) {
      setTimeout(() => UI.toast('🎡 Votre tour de roue quotidien est disponible !', 4500), 2600);
    }
  }

  return {
    available, nextSpinIn, countdownLabel, draw, odds, spin,
    rotationFor, open, render, refreshButton, refreshStats, reminder, startOfDay,
  };
})();
