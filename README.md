# ✈️ SkyFit — Fais du sport, garde ton avion en vol !

Jeu de motivation sportive : chaque séance de sport rapporte du kérosène,
le kérosène fait monter l'avion, et plus l'avion vole haut, plus il va vite
et plus il parcourt de kilomètres — même quand le navigateur est fermé.

## Lancer le jeu

Ouvre simplement `index.html` dans un navigateur (double-clic).
Aucun serveur ni installation nécessaire. Fonctionne sur PC, tablette et téléphone.

La sauvegarde est locale au navigateur (localStorage) : joue toujours dans le
même navigateur pour retrouver ta progression.

## Accueil, comptes et codes PIN

Au lancement, l'écran d'accueil affiche le classement général et donne accès
à la carte, sans connexion. Pour jouer : « Se connecter » → choisis ton profil
→ entre ton **code à 4 chiffres** (choisi à la création du profil, saisie au
pavé tactile ou au clavier). Les anciens profils sans code en créent un à la
première connexion. Le bouton « déconnexion » (en haut à gauche en jeu)
ramène à l'accueil.

⚠️ Protection « familiale » : le code empêche l'autre pilote d'ouvrir ton
compte, mais les données restent dans le navigateur (pas un coffre-fort).

Chaque avion continue de voler même quand son pilote n'est pas connecté.

## Règles du jeu

| Paramètre | Valeur |
|---|---|
| Altitude de décollage | 5 000 ft |
| Altitude maximale | 38 000 ft |
| **Crash** | à **0 ft** 💥 |
| Perte d'altitude | 500 ft/h (en continu, même navigateur fermé) |
| Combustion du kérosène | 600 L/h, 1 L = +40 ft |
| Vitesse | 150 km/h au ras du sol → 950 km/h à 38 000 ft |
| Points | 1 point tous les 10 km (cumulés à vie, jamais perdus) |

**Équilibrage :** ~30 minutes de sport par jour suffisent à maintenir l'altitude.
Sans sport, l'avion se crashe en 2 à 3 jours depuis les hautes altitudes.

### 💥 Le crash

Si l'altitude tombe à 0 ft, l'avion se crashe : vitesse nulle, les kilomètres
n'avancent plus et **le score de la tentative repart à 0**. Le meilleur score
de chaque pilote est conservé (🏆 record) dans le classement général.
Pour redécoller (à 5 000 ft) : ajouter une séance de sport !
Les points d'achat, avions et améliorations ne sont jamais perdus.

### Kérosène par activité

| Activité | L/min |
|---|---|
| Natation | 11 |
| Running | 10 |
| Musculation / Tennis | 8 |
| Padel | 7 |
| Vélo (ville) / Pilates | 5 |
| Yoga | 4 |

Bonus : Créatine 💊 = +50 L, une prise par jour.

## Boutique

- **Avions** : 8 modèles réels, du Cessna 172 au Concorde (x2,6 de vitesse) —
  TBM 700, A220, B737, A320, Falcon 900, A380. Images détourées dans
  `assets/planes/`, régénérables via `scripts/process_assets.py`.
- **Améliorations** : rendement kérosène (+15 %/niv), aérodynamisme (-10 % de
  perte/niv), réservoir agrandi (+1 000 L/niv).
- **Décors** : coucher de soleil, nuit étoilée, aurore boréale.

## Structure du projet

```
skyfit/
├── index.html        Structure de la page et HUD
├── css/style.css     Styles (ciel, panneaux, modales, responsive)
└── js/
    ├── config.js     Toutes les constantes d'équilibrage (à ajuster ici !)
    ├── state.js      Profils, sauvegarde locale
    ├── engine.js     Moteur : montée, descente, distance, hors-ligne, achats
    ├── scene.js      Scène 2D : avions SVG, nuages, décors
    ├── ui.js         HUD, modales, boutique, classement
    └── main.js       Démarrage et boucle de jeu
```

Pour modifier l'équilibrage (rendre le jeu plus ou moins exigeant), tout se
passe dans `js/config.js` — chaque constante y est commentée.
