# 🚀 Mettre SkyFit en ligne — guide pas à pas

Deux étapes, ~20 minutes, 100 % gratuit :

1. **Firebase** → la synchronisation (classement commun entre vos téléphones)
2. **GitHub Pages** → l'hébergement (le jeu accessible depuis n'importe où)

---

## Étape 1 — Créer la base Firebase (synchronisation)

1. Va sur **https://console.firebase.google.com** et connecte-toi avec ton
   compte Google.
2. Clique **« Créer un projet »** → nomme-le `skyfit` → tu peux désactiver
   Google Analytics (inutile ici) → **Créer**.
3. Dans le menu de gauche : **Créer > Realtime Database** →
   **« Créer une base de données »**.
   - Emplacement : choisis **Belgique (europe-west1)**.
   - Règles de sécurité : choisis **« Démarrer en mode test »** → Activer.
4. ⚠️ Le mode test expire au bout de 30 jours. Pour que le jeu continue de
   fonctionner, va dans l'onglet **« Règles »** de la base et remplace tout par :

   ```json
   {
     "rules": {
       "players": {
         ".read": true,
         ".write": true
       }
     }
   }
   ```

   puis clique **« Publier »**.
5. En haut de la page « Données », copie l'**URL de la base** — elle ressemble à :
   `https://skyfit-xxxxx-default-rtdb.europe-west1.firebasedatabase.app`
6. Ouvre le fichier **`js/sync-config.js`** du jeu et colle l'URL :

   ```js
   const SYNC_CONFIG = {
     databaseURL: 'https://skyfit-xxxxx-default-rtdb.europe-west1.firebasedatabase.app',
   };
   ```

C'est tout pour Firebase. (Plan gratuit « Spark » : très largement suffisant
pour 2 joueurs — 1 Go de stockage, 10 Go de trafic/mois.)

> 🔐 Honnêteté : ces règles laissent la base lisible/modifiable par quiconque
> connaît son URL exacte (quasi impossible à deviner, mais pas impossible).
> Pour un jeu familial c'est un compromis raisonnable. On pourra durcir plus
> tard avec Firebase Auth si besoin.

---

## Étape 2 — Héberger sur GitHub Pages

1. Crée un compte gratuit sur **https://github.com** (si tu n'en as pas).
2. En haut à droite : **+ → New repository**.
   - Nom : `skyfit`
   - Visibilité : **Public** (obligatoire pour Pages gratuit)
   - Coche **« Add a README file »** → **Create repository**.
3. Dans le dépôt : bouton **« Add file » → « Upload files »**.
   - Glisse **tout le contenu du dossier `skyfit`** (le fichier `index.html`,
     et les dossiers `css`, `js`, `assets`) dans la zone de dépôt.
     💡 Glisse les dossiers entiers depuis l'explorateur Windows : la
     structure est conservée (utilise Chrome ou Edge).
   - Vérifie que `js/sync-config.js` contient bien ton URL Firebase !
   - Clique **« Commit changes »**.
4. **Settings** (onglet du dépôt) → menu **Pages** (à gauche) :
   - Source : **« Deploy from a branch »**
   - Branch : **main** — dossier **/ (root)** → **Save**.
5. Attends 1 à 2 minutes, recharge la page : l'adresse du jeu s'affiche :

   **`https://TON-PSEUDO.github.io/skyfit/`**

6. Ouvre cette adresse sur vos deux téléphones. Sur l'écran d'accueil,
   tu dois voir **« ☁️ Synchronisé »** sous les boutons. Chacun crée son
   profil avec son code, et le classement est commun ! 🎉

💡 **Astuce téléphone** : dans le navigateur, menu « Ajouter à l'écran
d'accueil » → le jeu s'ouvre comme une appli, en plein écran.

---

## Mettre à jour le jeu plus tard

Retourne dans le dépôt GitHub → « Add file » → « Upload files » → glisse les
fichiers modifiés (ils remplacent les anciens) → Commit. Le site se met à
jour en ~1 minute.

Pour modifier un seul fichier (ex. `js/sync-config.js`) : clique sur le
fichier dans GitHub → icône crayon ✏️ → édite → « Commit changes ».

---

## Comment marche la synchro (pour info)

- Chaque profil est stocké dans Firebase (`/players/<nom>`), avec son code
  PIN (empreinte), ses km, son record, son avion, etc.
- Le jeu pousse ta progression toutes les 20 secondes pendant que tu joues,
  et récupère celle des autres au même rythme.
- Sans réseau, le jeu continue en local et se resynchronise dès que possible.
- Si le même profil joue sur deux appareils en même temps, c'est la dernière
  sauvegarde qui gagne — chacun son profil, et tout va bien. 😄
