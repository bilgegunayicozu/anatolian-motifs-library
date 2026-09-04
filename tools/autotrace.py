#!/usr/bin/env python3
"""
Anatolian Motif auto-tracer v3  (Mine Erbek - Anadolu Motifleri)
----------------------------------------------------------------
Turns the book's printed catalog motif drawings into pixel-grid motif JSON
files for the Anatolian Motifs Digital Library.

v3 upgrades over the pilot pipeline (calibrated on p.38 entries 087-098):
  * INK THRESHOLD 165 (was 110): fine outline drawings print light
    (~120-160 gray) — at 110 they were missed entirely (069, 081).
  * DRAWING ANALYSIS by run-lengths: ui = median ink run, ug = median
    internal gap run. This separates three drawing styles cleanly:
      FINE  (ui<=4 or ug<=2.5): fine line/lattice drawings -> trace at
            high resolution (cell=2px, grid up to 48) with a coverage
            threshold tuned to stroke density:
              ui<=2 -> 0.45 (hairlines: keep them)
              ui<=4 -> 0.55 (dense lattices: keep the gaps)
              else  -> 0.60 (thick lines, tiny gaps e.g. 093/098)
      SOLID (else): coverage gridding at cell~2.3px, thr 0.45
            (the batch-1 approved look).
  * GRID PHASE OPTIMIZATION: coverage is computed for 3 cell sizes x 9
    grid offsets; the crispest quantization wins (mean min(cov,1-cov)).
    This is what makes lattice gaps land inside cells instead of
    straddling them.
  * HAND-REDRAW pass:
      solid: close 1px gaps, denoise, enforce mirror symmetry
             (left-half canon), loom-honest diagonal stepping.
      fine:  symmetry-union only (never breaks a path, keeps dot rows).
  * 2-COLOR prep: cell values support 1=primary(■) 2=secondary(□).
  * Review sheet: source drawing above traced grid, labeled
    "entry · technique · region · WxH · mode".

Run:  python3 autotrace.py <page.png> <first_entry> <last_entry>
      (metadata for entries must exist in PAGES below)
"""
import numpy as np, json, os, sys, datetime
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage as ndi

# ---- paths ----
HERE   = os.path.dirname(os.path.abspath(__file__))
LIBDIR = os.path.join(HERE, "..", "motifs")
OUTDIR = os.path.join(HERE, "..", "_review")
os.makedirs(OUTDIR, exist_ok=True)

PRIMARY   = "#8B3A2A"          # madder red (■)
SECONDARY = "#2D4159"          # indigo (□ two-color motifs)
CREAM=(232,220,196); MAD=(139,58,42); IND=(45,65,89); LINE=(39,68,114)
PALETTE=["#8B3A2A","#A0432F","#2D4159","#B89456","#6E7240","#2C2620","#B05535","#E8DCC4"]
MAXG = 128  # editor grid limit (raised from 48 for border bands — su yolu
            # meanders and the tall koçboynuzu/bereket bands were being squashed)
INK_T = 165 # ink binarize threshold

