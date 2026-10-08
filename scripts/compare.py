#!/usr/bin/env python3
"""
Pixel comparison between Figma exports and browser screenshots (requires Pillow).

  compare.py trim   <dir> <width>[,<width>...]     crop the uniform margin around exported frames
  compare.py report --config qa.config.json [--pages a,b] [--widths 390,1440]
                    → table (height Δ, diff %, box Δ) + <out>-compare/<page>/<width>.png
                      (design | live | red = differs)
  compare.py bands  <design.png> <live.png> <x0> <x1> [y0 y1 [live_y0]]
                    → every horizontal band of "ink" (text lines, boxes) side by side with Δy;
                      the first row whose Δ changes is where the bug is
  compare.py boxes  <design.png> <live.png> [x]     → top/height of every card along column x
  compare.py zoom   <design.png> <live.png> x y w h [scale] [live_y]
                    → stacked crop (design / live / inverted diff) to qa-zoom.png
  compare.py color  <png> x y                       → exact pixel colour (hex)
"""
import json, os, sys
from collections import Counter
from PIL import Image, ImageChops


def load(p):
    return Image.open(p).convert("RGB")


def bg_of(im):
    """Page background = most common colour of the left edge column."""
    col = [im.getpixel((1, y)) for y in range(0, im.height, 3)]
    return Counter(col).most_common(1)[0][0]


# ---------------------------------------------------------------- trim
def trim(directory, widths):
    widths = [int(w) for w in widths.split(",")]
    for root, _, files in os.walk(directory):
        for f in files:
            if not f.endswith(".png"):
                continue
            p = os.path.join(root, f)
            im = load(p)
            if im.width in widths:
                continue
            bg = im.getpixel((2, 2))
            diff = ImageChops.difference(im, Image.new("RGB", im.size, bg)).convert("L").point(lambda v: 255 if v > 6 else 0)
            box = diff.getbbox()
            if box:
                im.crop(box).save(p)
                print(f"{p}: {im.size} → {im.crop(box).size}")


# ---------------------------------------------------------------- report
def boxes(im, x):
    """Vertical runs along column x that are not the page background (= cards/sections)."""
    bg = bg_of(im)
    px = im.load()
    out, start = [], None
    for y in range(im.height):
        on = px[x, y] != bg
        if on and start is None:
            start = y
        if not on and start is not None:
            if y - start > 20:
                out.append((start, y))
            start = None
    if start is not None:
        out.append((start, im.height))
    return out


