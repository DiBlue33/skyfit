/* ============================================================
   SkyFit — Émetteur de notifications
   ------------------------------------------------------------
   Tourne sur GitHub Actions (voir .github/workflows/notify.yml),
   pas dans le navigateur. Raison d'être : sur iPhone, une web app
   ne peut RIEN programmer pendant qu'elle dort — ni Background
   Sync, ni Periodic Sync, ni notification différée. La seule
   façon d'être prévenu téléphone verrouillé est qu'un tiers
   envoie le push. Ce tiers, c'est ce script, réveillé toutes les
   heures.

   Il ne modifie jamais un profil de joueur : il lit /players,
   décide, envoie, et n'écrit que dans /notify (ses propres
   garde-fous anti-spam). Une panne ici ne peut donc pas abîmer
   une partie.

   Secrets attendus : VAPID_PRIVATE (clé privée jumelle de celle
   publiée dans js/pwa.js). L'URL Firebase et la clé publique sont
   lues dans le dépôt : elles sont déjà publiques par nature.
   ============================================================ */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const webpush = require('web-push');

const ROOT = path.join(__dirname, '..');
const now = Date.now();
const DRY = process.argv.includes('--dry-run');
// --test : envoie une notification à tous les appareils abonnés, sans
// tenir compte des conditions ni des verrous. Sert à répondre à la seule
// question qui compte quand rien n'arrive : « le téléphone est-il
// vraiment abonné ? »
const TEST = process.argv.includes('--test');

/* ------------------------------------------------------------
   1. Charger les VRAIES règles du jeu
   ------------------------------------------------------------
   config.js est du JavaScript sans DOM : on l'exécute tel quel
   dans un contexte isolé plutôt que de recopier ici la formule de
   perte d'altitude. Une recopie finirait par diverger du jeu et
   annoncerait des altitudes fausses.
   ------------------------------------------------------------ */

function loadConfig() {
  const src = fs.readFileSync(path.join(ROOT, 'js', 'config.js'), 'utf8');
  const ctx = { console, window: {} };
  vm.createContext(ctx);
  // `const CONFIG = …` reste dans la portée lexicale du script et
  // n'apparaît pas sur l'objet de contexte : on le recopie soi-même.
  vm.runInContext(src + '\n;globalThis.__CONFIG = CONFIG;', ctx,
    { filename: 'config.js' });
  if (!ctx.__CONFIG) throw new Error('CONFIG introuvable dans js/config.js');
  return ctx.__CONFIG;
}

function readFirebaseUrl() {
  const src = fs.readFileSync(path.join(ROOT, 'js', 'sync-config.js'), 'utf8');
  const m = src.match(/databaseURL:\s*'([^']*)'/);
  return m && m[1] ? m[1].replace(/\/+$/, '') : '';
}

function readVapidPublic() {
  const src = fs.readFileSync(path.join(ROOT, 'js', 'pwa.js'), 'utf8');
  const m = src.match(/'(B[A-Za-z0-9_-]{80,})'/);
  return m ? m[1] : '';
}

/* ------------------------------------------------------------
   2. Accès à la base
   ------------------------------------------------------------ */

/* Le secret de base (facultatif) permet de VERROUILLER /push et /notify
   côté règles Firebase tout en laissant cet émetteur y accéder : un
   accès porteur du secret contourne les règles. Sans lui, ces deux
   nœuds doivent rester lisibles publiquement (voir firebase-rules.json). */
const SECRET = process.env.FIREBASE_SECRET || '';
const url = (db, node) =>
  `${db}/${node}.json` + (SECRET ? `?auth=${encodeURIComponent(SECRET)}` : '');

/** Traduit un échec Firebase en phrase actionnable plutôt qu'en pile d'appels. */
function explain(node, status) {
  if (status === 401) {
    return `Firebase refuse l'accès à « ${node} » (HTTP 401 = permission ` +
      `refusée par les règles de sécurité).\n` +
      `  → Console Firebase → Realtime Database → onglet Règles.\n` +
      `  → « ${node} » doit y être lisible, ou définissez le secret ` +
      `FIREBASE_SECRET.\n` +
      `  → Le fichier firebase-rules.json à la racine du dépôt contient des ` +
      `règles prêtes à coller.`;
  }
  if (status === 404) {
    return `Firebase ne connaît pas cette base (HTTP 404) — vérifiez ` +
      `databaseURL dans js/sync-config.js.`;
  }
  return `GET ${node} → HTTP ${status}`;
}

async function get(db, node) {
  const res = await fetch(url(db, node), { cache: 'no-store' });
  if (!res.ok) throw new Error(explain(node, res.status));
  return (await res.json()) || {};
}

