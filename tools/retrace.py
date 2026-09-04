#!/usr/bin/env python3
"""
Re-trace catalog pages from the page registry.

    python3 retrace.py            # every page in pages.py
    python3 retrace.py 96 97 98   # only these pages
    python3 retrace.py --family yildiz
    python3 retrace.py 106 --no-sheets

Reads tools/pages.py for masks/meta/order/extra, writes motif JSON into
../motifs/ and a review montage per page into ../_review/. Entries listed in
pages.PROTECTED (grids Bilge has hand-corrected) are never overwritten.

Two-colour handling: opt-in only. An entry is traced in two tones if and only if
it is listed in pages.TWO_TONE[page], each of which was confirmed against the
printed drawing. See the comment there for why automatic detection was dropped.
"""
import os, sys, json, datetime, importlib.util
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))

def _load(name):
    spec = importlib.util.spec_from_file_location(name, os.path.join(HERE, name + ".py"))
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m); return m

at = _load("autotrace")
P  = _load("pages")

LIBDIR = os.path.join(HERE, "..", "motifs")
BOOK   = os.path.join(HERE, "..", "Mine Erberk Anadolu Motifleri")
PRIMARY, SECONDARY = "#8B3A2A", "#2D4159"
TT_MIN = 0.15

def prep(page):
    """Load the page, upscaling the smaller early scans to 830-wide."""
    p = os.path.join(BOOK, f"{page}.png")
    im = Image.open(p); W, H = im.size
    s = 830 / W if W < 800 else 1.0
    if s != 1.0:
        im = im.resize((round(W * s), round(H * s)), Image.LANCZOS)
    return np.asarray(im.convert("L")), s, im

def _sc(box, s): return tuple(round(v * s) for v in box)

