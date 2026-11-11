#!/usr/bin/env python3
"""Trim a dialog screenshot (PNG or GIF) to the dialog window's edge.

Finds the dialog's 1 px border, crops to it and makes the rounded corners
transparent, so the docs stage shows through and nothing of Live is left
around the dialog.

    python3 scripts/trim-shot.py captures/palette.png docs/assets/images/palette.png
    python3 scripts/trim-shot.py docs/assets/images/error.png          # in place
    python3 scripts/trim-shot.py --radius 20 in.gif out.gif

For a GIF the border is found on the first frame and every frame gets the
same crop and one shared palette (keeps the file small). Needs Pillow (`pip install Pillow`).
"""
import argparse
import sys

from PIL import Image, ImageDraw

SEARCH = 40      # how far from each image edge the border may sit (px)
FLAT = 4         # how much a pixel may differ and still count as dialog fill
RUN = 10         # how many flat pixels in a row mark the dialog's inside


def lum(px):
    return px[0] + px[1] + px[2]


def edge(line):
    """Index of the border in a pixel line that runs from outside to inside.

    The border is a bright 1 px line (a local peak) with flat dialog fill right
    behind it. Slivers of Live outside the dialog are not followed by flat fill.
    """
    v = [lum(p) for p in line]
    for i in range(0, min(SEARCH, len(v) - RUN - 4)):
        if (i and v[i] < v[i - 1]) or v[i] < v[i + 1]:
            continue
        flat = v[i + 3:i + 3 + RUN]
        if max(flat) - min(flat) > FLAT * 3:
            continue
        if v[i] - flat[0] < 20:
            continue
        return i
    return None


def vote(found, total):
    """The outermost index that at least half of the sampled lines agree on."""
    counts = {}
    for i in found:
        counts[i] = counts.get(i, 0) + 1
    ok = [i for i, c in counts.items() if c * 2 >= total]
    if ok:
        return min(ok)
    return max(counts, key=counts.get) if counts else 0


def find_box(frames):
    """Dialog box (l, t, r, b) from one or more frames: 5 rows and 5 columns
    over the middle 60 % of each frame vote on every side."""
    sides = ([], [], [], [])
    n = 0
    for im in frames:
        im = im.convert("RGB")
        w, h = im.size
        for k in range(5):
            y = int(h * (0.2 + 0.6 * k / 4))
            x = int(w * (0.2 + 0.6 * k / 4))
            row = [im.getpixel((i, y)) for i in range(w)]
            col = [im.getpixel((x, j)) for j in range(h)]
            for side, line in zip(sides, (row, col, row[::-1], col[::-1])):
                e = edge(line)
                if e is not None:
                    side.append(e)
            n += 1
    l, t, r, b = (vote(side, n) for side in sides)
    return l, t, w - r, h - b


def corner_mask(size, radius):
    s = 4
    big = Image.new("L", (size[0] * s, size[1] * s), 0)
    ImageDraw.Draw(big).rounded_rectangle(
        (0, 0, size[0] * s - 1, size[1] * s - 1), radius * s, fill=255)
    return big.resize(size, Image.LANCZOS)


def trim_png(src, dst, radius, box=None):
    im = Image.open(src).convert("RGBA")
    box = box or find_box([im])
    out = im.crop(box)
    alpha = corner_mask(out.size, radius)
    out.putalpha(alpha)
    out.save(dst, optimize=True)
    return im.size, out.size, box


def trim_gif(src, dst, radius, box=None):
    g = Image.open(src)
    n = g.n_frames
    rgba, durations = [], []
    for i in range(n):
        g.seek(i)
        rgba.append(g.convert("RGBA"))
        durations.append(g.info.get("duration", 100))
    if box is None:
        pick = sorted({0, n // 4, n // 2, 3 * n // 4, n - 1})
        box = find_box([rgba[i] for i in pick])
    size = (box[2] - box[0], box[3] - box[1])
    mask = corner_mask(size, radius).point(lambda v: 255 if v >= 128 else 0)  # GIF: 1-bit alpha
    frames = []
    for f in rgba:
        c = f.crop(box).convert("RGB")
        frames.append(c)
    # one palette for all frames (a montage of a few of them), so Pillow can
    # store only the changed area of each frame and the file stays small
    pick = sorted({0, n // 4, n // 2, 3 * n // 4, n - 1})
    montage = Image.new("RGB", (size[0], size[1] * len(pick)))
    for k, i in enumerate(pick):
        montage.paste(frames[i], (0, size[1] * k))
    pal = montage.quantize(255, dither=Image.NONE)
    out = []
    for c in frames:
        p = c.quantize(palette=pal, dither=Image.NONE)
        p.paste(255, mask=mask.point(lambda v: 255 - v))   # index 255 = transparent
        out.append(p)
    pl = (pal.getpalette() or [])[:765]
    for p in out:
        p.putpalette(pl + [0] * (768 - len(pl)))
    out[0].save(dst, save_all=True, append_images=out[1:], duration=durations,
                loop=g.info.get("loop", 0), transparency=255, disposal=1,
                optimize=True)
    return g.size, size, box


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("src")
    ap.add_argument("dst", nargs="?", help="default: overwrite src")
    ap.add_argument("--box", help="l,t,r,b in source pixels; skips border detection")
    ap.add_argument("--radius", type=int, default=18, help="corner radius in px (default 18)")
    a = ap.parse_args()
    dst = a.dst or a.src
    fn = trim_gif if a.src.lower().endswith(".gif") else trim_png
    box = tuple(int(v) for v in a.box.split(",")) if a.box else None
    before, after, box = fn(a.src, dst, a.radius, box)
    print(f"{a.src}: {before[0]}x{before[1]} -> {after[0]}x{after[1]}, box l,t,r,b = {','.join(map(str, box))}")
    print("Check the edges of the result before you use it.")


if __name__ == "__main__":
    sys.exit(main())
