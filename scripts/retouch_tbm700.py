#!/usr/bin/env python3
"""Retouche du TBM 700 — train rentré + nettoyage des résidus de détourage.

Contexte : la photo source montrait l'avion au sol. Après détourage il restait
deux défauts signalés par Diego :

  1. un TRAIT BLANC flottant sous le nez (dernière ligne de pixels, x 334→355) :
     c'est le reste du sol de la photo, séparé de l'avion, plus deux mouchetures
     de quelques pixels ailleurs dans l'image ;
  2. le TRAIN D'ATTERRISSAGE SORTI — or en vol le train est rentré.

Méthode pour le train : on ne peut pas simplement effacer une boîte, parce que
la jambe se confond par endroits avec le ventre (certaines colonnes forment une
seule coulée de pixels du fuselage jusqu'à la roue). On coupe donc chaque
colonne du domaine concerné à la hauteur du VENTRE, interpolée linéairement
entre les deux colonnes saines qui encadrent le train. Le contour reste continu
avec le reste du fuselage : ça se lit comme une trappe fermée, pas comme une
gomme passée dessus.

⚠️ La taille de la toile (387×153) est volontairement CONSERVÉE, alors que tous
les autres avions sont rognés au plus juste. `CONFIG.PLANES` positionne
l'overlay d'hélice en POURCENTAGE du sprite (`prop: {left, top, width, height}`)
et le disque déborde sous le fuselage : rogner le bas décalerait l'hélice.

Usage :  python3 scripts/retouch_tbm700.py [--dry-run]
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

ASSET = Path(__file__).resolve().parent.parent / 'assets' / 'planes' / 'tbm700.png'

# Domaines des deux jambes, relevés sur le profil du bas de l'avion :
# hors de ces colonnes le bas de l'avion est à y≈125 (voilure) ou y≈129 (nez),
# dedans il plonge à y=148 (la roue).
GEAR = [
    {'name': 'train principal', 'x0': 215, 'x1': 232, 'left_y': 125, 'right_y': 125},
    # Le domaine avant est plus large que la jambe : la PORTE de trappe reste
    # ouverte sur la photo et pend 5 px sous le ventre (x 288→332). Elle n'a
    # rien à faire en vol non plus, on coupe donc tout le bloc au ventre.
    {'name': 'train avant',     'x0': 287, 'x1': 332, 'left_y': 124, 'right_y': 125},
]


def main(dry_run: bool = False) -> int:
    img = Image.open(ASSET).convert('RGBA')
    rgba = np.array(img)
    alpha = rgba[:, :, 3]
    before = int((alpha > 20).sum())

    # 1. Résidus détachés : on ne garde que la plus grosse composante connexe.
    labels, n = ndimage.label(alpha > 20)
    if n > 1:
        sizes = ndimage.sum(np.ones_like(labels), labels, range(1, n + 1))
        keep = int(np.argmax(sizes)) + 1
        stray = (labels != keep) & (labels != 0)
        print(f'  résidus supprimés : {n - 1} amas, {int(stray.sum())} px')
        alpha[stray] = 0

    # 2. Train rentré : coupe à la ligne du ventre.
    for g in GEAR:
        span = g['x1'] - g['x0']
        cut = 0
        for x in range(g['x0'], g['x1'] + 1):
            t = 0 if span == 0 else (x - g['x0']) / span
            belly = round(g['left_y'] + (g['right_y'] - g['left_y']) * t)
            cut += int((alpha[belly + 1:, x] > 20).sum())
            alpha[belly + 1:, x] = 0
        print(f"  {g['name']} : {cut} px retirés (x {g['x0']}→{g['x1']})")

    # 3. Éclat détaché au-dessus du capot (x 364→378, y 88→101) : bout de la
    #    pale supérieure, rongé par le détourage jusqu'à ne plus tenir à
    #    l'avion que par deux pixels. Sur fond de ciel il se lit comme un
    #    rectangle blanc flottant devant le nez — c'est le défaut signalé.
    #    L'hélice en vol est de toute façon dessinée par l'overlay animé.
    blade = (slice(88, 102), slice(364, 379))
    print(f'  éclat de pale supprimé : {int((alpha[blade] > 20).sum())} px')
    alpha[blade] = 0

    rgba[:, :, 3] = alpha
    # Les pixels devenus transparents gardent leur couleur : on les noircit pour
    # qu'aucun halo clair ne réapparaisse si un rendu ignore l'alpha.
    rgba[alpha == 0] = 0

    ys = np.where(alpha.max(axis=1) > 20)[0]
    print(f'  {before} px → {int((alpha > 20).sum())} px, bas de l\'avion : y={ys.max()}')

    if dry_run:
        print('  (dry-run : rien écrit)')
        return 0
    Image.fromarray(rgba, 'RGBA').save(ASSET, 'PNG', optimize=True)
    print(f'  ✓ {ASSET.name} réécrit ({img.width}x{img.height}, toile inchangée)')
    return 0


if __name__ == '__main__':
    sys.exit(main('--dry-run' in sys.argv))
