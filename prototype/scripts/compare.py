# Side-by-side Figma (left) vs prototype (right) for each screen -> shots/compare/*.png, plus shots/grid.png
import sys, os
from PIL import Image, ImageDraw
F = "/workspace/gymbro-figma"; S = "shots"
names = ["1-profile", "2-today", "3-log", "3b-log-swipe", "plus-add-chooser", "4a-food-search", "4b-food-detail", "4c-quick-add", "5-weight-entry", "6-progress"]
os.makedirs(f"{S}/compare", exist_ok=True)
for n in names:
    a = Image.open(f"{F}/{n}.png").convert("RGB"); b = Image.open(f"{S}/{n}.png").convert("RGB").resize((393, 852), Image.LANCZOS)
    im = Image.new("RGB", (393 * 2 + 12, 852), (60, 60, 60)); im.paste(a, (0, 0)); im.paste(b, (405, 0)); im.save(f"{S}/compare/{n}.png")
# grid: 5 x 2 of the prototype shots, like the Figma grid
cols, pad, w, h = 5, 24, 393, 852
g = Image.new("RGB", (cols * w + (cols + 1) * pad, 2 * h + 3 * pad), (30, 30, 33))
for i, n in enumerate(names):
    im = Image.open(f"{S}/{n}.png").convert("RGB").resize((w, h), Image.LANCZOS)
    g.paste(im, (pad + (i % cols) * (w + pad), pad + (i // cols) * (h + pad)))
g.save(f"{S}/grid.png")
print("ok")

# New-feature/state grids (phone states, desktop + tablet)
import glob
def grid(files, out, w, h, cols, pad=24, label=True):
    rows = (len(files) + cols - 1) // cols
    g = Image.new("RGB", (cols * w + (cols + 1) * pad, rows * (h + 28) + (rows + 1) * pad), (30, 30, 33))
    d = ImageDraw.Draw(g)
    for i, f in enumerate(files):
        im = Image.open(f).convert("RGB"); im.thumbnail((w, h), Image.LANCZOS)
        x = pad + (i % cols) * (w + pad); y = pad + (i // cols) * (h + 28 + pad)
        g.paste(im, (x, y + 28))
        if label: d.text((x, y + 6), os.path.basename(f)[:-4], fill=(200, 200, 205))
    g.save(out)
grid([f for f in sorted(glob.glob(f"{S}/states/p*.png"))], f"{S}/states/grid-phone-states.png", 393, 852, 9)
grid([f for f in sorted(glob.glob(f"{S}/states/[dt]*.png")) if "grid" not in f] + [f for f in sorted(glob.glob(f"{S}/desktop/*.png")) if "grid" not in f], f"{S}/states/grid-desktop-tablet.png", 720, 720, 5)
print("grids ok")
# Specs batch (item 0, S1–S5, S7)
grid([f for f in sorted(glob.glob(f"{S}/specs/p*.png"))], f"{S}/specs/grid-phone-specs.png", 393, 852, 10)
grid([f for f in sorted(glob.glob(f"{S}/specs/[dt]*.png")) if "grid" not in f], f"{S}/specs/grid-desktop-tablet-specs.png", 720, 720, 5)
grid([f for f in sorted(glob.glob(f"{S}/a11y/*.png")) if "grid" not in f], f"{S}/a11y/grid-a11y.png", 600, 600, 6)
# Dynamic Type (decision 33): one grid per screen group, columns = default / xxxL / 2x / AX5 (+ scrolled ends)
dt = sorted(f for f in glob.glob(f"{S}/dynamic-type/*.png") if "grid" not in f and not os.path.basename(f).startswith("webkit-"))
grid([f for f in dt if not f.endswith("-end.png")], f"{S}/dynamic-type/grid-dynamic-type.png", 393, 852, 8)
grid([f for f in dt if f.endswith("-end.png")], f"{S}/dynamic-type/grid-dynamic-type-scrolled.png", 393, 852, 9)
wk = sorted(f for f in glob.glob(f"{S}/dynamic-type/webkit-*.png") if "grid" not in f and not f.endswith("-end.png"))
if wk: grid(wk, f"{S}/dynamic-type/grid-webkit.png", 393, 852, 8)
