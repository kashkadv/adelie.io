"""Proxy room in REAL centimetres, drawn with the same pinhole camera as rectify_place.py: floor, back wall, a grey block
sofa (W x D x H) behind the product and the grey product slab. The model only 'dresses' these blocks (START=1 keeps the
layout), so the furniture cannot come out at another scale than the product - the size cue the prompt alone could not give.
Usage: scene_proxy.py cutout_canvas.png out.png
env (same as rectify_place.py): SIZE ROT ELEV ROOM_CM CANVAS CY; v2: CAM_H PITCH CAM_DIST FOV (eye-height camera),
ROOM_H (ceiling + baseboard), WINDOWS=x1,x2 (window centres on the back wall, cm) WIN_W WIN_SILL WIN_HEAD, SOFT (blur); LIGHT=evening (darker) / TONE; YAW (camera around, degrees); SOFA=220x90x80 (cm), GAP=30 (cm between product and sofa),
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
# CAM_H (v2, owner 2026-11-26: the old camera looked down from ~2.5 m - half the frame was empty floor): a camera at a
# person's eye height, CAM_DIST cm in front of the product's centre, tilted PITCH degrees down, FOV horizontal degrees.
if os.environ.get("CAM_H"):
    p_ = np.radians(float(os.environ.get("PITCH", 18)))
    C = np.array([0.0, -float(os.environ.get("CAM_DIST", 330)), float(os.environ["CAM_H"])])
    f = np.array([0.0, np.cos(p_), -np.sin(p_)])
    r = np.cross(f, [0, 0, 1.0]); r /= np.linalg.norm(r); u = np.cross(r, f)
    fpx = CW / 2 / np.tan(np.radians(float(os.environ.get("FOV", 62))) / 2)
    CY = float(os.environ.get("CY", 0.5))
# YAW: the camera walks around the product (degrees, + = from the right) - the "side" angle of a scene (ADR-0042)
YAW = np.radians(float(os.environ.get("YAW", 0))); cy_, sy_ = np.cos(YAW), np.sin(YAW)
def P(x, y, z):
    x, y = cy_ * x + sy_ * y, -sy_ * x + cy_ * y                         # the world turned instead of the camera
    d = np.array([x, y, z], float) - C
    depth = max(d @ f, 20.0)                                           # never behind the camera
    return (CW / 2 + fpx * d @ r / depth, CH * CY - fpx * d @ u / depth)

# product footprint after rotation: its depth (extent along y) decides where the sofa starts
c, s_ = np.cos(ROT), np.sin(ROT)
corners = np.array([[-sw / 2, -sh / 2], [sw / 2, -sh / 2], [sw / 2, sh / 2], [-sw / 2, sh / 2]]) @ np.array([[c, -s_], [s_, c]]).T
y_back = corners[:, 1].max()
y0 = y_back + GAP; y1 = y0 + SD; yw = y1 + WALLD                       # sofa front, sofa back, wall
# LIGHT=evening: a darker mock-up - the model takes the overall brightness from image 1, so words alone gave daylight
_k = float(os.environ.get("TONE", 0.55 if os.environ.get("LIGHT") == "evening" else 1.0))
tone = lambda c: tuple(int(v * _k) for v in c)
img = Image.new("RGB", (CW, CH), tone((214, 184, 146))); dr = ImageDraw.Draw(img)
# wall (a big vertical plane) and floor boards along x
y_near = C[1] + 80                                                     # floor lines only in front of the camera
for x in range(-1000, 1001, 20):
    dr.line([P(x, y_near, 0), P(x, yw, 0)], fill=tone((200, 170, 132)), width=1)
if YAW:   # turned camera: a room corner - the back wall plus the side wall it turns towards (no wall end in mid-air)
    xs = -float(os.environ.get("SIDE_WALL", 330)) * np.sign(YAW)
    dr.polygon([P(xs, -400, 0), P(xs, yw, 0), P(xs, yw, 600), P(xs, -400, 600)], fill=tone((226, 214, 196)))
    xa, xb = sorted((xs, 2000 * np.sign(YAW)))
    dr.polygon([P(xa, yw, 0), P(xb, yw, 0), P(xb, yw, 600), P(xa, yw, 600)], fill=tone((236, 226, 210)))
else:
    dr.polygon([P(-2000, yw, 0), P(2000, yw, 0), P(2000, yw, 600), P(-2000, yw, 600)], fill=tone((236, 226, 210)))
# v2 architecture: ceiling, baseboard and windows at real heights - without them the model put windows at any height
ROOM_H = float(os.environ.get("ROOM_H", 0))
if ROOM_H:
    dr.polygon([P(-2000, y_near, ROOM_H), P(2000, y_near, ROOM_H), P(2000, yw, ROOM_H), P(-2000, yw, ROOM_H)],
               fill=tone((242, 238, 230)))
    dr.polygon([P(-2000, yw, 0), P(2000, yw, 0), P(2000, yw, 10), P(-2000, yw, 10)], fill=tone((205, 198, 186)))
for wx in [float(v) for v in os.environ.get("WINDOWS", "").split(",") if v.strip()]:   # window centres on the back wall, cm
    WW, SILL, HEAD = float(os.environ.get("WIN_W", 110)), float(os.environ.get("WIN_SILL", 85)), float(os.environ.get("WIN_HEAD", 235))
    dr.polygon([P(wx - WW / 2 - 6, yw, SILL - 6), P(wx + WW / 2 + 6, yw, SILL - 6), P(wx + WW / 2 + 6, yw, HEAD + 6),
                P(wx - WW / 2 - 6, yw, HEAD + 6)], fill=tone((214, 208, 198)))
    dr.polygon([P(wx - WW / 2, yw, SILL), P(wx + WW / 2, yw, SILL), P(wx + WW / 2, yw, HEAD), P(wx - WW / 2, yw, HEAD)],
               fill=tone((250, 251, 252)))
    dr.line([P(wx, yw, SILL), P(wx, yw, HEAD)], fill=tone((214, 208, 198)), width=4)
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
# small side table beside the sofa arm (owner: the table goes beside the sofa, never on the rug); drawn after the sofa only
# when it is in front of it, so painter's order holds for this camera
ST = os.environ.get("SIDE_TABLE", "left"); STW, STH = 45.0, 50.0
if ST in ("left", "right"):
    sx0 = -SW / 2 - 12 - STW if ST == "left" else SW / 2 + 12
    # a table, not a cube: a solid block made the model draw a drum (2026-11-25) - top slab on four thin legs
    ya_, yb_ = y0 + 10, y0 + 10 + STW
    for lx_, ly_ in ((sx0 + 4, yb_ - 4), (sx0 + STW - 4, yb_ - 4), (sx0 + 4, ya_ + 4), (sx0 + STW - 4, ya_ + 4)):
        box(lx_ - 1.5, lx_ + 1.5, ly_ - 1.5, ly_ + 1.5, 0, STH - 4, 0.7)
    box(sx0, sx0 + STW, ya_, yb_, STH - 4, STH, 1.05)
for lx in (-SW / 2 + 8, SW / 2 - 8):                                    # legs
    dr.polygon([P(lx - 3, y0 + 5, 0), P(lx + 3, y0 + 5, 0), P(lx + 3, y0 + 5, 10), P(lx - 3, y0 + 5, 10)], fill=(90, 70, 50))
# SOFT (v2): blur the whole mock-up - only "a big soft thing here" is left, the model designs the furniture itself
# (sharp grey boxes came back as boxy furniture)
img = img.filter(ImageFilter.GaussianBlur(float(os.environ.get("SOFT", 0.6))))
# the product slab on top (exact silhouette from the placed cutout)
a = np.asarray(Image.open(cut_p).convert("RGBA").resize((CW, CH)).split()[3]) / 255.0
slab = (a > 0.5).astype(float) * (os.environ.get("SLAB", "1") == "1")   # SLAB=0: bare floor, no placeholder (owner's variant)
MATC = np.array([float(v) for v in os.environ.get("MAT_RGB", "%d,%d,%d" % (GREY, GREY, GREY)).split(",")])   # lime: owner, 2026-11-25
arr = np.asarray(img).astype(float); arr = arr * (1 - slab[..., None]) + MATC * slab[..., None]
# armchair on the side of the rug, at 90 degrees to the sofa, facing across the rug (owner, 2026-11-25). Drawn after the slab:
# it stands up next to the rug, so where they overlap in the picture the chair is in front.
AC = os.environ.get("ARMCHAIR", "left")
if AC in ("left", "right"):
    img = Image.fromarray(arr.clip(0, 255).astype(np.uint8)); dr = ImageDraw.Draw(img)
    rx = corners[:, 0].max(); AW, AD, AH, AG = 78.0, 75.0, 78.0, float(os.environ.get("ARM_GAP", 15))   # width (along y), depth (along x), height, gap
    sgn = -1 if AC == "left" else 1
    # beside the rug AND beyond the sofa end: a rug narrower than the sofa would put the chair in front of the sofa arm
    xin = max(rx + AG, SW / 2 + float(os.environ.get("ARM_SOFA_GAP", 15)))
    xi = sgn * xin; xo = sgn * (xin + AD)                               # inner (towards the rug) and outer x
    xa, xb = min(xi, xo), max(xi, xo); yc = float(os.environ.get("ARM_Y", 35)); ya, yb = yc - AW / 2, yc + AW / 2
    back = (xa, xa + 18) if AC == "left" else (xb - 18, xb)
    box(back[0], back[1], ya, yb, 10, AH, 1.05)                         # backrest on the outer side
    box(xa, xb, ya, yb, 10, 42, 1.15)                                   # seat
    box(xa, xb, ya, ya + 14, 10, 58, 1.0); box(xa, xb, yb - 14, yb, 10, 58, 1.0)   # arms
    img = img.filter(ImageFilter.GaussianBlur(float(os.environ.get("SOFT", 0))))
    arr = np.asarray(img).astype(float)
    print("proxy: armchair %s of the product, facing it" % AC)
Image.fromarray(arr.clip(0, 255).astype(np.uint8)).save(out_p)
sx = [P(x, y, z)[0] for x in (-SW / 2, SW / 2) for y in (y0, y1) for z in (0, SH)]
sy = [P(x, y, z)[1] for x in (-SW / 2, SW / 2) for y in (y0, y1) for z in (0, SH)]
open(os.path.splitext(out_p)[0] + "_sofa_box.txt", "w").write("%d,%d,%d,%d" % (min(sx), min(sy), max(sx), max(sy)))
print("proxy: sofa %gx%gx%g cm at %g cm behind the product, saved %s" % (SW, SD, SH, GAP, out_p))
