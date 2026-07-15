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

  /* ---------- Suppression de pilotes (tombstones) ---------- */
  // Un pilote supprimé laisse une « pierre tombale » dans /deleted :
  // les autres appareils l'effacent localement et ne le re-poussent pas.

  // Pierres tombales intégrées au code : purge automatique sur tous les
  // appareils, même sans action manuelle. Un pilote du même nom peut être
  // recréé après la date indiquée.
  const BUILTIN_TOMBSTONES = {
    'Test': 1784200000000, // purge demandée par Diego le 16/07/2026
  };

  async function fetchDeleted() {
    let deleted = {};
    if (enabled()) {
      try {
        const res = await fetch(`${baseUrl()}/deleted.json`, { cache: 'no-store' });
        if (res.ok) deleted = (await res.json()) || {};
      } catch (e) { /* hors-ligne : on garde les intégrées */ }
    }
    for (const [name, ts] of Object.entries(BUILTIN_TOMBSTONES)) {
      const key = keyFor(name);
      if (!(typeof deleted[key] === 'number' && deleted[key] >= ts)) {
        deleted[key] = ts;
      }
    }
    return deleted;
  }

  /** Nettoie le cloud : supprime les profils sous tombstone et publie
      les tombstones intégrées manquantes. */
  async function cleanupCloud(cloudPlayers, deleted) {
    if (!enabled() || !cloudPlayers) return;
    for (const [key, cp] of Object.entries(cloudPlayers)) {
      if (!cp || !cp.name) continue;
      if (tombstoneFor(deleted, cp)) {
        try {
          const ts = deleted[keyFor(cp.name)];
          await fetch(`${baseUrl()}/deleted/${keyFor(cp.name)}.json`, {
            method: 'PUT', body: JSON.stringify(ts),
          });
          await fetch(`${baseUrl()}/players/${key}.json`, { method: 'DELETE' });
          delete cloudPlayers[key];
        } catch (e) { /* réessaiera à la prochaine synchro */ }
      }
    }
  }

  function tombstoneFor(deleted, player) {
    const ts = deleted[keyFor(player.name)];
    // La pierre tombale ne vaut que pour les profils créés AVANT elle
    // (on peut donc recréer un pilote du même nom ensuite)
    return (typeof ts === 'number' && ts > (player.createdAt || 0)) ? ts : null;
  }

  function applyTombstones(deleted) {
    if (!deleted) return false;
    const data = State.raw();
    let changed = false;
    for (const name of Object.keys(data.players)) {
      if (tombstoneFor(deleted, data.players[name])) {
        delete data.players[name];
        if (data.currentPlayer === name) data.currentPlayer = null;
        changed = true;
      }
    }
    if (changed) State.save(null, true);
    return changed;
  }

  /** Supprime un pilote partout : localement, dans le cloud, + tombstone. */
  async function deletePlayer(name) {
    const data = State.raw();
    const player = data.players[name];
    delete data.players[name];
    if (data.currentPlayer === name) data.currentPlayer = null;
    State.save(null, true);

    if (enabled() && player) {
      try {
        await fetch(`${baseUrl()}/deleted/${keyFor(name)}.json`, {
          method: 'PUT', body: JSON.stringify(Date.now()),
        });
        await fetch(`${baseUrl()}/players/${keyFor(name)}.json`, { method: 'DELETE' });
        lastOk = Date.now(); lastError = false;
      } catch (e) {
        console.warn('Suppression cloud impossible :', e.message);
      }
    }
  }

  /* ---------- Fusion cloud <-> local ---------- */

  /**
   * Fusionne les profils du cloud dans la sauvegarde locale.
   * Règle : updatedAt le plus récent gagne. Le joueur actuellement
   * EN JEU sur cet appareil n'est jamais écrasé (il fait autorité).
   * Retourne true si quelque chose a changé localement.
   */
  function mergeIntoLocal(cloudPlayers, deleted) {
    if (!cloudPlayers) return false;
    const data = State.raw();
    const activeName = isPlaying() && State.current() ? State.current().name : null;
    let changed = false;

    Object.values(cloudPlayers).forEach(cp => {
      if (!cp || !cp.name) return;
      if (cp.name === activeName) return;
      if (deleted && tombstoneFor(deleted, cp)) return; // pilote supprimé
      const lp = data.players[cp.name];
      if (!lp || (cp.updatedAt || 0) > (lp.updatedAt || 0)) {
        data.players[cp.name] = cp;
        changed = true;
      }
    });
    if (changed) {
      // Firebase supprime les listes vides (ex : activityLog) et les null :
      // on renormalise les profils avant de sauvegarder.
      State.migrate();
      State.save(null, true); // sauvegarde locale sans réestampiller
    }
    return changed;
  }

  /** Pousse les profils locaux plus récents (ou absents) vers le cloud. */
  async function pushNewer(cloudPlayers, deleted) {
    const cloud = cloudPlayers || {};
    for (const lp of State.allPlayers()) {
      if (deleted && tombstoneFor(deleted, lp)) continue; // supprimé ailleurs
      const cp = cloud[lp.name] ||
        Object.values(cloud).find(c => c && c.name === lp.name);
      if (!cp || (lp.updatedAt || 0) > (cp.updatedAt || 0)) {
        await push(lp);
      }
    }
  }

  /** Synchronisation complète : tombstones, pull, fusion, push. */
  async function fullSync() {
    const deleted = await fetchDeleted();
    let changed = applyTombstones(deleted); // purge locale (même hors-ligne)
    if (!enabled()) return changed;
    const cloud = await pullAll();
    if (cloud === null) return changed;
    await cleanupCloud(cloud, deleted);
    changed = mergeIntoLocal(cloud, deleted) || changed;
    await pushNewer(cloud, deleted);
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
      const deleted = await fetchDeleted();
      applyTombstones(deleted);
      const cloud = await pullAll();
      if (cloud && mergeIntoLocal(cloud, deleted)) {
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

  return {
    enabled, pullAll, push, mergeIntoLocal, fullSync, deletePlayer,
    startLoop, statusText, updateBadge,
  };
})();
