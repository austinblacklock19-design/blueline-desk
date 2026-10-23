#!/usr/bin/env python3
"""Draw the Blueline Desk app icons into web/icons/.

The mark is the site's favicon grown up: a white center-ice circle on the dark ink color, with the red
center line, the two blue lines and the blue center faceoff circle. Drawn at 4x and scaled down for
smooth edges.

    pip install pillow
    python3 scripts/make-icons.py
"""
import os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'web', 'icons')
INK, ICE, RED, BLUE = (13, 24, 36, 255), (244, 247, 250, 255), (200, 36, 58, 255), (23, 58, 158, 255)
SS = 4  # supersampling


def mark(size, rounded, r=176):
    """r: radius of the ice circle on a 512 canvas. Maskable icons use a smaller one so it stays inside the
    central 80% circle that Android never crops."""
    n = size * SS
    u = n / 512  # design units: a 512 x 512 canvas
    k = r / 150  # the rink markings scale with the circle
    img = Image.new('RGBA', (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if rounded:
        d.rounded_rectangle((0, 0, n - 1, n - 1), radius=round(112 * u), fill=INK)
    else:
        d.rectangle((0, 0, n, n), fill=INK)
    disc = Image.new('RGBA', (n, n), ICE)
    dd = ImageDraw.Draw(disc)
    c = 256 * u
    dd.rectangle((c - 13 * k * u, 0, c + 13 * k * u, n), fill=RED)  # center red line
    for side in (-1, 1):  # the blue lines
        x = c + side * 100 * k * u
        dd.rectangle((x - 11 * k * u, 0, x + 11 * k * u, n), fill=BLUE)
    fr = 62 * k * u
    dd.ellipse((c - fr, c - fr, c + fr, c + fr), outline=BLUE, width=round(10 * k * u))  # faceoff circle
    dr = 12 * k * u
    dd.ellipse((c - dr, c - dr, c + dr, c + dr), fill=BLUE)  # center dot
    mask = Image.new('L', (n, n), 0)
    ImageDraw.Draw(mask).ellipse((c - r * u, c - r * u, c + r * u, c + r * u), fill=255)
    img.paste(disc, (0, 0), mask)
    return img.resize((size, size), Image.LANCZOS)


def main():
    os.makedirs(OUT, exist_ok=True)
    mark(192, True).save(os.path.join(OUT, 'icon-192.png'), optimize=True)
    mark(512, True).save(os.path.join(OUT, 'icon-512.png'), optimize=True)
    mark(512, False, r=160).save(os.path.join(OUT, 'maskable-512.png'), optimize=True)  # Android crops it to its own shape
    mark(180, False).convert('RGB').save(os.path.join(OUT, 'apple-touch-icon.png'), optimize=True)  # iOS rounds the corners itself
    mark(32, True, r=200).save(os.path.join(OUT, 'favicon-32.png'), optimize=True)
    print('icons written to', OUT)


if __name__ == '__main__':
    main()
