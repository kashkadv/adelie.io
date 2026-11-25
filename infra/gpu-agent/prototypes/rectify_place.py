"""Flat product (rug, spread blanket): real size + any rotation on the floor + a chosen camera, by plane geometry only.
  1. 4 corners of the product from its mask (convex hull reduced to the quadrilateral that loses the least area);
  2. the photo -> a top view of the product at its REAL size (size_cm), so proportions are right whatever the photo angle;
  3. the product is laid on a virtual floor, rotated by ROT degrees, seen by a pinhole camera at elevation ELEV degrees
     (90 = straight down); the frame width at the product's distance is ROOM_CM centimetres - this is the scale cue the model
     builds the room from (a 60x90 rug takes less of the frame than a 200x300 one).
For a plane this is exact. Limits: the pile and the light are those of the photo - keep the camera within ~20-30 degrees of
the photo's own view (a top-view photo should not be shown from eye level).
Usage: rectify_place.py photo.png cutout.png out_photo.png out_cut.png  (env: SIZE=150x200 ROT=0 ELEV=60 ROOM_CM=360
       CANVAS=1200x1800 CY=0.66)"""
import os, sys
import numpy as np
from PIL import Image
from scipy.spatial import ConvexHull

photo_p, cut_p, out_photo, out_cut = sys.argv[1:5]
sw, sh = map(float, os.environ.get("SIZE", "150x200").split("x"))
ROT = np.radians(float(os.environ.get("ROT", 0))); ELEV = np.radians(float(os.environ.get("ELEV", 60)))
ROOM = float(os.environ.get("ROOM_CM", 360)); CW, CH = map(int, os.environ.get("CANVAS", "1200x1800").split("x"))
CY = float(os.environ.get("CY", 0.66)); D = 450.0                     # camera distance, cm (only the perspective strength)

ph = Image.open(photo_p).convert("RGB"); cut = Image.open(cut_p).convert("RGBA").resize(ph.size, Image.LANCZOS)
a = np.asarray(cut.split()[3]) > 128
ys, xs = np.nonzero(a)
pts = np.stack([xs, ys], 1).astype(float)
hull = pts[ConvexHull(pts).vertices]

def area(p):
    x, y = p[:, 0], p[:, 1]
    return 0.5 * abs(np.dot(x, np.roll(y, 1)) - np.dot(y, np.roll(x, 1)))
quad = hull.copy()
while len(quad) > 4:                                                   # drop the vertex whose removal loses the least area
    losses = [area(quad) - area(np.delete(quad, i, 0)) for i in range(len(quad))]
    quad = np.delete(quad, int(np.argmin(losses)), 0)
c = quad.mean(0); ang = np.arctan2(quad[:, 1] - c[1], quad[:, 0] - c[0])
quad = quad[np.argsort(ang)]                                           # clockwise in image coords, starting at ~top-left
quad = np.roll(quad, -int(np.argmin(quad.sum(1))), 0)                  # TL, TR, BR, BL
side = lambda i, j: np.linalg.norm(quad[i] - quad[j])
horiz, vert = (side(0, 1) + side(3, 2)) / 2, (side(0, 3) + side(1, 2)) / 2
w_cm, h_cm = (max(sw, sh), min(sw, sh)) if horiz > vert else (min(sw, sh), max(sw, sh))
print("corners", quad.round().tolist(), "-> %gx%g cm" % (w_cm, h_cm))

def homography(src, dst):
    A = []
    for (x, y), (u, v) in zip(src, dst):
        A += [[x, y, 1, 0, 0, 0, -u * x, -u * y, -u], [0, 0, 0, x, y, 1, -v * x, -v * y, -v]]
    _, _, vt = np.linalg.svd(np.array(A)); return vt[-1].reshape(3, 3) / vt[-1][-1]

# product corners on the floor (cm), centred at the origin, y = away from the camera; then rotated on the floor
fl = np.array([[-w_cm / 2, h_cm / 2], [w_cm / 2, h_cm / 2], [w_cm / 2, -h_cm / 2], [-w_cm / 2, -h_cm / 2]])
R2 = np.array([[np.cos(ROT), -np.sin(ROT)], [np.sin(ROT), np.cos(ROT)]]); fl = fl @ R2.T
C = np.array([0, -D * np.cos(ELEV), D * np.sin(ELEV)]); f = -C / np.linalg.norm(C)
r = np.cross(f, [0, 0, 1.0]); r /= np.linalg.norm(r) if np.linalg.norm(r) > 1e-9 else 1; u = np.cross(r, f)
if np.linalg.norm(np.cross(f, [0, 0, 1.0])) < 1e-9: r, u = np.array([1.0, 0, 0]), np.array([0, 1.0, 0])
fpx = CW * D / ROOM
def project(x, y):
    d = np.array([x, y, 0.0]) - C
    return [CW / 2 + fpx * d @ r / (d @ f), CH * CY - fpx * d @ u / (d @ f)]
img_pts = np.array([project(x, y) for x, y in fl])
H = homography(quad, img_pts)                                          # photo -> output canvas, through the real-size plane
Hi = np.linalg.inv(H); Hi /= Hi[2, 2]
coef = tuple(Hi.flatten()[:8])
ph.transform((CW, CH), Image.PERSPECTIVE, coef, Image.BICUBIC, fillcolor=(200, 190, 175)).save(out_photo)
cut.transform((CW, CH), Image.PERSPECTIVE, coef, Image.BICUBIC).save(out_cut)
print("placed: product %.0f%% of the frame width, saved" % (100 * np.ptp(img_pts[:, 0]) / CW), out_photo, out_cut)