async function put(db, node, value) {
  if (DRY) return true;
  const res = await fetch(url(db, node), {
    method: 'PUT', body: JSON.stringify(value),
  });
  // Une écriture refusée casse l'anti-spam mais pas l'envoi : on le dit
  // fort plutôt que d'échouer, sinon plus personne n'est prévenu de rien.
  if (!res.ok) console.log(`· ⚠️ écriture refusée sur ${node} (HTTP ${res.status})`);
  return res.ok;
}

async function del(db, node) {
  if (DRY) return true;
  const res = await fetch(url(db, node), { method: 'DELETE' });
  return res.ok;
}

// Les clés Firebase interdisent . # $ / [ ] — même encodage que js/sync.js
const keyFor = (name) => encodeURIComponent(name).replace(/\./g, '%2E');

/* ------------------------------------------------------------
   3. Lecture de l'état d'un avion
   ------------------------------------------------------------ */

function decayFactor(CONFIG, p) {
  const up = CONFIG.UPGRADES.find(u => u.id === 'aero');
  const lvl = (p.upgrades && p.upgrades.aero) || 0;
  return Math.max(0.3, 1 - lvl * (up ? up.effectPerLevel : 0));
}

/**
 * Altitude estimée MAINTENANT. Le profil stocké date du dernier
 * instant simulé par un navigateur (`lastTick`) : entre-temps l'avion
 * a continué de descendre, et c'est justement cette descente-là qu'on
 * veut annoncer avant le crash.
 */
function altitudeNow(CONFIG, p) {
  const last = Number(p.lastTick) || now;
  const hours = Math.max(0, (now - last) / 3600000);
  if (p.crashed) return 0;
  const perHour = CONFIG.decayFtPerHour(p) * decayFactor(CONFIG, p);
  return Math.max(0, (Number(p.altitude) || 0) - perHour * hours);
}

/** Heures restantes avant que l'avion touche le sol. */
function hoursToGround(CONFIG, p, alt) {
  const perHour = CONFIG.decayFtPerHour(p) * decayFactor(CONFIG, p);
  return perHour > 0 ? alt / perHour : Infinity;
}

/* Une entrée du journal porte DEUX horodatages, et les confondre casse
   l'alerte « le conjoint s'est entraîné » :
     · date     = début de la séance, choisi par le joueur. Peut être
                  ce matin, ou hier, pour une séance saisie après coup.
     · loggedAt = instant réel de la saisie. C'est CELUI-LÀ qui dit
                  « il vient de se passer quelque chose ».
   Tout ce qui relève de la nouveauté (fraîcheur, anti-doublon) se
   calcule donc sur loggedAt ; `date` ne sert plus qu'à raconter quand
   la séance a eu lieu. Le repli sur `date` couvre les entrées
   enregistrées avant l'existence du champ loggedAt. */
const saisieAt = (e) => Number(e && (e.loggedAt || e.date)) || 0;

/** Dernière VRAIE séance de sport SAISIE (les entrées méta n'en sont pas). */
function lastSession(CONFIG, p) {
  const log = Array.isArray(p.activityLog) ? p.activityLog : [];
  let best = null;
  for (const e of log) {
    if (!e || CONFIG.META_ENTRIES[e.activityId]) continue;
    if (!best || saisieAt(e) > saisieAt(best)) best = e;
  }
  return best;
}

function activityName(CONFIG, id) {
  const a = (CONFIG.ACTIVITIES || []).find(x => x.id === id);
  return a ? a.name : 'une séance';
}

/**
 * Précise QUAND la séance a eu lieu, mais seulement si ce n'est pas
 * « à l'instant » : annoncer une sortie du matin saisie à midi sans
 * rien dire laisse croire qu'elle vient de se terminer.
 */
function quand(debut, saisie) {
  if (!debut || saisie - debut < 2 * 3600000) return '';
  const d = new Date(debut);
  const minuit = new Date(saisie); minuit.setHours(0, 0, 0, 0);
  const mm = d.getMinutes();
  const h = `${d.getHours()} h` + (mm ? ` ${String(mm).padStart(2, '0')}` : '');
  if (debut >= minuit.getTime()) return ` (à ${h})`;
  if (debut >= minuit.getTime() - 86400000) return ` (hier à ${h})`;
  return ` (le ${d.getDate()}/${d.getMonth() + 1})`;
}

