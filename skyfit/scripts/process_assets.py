#!/usr/bin/env python3
"""
SkyFit — Traitement des images d'avions.

Pour chaque image source :
1. Détecte la couleur du fond (médiane des pixels du bord)
2. Supprime le fond : composantes connexes proches de la couleur du fond
   ET touchant le bord de l'image (le blanc de l'avion est préservé)
3. Recadre autour de l'avion
4. Retourne l'image horizontalement si demandé (nez vers la droite)
5. Redimensionne et exporte en PNG transparent dans assets/planes/

Usage :
    pip install pillow numpy scipy --break-system-packages
    python3 scripts/process_assets.py <dossier_sources>
"""

import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

OUT_DIR = Path(__file__).resolve().parent.parent / 'assets' / 'planes'
MAX_WIDTH = 900
FLIP = True  # les sources regardent à gauche -> on retourne vers la droite

# Tolérance par type de fond : les fonds saturés (bleu) peuvent être
# larges, les fonds blancs doivent être stricts pour préserver le fuselage.
TOL_COLORED = 60
TOL_WHITE = 14


def background_color(rgb: np.ndarray) -> np.ndarray:
    """Couleur médiane du bord de l'image."""
    border = np.concatenate([
        rgb[0, :], rgb[-1, :], rgb[:, 0], rgb[:, -1],
    ])
    return np.median(border, axis=0)


def remove_background(img: Image.Image) -> Image.Image:
    rgba = np.array(img.convert('RGBA'))
    rgb = rgba[:, :, :3].astype(np.int16)
    h, w = rgb.shape[:2]

    bg = background_color(rgb)
    is_whiteish = bg.min() > 220
    tol = TOL_WHITE if is_whiteish else TOL_COLORED

    # Pixels proches de la couleur du fond
    dist = np.abs(rgb - bg).max(axis=2)
    near_bg = dist <= tol

    # Composantes connexes de pixels "fond" qui touchent le bord
    labels, _ = ndimage.label(near_bg)
    border_labels = np.unique(np.concatenate([
        labels[0, :], labels[-1, :], labels[:, 0], labels[:, -1],
    ]))
    border_labels = border_labels[border_labels != 0]
    bg_mask = np.isin(labels, border_labels)

    # Adoucissement du bord : les pixels adjacents au fond deviennent
    # semi-transparents proportionnellement à leur proximité du fond
    edge = ndimage.binary_dilation(bg_mask, iterations=1) & ~bg_mask
    alpha = rgba[:, :, 3].astype(np.float32)
    alpha[bg_mask] = 0
    edge_dist = np.clip(dist[edge] / max(tol * 2.5, 1), 0, 1)
    alpha[edge] = alpha[edge] * edge_dist

    rgba[:, :, 3] = alpha.astype(np.uint8)
    return Image.fromarray(rgba, 'RGBA')


def process(path: Path) -> None:
    img = Image.open(path)
    img = remove_background(img)

    bbox = img.getchannel('A').getbbox()
    if bbox:
        img = img.crop(bbox)

    if FLIP:
        img = img.transpose(Image.FLIP_LEFT_RIGHT)

    if img.width > MAX_WIDTH:
        ratio = MAX_WIDTH / img.width
        img = img.resize((MAX_WIDTH, round(img.height * ratio)), Image.LANCZOS)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out = OUT_DIR / (path.stem.lower() + '.png')
    img.save(out, 'PNG', optimize=True)
    print(f'  ✓ {path.name} -> {out.name} ({img.width}x{img.height})')


if __name__ == '__main__':
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('.')
    files = [p for p in sorted(src.iterdir())
             if p.suffix.lower() in ('.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp')]
    if not files:
        print(f'Aucune image trouvée dans {src}')
        sys.exit(1)
    print(f'{len(files)} image(s) à traiter :')
    for f in files:
        process(f)