# ------------------------------------------------------------------- detection
def detect_motifs(path, masks=None, leftmask=135):
    """Return grayscale array + ordered [x0,y0,x1,y1] motif boxes (reading order).
    leftmask: width of left margin to ignore (sidebar). Odd pages (e.g. 37) have
    the sidebar on the RIGHT and motifs near the left edge -> use leftmask~25
    and mask the right sidebar explicitly."""
    im=Image.open(path).convert("L"); A=np.asarray(im); H,W=A.shape
    ink=(A<INK_T)
    m=np.ones_like(ink)
    if leftmask: m[:, :leftmask]=0
    for (y0,y1,x0,x1) in (masks or []): m[y0:y1, x0:x1]=0
    ink=ink & (m>0)
    D=ndi.binary_dilation(ink, iterations=4)
    lab,n=ndi.label(D)
    boxes=[]
    for sl in ndi.find_objects(lab):
        y0,y1=sl[0].start,sl[0].stop-1; x0,x1=sl[1].start,sl[1].stop-1
        h=y1-y0+1; w=x1-x0+1
        if 28<=h<=170 and 26<=w<=210 and ink[sl].sum()>250:
            boxes.append((x0,y0,x1,y1))
    boxes.sort(key=lambda b:((b[1]+b[3])//2,b[0]))
    rows=[]
    for b in boxes:
        cy=(b[1]+b[3])//2
        for r in rows:
            if abs(r[0]-cy)<38: r[1].append(b); break
        else: rows.append([cy,[b]])
    rows.sort(key=lambda r:r[0]); out=[]
    for _,bs in rows: bs.sort(key=lambda b:b[0]); out+=bs
    return A, out

# --------------------------------------------------------------------- helpers
def _tight(ink):
    ys,xs=np.where(ink)
    return ink[ys.min():ys.max()+1, xs.min():xs.max()+1] if len(xs) else ink

def _strip_number(ink):
    H,Wd=ink.shape; rh=ink.any(axis=1); bands=[]; s=None
    for r in range(H):
        if rh[r] and s is None: s=r
        elif not rh[r] and s is not None: bands.append((s,r-1)); s=None
    if s is not None: bands.append((s,H-1))
    if len(bands)>=2:
        bs,be=bands[-1]; bh=be-bs+1; gap=bs-bands[-2][1]-1
        xw=np.where(ink[bs:be+1].any(axis=0))[0]; bw=(xw.max()-xw.min()+1) if len(xw) else 0
        if bh<=0.20*H and gap>=2 and bw<0.55*Wd: ink=ink[:bands[-2][1]+1]
    ink=_tight(ink)
    # fallback: printed number TOUCHING the drawing (no blank row, e.g. p37 no.050)
    # -> remove small text-like components near the bottom
    H,Wd=ink.shape
    lab,n=ndi.label(ink)
    if n>1:
        keep=np.zeros_like(ink); changed=False
        for i,sl in enumerate(ndi.find_objects(lab),1):
            y0,h=sl[0].start,sl[0].stop-sl[0].start; w=sl[1].stop-sl[1].start
            if y0>0.7*H and h<0.3*H and w<0.5*Wd and h<=14: changed=True; continue
            keep|=(lab==i)
        if changed: ink=_tight(keep)
    return ink

def ink_runs(ink):
    """All horizontal+vertical run lengths of ink pixels."""
    out=[]
    for arr in (ink, ink.T):
        for row in arr:
            idx=np.flatnonzero(np.diff(np.r_[0,row.view(np.int8),0]))
            for i in range(0,len(idx),2): out.append(idx[i+1]-idx[i])
    return np.array(out) if out else np.array([2])

def gap_runs(ink):
    """Internal (bounded) background run lengths, horizontal+vertical."""
    out=[]
    for arr in (ink, ink.T):
        for row in arr:
            b=(~row)
            idx=np.flatnonzero(np.diff(np.r_[0,b.view(np.int8),0]))
            for i in range(0,len(idx),2):
                s,e=idx[i],idx[i+1]
                if s>0 and e<len(row): out.append(e-s)
    return np.array(out) if out else np.array([6])

# ---------------------------------------------------------------------- gridding
def _coverage(ink, rows, cols, oy, ox):
    h,w=ink.shape
    ri=np.clip(((np.arange(h)+oy)*rows/h).astype(int),0,rows-1)
    ci=np.clip(((np.arange(w)+ox)*cols/w).astype(int),0,cols-1)
    tot=np.zeros((rows,cols)); on=np.zeros((rows,cols))
    RI=ri[:,None].repeat(w,1); CI=ci[None,:].repeat(h,0)
    np.add.at(tot,(RI,CI),1)
    np.add.at(on,(RI,CI),ink.astype(float))
    return on/np.maximum(tot,1)

def griddize(ink, cell, thr):
    """Coverage gridding with cell-size + grid-phase optimization: the
    quantization whose cells are most decisively on/off wins."""
    h,w=ink.shape; best=None
    for cm in (0.9,1.0,1.12):
        c=cell*cm
        cols=int(np.clip(round(w/c),8,MAXG))
        rows=int(np.clip(round(h/(w/cols)),3,MAXG))
        for oy in (0,c/3,2*c/3):
            for ox in (0,c/3,2*c/3):
                cov=_coverage(ink,rows,cols,oy,ox)
                score=np.minimum(cov,1-cov).mean()
                if best is None or score<best[0]: best=(score,cov)
    return (best[1]>=thr).astype(int)

# ------------------------------------------------------------------ hand-redraw
def hand_redraw(g, mode):
    """Clean-up pass. solid: gaps/denoise/symmetry/loom steps.
    fine: symmetry-union only (never breaks paths, keeps dot details)."""
    g=g.copy(); R,C=g.shape
    if mode=="fine":
        same=sum(1 for r in range(R) for c in range(C) if g[r,c]==g[r,C-1-c])
        if R*C and same/(R*C)>=0.90:
            for r in range(R):
                for c in range(C//2):
                    v=g[r,c] or g[r,C-1-c]; g[r,c]=v; g[r,C-1-c]=v
        return g
    # -- solid --
    for r in range(R):                          # 1. close 1-px gaps
        for c in range(C):
            if g[r,c]==0:
                if 0<c<C-1 and g[r,c-1] and g[r,c+1] and g[r,c-1]==g[r,c+1]: g[r,c]=g[r,c-1]
                elif 0<r<R-1 and g[r-1,c] and g[r+1,c] and g[r-1,c]==g[r+1,c]: g[r,c]=g[r-1,c]
    for r in range(R):                          # 2. denoise isolated cells
        for c in range(C):
            if g[r,c] and not any(0<=r+dr<R and 0<=c+dc<C and g[r+dr,c+dc]
                                  for dr,dc in ((1,0),(-1,0),(0,1),(0,-1))):
                g[r,c]=0
    same=sum(1 for r in range(R) for c in range(C) if g[r,c]==g[r,C-1-c])
    if R*C and same/(R*C)>=0.85:                # 3. true mirror symmetry
        for r in range(R):
            for c in range(C//2):
                if g[r,c]!=g[r,C-1-c]:
                    g[r,C-1-c]=g[r,c]           # left-half canon (batch-1 look)
    add=[]                                      # 4. loom-honest diagonal steps
    for r in range(R-1):
        for c in range(C-1):
            a,b,cc,d=g[r,c],g[r,c+1],g[r+1,c],g[r+1,c+1]
            if a and d and not b and not cc: cand=[(r,c+1),(r+1,c)]
            elif b and cc and not a and not d: cand=[(r,c),(r+1,c+1)]
            else: continue
            pick=next((p for p in cand if g[p[0],C-1-p[1]]), cand[1])
            add.append((pick,max(a,b,cc,d)))
    for (r,c),v in add: g[r,c]=v
    return g

def two_tone(A, box, T_all=205, T_solid=INK_T, cell=2.3, enclosed_only=True):
    """TWO-COLOUR trace (■ primary / □ secondary).

    For motifs drawn as solid ink plus a thin-outlined counter-shape — the
    Ying-Yang 'aşk ve birleşim' family and the outlined stars of 'yıldız' are
    the reference cases. Binarizes twice: a loose threshold catches the thin
    outline, a tight one catches solid ink. Filling the closed outline recovers
    the whole silhouette; cells inside the silhouette but not solid become
    secondary (indigo).

    enclosed_only drops secondary regions that open onto the grid edge. Those
    are closing artefacts — on a concave form like an 8-pointed star, dilation
    bridges neighbouring points and the notches between them read as fake
    pockets. A real counter-shape is enclosed by ink on all sides.

    Decide with the secondary/primary ratio: >=0.15 means a genuine two-colour
    motif; below that the drawing is single-tone. Dense lattice drawings (e.g.
    Çorap socks) still fool fill_holes, so eyeball those on the review sheet.
    -> grid, silhouette mask
    """
    x0,y0,x1,y1=box
    crop=A[max(0,y0-2):y1+3, max(0,x0-2):x1+3]
    all_=crop<T_all; sol=crop<T_solid
    closed=ndi.binary_closing(all_,structure=np.ones((3,3)),iterations=2)
    sil=ndi.binary_fill_holes(closed)
    ys,xs=np.where(sil)
    if not len(xs): return None, None
    sl=(slice(ys.min(),ys.max()+1),slice(xs.min(),xs.max()+1))
    sil=sil[sl]; sol=sol[sl]; h,w=sil.shape
    best=None
    for cm in (0.9,1.0,1.12):
        c=cell*cm
        cols=int(np.clip(round(w/c),8,MAXG))
        rows=int(np.clip(round(h/(w/cols)),3,MAXG))
        for oy in (0,c/3,2*c/3):
            for ox in (0,c/3,2*c/3):
                cf=_coverage(sil,rows,cols,oy,ox)
                sc=np.minimum(cf,1-cf).mean()
                if best is None or sc<best[0]: best=(sc,rows,cols,oy,ox)
    _,rows,cols,oy,ox=best
    cf=_coverage(sil,rows,cols,oy,ox); cs=_coverage(sol,rows,cols,oy,ox)
    g=np.zeros((rows,cols),int); g[cf>=0.5]=2; g[cs>=0.45]=1
    if enclosed_only:
        lab,n=ndi.label(g==2)
        for i in range(1,n+1):
            m=(lab==i)
            if m[0,:].any() or m[-1,:].any() or m[:,0].any() or m[:,-1].any(): g[m]=0
    return hand_redraw(g,"solid"), sil

def trace(A, box):
    """-> grid, ink crop, mode, (ui,ug)."""
    x0,y0,x1,y1=box
    crop=A[max(0,y0-2):y1+3, max(0,x0-2):x1+3]
    ink=_strip_number(_tight(crop<INK_T))
    ui=float(np.median(ink_runs(ink))); ug=float(np.median(gap_runs(ink)))
    if ui<=4 or ug<=2.5:
        mode="fine"
        thr=0.45 if ui<=2 else (0.55 if ui<=4 else 0.60)
        g=griddize(ink,2.0,thr)
    else:
        mode="solid"
        # A cell must be small enough for the drawing's narrowest gap to survive
        # quantization — roughly ug/2.5. Motifs printed small but densely (the
        # vertical repeat-bands of su yolu, ~60px wide with 4px gaps) came out as
        # blobs at a flat 2.3. Clipped to 2.3 so nothing gets coarser than before.
        cell=float(np.clip(min(2.3, ug/2.5), 1.2, 2.3))
        g=griddize(ink,cell,0.45)
    g=hand_redraw(g,mode)
    return g, ink, mode, (ui,ug)

# ------------------------------------------------------------------ persistence
def save_motif(g, num, tech, region, family, slug, page, meaning, category):
    R,C=g.shape; mid=f"{slug}-{num:03d}"   # ascii slug for id/filename (pilot convention)
    ts=datetime.datetime.now().isoformat(timespec="seconds")
    label=region if region else tech
    obj={"id":mid,"nameTr":f"{family.capitalize()} #{num}","nameEn":f"{family} – {label}",
         "meaning":meaning,"category":category,"curvilinear":False,
         "regions":([region] if region else []),"story":"",
         "tags":[family,"auto-trace","validate",tech.lower()],
         "family":family,"technique":tech,"sourceNo":num,"sourcePage":page,
         "sourceBook":"Mine Erbek – Anadolu Motifleri",
         "gridW":C,"gridH":R,"background":"#E8DCC4","palette":PALETTE,
         "cells":[[PRIMARY if v==1 else (SECONDARY if v==2 else None) for v in row]
                  for row in g.tolist()],
         "createdAt":ts,"updatedAt":ts}
    json.dump(obj,open(os.path.join(LIBDIR,mid+".json"),"w",encoding="utf-8"),
              ensure_ascii=False,indent=2)
    return mid

def render(g,scale=12):
    R,C=g.shape; img=Image.new("RGB",(C*scale,R*scale),CREAM); d=ImageDraw.Draw(img)
    for r in range(R):
        for c in range(C):
            if g[r,c]==1: d.rectangle([c*scale,r*scale,(c+1)*scale-1,(r+1)*scale-1],fill=MAD)
            elif g[r,c]==2: d.rectangle([c*scale,r*scale,(c+1)*scale-1,(r+1)*scale-1],fill=IND)
    for c in range(C+1): d.line([(c*scale,0),(c*scale,R*scale)],fill=LINE)
    for r in range(R+1): d.line([(0,r*scale),(C*scale,r*scale)],fill=LINE)
    return img

# ---------------------------------------------------------------- review sheet
def review_sheet(items, outname, title):
    """items: list of (label, ink_bool_array, grid). Source above traced grid."""
    try: F=ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",15)
    except OSError: F=ImageFont.load_default()
    cells=[]
    for label,ink,g in items:
        src=Image.fromarray(np.where(ink,0,255).astype(np.uint8)).convert("RGB")
        src=src.resize((src.width*2,src.height*2),Image.NEAREST)
        gr=render(g)
        w=max(src.width,gr.width,190); h=src.height+gr.height+46
        cell=Image.new("RGB",(w+16,h+16),(250,247,240)); dr=ImageDraw.Draw(cell)
        cell.paste(src,(8+(w-src.width)//2,26))
        cell.paste(gr,(8+(w-gr.width)//2,26+src.height+12))
        dr.text((8,4),label,fill=(30,30,30),font=F)
        cells.append(cell)
    perrow=4
    rows=[cells[i:i+perrow] for i in range(0,len(cells),perrow)]
    W=max(sum(c.width for c in r)+12*(len(r)+1) for r in rows)
    H=40+sum(max(c.height for c in r)+12 for r in rows)
    sheet=Image.new("RGB",(W,H),(255,255,255)); d=ImageDraw.Draw(sheet)
    d.text((12,10),title,fill=(0,0,0),font=F)
    y=40
    for r in rows:
        x=12
        for c in r: sheet.paste(c,(x,y)); x+=c.width+12
        y+=max(c.height for c in r)+12
    p=os.path.join(OUTDIR,outname); sheet.save(p); return p

# ------------------------------------------------------------------- page meta
# masks = (y0,y1,x0,x1) photo/caption blocks to ignore
# order  = entry number for each detected box, in detection order (when reading
#          order breaks); extra = {entry: box} for boxes detection misses
_KOC=dict(family="koçboynuzu", slug="kocboynuzu", category="masculine",
          meaning="Masculinity, heroism, power, fertility; abundance and protection.")
PAGES={
 "36": dict(masks=[(0,415,135,375),(85,420,585,830),(400,800,135,365),(745,1188,360,590)],
            order=list(range(1,26))+[28,29,26,30,31,32,33],
            extra={27:(697,760,793,1014)},   # tall Damga stamp, over h-cap
            meta={
              1:("Kilim","Yüncü/Balıkesir"),2:("Kilim","Malatya"),3:("Kilim","Ardahan"),
              4:("Kilim","Orta/Çankırı"),5:("Cicim","Adıyaman"),6:("Kilim","Afyon"),
              7:("Kilim","Afyon"),8:("Kilim","Eskişehir"),9:("Kilim","Kahramanmaraş"),
              10:("Kilim","Kahramanmaraş"),11:("Kilim","Manisa"),12:("Kilim","Çamlibel/Tokat"),
              13:("Kilim","Kayseri"),14:("Kilim","Pötürge/Malatya"),15:("Kilim","Elazığ"),
              16:("Kilim","Gaziantep"),17:("Kilim","Kayseri"),18:("Kilim","Hotamış/Konya"),
              19:("Sumak","Mut/Mersin"),20:("Kilim","Emirdağ/Afyon"),21:("Kilim","Kars"),
              22:("Kilim","Digor/Kars"),23:("Kilim","Mut/Mersin"),24:("Dokuma",""),
              25:("Sumak","Mut/Mersin"),26:("Kilim","Kars"),27:("Damga",""),
              28:("Kilim","Kars"),29:("Kilim","Niğde"),30:("Kilim","Sivas"),
              31:("Kilim","Sivas"),32:("Kilim","Kayseri"),33:("Kilim","Çankırı")},
            **_KOC),
 "37": dict(masks=[(0,1188,685,830),(0,305,460,665),(340,685,40,275),
                   (560,935,470,670),(790,1188,235,465)],
            leftmask=25,                     # sidebar is on the RIGHT on p.37
            meta={
              34:("Cicim","Zile/Tokat"),35:("Halı","Kütahya"),36:("Kilim","Mut/Mersin"),
              37:("Kilim","Antalya"),38:("Dokuma","Buldan/Denizli"),39:("Halı","Kars"),
              40:("Kilim","Konya"),41:("Cicim","Korkuteli/Antalya"),42:("Kilim","Kayseri"),
              43:("Halı","Elazığ"),44:("Kilim","Elazığ"),45:("Kilim","Afyon"),
              46:("Halı","Döşemealtı/Antalya"),47:("Halı","Kars"),48:("Çorap","Kars"),
              49:("Kilim","Pötürge/Malatya"),50:("Kilim","Konya"),51:("Kilim","Erzurum"),
              52:("Kilim","Obruk/Konya"),53:("Halı","Elazığ"),54:("Kilim","Tokat"),
              55:("Kilim","Kahramanmaraş"),56:("Kilim","Kars"),57:("Damga","Gaziantep"),
              58:("Kilim","Kayseri"),59:("Kilim","Balıkesir"),60:("Halı","Elazığ"),
              61:("Cicim","Sivas"),62:("Kilim","Hakkari"),63:("Sumak","Hakkari"),
              64:("Kilim","Kayseri"),65:("Cicim","Afyon"),66:("Halı","Döşemealtı/Antalya")},
            **_KOC),
 "38": dict(masks=[(0,430,565,830),(735,1188,345,830),(80,420,135,345)],
            family="koçboynuzu", slug="kocboynuzu", category="masculine",
            meaning="Masculinity, heroism, power, fertility; abundance and protection.",
            meta={
              67:("Kilim","Konya"),68:("Kilim","Konya"),69:("Kilim","Yahyalı/Kayseri"),
              70:("Kilim","Niğde"),71:("Kilim","Manisa"),72:("Kilim","Balıkesir"),
              73:("Kilim","Balıkesir"),74:("Kilim","Erzurum"),75:("Kilim","Gümüşhane"),
              76:("Kilim","Kelkit/Gümüşhane"),77:("Kilim","Mut/Mersin"),78:("Kilim","Çine/Aydın"),
              79:("Kilim","Denizli"),80:("Kilim","Balıkesir"),81:("Halı","Uşak"),
              82:("Halı","Mucur/Kırşehir"),83:("Kilim","Bayburt"),84:("Halı","Mucur/Kırşehir"),
              85:("Kilim","Balıkesir"),86:("Kilim","Alanya/Antalya"),87:("Kilim","Malatya"),
              88:("Kilim","Mut/Mersin"),89:("Kilim","Balıkesir"),90:("Kilim","Buldan/Denizli"),
              91:("Cicim","Isparta"),92:("Kumaş","Çorum"),93:("Keçe",""),
              94:("Kilim","Malatya"),95:("Kilim","Malatya"),96:("Halı","Ardahan"),
              97:("Halı","Adıyaman"),98:("Halı","Digor/Kars")})}

def run_page(pagepath, first, last):
    key=os.path.splitext(os.path.basename(pagepath))[0]
    P=PAGES[key]
    A,boxes=detect_motifs(pagepath, P["masks"], P.get("leftmask",135))
    order=P.get("order") or sorted(P["meta"])   # entry no. per box, detection order
    extra=P.get("extra",{})
    assert len(boxes)==len(order), f"expected {len(order)} boxes, got {len(boxes)}"
    pairs=dict(zip(order,boxes)); pairs.update(extra)
    items=[]; ids=[]
    for n in sorted(pairs):
        box=pairs[n]
        if not (first<=n<=last): continue
        g,ink,mode,(ui,ug)=trace(A,box)
        tech,region=P["meta"][n]
        mid=save_motif(g,n,tech,region,P["family"],P["slug"],int(key),P["meaning"],P["category"])
        ids.append(mid)
        R,C=g.shape
        items.append((f"{n:03d} · {tech} · {region or '—'} · {C}×{R} · {mode}",ink,g))
        print(f"{mid}: {mode} ui={ui:.0f} ug={ug:.0f} grid {C}x{R}")
    out=review_sheet(items,f"{P['slug']}_p{key}_{first:03d}-{last:03d}_review.png",
                     f"{P['family']} p.{key} entries {first:03d}–{last:03d} — source (top) vs traced grid (bottom)")
    print("review:",out)
    return ids,out

if __name__=="__main__":
    run_page(sys.argv[1], int(sys.argv[2]), int(sys.argv[3]))
