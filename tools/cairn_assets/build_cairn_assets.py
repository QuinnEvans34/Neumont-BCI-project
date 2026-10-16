"""Build Cairn's scrapbook sprites from the reference photos.

Two stages:

1. ``--segment`` cuts each object out of its photo with Segment Anything (SAM ViT-H)
   using the hand-picked boxes below and caches soft masks next to the photos.
   Needs ``torch`` and ``transformers``; downloads ~2.5 GB of weights once.
2. Compose (always): level each stone so it rests on a stable face, deskew the plank,
   align the hand frames on the forearm, scale to world units and add a faceted
   white paper margin so every moving piece looks cut from a photo print.

    python tools/cairn_assets/build_cairn_assets.py --segment   # first run
    python tools/cairn_assets/build_cairn_assets.py             # re-compose only
    python tools/cairn_assets/build_cairn_assets.py --digits    # score digits only

The photos (images/dump) stay out of Git; the generated sprites and manifest in
apps/web/src/assets/cairn are committed. The score digits are cut from
images/paper_numbers.jpg, which needs no segmentation model.

An optional ``hand_thumbs_up.JPG`` in the photo folder (same spot and framing as
the other hand photos, thumb raised) becomes the hand's thumbs-up frame.
"""
import argparse
import json
import math
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageFilter, ImageOps

ROOT = Path(__file__).resolve().parents[2]
SCALE = 0.5  # world units per full-resolution photo pixel
BG_SCALE = 0.75  # background image pixels per photo pixel: finer than world units, for sharpness
BORDER = 7.0  # mean paper margin, output pixels
PAPER = np.array([251, 250, 246], np.float32)
HAND_FRAMES = ["hand_open_big", "hand_open_small", "hand_opening", "hand_closed"]
THUMBS_UP = "hand_thumbs_up"  # optional photo; made from hand_closed when absent
STONES = [f"rock{i}" for i in range(1, 10)]

# name: (photo, tight box [x0, y0, x1, y1] in full-resolution pixels, positive points)
OBJECTS = {
    "pivot": ("main_bg.JPG", [1760, 1830, 2225, 2170], []),
    "wood": ("wood_focus.JPG", [1185, 1475, 2585, 1795], []),
    "rock1": ("stacking_rocks1.JPG", [1050, 1695, 1640, 1990], []),
    "rock2": ("stacking_rocks1.JPG", [1725, 1690, 2025, 1850], []),
    "rock3": ("stacking_rocks1.JPG", [2165, 1650, 2505, 1820], []),
    "rock4": ("stacking_rocks1.JPG", [2672, 1576, 3055, 1780], []),
    "rock5": ("stacking_rocks1.JPG", [3076, 1541, 3503, 1750], []),
    "rock6": ("stacking_rocks2.JPG", [1392, 1516, 1775, 1695], []),
    "rock7": ("stacking_rocks2.JPG", [1930, 1526, 2343, 1705], []),
    "rock8": ("stacking_rocks2.JPG", [2359, 1466, 2811, 1655], []),
    "rock9": ("stacking_rocks2.JPG", [2852, 1401, 3209, 1581], []),
    **{
        f: (f"{f}.JPG", [1540, 0, 2990, 1790], [[2300, 1120], [2650, 400]])
        for f in HAND_FRAMES + [THUMBS_UP]
    },
}


def photo(photos, name):
    return ImageOps.exif_transpose(Image.open(photos / name)).convert("RGB")


def crop_box(size, box):
    w, h = size
    pad = int(max(box[2] - box[0], box[3] - box[1]) * 0.35)
    return [max(0, box[0] - pad), max(0, box[1] - pad), min(w, box[2] + pad), min(h, box[3] + pad)]


