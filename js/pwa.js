/* ============================================================
   SkyFit — Installation sur l'écran d'accueil & notifications
   ------------------------------------------------------------
   Deux sujets liés par une contrainte d'Apple : sur iPhone, les
   notifications web n'existent QUE si le site a été ajouté à
   l'écran d'accueil. Dans un onglet Safari, `window.Notification`
   est absent. Tout le module part de là :

     1. `initInstall()` propose l'ajout à l'écran d'accueil —
        automatiquement sur Android (beforeinstallprompt), avec un
        mode d'emploi illustré sur iPhone puisque Apple n'a jamais
        implémenté de bannière d'installation ;
     2. `enableNotifications()` n'est proposé qu'une fois le jeu
        installé, et refuse poliment sinon.

   Rien ici n'est indispensable au jeu : sur un navigateur qui ne
   sait rien faire de tout ça, chaque fonction rend un état inerte
   et l'interface masque simplement les boutons concernés.
   ============================================================ */

const PWA = (() => {

  /* Clé publique VAPID. Elle est PUBLIQUE par construction (elle part
     dans chaque abonnement) ; c'est la clé privée jumelle, connue du
     seul émetteur planifié, qui signe les envois. */
  const VAPID_PUBLIC =
    'BB_XU5-Ex3ap6l1y7uWlkTGq6ZZROLjZg57L9l1swbRGaPl8ZEstdCD9Z0MPc9owHz0EarwyL2pBNPxX5a8s4K8';

  const HIDE_KEY = 'skyfit_install_hint_hidden';

  let deferredPrompt = null;   // événement Android mis de côté
  let reg = null;              // enregistrement du service worker

  /* ------------------------------------------------------------
     Détection
     ------------------------------------------------------------ */

  /** Le jeu tourne-t-il depuis l'icône de l'écran d'accueil ? */
  function isStandalone() {
    try {
      return window.matchMedia('(display-mode: standalone)').matches ||
             window.navigator.standalone === true;   // ancien drapeau iOS
    } catch (e) { return false; }
  }

  /** iPhone / iPad. L'iPad récent se déclare « Macintosh » : on le
      démasque par la présence d'un écran tactile. */
  function isIOS() {
    const ua = navigator.userAgent || '';
    if (/iPhone|iPad|iPod/.test(ua)) return true;
    return /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  }

  function swSupported() {
    return 'serviceWorker' in navigator &&
           window.location.protocol !== 'file:';
  }

  function pushSupported() {
    return swSupported() && 'PushManager' in window && 'Notification' in window;
  }

  /* ------------------------------------------------------------
     Service worker
     ------------------------------------------------------------ */

  async function register() {
    if (!swSupported()) return null;
    try {
      reg = await navigator.serviceWorker.register('sw.js');
      return reg;
    } catch (e) {
      console.warn('Service worker non enregistré :', e.message);
      return null;
    }
  }

  async function registration() {
    if (reg) return reg;
    if (!swSupported()) return null;
    try { reg = await navigator.serviceWorker.ready; } catch (e) { reg = null; }
    return reg;
  }

  /* ------------------------------------------------------------
     Invitation à installer
     ------------------------------------------------------------ */

  function hintHidden() {
    try { return localStorage.getItem(HIDE_KEY) === '1'; } catch (e) { return false; }
  }

  function hideHint(remember) {
    const el = document.getElementById('install-hint');
    if (el) el.hidden = true;
    if (remember) {
      try { localStorage.setItem(HIDE_KEY, '1'); } catch (e) { /* navigation privée */ }
    }
  }

  function showHint(kind) {
    const el = document.getElementById('install-hint');
    if (!el || isStandalone() || hintHidden()) return;
    el.dataset.kind = kind;
    el.hidden = false;
  }

  function initInstall() {
    // Android / Chrome : le navigateur nous confie sa propre invite.
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredPrompt = e;
      showHint('prompt');
    });

    window.addEventListener('appinstalled', () => {
      deferredPrompt = null;
      hideHint(true);
    });

    // iPhone : aucune invite n'existe, on explique le geste à la main.
    if (isIOS() && !isStandalone()) showHint('ios');
  }

  /**
   * Réaction au bouton « Installer ».
   * Android : déclenche l'invite native. Ailleurs (iPhone, ou Android
   * dont l'invite n'est pas encore disponible) : ouvre le mode d'emploi.
   * @returns {Promise<string>} 'accepted' | 'dismissed' | 'manual'
   */
  async function promptInstall() {
    if (deferredPrompt) {
      const evt = deferredPrompt;
      deferredPrompt = null;
      evt.prompt();
      let outcome = 'dismissed';
      try { outcome = (await evt.userChoice).outcome; } catch (e) { /* ignoré */ }
      if (outcome === 'accepted') hideHint(true);
      return outcome;
    }
    openGuide();
    return 'manual';
  }

  function openGuide() {
    const m = document.getElementById('modal-install');
    if (!m) return;
    // Le mode d'emploi diffère selon le téléphone : on n'affiche que
    // la colonne qui correspond, sinon Jade lit les gestes d'Android.
    const ios = isIOS();
    const bIos = document.getElementById('install-ios');
    const bAnd = document.getElementById('install-android');
    if (bIos) bIos.hidden = !ios;
    if (bAnd) bAnd.hidden = ios;
    m.classList.add('open');
  }

  /* ------------------------------------------------------------
     Notifications
     ------------------------------------------------------------ */

  /**
   * État complet, pour que l'interface sache quoi afficher sans
   * refaire elle-même la logique des cas particuliers d'Apple.
   * @returns {{supported:boolean, needsInstall:boolean,
   *            permission:string, subscribed:boolean, reason:string}}
   */
  async function notifState() {
    // Sur iPhone hors écran d'accueil, l'API n'existe pas du tout :
    // ce n'est pas un refus de l'utilisateur, c'est une installation
    // qui manque — et le message doit le dire.
    if (isIOS() && !isStandalone()) {
      return {
        supported: false, needsInstall: true,
        permission: 'default', subscribed: false,
        reason: 'Ajoute d\'abord SkyFit à ton écran d\'accueil : sur iPhone, ' +
                'les notifications n\'existent que depuis l\'icône.',
      };
    }
    if (!pushSupported()) {
      return {
        supported: false, needsInstall: false,
        permission: 'default', subscribed: false,
        reason: 'Ce navigateur ne gère pas les notifications.',
      };
    }
    const r = await registration();
    let sub = null;
    if (r && r.pushManager) {
      try { sub = await r.pushManager.getSubscription(); } catch (e) { sub = null; }
    }
    return {
      supported: true, needsInstall: false,
      permission: Notification.permission,
      subscribed: !!sub, reason: '',
    };
  }

  /** Base64 URL → Uint8Array (format attendu par applicationServerKey). */
  function decodeKey(b64) {
    const pad = '='.repeat((4 - (b64.length % 4)) % 4);
    const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  /**
   * Demande l'autorisation puis abonne l'appareil, et range
   * l'abonnement sous le nom du pilote pour que l'émetteur sache à
   * qui parler. À n'appeler QUE depuis un vrai clic : Safari refuse
   * `requestPermission()` en dehors d'un geste utilisateur.
   * @returns {Promise<{ok:boolean, error?:string}>}
   */
  async function enableNotifications(playerName) {
    const st = await notifState();
    if (!st.supported) return { ok: false, error: st.reason };

    let perm = Notification.permission;
    if (perm === 'default') {
      try { perm = await Notification.requestPermission(); }
      catch (e) { return { ok: false, error: 'Autorisation impossible.' }; }
    }
    if (perm !== 'granted') {
      return {
        ok: false,
        error: perm === 'denied'
          ? 'Notifications refusées. Réactive-les dans les réglages du téléphone.'
          : 'Autorisation non accordée.',
      };
    }

    const r = await registration();
    if (!r || !r.pushManager) return { ok: false, error: 'Service worker indisponible.' };

    let sub = null;
    try {
      sub = await r.pushManager.getSubscription();
      if (!sub) {
        sub = await r.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: decodeKey(VAPID_PUBLIC),
        });
      }
    } catch (e) {
      return { ok: false, error: 'Abonnement refusé par le navigateur.' };
    }

    const saved = await saveSubscription(playerName, sub);
    if (!saved) return { ok: false, error: 'Abonnement impossible à enregistrer en ligne.' };
    return { ok: true };
  }

  async function disableNotifications(playerName) {
    const r = await registration();
    if (r && r.pushManager) {
      try {
        const sub = await r.pushManager.getSubscription();
        if (sub) await sub.unsubscribe();
      } catch (e) { /* on efface quand même côté serveur */ }
    }
    if (typeof Sync !== 'undefined' && Sync.deletePush) await Sync.deletePush(playerName);
    return { ok: true };
  }

  function saveSubscription(playerName, sub) {
    if (typeof Sync === 'undefined' || !Sync.savePush || !sub) return Promise.resolve(false);
    const j = typeof sub.toJSON === 'function' ? sub.toJSON() : sub;
    return Sync.savePush(playerName, {
      endpoint: j.endpoint,
      p256dh: j.keys && j.keys.p256dh,
      auth: j.keys && j.keys.auth,
      updatedAt: Date.now(),
    });
  }

  /**
   * Rattache l'abonnement de cet appareil au pilote qui vient de se
   * connecter. Sans ça, un téléphone partagé continuerait de recevoir
   * les alertes du pilote précédent : le navigateur ne connaît qu'un
   * abonnement par appareil, c'est nous qui décidons à qui il sert.
   */
  async function syncSubscription(playerName) {
    if (!playerName || !pushSupported()) return false;
    if (Notification.permission !== 'granted') return false;
    const r = await registration();
    if (!r || !r.pushManager) return false;
    let sub = null;
    try { sub = await r.pushManager.getSubscription(); } catch (e) { return false; }
    if (!sub) return false;
    return saveSubscription(playerName, sub);
  }

  /* ------------------------------------------------------------
     Amorçage
     ------------------------------------------------------------ */

  function init() {
    register();
    initInstall();

    const btn = document.getElementById('install-hint-btn');
    if (btn) btn.addEventListener('click', () => promptInstall());
    const close = document.getElementById('install-hint-close');
    if (close) close.addEventListener('click', () => hideHint(true));
  }

  return {
    init, register, registration,
    isStandalone, isIOS, swSupported, pushSupported,
    initInstall, promptInstall, openGuide, showHint, hideHint,
    notifState, enableNotifications, disableNotifications, syncSubscription,
    VAPID_PUBLIC,
  };
})();