def report(argv):
    args = dict(zip(argv[::2], argv[1::2]))
    cfg_path = os.path.abspath(args.get("--config", "qa.config.json"))
    cfg = json.load(open(cfg_path))
    base = os.path.dirname(cfg_path)
    out = os.path.join(base, cfg.get("out", "qa/shots"))
    design_tpl = os.path.join(base, cfg.get("design", "qa/design/{page}/{width}.png"))
    widths = [int(w) for w in args.get("--widths", ",".join(map(str, cfg.get("widths", [390, 768, 1024, 1440, 1920])))).split(",")]
    only = args.get("--pages", "").split(",") if "--pages" in args else None
    cmp_dir = out + "-compare"
    print(f"{'page':24} {'width':>5} {'design h':>8} {'live h':>7} {'Δh':>6} {'diff%':>6} {'boxes':>7} {'max box Δ':>9}")
    for page in cfg["pages"]:
        name = page["name"]
        if only and name not in only:
            continue
        for w in widths:
            dp = design_tpl.format(page=name, width=w)
            lp = os.path.join(out, name, f"{w}.png")
            if not (os.path.exists(dp) and os.path.exists(lp)):
                print(f"{name:24} {w:>5}  (missing {'design' if not os.path.exists(dp) else 'screenshot'})")
                continue
            d, l = load(dp), load(lp)
            h = min(d.height, l.height)
            diff = ImageChops.difference(d.crop((0, 0, w, h)), l.crop((0, 0, w, h)))
            mask = diff.convert("L").point(lambda v: 255 if v > 24 else 0)
            ratio = mask.histogram()[255] / (w * h)
            bd, bl = boxes(d, w // 2), boxes(l, w // 2)
            n = min(len(bd), len(bl))
            worst = max([abs((bl[i][1] - bl[i][0]) - (bd[i][1] - bd[i][0])) for i in range(n)] + [abs(bl[i][0] - bd[i][0]) for i in range(n)] + [0])
            print(f"{name:24} {w:>5} {d.height:>8} {l.height:>7} {l.height - d.height:>+6} {ratio * 100:>5.1f}% {len(bd):>3}/{len(bl):<3} {worst:>9}")
            canvas = Image.new("RGB", (w * 3 + 40, max(d.height, l.height)), (255, 0, 255))
            canvas.paste(d, (0, 0))
            canvas.paste(l, (w + 20, 0))
            ghost = Image.blend(d.crop((0, 0, w, h)), Image.new("RGB", (w, h), (255, 255, 255)), 0.6)
            ghost.paste((255, 0, 0), mask=mask)
            canvas.paste(ghost, (2 * w + 40, 0))
            os.makedirs(os.path.join(cmp_dir, name), exist_ok=True)
            canvas.save(os.path.join(cmp_dir, name, f"{w}.png"))
    print(f"\nside-by-side images → {os.path.relpath(cmp_dir)}")


# ---------------------------------------------------------------- bands
def ink_bands(im, x0, x1, y0, y1):
    px = im.load()
    y1 = min(y1, im.height)
    out, cur = [], None
    for y in range(y0, y1):
        row = [px[x, y] for x in range(x0, x1)]
        bg = Counter(row).most_common(1)[0][0]
        ink = any(sum(abs(a - b) for a, b in zip(c, bg)) > 60 for c in row)
        if ink and cur is None:
            cur = y
        if not ink and cur is not None:
            out.append((cur, y))
            cur = None
    if cur is not None:
        out.append((cur, y1))
    return out


def bands(dp, lp, x0, x1, y0=0, y1=100000, ly0=None):
    x0, x1, y0, y1 = int(x0), int(x1), int(y0), int(y1)
    ly0 = int(ly0) if ly0 is not None else y0
    d = ink_bands(load(dp), x0, x1, y0, y1)
    l = ink_bands(load(lp), x0, x1, ly0, ly0 + (y1 - y0))
    print(f"{'design':>15} {'h':>4} {'gap':>4} | {'live':>15} {'h':>4} {'gap':>4} | Δy")
    pd = pl = None
    for i in range(max(len(d), len(l))):
        a = d[i] if i < len(d) else None
        b = l[i] if i < len(l) else None
        s = f"{a[0]:>7}-{a[1]:<7} {a[1]-a[0]:>4} {'' if pd is None else a[0]-pd:>4} | " if a else " " * 26 + "| "
        s += f"{b[0]:>7}-{b[1]:<7} {b[1]-b[0]:>4} {'' if pl is None else b[0]-pl:>4} | " if b else " " * 26 + "| "
        if a and b:
            s += f"{(b[0] - ly0) - (a[0] - y0):+d}"
        print(s)
        pd = a[1] if a else pd
        pl = b[1] if b else pl


def boxes_cmd(dp, lp, x=None):
    d, l = load(dp), load(lp)
    x = int(x) if x else d.width // 2
    bd, bl = boxes(d, x), boxes(l, x)
    for i in range(max(len(bd), len(bl))):
        a = bd[i] if i < len(bd) else None
        b = bl[i] if i < len(bl) else None
        line = f"{str(a):>14} h{(a[1]-a[0]) if a else '':>5} | {str(b):>14} h{(b[1]-b[0]) if b else '':>5}"
        if a and b:
            line += f" | Δtop {b[0]-a[0]:+d} Δh {(b[1]-b[0])-(a[1]-a[0]):+d}"
        print(line)


def zoom(dp, lp, x, y, w, h, scale=2, ly=None):
    x, y, w, h = map(int, (x, y, w, h))
    scale = float(scale)
    ly = int(ly) if ly is not None else y
    d = load(dp).crop((x, y, x + w, y + h))
    l = load(lp).crop((x, ly, x + w, ly + h))
    c = Image.new("RGB", (w, h * 3 + 8), (255, 0, 255))
    c.paste(d, (0, 0))
    c.paste(l, (0, h + 4))
    c.paste(ImageChops.invert(ImageChops.difference(d, l)), (0, 2 * h + 8))
    c = c.resize((int(w * scale), int((h * 3 + 8) * scale)), Image.NEAREST)
    c.save("qa-zoom.png")
    print("qa-zoom.png", c.size)


def color(p, x, y):
    r, g, b = load(p).getpixel((int(x), int(y)))
    print(f"#{r:02X}{g:02X}{b:02X}  rgb({r},{g},{b})")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(0)
    cmd, rest = sys.argv[1], sys.argv[2:]
    {"trim": lambda: trim(*rest), "report": lambda: report(rest), "bands": lambda: bands(*rest),
     "boxes": lambda: boxes_cmd(*rest), "zoom": lambda: zoom(*rest), "color": lambda: color(*rest)}.get(
        cmd, lambda: print(__doc__))()
