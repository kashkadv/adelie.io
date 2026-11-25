"""Did the model keep the product where it was? Compares edges (gradients) of the original product and of the model frame
inside the product mask. A variant where the model moved / redrew the product gives a ghost after blending - it is rejected.
Prints the normalised correlation per variant (1 = identical structure). Usage: check_alignment.py cutout.png v1.png [v2 ...]"""
import sys
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

cut = Image.open(sys.argv[1]).convert("RGBA")
for p in sys.argv[2:]:
    im = Image.open(p).convert("L"); W, H = im.size
    c = cut.resize((W, H), Image.LANCZOS)
    a = np.asarray(c.split()[3]) > 200
    a = ndi.binary_erosion(a, iterations=max(2, W // 200))
    def grad(x):
        x = ndi.gaussian_filter(np.asarray(x).astype(float), 1.5)
        return np.hypot(ndi.sobel(x, 0), ndi.sobel(x, 1))
    g1, g2 = grad(c.convert("L"))[a], grad(im)[a]
    g1, g2 = (g1 - g1.mean()) / (g1.std() + 1e-6), (g2 - g2.mean()) / (g2.std() + 1e-6)
    print("%.3f  %s" % ((g1 * g2).mean(), p.split("/")[-1]))
