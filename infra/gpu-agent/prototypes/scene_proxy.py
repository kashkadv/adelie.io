"""Proxy room in REAL centimetres, drawn with the same pinhole camera as rectify_place.py: floor, back wall, a grey block
sofa (W x D x H) behind the product and the grey product slab. The model only 'dresses' these blocks (START=1 keeps the
layout), so the furniture cannot come out at another scale than the product - the size cue the prompt alone could not give.
Usage: scene_proxy.py cutout_canvas.png out.png
env (same as rectify_place.py): SIZE ROT ELEV ROOM_CM CANVAS CY; SOFA=220x90x80 (cm), GAP=30 (cm between product and sofa),
WALL=40 (cm between sofa and wall), GREY=150"""
import os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

cut_p, out_p = sys.argv[1:3]
sw, sh = map(float, os.environ.get("SIZE", "150x200").split("x"))
ROT = np.radians(float(os.environ.get("ROT", 0))); ELEV = np.radians(float(os.environ.get("ELEV", 60)))
ROOM = float(os.environ.get("ROOM_CM", 360)); CW, CH = map(int, os.environ.get("CANVAS", "1200x1800").split("x"))
CY = float(os.environ.get("CY", 0.66)); D = 450.0
SW, SD, SH = map(float, os.environ.get("SOFA", "220x90x80").split("x"))
GAP = float(os.environ.get("GAP", 30)); WALLD = float(os.environ.get("WALL", 40)); GREY = int(os.environ.get("GREY", 150))

C = np.array([0, -D * np.cos(ELEV), D * np.sin(ELEV)]); f = -C / np.linalg.norm(C)
r = np.cross(f, [0, 0, 1.0]); r /= np.linalg.norm(r); u = np.cross(r, f); fpx = CW * D / ROOM
def P(x, y, z):
    d = np.array([x, y, z], float) - C
    return (CW / 2 + fpx * d @ r / (d @ f), CH * CY - fpx * d @ u / (d @ f))

# product footprint after rotation: its depth (extent along y) decides where the sofa starts
c, s_ = np.cos(ROT), np.sin(ROT)
corners = np.array([[-sw / 2, -sh / 2], [sw / 2, -sh / 2], [sw / 2, sh / 2], [-sw / 2, sh / 2]]) @ np.array([[c, -s_], [s_, c]]).T
y_back = corners[:, 1].max()
y0 = y_back + GAP; y1 = y0 + SD; yw = y1 + WALLD                       # sofa front, sofa back, wall
img = Image.new("RGB", (CW, CH), (214, 184, 146)); dr = ImageDraw.Draw(img)
# wall (a big vertical plane) and floor boards along x
y_near = C[1] + 80                                                     # floor lines only in front of the camera
for x in range(-1000, 1001, 20):
    dr.line([P(x, y_near, 0), P(x, yw, 0)], fill=(200, 170, 132), width=1)
dr.polygon([P(-2000, yw, 0), P(2000, yw, 0), P(2000, yw, 600), P(-2000, yw, 600)], fill=(236, 226, 210))
# sofa: back block, seat block, two arms (flat-shaded faces, painter's order: back -> front)
def box(x0, x1, ya, yb, z0, z1, shade):
    top = [P(x0, ya, z1), P(x1, ya, z1), P(x1, yb, z1), P(x0, yb, z1)]
    front = [P(x0, ya, z0), P(x1, ya, z0), P(x1, ya, z1), P(x0, ya, z1)]
    left = [P(x0, ya, z0), P(x0, yb, z0), P(x0, yb, z1), P(x0, ya, z1)]
    right = [P(x1, ya, z0), P(x1, yb, z0), P(x1, yb, z1), P(x1, ya, z1)]
    g = lambda k: (int(GREY * k),) * 3
    for face, k in ((left, shade * 0.85), (right, shade * 0.85), (front, shade * 0.8), (top, shade)):
        dr.polygon(face, fill=g(k))
arm = 18
box(-SW / 2, SW / 2, y1 - 22, y1, 10, SH, 1.05)                         # back rest
box(-SW / 2 + arm, SW / 2 - arm, y0, y1 - 22, 10, 45, 1.15)             # seat
box(-SW / 2, -SW / 2 + arm, y0, y1, 10, 62, 1.0)                        # arms
box(SW / 2 - arm, SW / 2, y0, y1, 10, 62, 1.0)
for lx in (-SW / 2 + 8, SW / 2 - 8):                                    # legs
    dr.polygon([P(lx - 3, y0 + 5, 0), P(lx + 3, y0 + 5, 0), P(lx + 3, y0 + 5, 10), P(lx - 3, y0 + 5, 10)], fill=(90, 70, 50))
img = img.filter(ImageFilter.GaussianBlur(0.6))
# the product slab on top (exact silhouette from the placed cutout)
a = np.asarray(Image.open(cut_p).convert("RGBA").resize((CW, CH)).split()[3]) / 255.0
slab = (a > 0.5).astype(float)
arr = np.asarray(img).astype(float); arr = arr * (1 - slab[..., None]) + GREY * slab[..., None]
Image.fromarray(arr.clip(0, 255).astype(np.uint8)).save(out_p)
sx = [P(x, y, z)[0] for x in (-SW / 2, SW / 2) for y in (y0, y1) for z in (0, SH)]
sy = [P(x, y, z)[1] for x in (-SW / 2, SW / 2) for y in (y0, y1) for z in (0, SH)]
open(os.path.splitext(out_p)[0] + "_sofa_box.txt", "w").write("%d,%d,%d,%d" % (min(sx), min(sy), max(sx), max(sy)))
print("proxy: sofa %gx%gx%g cm at %g cm behind the product, saved %s" % (SW, SD, SH, GAP, out_p))
