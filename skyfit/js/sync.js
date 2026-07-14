/* ============================================================
   SkyFit — Synchronisation en ligne (Firebase Realtime Database)
   ------------------------------------------------------------
   Utilise l'API REST de la Realtime Database : chaque profil est
   stocké sous /players/<nom>. Fusion par horodatage (updatedAt) :
   la version la plus récente gagne.

   - Si SYNC_CONFIG.databaseURL est vide → mode 100 % local.
   - Si le réseau est coupé → le jeu continue en local et se
     resynchronise dès que possible.
   ============================================================ */

const Sync = (() => {

  let lastOk = null;        // dernier échange réussi (Date.now()) ou null
  let lastError = false;
  let loopStarted = false;

  function enabled() {
    return typeof SYNC_CONFIG !== 'undefined' &&
      !!(SYNC_CONFIG.databaseURL && SYNC_CONFIG.databaseURL.startsWith('http'));
  }

  function baseUrl() {
    return SYNC_CONFIG.databaseURL.replace(/\/+$/, '');
  }

  // Les clés Firebase ne peuvent pas contenir . # $ / [ ]
  function keyFor(name) {
    return encodeURIComponent(name).replace(/\./g, '%2E');
  }

  /* ---------- Échanges REST ---------- */

  async function pullAll() {
    if (!enabled()) return null;
    try {
      const res = await fetch(`${baseUrl()}/players.json`, { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      lastOk = Date.now(); lastError = false;
      return (await res.json()) || {};
    } catch (e) {
      lastError = true;
      console.warn('Sync pull impossible :', e.message);
      return null;
    }
  }

  async function push(player, keepalive = false) {
    if (!enabled() || !player) return false;
    try {
      const res = await fetch(`${baseUrl()}/players/${keyFor(player.name)}.json`, {
        method: 'PUT',
        body: JSON.stringify(player),
        keepalive,
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      lastOk = Date.now(); lastError = false;
      return true;
    } catch (e) {
      lastError = true;
      console.warn('Sync push impossible :', e.message);
      return false;
    }
  }

  /* ---------- Fusion cloud <-> local ---------- */

  /**
   * Fusionne les profils du cloud dans la sauvegarde locale.
   * Règle : updatedAt le plus récent gagne. Le joueur actuellement
   * EN JEU sur cet appareil n'est jamais écrasé (il fait autorité).
   * Retourne true si quelque chose a changé localement.
   */
  function mergeIntoLocal(cloudPlayers) {
    if (!cloudPlayers) return false;
    const data = State.raw();
    const activeName = isPlaying() && State.current() ? State.current().name : null;
    let changed = false;

    Object.values(cloudPlayers).forEach(cp => {
      if (!cp || !cp.name) return;
      if (cp.name === activeName) return;
      const lp = data.players[cp.name];
      if (!lp || (cp.updatedAt || 0) > (lp.updatedAt || 0)) {
        data.players[cp.name] = cp;
        changed = true;
      }
    });
    if (changed) State.save(null, true); // sauvegarde locale sans réestampiller
    return changed;
  }

  /** Pousse les profils locaux plus récents (ou absents) vers le cloud. */
  async function pushNewer(cloudPlayers) {
    const cloud = cloudPlayers || {};
    for (const lp of State.allPlayers()) {
      const cp = cloud[lp.name] ||
        Object.values(cloud).find(c => c && c.name === lp.name);
      if (!cp || (lp.updatedAt || 0) > (cp.updatedAt || 0)) {
        await push(lp);
      }
    }
  }

  /** Synchronisation complète : pull, fusion, push de ce qui est plus récent. */
  async function fullSync() {
    if (!enabled()) return false;
    const cloud = await pullAll();
    if (cloud === null) return false;
    const changed = mergeIntoLocal(cloud);
    await pushNewer(cloud);
    return changed;
  }

  function isPlaying() {
    const home = document.getElementById('home-screen');
    return home && !home.classList.contains('open');
  }

  /* ---------- Boucle de synchro ---------- */

  function startLoop() {
    if (loopStarted || !enabled()) return;
    loopStarted = true;

    setInterval(async () => {
      // Pousse le joueur en cours de partie
      if (isPlaying() && State.current()) {
        await push(State.current());
      }
      // Rafraîchit les autres profils (classement, carte)
      const cloud = await pullAll();
      if (cloud && mergeIntoLocal(cloud)) {
        if (isPlaying()) UI.refreshHUD();
        else Auth.refreshHome();
      }
      updateBadge();
    }, 20000);

    // Dernier envoi à la fermeture de l'onglet
    window.addEventListener('beforeunload', () => {
      if (isPlaying() && State.current()) {
        const p = State.current();
        p.lastTick = Date.now();
        push(p, true); // keepalive
      }
    });
  }

  /* ---------- Indicateur d'état ---------- */

  function statusText() {
    if (!enabled()) return '💾 Mode local (synchro non configurée)';
    if (lastError) return '⚠️ Synchro : hors-ligne, réessai en cours…';
    if (lastOk) return '☁️ Synchronisé';
    return '☁️ Connexion…';
  }

  function updateBadge() {
    const el = document.getElementById('sync-status');
    if (el) el.textContent = statusText();
  }

  return { enabled, pullAll, push, mergeIntoLocal, fullSync, startLoop, statusText, updateBadge };
})();
