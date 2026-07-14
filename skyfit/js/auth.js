/* ============================================================
   SkyFit — Écran d'accueil et protection des profils (code PIN)
   ------------------------------------------------------------
   Chaque pilote choisit un code à 4 chiffres à la création de
   son profil. Seule l'empreinte (hash) du code est stockée.
   NB : c'est une protection « familiale » (les données restent
   dans le navigateur), pas un coffre-fort bancaire.
   ============================================================ */

const Auth = (() => {

  const $ = (id) => document.getElementById(id);
  const fmt = (n) => Math.floor(n).toLocaleString('fr-FR');

  // --- Empreinte du code (djb2, salée avec le nom) ---
  function hashPin(name, pin) {
    const s = `skyfit|${name}|${pin}|v1`;
    let h = 5381;
    for (let i = 0; i < s.length; i++) {
      h = (((h << 5) + h) ^ s.charCodeAt(i)) >>> 0;
    }
    return h.toString(16);
  }

  // --- Machine à états du pavé PIN ---
  // mode : 'login' (vérifier) | 'create' (choisir) | 'confirm' (confirmer)
  let pinMode = 'login';
  let pinBuffer = '';
  let firstPin = '';         // 1re saisie en création
  let pendingName = null;    // profil en cours de connexion/création
  let pendingIsNew = false;  // true si le profil n'existe pas encore

  /* ---------- Navigation entre les vues ---------- */

  function showView(id) {
    document.querySelectorAll('.home-view').forEach(v => { v.hidden = v.id !== id; });
    if (id === 'hv-menu') refreshHomeScoreboard();
    if (id === 'hv-profiles') refreshProfileList();
  }

  function showHome() {
    refreshHomeScoreboard();
    showView('hv-menu');
    $('home-screen').classList.add('open');
    Sync.updateBadge();
    // Récupère les profils des autres appareils
    Sync.fullSync().then(() => refreshHome());
  }

  /** Rafraîchit l'accueil (appelé aussi par la synchro). */
  function refreshHome() {
    if (!$('home-screen').classList.contains('open')) return;
    if (!$('hv-menu').hidden) refreshHomeScoreboard();
    if (!$('hv-profiles').hidden) refreshProfileList();
    Sync.updateBadge();
  }

  function hideHome() {
    $('home-screen').classList.remove('open');
  }

  /* ---------- Classement général (accueil) ---------- */

  function refreshHomeScoreboard() {
    const record = (p) => Math.max(p.bestKm || 0, p.totalKm || 0);
    const players = State.allPlayers().slice().sort((a, b) => record(b) - record(a));
    const medals = ['🥇', '🥈', '🥉'];
    $('home-scoreboard').innerHTML = players.length
      ? players.map((p, i) => `
        <div class="home-score-row">
          <span class="hsr-name">${medals[i] || '•'} ${escapeHtml(p.name)}${p.crashed ? ' 💥' : ''}</span>
          <span class="hsr-km">🏆 ${fmt(record(p))} km
            <small>en vol : ${fmt(p.totalKm)} km</small></span>
        </div>`).join('')
      : '<p class="home-empty">Aucun pilote pour l\'instant.<br>Connecte-toi pour créer ton profil !</p>';
  }

  /* ---------- Liste des profils ---------- */

  function refreshProfileList() {
    const players = State.allPlayers().slice()
      .sort((a, b) => Math.max(b.bestKm, b.totalKm) - Math.max(a.bestKm, a.totalKm));
    $('home-profile-list').innerHTML = players.map(p => `
      <button class="player-btn" data-player="${escapeHtml(p.name)}" type="button">
        <span>👨‍✈️ ${escapeHtml(p.name)}</span>
        <span class="pkm">${p.pinHash ? '🔒' : '🔓 code à créer'}</span>
      </button>`).join('');
    document.querySelectorAll('#home-profile-list .player-btn').forEach(btn =>
      btn.addEventListener('click', () => selectProfile(btn.dataset.player)));
  }

  function selectProfile(name) {
    const players = State.allPlayers();
    const p = players.find(pl => pl.name === name);
    if (!p) return;
    pendingName = name;
    pendingIsNew = false;
    if (p.pinHash) {
      startPin('login', `Bonjour ${name} !`, 'Entre ton code à 4 chiffres');
    } else {
      // Ancien profil sans code : on lui en fait créer un
      startPin('create', `${name}, choisis ton code`, 'Ce code protégera ton profil (4 chiffres)');
    }
  }

  function createProfile() {
    const input = $('new-player-name');
    const name = input.value.trim();
    if (!name) return;
    if (State.allPlayers().some(p => p.name.toLowerCase() === name.toLowerCase())) {
      input.value = '';
      selectProfile(State.allPlayers().find(p => p.name.toLowerCase() === name.toLowerCase()).name);
      return;
    }
    pendingName = name;
    pendingIsNew = true;
    input.value = '';
    startPin('create', `${name}, choisis ton code`, 'Ce code protégera ton profil (4 chiffres)');
  }

  /* ---------- Pavé PIN ---------- */

  function startPin(mode, title, subtitle) {
    pinMode = mode;
    pinBuffer = '';
    if (mode !== 'confirm') firstPin = '';
    $('pin-title').textContent = title;
    $('pin-subtitle').textContent = subtitle;
    $('pin-error').textContent = '';
    updateDots();
    showView('hv-pin');
  }

  function updateDots() {
    document.querySelectorAll('#pin-dots span').forEach((d, i) =>
      d.classList.toggle('filled', i < pinBuffer.length));
  }

  function pressKey(key) {
    if ($('hv-pin').hidden) return;
    if (key === 'back') {
      pinBuffer = pinBuffer.slice(0, -1);
      updateDots();
      return;
    }
    if (!/^[0-9]$/.test(key) || pinBuffer.length >= 4) return;
    pinBuffer += key;
    $('pin-error').textContent = '';
    updateDots();
    if (pinBuffer.length === 4) {
      setTimeout(submitPin, 180); // laisse le 4e point s'afficher
    }
  }

  function submitPin() {
    const pin = pinBuffer;

    if (pinMode === 'create') {
      firstPin = pin;
      startPin('confirm', 'Confirme ton code', 'Retape le même code pour valider');
      return;
    }

    if (pinMode === 'confirm') {
      if (pin !== firstPin) {
        startPin('create', 'Les codes ne correspondent pas', 'Choisis ton code (4 chiffres)');
        shake();
        return;
      }
      // Création / mise à niveau du profil
      let p = State.allPlayers().find(pl => pl.name === pendingName);
      if (!p) p = State.addPlayer(pendingName);
      p.pinHash = hashPin(p.name, pin);
      State.save(p);      // estampille CE profil pour la synchro
      Sync.push(p);       // visible immédiatement sur les autres appareils
      enterGame(p.name);
      return;
    }

    // login
    const p = State.allPlayers().find(pl => pl.name === pendingName);
    if (p && hashPin(p.name, pin) === p.pinHash) {
      enterGame(p.name);
    } else {
      pinBuffer = '';
      updateDots();
      $('pin-error').textContent = '❌ Code incorrect, réessaie';
      shake();
    }
  }

  function shake() {
    const card = document.querySelector('.home-card');
    card.classList.remove('shake');
    void card.offsetWidth; // relance l'animation
    card.classList.add('shake');
  }

  function enterGame(name) {
    hideHome();
    Main.startWithPlayer(name);
  }

  /** Déconnexion : on retourne à l'accueil. */
  function logout() {
    State.save();
    Main.stopLoop();
    showHome();
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  /* ---------- Écouteurs ---------- */

  function bind() {
    $('btn-home-login').addEventListener('click', () => {
      showView('hv-profiles');
      // Profils à jour (un profil créé sur l'autre téléphone doit apparaître)
      Sync.fullSync().then(() => refreshHome());
    });
    $('btn-home-map').addEventListener('click', () => WorldMap.open());

    document.querySelectorAll('.home-back').forEach(btn =>
      btn.addEventListener('click', () => showView(btn.dataset.homeView)));

    $('btn-new-player').addEventListener('click', createProfile);
    $('new-player-name').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') createProfile();
    });

    $('pin-pad').querySelectorAll('button').forEach(btn =>
      btn.addEventListener('click', () => pressKey(btn.dataset.key)));

    // Saisie au clavier physique
    document.addEventListener('keydown', (e) => {
      if (!$('home-screen').classList.contains('open') || $('hv-pin').hidden) return;
      if (/^[0-9]$/.test(e.key)) pressKey(e.key);
      else if (e.key === 'Backspace') pressKey('back');
    });
  }

  document.addEventListener('DOMContentLoaded', bind);

  return { showHome, refreshHome, logout };
})();
