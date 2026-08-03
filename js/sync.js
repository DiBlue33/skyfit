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
      const players = (await res.json()) || {};
      noteCloud(players);
      return players;
    } catch (e) {
      lastError = true;
      console.warn('Sync pull impossible :', e.message);
      return null;
    }
  }

  /* ---------- Garde-fou anti-régression (v3.9) ----------
     Deuxième verrou après la correction de resetPlayer(). On mémorise la
     dernière copie connue du cloud pour chaque pilote et on REFUSE de publier
     un profil qui aurait moins de km à vie qu'elle, à tampon de reset égal.
     lifetimeKm ne redescend jamais en jeu : une baisse signifie forcément un
     effacement. Un vrai grand reset, lui, change le tampon — il passe donc.
     Seule la restauration explicite (State.restaurer / Sync.restaurerDepuisCloud)
     force le passage. */
  const cloudSeen = {};
  let lastBlocked = null;

  function noteCloud(cloudPlayers) {
    Object.values(cloudPlayers || {}).forEach(cp => {
      if (!cp || !cp.name) return;
      cloudSeen[cp.name] = {
        resetStamp: cp.resetStamp || '',
        lifetimeKm: Number(cp.lifetimeKm) || 0,
        updatedAt: Number(cp.updatedAt) || 0,
      };
    });
  }

  function regression(p) {
    const cp = cloudSeen[p.name];
    if (!cp) return null;
    if ((p.resetStamp || '') !== cp.resetStamp) return null; // vrai reset : autorisé
    const local = Number(p.lifetimeKm) || 0;
    if (local >= cp.lifetimeKm - 1e-6) return null;
    return { local, cloud: cp.lifetimeKm };
  }

  /**
   * La même règle, dans l'autre sens : faut-il refuser d'ADOPTER un profil
   * venu du cloud ? Sans ça, un appareil sain qui se reconnecte après un
   * accident avale les profils vierges (plus récents) avant d'avoir pu
   * republier les siens — et la dernière copie intacte disparaît.
   * Une restauration explicite (restoredAt qui augmente) reste prioritaire.
   */
  function regressionEntrante(cp, lp) {
    if (!lp || !cp) return false;
    if ((cp.resetStamp || '') !== (lp.resetStamp || '')) return false;
    if ((Number(cp.restoredAt) || 0) > (Number(lp.restoredAt) || 0)) return false;
    return (Number(cp.lifetimeKm) || 0) < (Number(lp.lifetimeKm) || 0) - 1e-6;
  }

  async function push(player, keepalive = false, force = false) {
    if (!enabled() || !player) return false;
    if (!force) {
      const reg = regression(player);
      if (reg) {
        lastBlocked = { name: player.name, at: Date.now(), ...reg };
        console.warn(
          `SkyFit — envoi BLOQUÉ pour ${player.name} : ce profil local a ` +
          `${reg.local.toFixed(1)} km alors que le cloud en a ${reg.cloud.toFixed(1)} ` +
          `avec le même tampon de reset. Les données du cloud sont conservées.`);
        return false;
      }
    }
    try {
      const res = await fetch(`${baseUrl()}/players/${keyFor(player.name)}.json`, {
        method: 'PUT',
        body: JSON.stringify(player),
        keepalive,
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      lastOk = Date.now(); lastError = false;
      noteCloud({ [player.name]: player }); // le cloud vaut maintenant ceci
      return true;
    } catch (e) {
      lastError = true;
      console.warn('Sync push impossible :', e.message);
      return false;
    }
  }

  /* ---------- Sauvegardes de secours dans le cloud (v3.9) ----------
     Le filet local (skyfit_avant_reset) ne vit que dans le navigateur qui a
     fait le dégât : inutile depuis un autre appareil, c'est-à-dire le jour où
     on en a besoin. On garde donc aussi les photos dans /backups/<nom>/<ts>. */

  const BACKUP_DAY_KEY = 'skyfit_backup_cloud';
  const KEEP_BACKUPS = 12;
  let lastBackupKey = 0;

  async function backup(player, tag) {
    if (!enabled() || !player || !player.name) return false;
    // Deux photos prises dans la même milliseconde (photo d'avant-reset +
    // photo du jour, à la même synchro) partageraient la même clé et la
    // seconde effacerait la première.
    const ts = Math.max(Date.now(), lastBackupKey + 1);
    lastBackupKey = ts;
    try {
      const res = await fetch(`${baseUrl()}/backups/${keyFor(player.name)}/${ts}.json`, {
        method: 'PUT',
        body: JSON.stringify({ at: ts, tag: tag || 'auto', player }),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      await prunerSauvegardes(player.name);
      return true;
    } catch (e) {
      console.warn('Sauvegarde cloud impossible :', e.message);
      return false;
    }
  }

  /** Ne conserve que les KEEP_BACKUPS photos les plus récentes. */
  async function prunerSauvegardes(name) {
    try {
      const res = await fetch(
        `${baseUrl()}/backups/${keyFor(name)}.json?shallow=true`, { cache: 'no-store' });
      if (!res.ok) return;
      // Clés = horodatages en ms, toutes de même longueur : le tri texte suffit.
      const keys = Object.keys((await res.json()) || {}).sort();
      for (const k of keys.slice(0, Math.max(0, keys.length - KEEP_BACKUPS))) {
        await fetch(`${baseUrl()}/backups/${keyFor(name)}/${k}.json`, { method: 'DELETE' });
      }
    } catch (e) { /* le ménage réessaiera demain */ }
  }

  /** Recopie dans le cloud les photos prises juste avant un grand reset. */
  async function envoyerSauvegardes() {
    if (!enabled() || !State.sauvegardesEnAttente) return;
    for (const s of State.sauvegardesEnAttente()) {
      if (await backup(s.player, 'avant-reset')) State.marquerSauvegardeEnvoyee(s.name);
    }
  }

  /** Une photo par jour et par pilote : de quoi remonter une douzaine de jours. */
  async function sauvegardeQuotidienne() {
    if (!enabled()) return;
    let vues = {};
    try { vues = JSON.parse(localStorage.getItem(BACKUP_DAY_KEY)) || {}; } catch (e) { vues = {}; }
    let touched = false;
    for (const p of State.allPlayers()) {
      if (Date.now() - (vues[p.name] || 0) < 86400000) continue;
      if (await backup(p, 'quotidienne')) { vues[p.name] = Date.now(); touched = true; }
    }
    if (touched) {
      try { localStorage.setItem(BACKUP_DAY_KEY, JSON.stringify(vues)); } catch (e) { /* tant pis */ }
    }
  }

  /** Console : Sync.listerSauvegardes('Diego') → photos disponibles. */
  async function listerSauvegardes(name) {
    if (!enabled()) { console.warn('Synchro désactivée.'); return []; }
    try {
      const res = await fetch(`${baseUrl()}/backups/${keyFor(name)}.json`, { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const all = (await res.json()) || {};
      const liste = Object.entries(all).map(([ts, s]) => ({
        ts: Number(ts),
        quand: new Date(Number(ts)).toLocaleString('fr-FR'),
        tag: s && s.tag,
        km: s && s.player ? Math.round(s.player.lifetimeKm || 0) : 0,
      })).sort((a, b) => b.ts - a.ts);
      console.table(liste);
      return liste;
    } catch (e) { console.warn('Lecture des sauvegardes impossible :', e.message); return []; }
  }

  /** Console : Sync.restaurerDepuisCloud('Diego') — ou avec un ts précis. */
  async function restaurerDepuisCloud(name, ts) {
    if (!enabled()) { console.warn('Synchro désactivée.'); return null; }
    try {
      let snap;
      if (ts) {
        const r = await fetch(`${baseUrl()}/backups/${keyFor(name)}/${ts}.json`, { cache: 'no-store' });
        snap = r.ok ? await r.json() : null;
      } else {
        const r = await fetch(`${baseUrl()}/backups/${keyFor(name)}.json`, { cache: 'no-store' });
        const all = r.ok ? ((await r.json()) || {}) : {};
        const dernier = Object.keys(all).sort().pop();
        snap = dernier ? all[dernier] : null;
      }
      if (!snap || !snap.player) { console.warn('Aucune sauvegarde pour', name); return null; }
      const p = snap.player;
      p.resetStamp = CONFIG.RESET_STAMP; // sinon le reset se rejouerait aussitôt
      p.updatedAt = Date.now();
      p.restoredAt = Date.now();         // laissez-passer du garde-fou
      State.raw().players[name] = p;
      State.migrate();
      State.save(null, true);
      await push(p, false, true); // restauration : on force le garde-fou
      console.info('SkyFit — restauré depuis le cloud :', name,
        new Date(snap.at).toLocaleString('fr-FR'));
      return p;
    } catch (e) { console.warn('Restauration impossible :', e.message); return null; }
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
      if (regressionEntrante(cp, lp)) {
        console.warn(
          `SkyFit — copie cloud IGNORÉE pour ${cp.name} : elle n'a que ` +
          `${Math.round(cp.lifetimeKm || 0)} km contre ${Math.round(lp.lifetimeKm || 0)} ` +
          `ici, avec le même tampon de reset. La copie locale sera republiée.`);
        return;
      }
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
      // Sauvetage : le cloud a moins de km que nous à tampon égal. Notre copie
      // fait autorité — on la réestampille pour qu'elle gagne partout, sinon
      // l'appareil fautif resterait bloqué sur son profil vierge.
      const sauvetage = regressionEntrante(cp, lp);
      if (sauvetage) {
        lp.updatedAt = Date.now();
        State.save(null, true);
      }
      if (!cp || sauvetage || (lp.updatedAt || 0) > (cp.updatedAt || 0)) {
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
    await envoyerSauvegardes();   // photos prises avant un grand reset
    await sauvegardeQuotidienne();
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

  /* ---------- Abonnements aux notifications ----------
     Rangés sous /push/<pilote>, à part des profils : ce sont des
     données d'appareil, pas de jeu, et surtout un profil entier est
     réécrit en bloc à chaque `push()` — un abonnement logé dedans
     serait écrasé par le premier appareil à publier une version
     légèrement plus ancienne. Un pilote = un abonnement, le dernier
     appareil connecté gagne. */

  async function savePush(name, sub) {
    if (!enabled() || !name || !sub) return false;
    try {
      const res = await fetch(`${baseUrl()}/push/${keyFor(name)}.json`, {
        method: 'PUT', body: JSON.stringify(sub),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return true;
    } catch (e) {
      console.warn('Abonnement non enregistré :', e.message);
      return false;
    }
  }

  async function deletePush(name) {
    if (!enabled() || !name) return false;
    try {
      const res = await fetch(`${baseUrl()}/push/${keyFor(name)}.json`,
        { method: 'DELETE' });
      return res.ok;
    } catch (e) {
      console.warn('Désabonnement non transmis :', e.message);
      return false;
    }
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
    savePush, deletePush,
    startLoop, statusText, updateBadge,
    // Sauvegardes de secours + garde-fou (v3.9)
    backup, listerSauvegardes, restaurerDepuisCloud,
    dernierBlocage: () => lastBlocked,
  };
})();
