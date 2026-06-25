#!/usr/bin/env python3
"""Regenerate every launcher/splash/favicon/PWA/desktop asset from one logo.

Usage:
    python3 apps/mobile/scripts/gen-icons.py [SOURCE_LOGO]

SOURCE_LOGO defaults to the canonical apps/mobile/assets/images/logo.png. Pass a
freshly-dropped raw logo to re-base everything onto a new mark; the script
alpha-bleeds it (see the dirty-alpha note below), crops to the visible mark, and
fans it out to all tracked, path-stable PNG assets — so no config/code edits are
needed (app.json, manifest.webmanifest, index.html, electron-builder.yml all
reference these by path).

Dirty-alpha gotcha: exported logos can be genuinely transparent (corner alpha=0)
yet carry a dark leftover RGB matte under those transparent pixels, which seeds
dark halos on downscale. Fix = alpha-bleed: fill each transparent pixel's RGB
from the nearest opaque pixel, leaving alpha untouched.

Native icons (ios/android) regenerate from app.json on `expo prebuild --clean`
/ EAS build; desktop .icns/.ico regenerate from build/icon*.png on an electron
rebuild. This script only writes the committed source PNGs.
"""
import sys, os
from PIL import Image, ImageDraw, ImageFilter
import numpy as np
from scipy import ndimage

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..'))      # apps/mobile
IMAGES = os.path.join(ROOT, 'assets', 'images')
PUBLIC = os.path.join(ROOT, 'public')
DESKTOP = os.path.normpath(os.path.join(ROOT, '..', 'desktop'))

BG = (230, 244, 254)            # #E6F4FE marine paper background
DARK = (11, 21, 28)            # #0b151c (unused fill ref)

SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(IMAGES, 'logo.png')


def alpha_bleed(im):
    """Fill RGB of transparent pixels from nearest opaque pixel; keep alpha."""
    a = np.array(im.convert('RGBA'))
    alpha = a[:, :, 3]
    opaque = alpha > 0
    if opaque.all() or not opaque.any():
        return im
    # nearest opaque index for every pixel
    idx = ndimage.distance_transform_edt(~opaque, return_distances=False,
                                         return_indices=True)
    bled = a.copy()
    for c in range(3):
        bled[:, :, c] = a[idx[0], idx[1], c]
    bled[:, :, 3] = alpha
    return Image.fromarray(bled, 'RGBA')


def crop_to_content(im, thresh=16):
    a = np.array(im.convert('RGBA'))
    ys, xs = np.where(a[:, :, 3] > thresh)
    return im.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))


def place(mark, size, frac, bg=None, radius_frac=None, margin_frac=0.0):
    """Center `mark` (scaled so its longest side = frac*size) on a `size` canvas.

    bg=None -> transparent canvas. bg=(r,g,b) -> opaque fill, OR if radius_frac
    is set, a rounded-rect (squircle) of that color inset by margin_frac.
    """
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    if bg is not None:
        if radius_frac is None:
            canvas = Image.new('RGBA', (size, size), bg + (255,))
        else:
            m = int(size * margin_frac)
            tile = Image.new('RGBA', (size, size), (0, 0, 0, 0))
            d = ImageDraw.Draw(tile)
            d.rounded_rectangle([m, m, size - 1 - m, size - 1 - m],
                                radius=int(size * radius_frac), fill=bg + (255,))
            canvas = Image.alpha_composite(canvas, tile)
    w, h = mark.size
    s = (frac * size) / max(w, h)
    nw, nh = max(1, round(w * s)), max(1, round(h * s))
    scaled = mark.resize((nw, nh), Image.LANCZOS)
    canvas.alpha_composite(scaled, ((size - nw) // 2, (size - nh) // 2))
    return canvas


def monochrome(mark, size, frac, thresh=24):
    """White silhouette from the mark's alpha, centered on a transparent canvas."""
    a = np.array(mark.convert('RGBA'))
    sil = np.zeros_like(a)
    on = a[:, :, 3] > thresh
    sil[on] = [255, 255, 255, 255]
    return place(Image.fromarray(sil, 'RGBA'), size, frac)


def save(im, path, mode='RGBA'):
    if mode == 'RGB':
        bg = Image.new('RGB', im.size, BG)
        bg.paste(im, mask=im.split()[3] if im.mode == 'RGBA' else None)
        im = bg
    im.save(path)
    print(f'  wrote {os.path.relpath(path, ROOT)}  {im.size} {im.mode}')


print(f'source: {os.path.relpath(SRC, ROOT)}')
raw = alpha_bleed(Image.open(SRC).convert('RGBA'))
mark = crop_to_content(raw)
print(f'mark bbox -> {mark.size} ({mark.size[0]/mark.size[1]:.2f}:1)')

# --- canonical source ---
save(place(mark, 1024, 0.94), os.path.join(IMAGES, 'logo.png'))

# --- mobile launcher / splash / favicon (apps/mobile/assets/images) ---
save(place(mark, 1024, 0.86, bg=BG), os.path.join(IMAGES, 'icon.png'), 'RGB')
# splash-icon.png was removed — app.json splash points to logo.png, not splash-icon
save(place(mark, 256, 0.92), os.path.join(IMAGES, 'favicon.png'))
save(place(mark, 512, 0.60), os.path.join(IMAGES, 'android-icon-foreground.png'))
save(Image.new('RGBA', (512, 512), BG + (255,)),
     os.path.join(IMAGES, 'android-icon-background.png'), 'RGB')
save(monochrome(mark, 432, 0.60), os.path.join(IMAGES, 'android-icon-monochrome.png'))

# --- PWA (apps/mobile/public) ---
save(place(mark, 180, 0.86, bg=BG), os.path.join(PUBLIC, 'apple-touch-icon.png'), 'RGB')
save(place(mark, 192, 0.86, bg=BG), os.path.join(PUBLIC, 'icons', 'icon-192.png'))
save(place(mark, 512, 0.86, bg=BG), os.path.join(PUBLIC, 'icons', 'icon-512.png'))
save(place(mark, 192, 0.60, bg=BG), os.path.join(PUBLIC, 'icons', 'maskable-192.png'))
save(place(mark, 512, 0.60, bg=BG), os.path.join(PUBLIC, 'icons', 'maskable-512.png'))

# --- desktop (apps/desktop) ---
save(place(mark, 1024, 0.86, bg=BG), os.path.join(DESKTOP, 'build', 'icon.png'), 'RGB')
save(place(mark, 1024, 0.64, bg=BG, radius_frac=0.225, margin_frac=0.098),
     os.path.join(DESKTOP, 'build', 'icon-mac.png'))
save(place(mark, 1024, 0.86, bg=BG), os.path.join(DESKTOP, 'assets', 'tray.png'), 'RGB')

print('done.')