def segment(photos, masks):
    import torch
    from transformers import SamModel, SamProcessor

    model = SamModel.from_pretrained("facebook/sam-vit-huge").eval()
    proc = SamProcessor.from_pretrained("facebook/sam-vit-huge")
    masks.mkdir(parents=True, exist_ok=True)
    for name, (file, box, points) in OBJECTS.items():
        if not (photos / file).exists():
            continue  # the thumbs-up photo is optional
        img = photo(photos, file)
        c = crop_box(img.size, box)
        kwargs = dict(input_boxes=[[[box[0] - c[0], box[1] - c[1], box[2] - c[0], box[3] - c[1]]]],
                      return_tensors="pt")
        if points:
            kwargs["input_points"] = [[[[x - c[0], y - c[1]] for x, y in points]]]
            kwargs["input_labels"] = [[[1] * len(points)]]
        inputs = proc(img.crop(c), **kwargs)
        with torch.no_grad():
            out = model(**inputs, multimask_output=True)
        logits = proc.image_processor.post_process_masks(
            out.pred_masks, inputs["original_sizes"], inputs["reshaped_input_sizes"], binarize=False)[0][0]
        best = int(torch.argmax(out.iou_scores[0, 0]))
        prob = torch.sigmoid(logits[best]).numpy()
        Image.fromarray((prob * 255).astype(np.uint8)).save(masks / f"{name}.png")
        print(f"segmented {name}")


def load(photos, masks, name):
    file, box, _ = OBJECTS[name]
    img = photo(photos, file)
    c = crop_box(img.size, box)
    rgb = np.asarray(img.crop(c))
    prob = np.asarray(Image.open(masks / f"{name}.png")).astype(np.float32) / 255
    alpha = np.clip((prob - 0.35) / 0.3, 0, 1)
    n, lab, stats, _ = cv2.connectedComponentsWithStats((alpha > 0.5).astype(np.uint8))
    if n > 2:  # keep the main object only
        keep = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
        alpha = alpha * cv2.dilate((lab == keep).astype(np.uint8), np.ones((9, 9), np.uint8))
    return rgb, alpha, c


def rotate(rgb, alpha, deg):
    h, w = alpha.shape
    m = cv2.getRotationMatrix2D((w / 2, h / 2), deg, 1)
    c, s = abs(m[0, 0]), abs(m[0, 1])
    nw, nh = int(h * s + w * c) + 2, int(h * c + w * s) + 2
    m[0, 2] += nw / 2 - w / 2
    m[1, 2] += nh / 2 - h / 2
    return (cv2.warpAffine(rgb, m, (nw, nh), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE),
            cv2.warpAffine(alpha, m, (nw, nh), flags=cv2.INTER_LINEAR, borderValue=0))


def fold(deg):
    return deg - 180 if deg > 90 else deg + 180 if deg < -90 else deg


def resting_angle(alpha):
    """Rotation (degrees, OpenCV convention) that sets a stone on its most level stable face."""
    ys, xs = np.nonzero(alpha > 0.5)
    pts = np.stack([xs, ys], 1).astype(np.float32)
    centre = pts.mean(0)
    hull = cv2.convexHull(pts)[:, 0]
    best = None
    for i in range(len(hull)):
        a, b = hull[i], hull[(i + 1) % len(hull)]
        d = b - a
        length = float(np.hypot(*d))
        if length < 8:
            continue
        normal = np.array([d[1], -d[0]]) / length
        if ((a + b) / 2 - centre) @ normal < 0:
            normal = -normal
        t = ((centre - a) @ d) / length**2
        if normal[1] < 0.5 or not 0.15 < t < 0.85:
            continue  # only downward faces with the centroid above them are stable
        ang = fold(math.degrees(math.atan2(d[1], d[0])))
        score = abs(ang) - 0.02 * length
        if best is None or score < best[0]:
            best = (score, ang)
    return 0.0 if best is None else best[1]


def plank_angle(alpha):
    ys, xs = np.nonzero(alpha > 0.5)
    v = np.linalg.eigh(np.cov(np.stack([xs, ys])))[1][:, 1]
    return fold(math.degrees(math.atan2(v[1], v[0])))