function fmtFt(n) {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/* ------------------------------------------------------------
   4. Décision : quelles alertes pour qui
   ------------------------------------------------------------
   Chaque famille d'alerte a son propre verrou dans /notify pour
   qu'un réveil horaire ne se transforme pas en harcèlement : une
   alerte d'altitude au plus toutes les 10 h, un crash annoncé une
   seule fois, une séance du conjoint annoncée une seule fois (on
   retient son horodatage), la roue une seule fois par jour et
   seulement le soir.
   ------------------------------------------------------------ */

const LOW_RATIO   = 0.25;   // sous 25 % du plafond, on prévient
const LOW_HOURS   = 10;     // pas plus d'une alerte altitude par 10 h
// Une séance SAISIE il y a plus de 3 h n'est plus une nouvelle. Large
// devant le réveil horaire : même un réveil raté laisse passer l'alerte.
const RIVAL_MAX_H = 3;
const WHEEL_HOUR  = 19;     // heure locale du rappel de roue
const CREA_HOUR   = 20;     // rappel créatine à 20 h 30 (heure de Paris)
const CREA_MIN    = 30;

function decide(CONFIG, name, players, state) {
  const p = players[name];
  const out = [];
  if (!p) return out;

  const st = state[name] || {};
  const ceiling = CONFIG.ceilingFor(p);
  const alt = altitudeNow(CONFIG, p);

  // TZ=Europe/Paris est posé par le workflow : ces valeurs sont donc
  // bien l'heure locale de Diego et Jade, pas l'heure UTC de GitHub.
  const d = new Date(now);
  const hour = d.getHours();
  const minute = d.getMinutes();
  const startOfDay = new Date(now); startOfDay.setHours(0, 0, 0, 0);

  /* --- Créatine du jour ---
     Placé AVANT le bloc crash, qui sort de la fonction : la créatine
     se prend même quand l'avion est au sol. Et seuls les pilotes qui en
     prennent déjà sont concernés — inutile de rappeler à quelqu'un une
     habitude qui n'est pas la sienne. */
  const creaLog = (Array.isArray(p.activityLog) ? p.activityLog : [])
    .filter(e => e && e.activityId === 'creatine');
  if (creaLog.length) {
    const priseAujourdhui = creaLog.some(e => (Number(e.date) || 0) >= startOfDay.getTime());
    const dejaDit = (Number(st.creatineAt) || 0) >= startOfDay.getTime();
    if (hour === CREA_HOUR && minute >= CREA_MIN && !priseAujourdhui && !dejaDit) {
      out.push({
        tag: 'creatine',
        title: '💊 Attention, tu n\'as pas pris ta créatine du jour',
        body: 'Une dose de 5 g, et 50 L de kérosène en prime. Tu as jusqu\'à minuit.',
        set: { creatineAt: now },
      });
    }
  }

  /* --- Crash --- */
  if (p.crashed) {
    if (!st.crashed) {
      out.push({
        tag: 'alt',
        title: '💥 Ton avion s\'est posé en catastrophe',
        body: 'Le compteur de kilomètres est reparti de zéro. Une séance de sport et tu redécolles.',
        set: { crashed: true },
      });
    }
    return out;   // inutile d'ajouter « tu descends » à quelqu'un déjà au sol
  }
  if (st.crashed) out.push({ silent: true, set: { crashed: false } });

  /* --- Altitude critique --- */
  const low = alt <= ceiling * LOW_RATIO;
  const since = now - (Number(st.lowAt) || 0);
  if (low && alt > 0 && since > LOW_HOURS * 3600000) {
    const h = hoursToGround(CONFIG, p, alt);
    out.push({
      tag: 'alt',
      title: '✈️ Ton avion descend',
      body: `${fmtFt(alt)} ft et ça continue de tomber — ` +
            (h < 24
              ? `crash dans environ ${Math.max(1, Math.round(h))} h.`
              : 'il est temps de refaire le plein.'),
      set: { lowAt: now },
    });
  }

  /* --- Séance du conjoint ---
     Fraîcheur ET anti-doublon se mesurent à la SAISIE, pas au début de
     la séance : une course du matin notée à midi reste une nouvelle,
     et une séance oubliée saisie après une plus récente ne doit pas
     être avalée par un verrou déjà en avance. */
  const rivalName = Object.keys(players).find(n => n !== name);
  if (rivalName) {
    const s = lastSession(CONFIG, players[rivalName]);
    const ts = saisieAt(s);
    if (s && ts > (Number(st.rivalAt) || 0) && now - ts < RIVAL_MAX_H * 3600000) {
      const mins = Number(s.minutes) || 0;
      out.push({
        tag: 'rival',
        title: `🏃 ${rivalName} vient de s'entraîner`,
        body: `${activityName(CONFIG, s.activityId)}` +
              (mins ? ` — ${mins} min` : '') +
              quand(Number(s.date) || 0, ts) +
              `. À toi de jouer.`,
        set: { rivalAt: ts },
      });
    }
  }

  /* --- Roue du jour --- */
  const wheelDone = Number(p.wheelLast) || 0;
  const alreadyToldToday = (Number(st.wheelAt) || 0) >= startOfDay.getTime();
  if (hour === WHEEL_HOUR && wheelDone < startOfDay.getTime() && !alreadyToldToday) {
    out.push({
      tag: 'wheel',
      title: '🎡 Ton tour de roue t\'attend',
      body: 'Il expire à minuit. Un tour gratuit, ça ne se refuse pas.',
      set: { wheelAt: now },
    });
  }

  return out;
}

/* ------------------------------------------------------------
   5. Envoi
   ------------------------------------------------------------ */

async function main() {
  const CONFIG = loadConfig();
  const db = readFirebaseUrl();
  const pub = readVapidPublic();
  const priv = process.env.VAPID_PRIVATE;

  if (!db) { console.log('Pas d\'URL Firebase — rien à faire.'); return; }
  if (!pub) throw new Error('Clé publique VAPID introuvable dans js/pwa.js');
  if (!priv && !DRY) throw new Error('Secret VAPID_PRIVATE absent');

  if (priv) {
    webpush.setVapidDetails('mailto:diego.mrtn33@gmail.com', pub, priv);
  }

  const [players, subs, state] = await Promise.all([
    get(db, 'players'), get(db, 'push'), get(db, 'notify'),
  ]);

  // /push et /notify sont indexés par la clé encodée ; /players aussi.
  // On rétablit les vrais noms pour raisonner en clair.
  const byName = {};
  for (const k of Object.keys(players)) {
    const p = players[k];
    if (p && p.name) byName[p.name] = p;
  }

  // Diagnostic systématique : quand aucune notification n'arrive, la
  // première chose à savoir est si un appareil est seulement abonné.
  const pilotes = Object.keys(byName);
  const abonnes = pilotes.filter(n => {
    const s = subs[keyFor(n)];
    return s && s.endpoint;
  });
  console.log(`Pilotes en base   : ${pilotes.join(', ') || '(aucun)'}`);
  console.log(`Appareils abonnés : ${abonnes.join(', ') || '(aucun)'}`);
  if (!abonnes.length) {
    console.log('  → Personne n\'est abonné. Sur iPhone : ouvrir SkyFit depuis');
    console.log('    l\'icône de l\'écran d\'accueil (pas depuis Safari), fiche');
    console.log('    pilote, activer les alertes. Un abonnement enregistré');
    console.log('    pendant que Firebase refusait l\'écriture est perdu :');
    console.log('    il faut désactiver puis réactiver.');
  }

  let sent = 0;
  for (const name of pilotes) {
    const sub = subs[keyFor(name)];
    const alerts = TEST
      ? [{
          tag: 'test',
          title: '🛫 SkyFit vous reçoit cinq sur cinq',
          body: `Notification d'essai pour ${name}. Si tu lis ceci, tout est branché.`,
        }]
      : decide(CONFIG, name, byName, { [name]: state[keyFor(name)] || {} });

    let patch = {};
    for (const a of alerts) Object.assign(patch, a.set || {});

    const real = alerts.filter(a => !a.silent);
    if (real.length && !sub) {
      console.log(`· ${name} : ${real.length} alerte(s) mais aucun appareil abonné`);
    }

    for (const a of real) {
      if (!sub || !sub.endpoint) continue;
      const payload = JSON.stringify({
        title: a.title, body: a.body, tag: a.tag, url: './',
      });
      if (DRY) {
        console.log(`· [essai] ${name} ← ${a.title} — ${a.body}`);
        sent++;
        continue;
      }
      try {
        await webpush.sendNotification({
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        }, payload);
        console.log(`· ${name} ← ${a.title}`);
        sent++;
      } catch (e) {
        const code = e.statusCode || 0;
        console.log(`· ${name} : envoi refusé (HTTP ${code})`);
        // 404/410 = abonnement périmé (app désinstallée, cache purgé).
        // On l'efface, sinon on réessaie toutes les heures pour rien.
        if (code === 404 || code === 410) await del(db, `push/${keyFor(name)}`);
      }
    }

    if (Object.keys(patch).length) {
      await put(db, `notify/${keyFor(name)}`,
        Object.assign({}, state[keyFor(name)] || {}, patch));
    }
  }

  console.log(`${sent} notification(s) envoyée(s).`);
}

main().catch(e => {
  // Une pile d'appels n'apprend rien à personne ici : le message d'explain()
  // dit quoi faire, on l'affiche seul.
  console.error('\n❌ ' + ((e && e.message) || e) + '\n');
  process.exit(1);
});