def save(g, num, tech, region, page, F, curvi=False):
    R, C = g.shape; mid = f"{F['slug']}-{num:03d}"
    if mid in P.PROTECTED:
        print(f"  {mid}: protected, left as-is"); return False
    ts = datetime.datetime.now().isoformat(timespec="seconds")
    tags = [F["fam"], "auto-trace", "validate", tech.lower()]
    story = ""
    if mid in P.NEEDS_REDRAW:
        tags.append("needs-redraw")
        story = P.NEEDS_REDRAW[mid] + " Needs hand redraw in the editor."
    obj = {"id": mid, "nameTr": f"{F['nameTr']} #{num}",
           "nameEn": f"{F['fam']} – {region or tech}",
           "meaning": F["meaning"], "category": F["cat"], "curvilinear": bool(curvi),
           "regions": ([region] if region else []), "story": story, "tags": tags,
           "family": F["fam"], "technique": tech, "sourceNo": num, "sourcePage": page,
           "sourceBook": "Mine Erbek – Anadolu Motifleri",
           "gridW": C, "gridH": R, "background": "#E8DCC4", "palette": at.PALETTE,
           "cells": [[PRIMARY if v == 1 else (SECONDARY if v == 2 else None) for v in row]
                     for row in g.tolist()],
           "createdAt": ts, "updatedAt": ts}
    json.dump(obj, open(os.path.join(LIBDIR, mid + ".json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=2)
    return True

def run_page(page, sheets=True):
    cfg = P.PAGES[page]
    F = P.FAMILIES[cfg["family"]]
    A, s, _ = prep(page)
    masks = [_sc(m, s) for m in cfg.get("masks", [])]
    _, boxes = at.detect_motifs(os.path.join(BOOK, f"{page}.png"), masks,
                               round(cfg.get("leftmask", 135) * s)) if s == 1.0 else (None, None)
    if boxes is None:                       # upscaled page: detect on the scaled array
        boxes = _detect_arr(A, masks, round(cfg.get("leftmask", 135) * s))
    boxes = list(boxes)
    for i, j in cfg.get("merge", []):
        a, b = boxes[i], boxes[j]
        boxes[i] = (min(a[0], b[0]), min(a[1], b[1]), max(a[2], b[2]), max(a[3], b[3]))
    for _, j in sorted(cfg.get("merge", []), reverse=True): boxes.pop(j)

    nums = cfg.get("order") or sorted(cfg["meta"])
    if len(boxes) != len(nums):
        print(f"p.{page}: EXPECTED {len(nums)} boxes, DETECTED {len(boxes)} — skipped")
        return
    pairs = dict(zip(nums, boxes))
    for k, v in cfg.get("extra", {}).items(): pairs[k] = _sc(v, s)

    force = set() if cfg["family"] in P.TWO_TONE_OFF else P.TWO_TONE.get(page, set())
    curvi = P.CURVILINEAR.get(F["slug"], set())
    items, tt = [], []
    for n in sorted(pairs):
        g, ink, mode, _ = at.trace(A, pairs[n])
        if n in force:                       # opt-in only — see pages.TWO_TONE
            g2, _ = at.two_tone(A, pairs[n])
            if g2 is not None:
                g, mode = g2, "two-tone"; tt.append(n)
        tech, region = cfg["meta"][n]
        save(g, n, tech, region, page, F, curvi=(n in curvi))
        R, C = g.shape
        items.append((f"{n:03d} · {tech} · {region or '—'} · {C}×{R} · {mode}", ink, g))
    print(f"p.{page} {F['fam']}: {len(items)} entries, two-tone {len(tt)}")
    if sheets and items:
        half = (len(items) + 1) // 2
        for chunk in (items[:half], items[half:]):
            if not chunk: continue
            a, b = chunk[0][0][:3], chunk[-1][0][:3]
            at.review_sheet(chunk, f"{F['slug']}_p{page}_{a}-{b}_review.png",
                f"{F['fam']} p.{page} entries {a}-{b} - source (top) vs traced grid (bottom)")

def _detect_arr(A, masks, leftmask):
    """detect_motifs on an in-memory array (needed for the upscaled early pages)."""
    from scipy import ndimage as ndi
    ink = (A < at.INK_T)
    m = np.ones_like(ink)
    if leftmask: m[:, :leftmask] = 0
    for (y0, y1, x0, x1) in masks: m[y0:y1, x0:x1] = 0
    ink = ink & (m > 0)
    D = ndi.binary_dilation(ink, iterations=4)
    lab, _ = ndi.label(D)
    boxes = []
    for sl in ndi.find_objects(lab):
        y0, y1 = sl[0].start, sl[0].stop - 1
        x0, x1 = sl[1].start, sl[1].stop - 1
        h, w = y1 - y0 + 1, x1 - x0 + 1
        # keep these caps identical to autotrace.detect_motifs, or the upscaled
        # early pages pick up boxes the 830-wide pages do not
        if 28 <= h <= 170 and 26 <= w <= 210 and ink[sl].sum() > 250:
            boxes.append((x0, y0, x1, y1))
    boxes.sort(key=lambda b: ((b[1] + b[3]) // 2, b[0]))
    rows = []
    for b in boxes:
        cy = (b[1] + b[3]) // 2
        for r in rows:
            if abs(r[0] - cy) < 38: r[1].append(b); break
        else: rows.append([cy, [b]])
    rows.sort(key=lambda r: r[0])
    out = []
    for _, bs in rows: bs.sort(key=lambda b: b[0]); out += bs
    return out

if __name__ == "__main__":
    args = [a for a in sys.argv[1:]]
    sheets = "--no-sheets" not in args
    args = [a for a in args if a != "--no-sheets"]
    if args and args[0] == "--family":
        pages = [p for p, c in P.PAGES.items() if c["family"] == args[1]]
    elif args:
        pages = [int(a) for a in args]
    else:
        pages = sorted(P.PAGES)
    for pg in sorted(pages): run_page(pg, sheets)