def smooth_noise(rng, shape, scale, amp):
    n = rng.standard_normal((max(2, shape[0] // scale + 2), max(2, shape[1] // scale + 2))).astype(np.float32)
    n = cv2.GaussianBlur(cv2.resize(n, (shape[1], shape[0]), interpolation=cv2.INTER_CUBIC), (0, 0), scale / 3)
    return n / max(1e-6, np.abs(n).max()) * amp


def paper(rng, rgb, alpha, border=BORDER):
    """Composite the object onto a hand-cut paper margin. Returns RGBA uint8 and the added padding."""
    pad = int(border * 2 + 6)
    rgb = cv2.copyMakeBorder(rgb, pad, pad, pad, pad, cv2.BORDER_REPLICATE)
    alpha = cv2.copyMakeBorder(alpha, pad, pad, pad, pad, cv2.BORDER_CONSTANT, value=0)
    h, w = alpha.shape
    dist = cv2.distanceTransform(1 - (alpha > 0.4).astype(np.uint8), cv2.DIST_L2, 5)
    region = (dist <= border + smooth_noise(rng, (h, w), 40, border * 0.35)).astype(np.uint8)
    # Straight scissor facets, drawn at 4x for anti-aliasing.
    contours, _ = cv2.findContours(region, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    big = np.zeros((h * 4, w * 4), np.uint8)
    for c in contours:
        if cv2.contourArea(c) >= 50:
            poly = cv2.approxPolyDP(c, 1.6, True)
            cv2.fillPoly(big, [(poly * 4 + 2).astype(np.int32)], 255, lineType=cv2.LINE_AA)
    pa = np.maximum(cv2.resize(big, (w, h), interpolation=cv2.INTER_AREA).astype(np.float32) / 255, alpha)
    tex = smooth_noise(rng, (h, w), 3, 4) + smooth_noise(rng, (h, w), 18, 3)
    paper_rgb = np.clip(PAPER + tex[..., None], 0, 255)
    rim = np.clip((1 - cv2.GaussianBlur(pa, (0, 0), 1.0)) * 2.2, 0, 1) * (pa > 0.02)
    paper_rgb *= 1 - 0.16 * rim[..., None]
    a = alpha[..., None]
    out = paper_rgb * (1 - a) + rgb.astype(np.float32) * a
    return np.dstack([np.clip(out, 0, 255), pa * 255]).astype(np.uint8), pad


def trim(rgba, margin=2):
    ys, xs = np.nonzero(rgba[..., 3] > 3)
    y0, x0 = max(0, ys.min() - margin), max(0, xs.min() - margin)
    return rgba[y0:ys.max() + margin + 1, x0:xs.max() + margin + 1], (x0, y0)


def profiles(alpha, n=32):
    """Top and bottom opaque rows per column band, measured from the sprite's top edge."""
    h, w = alpha.shape
    top, bottom = [], []
    for i in range(n):
        x0 = int(i * w / n)
        ys = np.nonzero((alpha[:, x0:max(int((i + 1) * w / n), x0 + 1)] > 0.5).any(1))[0]
        top.append(int(ys.min()) if len(ys) else None)
        bottom.append(int(ys.max()) if len(ys) else None)
    return top, bottom


def resize(rgb, alpha):
    size = (int(alpha.shape[1] * SCALE), int(alpha.shape[0] * SCALE))
    return cv2.resize(rgb, size, interpolation=cv2.INTER_AREA), cv2.resize(alpha, size, interpolation=cv2.INTER_AREA)


def save(rgba, path):
    Image.fromarray(rgba).save(path, "WEBP", quality=88, method=6)


def fingertips(alpha):
    """Lowest points of the hand outline, left to right."""
    h, w = alpha.shape
    low = np.array([np.nonzero(alpha[:, x])[0].max() if alpha[:, x].any() else -1 for x in range(w)])
    tips = []
    for x in range(5, w - 5):
        if low[x] > h * 0.7 and low[x] == low[max(0, x - 25):x + 26].max():
            if not tips or x - tips[-1][0] > 30:
                tips.append([x, int(low[x])])
    return tips


def thumbs_up_from_fist(rgb, alpha):
    """Stand-in thumbs up from the closed hand (a fist, thumb down), until a real photo exists.

    Works on the aligned, cropped full-resolution frame. The thumb is cut from under the
    fist, turned over and tucked behind the fist's knuckles so it points up.
    """
    at = lambda sx, sy: (int((sx - 20) / SCALE), int(sy / SCALE))  # from hand sprite pixels
    rgb, alpha = rgb.copy(), alpha.copy()
    tx0, ty0 = at(244, 700)
    tx1, ty1 = at(318, 822)
    thumb_rgb = np.ascontiguousarray(rgb[ty0:ty1, tx0:tx1][::-1, ::-1])
    thumb_a = np.ascontiguousarray(alpha[ty0:ty1, tx0:tx1][::-1, ::-1])
    # Remove the thumb below the fist, with a soft cut so the fist keeps a rounded base.
    cx, cy = at(244, 742)
    yy, xx = np.mgrid[0:alpha.shape[0], 0:alpha.shape[1]]
    alpha *= 1 - np.clip(cv2.GaussianBlur(((yy > cy) & (xx > cx)).astype(np.float32), (0, 0), 6) * 1.6, 0, 1)
    # Set the turned thumb's root on top of the fist, leaning a little away from the arm.
    h, w = thumb_a.shape
    root = (w / 2, h * 0.92)
    bx, by = at(165, 610)
    m = cv2.getRotationMatrix2D(root, 10, 1.12)
    m[0, 2] += bx - root[0]
    m[1, 2] += by - root[1]
    size = (alpha.shape[1], alpha.shape[0])
    t_rgb = cv2.warpAffine(thumb_rgb, m, size, flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
    t_a = cv2.warpAffine(thumb_a, m, size, flags=cv2.INTER_LINEAR, borderValue=0)
    t_a *= np.clip((by - yy) / 60 + 0.5, 0, 1)
    a = alpha[..., None]
    out = np.where(((alpha > 0.02) | (t_a > 0.02))[..., None], rgb * a + t_rgb * (1 - a), rgb)
    return out.astype(np.uint8), np.maximum(alpha, t_a)


def boulder_edge(gray, pivot, step=40):
    """Top edge of the pale boulder in world units, sampled across the photo; fallen stones bounce on it."""
    h, w = gray.shape
    lo = int(pivot["tip"][1])
    points = []
    for x in range(0, w, step):
        if pivot["left"] - 10 <= x <= pivot["right"] + 10:
            continue  # the pivot rock is pale too
        col = cv2.GaussianBlur(gray[:, max(0, x - 3):x + 4], (0, 0), 2).mean(1)
        bright = np.nonzero(col[lo:] > 110)[0]
        run = [i for i in bright if (col[lo + i:lo + i + 12] > 110).all()]
        if run:
            points.append([x, lo + int(run[0])])
    return points


def pivot_overlay(rgb, alpha, crop, out, margin=24):
    """Full-resolution, lightly sharpened pivot rock laid over the half-resolution background.

    It is cut from the same photo, so a feathered edge reaching just past the rock blends
    into identical pixels underneath. Returns its world position and display scale.
    """
    ys, xs = np.nonzero(alpha > 0.05)
    y0, x0 = max(0, ys.min() - margin), max(0, xs.min() - margin)
    y1, x1 = min(alpha.shape[0], ys.max() + margin + 1), min(alpha.shape[1], xs.max() + margin + 1)
    rgb, alpha = rgb[y0:y1, x0:x1], alpha[y0:y1, x0:x1]
    solid = cv2.dilate((alpha > 0.5).astype(np.uint8), np.ones((9, 9), np.uint8))
    feather = cv2.GaussianBlur(solid.astype(np.float32), (0, 0), 3)
    sharp = Image.fromarray(rgb).filter(ImageFilter.UnsharpMask(radius=2, percent=60, threshold=3))
    rgba = np.dstack([np.asarray(sharp), (np.clip(feather, 0, 1) * 255).astype(np.uint8)])
    Image.fromarray(rgba).save(out / "pivot.webp", "WEBP", quality=92, method=6)
    return dict(x=(crop[0] + x0) * SCALE, y=(crop[1] + y0) * SCALE, scale=SCALE)


def compose(photos, masks, out):
    rng = np.random.default_rng(7)
    out.mkdir(parents=True, exist_ok=True)
    manifest = {"scale": SCALE, "border": BORDER}

    for name in ["wood"] + STONES:
        rgb, alpha, _ = load(photos, masks, name)
        ys, xs = np.nonzero(alpha > 0.05)
        y0, x0 = max(0, ys.min() - 30), max(0, xs.min() - 30)
        rgb, alpha = rgb[y0:ys.max() + 30, x0:xs.max() + 30], alpha[y0:ys.max() + 30, x0:xs.max() + 30]
        deg = plank_angle(alpha) if name == "wood" else resting_angle(alpha)
        rgb, alpha = resize(*rotate(rgb, alpha, deg))
        rgba, pad = paper(rng, rgb, alpha)
        rgba, (ox, oy) = trim(rgba)
        obj = cv2.copyMakeBorder(alpha, pad, pad, pad, pad, cv2.BORDER_CONSTANT, value=0)
        obj = obj[oy:oy + rgba.shape[0], ox:ox + rgba.shape[1]]
        top, bottom = profiles(obj)
        ys, xs = np.nonzero(obj > 0.5)
        save(rgba, out / f"{name}.webp")
        manifest[name] = dict(w=rgba.shape[1], h=rgba.shape[0],
                              object=[int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1],
                              top=top, bottom=bottom)
        print(f"{name}: {rgba.shape[1]}x{rgba.shape[0]}, levelled {deg:+.1f} deg")

    # The pivot stays part of the background photo; record its tip and footing.
    rgb, alpha, c = load(photos, masks, "pivot")
    ys, xs = np.nonzero(alpha > 0.5)
    tip_x = float(xs[ys <= ys.min() + 6].mean())
    manifest["pivot"] = dict(tip=[round((c[0] + tip_x) * SCALE, 1), round((c[1] + ys.min()) * SCALE, 1)],
                             base=round((c[1] + ys.max()) * SCALE, 1),
                             left=round((c[0] + xs.min()) * SCALE, 1), right=round((c[0] + xs.max()) * SCALE, 1))
    manifest["pivot"]["image"] = pivot_overlay(rgb, alpha, c, out)

    bg = photo(photos, "main_bg.JPG")
    size = (int(bg.width * SCALE), int(bg.height * SCALE))
    small = bg.resize(size, Image.LANCZOS)
    # The page ships finer than world units and is drawn at `scale`, so it stays sharp up close.
    fine = bg.resize((round(bg.width * BG_SCALE), round(bg.height * BG_SCALE)), Image.LANCZOS)
    fine.save(out / "background.jpg", quality=80, optimize=True, progressive=True)
    manifest["background"] = dict(w=size[0], h=size[1], scale=round(size[0] / fine.width, 6))
    manifest["ground"] = boulder_edge(np.asarray(small.convert("L")).astype(np.float32), manifest["pivot"])

    # Hand frames: register every frame on the forearm of the first so only the fingers move.
    thumbs_photo = (photos / OBJECTS[THUMBS_UP][0]).exists() and (masks / f"{THUMBS_UP}.png").exists()
    frames = {f: load(photos, masks, f) for f in HAND_FRAMES + ([THUMBS_UP] if thumbs_photo else [])}
    ref_rgb, ref_alpha, ref_c = frames[HAND_FRAMES[0]]
    h, w = ref_alpha.shape
    band = np.zeros_like(ref_alpha)
    band[60:850] = 1
    template = cv2.GaussianBlur(ref_alpha * band, (0, 0), 3)
    aligned = {}
    for f, (rgb, alpha, c) in frames.items():
        shift = np.float32([[1, 0, c[0] - ref_c[0]], [0, 1, c[1] - ref_c[1]]])
        rgb = cv2.warpAffine(rgb, shift, (w, h), borderMode=cv2.BORDER_REPLICATE)
        alpha = cv2.warpAffine(alpha, shift, (w, h), borderValue=0)
        warp = np.eye(2, 3, dtype=np.float32)
        if f != HAND_FRAMES[0]:
            _, warp = cv2.findTransformECC(template, cv2.GaussianBlur(alpha * band, (0, 0), 3), warp,
                                           cv2.MOTION_EUCLIDEAN,
                                           (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 300, 1e-6), None, 5)
        inverse = cv2.WARP_INVERSE_MAP
        aligned[f] = (cv2.warpAffine(rgb, warp, (w, h), flags=cv2.INTER_CUBIC + inverse,
                                     borderMode=cv2.BORDER_REPLICATE),
                      cv2.warpAffine(alpha, warp, (w, h), flags=cv2.INTER_LINEAR + inverse, borderValue=0))
    union = np.max([a for _, a in aligned.values()], axis=0)
    ys, xs = np.nonzero(union > 0.05)
    cut = 120  # straight cut below the sleeve
    y0, y1, x0, x1 = cut, ys.max() + 30, max(0, xs.min() - 30), xs.max() + 30
    if not thumbs_photo:
        aligned[THUMBS_UP] = thumbs_up_from_fist(aligned["hand_closed"][0][y0:y1, x0:x1],
                                                 aligned["hand_closed"][1][y0:y1, x0:x1])
    hand = {}
    for f, (rgb, alpha) in aligned.items():
        if f == THUMBS_UP and not thumbs_photo:
            rgb, alpha = resize(rgb, alpha)  # already cropped
        else:
            rgb, alpha = resize(rgb[y0:y1, x0:x1], alpha[y0:y1, x0:x1])
        rgba, pad = paper(rng, rgb, alpha)
        # Keep the arm's top edge a clean straight cut running off the page.
        rgba = rgba[pad:]
        save(rgba, out / f"{f}.webp")
        if f in HAND_FRAMES:
            hand[f] = fingertips(rgba[..., 3] > 128)
        if f == "hand_closed":
            top_row = np.nonzero(rgba[0, :, 3] > 128)[0]
    manifest["hand"] = dict(w=int(rgba.shape[1]), h=int(rgba.shape[0]), tips=hand,
                            armTop=[round(float(top_row.mean()), 1), 0])
    (out / "manifest.json").write_text(json.dumps(manifest, indent=1) + "\n")
    print("hand", rgba.shape[1], "x", rgba.shape[0], hand)


def build_digits(source, out):
    """Cut the ten paper numbers out of their cream backdrop: digit0.webp ... digit9.webp.

    The sheet holds 1-5 on the top row and 6-9, 0 below. Each digit keeps its own size,
    so they line up as cut, and a soft edge from the colour distance to the backdrop.
    """
    rgb = np.asarray(Image.open(source).convert("RGB"))
    lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB).astype(np.float32)
    edge = np.concatenate([lab[:8].reshape(-1, 3), lab[-8:].reshape(-1, 3),
                           lab[:, :8].reshape(-1, 3), lab[:, -8:].reshape(-1, 3)])
    dist = np.sqrt(((lab - np.median(edge, 0)) ** 2).sum(-1))
    solid = cv2.morphologyEx((dist > 14).astype(np.uint8), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    n, labels, stats, centres = cv2.connectedComponentsWithStats(solid)
    parts = sorted(np.argsort(-stats[1:, cv2.CC_STAT_AREA])[:10] + 1, key=lambda i: centres[i][1])
    rows = [sorted(parts[:5], key=lambda i: centres[i][0]), sorted(parts[5:], key=lambda i: centres[i][0])]
    alpha = np.clip((dist - 8) / 12, 0, 1)
    for digit, i in zip([1, 2, 3, 4, 5, 6, 7, 8, 9, 0], rows[0] + rows[1]):
        x, y, w, h = stats[i][:4]
        x0, y0, x1, y1 = max(0, x - 3), max(0, y - 3), x + w + 3, y + h + 3
        keep = cv2.dilate((labels == i).astype(np.uint8), np.ones((5, 5), np.uint8))[y0:y1, x0:x1]
        d_rgb, d_a = rgb[y0:y1, x0:x1], alpha[y0:y1, x0:x1] * keep
        if digit == 0:
            d_rgb, d_a = cyan_ring(d_rgb, d_a)
        a = (d_a * 255).astype(np.uint8)
        Image.fromarray(np.dstack([d_rgb, a])).save(out / f"digit{digit}.webp", "WEBP", quality=90, method=6)
        print(f"digit {digit}: {x1 - x0}x{y1 - y0}")


def cyan_ring(rgb, alpha, color=(58, 182, 200), ring=(24, 27)):
    """Turn the solid paper 0 cyan and scissor a counter out of it.

    The paper keeps its crumples (lightness detail around a new colour). The hole is
    the 0's own faceted outline pulled in to leave a ring about as thick as the
    other digits' strokes (`ring` = x, y in pixels), with a little hand jitter.
    """
    # The few pixels along the edge carry the cream backdrop, even where fully opaque;
    # repaint them from the paper inside before recolouring.
    solid = cv2.erode((alpha > 0.95).astype(np.uint8), np.ones((3, 3), np.uint8), iterations=3) > 0
    rgb = cv2.inpaint(np.ascontiguousarray(rgb), (~solid).astype(np.uint8), 3, cv2.INPAINT_TELEA)
    lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB).astype(np.float32)
    mean = lab[solid].mean(0)
    target = cv2.cvtColor(np.uint8([[color]]), cv2.COLOR_RGB2LAB)[0, 0].astype(np.float32)
    lab = target + (lab - mean) * np.float32([1, 0.35, 0.35])
    rgb = cv2.cvtColor(np.clip(lab, 0, 255).astype(np.uint8), cv2.COLOR_LAB2RGB)

    mask = (alpha > 0.5).astype(np.uint8)
    outline = max(cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)[0], key=cv2.contourArea)
    poly = cv2.approxPolyDP(outline, 3.0, True)[:, 0].astype(np.float32)
    m = cv2.moments(mask)
    cx, cy = m["m10"] / m["m00"], m["m01"] / m["m00"]
    half = (poly.max(0) - poly.min(0)) / 2
    inner = np.array([cx, cy]) + (poly - [cx, cy]) * (1 - np.array(ring) / half)
    inner += np.random.default_rng(3).normal(0, 1.2, inner.shape)
    h, w = alpha.shape
    big = np.zeros((h * 4, w * 4), np.uint8)
    cv2.fillPoly(big, [(inner * 4 + 2).astype(np.int32)], 255, lineType=cv2.LINE_AA)
    hole = cv2.resize(big, (w, h), interpolation=cv2.INTER_AREA).astype(np.float32) / 255
    # As soft as the outer edge, which comes from a JPEG.
    hole = cv2.GaussianBlur(hole, (0, 0), 0.6)
    return rgb, alpha * (1 - hole)


def compose_card(out, manifest):
    """Game-picker art: a small cairn with the hand bringing the next stone, on the photo."""
    bg = Image.open(out / "background.jpg").convert("RGBA")
    bg = bg.resize((manifest["background"]["w"], manifest["background"]["h"]), Image.LANCZOS)
    tx, ty = manifest["pivot"]["tip"]
    scale = 0.8

    def sprite(name, s=1.0):
        im = Image.open(out / f"{name}.webp").convert("RGBA")
        return im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS) if s != 1 else im

    def put(im, x, y):
        a = np.asarray(im)[..., 3].astype(np.float32) * 0.42
        shadow = Image.fromarray(cv2.GaussianBlur(a, (0, 0), 5).astype(np.uint8))
        black = Image.new("RGBA", im.size, (26, 20, 12, 0))
        black.putalpha(shadow)
        bg.alpha_composite(black, (round(x + 6), round(y + 8)))
        bg.alpha_composite(im, (round(x), round(y)))

    wood = manifest["wood"]
    plank = sprite("wood")
    cx = (wood["object"][0] + wood["object"][2]) / 2
    put(plank, tx - cx, ty - wood["object"][3] + 2)
    top = ty - (wood["object"][3] - wood["object"][1]) + 4
    for i, name in enumerate(["rock4", "rock6", "rock8", "rock2"]):
        info = manifest[name]
        im = sprite(name, scale)
        put(im, tx + (-1) ** i * 7 - im.width / 2, top - info["object"][3] * scale + 3)
        top -= (info["object"][3] - info["object"][1]) * scale - 3
    info = manifest["rock9"]
    held = sprite("rock9", scale)
    # The hand shares the stones' scale; a narrow stone gets the smaller pinch.
    pose = "hand_open_small" if (info["object"][2] - info["object"][0]) * scale < 140 else "hand_open_big"
    hand = sprite(pose, scale)
    tips = manifest["hand"]["tips"][pose]
    ax, ay = (tips[0][0] + tips[-1][0]) / 2 * scale, ((tips[0][1] + tips[-1][1]) / 2 - 18) * scale
    hx, hy = tx + 10, top - (info["object"][3] - info["object"][1]) * scale / 2 - 26
    put(held, hx - held.width / 2, hy - held.height / 2)
    put(hand, hx - ax, hy - ay)
    upper = round(hy - 300)
    h = round(ty + 190 - upper)
    w = round(h * 1.85)
    left = round(tx - w / 2)
    card = bg.crop((left, upper, left + w, upper + h)).convert("RGB").resize((w // 2, h // 2), Image.LANCZOS)
    card.save(out / "card.jpg", quality=84, optimize=True, progressive=True)


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--photos", type=Path, default=ROOT / "images/dump")
    p.add_argument("--masks", type=Path, default=ROOT / "images/cairn-masks")
    p.add_argument("--out", type=Path, default=ROOT / "apps/web/src/assets/cairn")
    p.add_argument("--numbers", type=Path, default=ROOT / "images/paper_numbers.jpg")
    p.add_argument("--segment", action="store_true", help="re-run SAM segmentation first")
    p.add_argument("--digits", action="store_true", help="only rebuild the score digits")
    args = p.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    build_digits(args.numbers, args.out)
    if args.digits:
        raise SystemExit
    if args.segment:
        segment(args.photos, args.masks)
    compose(args.photos, args.masks, args.out)
    compose_card(args.out, json.loads((args.out / "manifest.json").read_text()))
