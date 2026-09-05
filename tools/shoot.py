#!/usr/bin/env python3
"""Headless check: serve the site, load it, collect console errors, take screenshots,
exercise the accordions/variations, and render the OG image + favicon PNG.
    python3 tools/shoot.py [outdir]
"""
import os, sys, subprocess, time, json
from playwright.sync_api import sync_playwright

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "_shots")
os.makedirs(OUT, exist_ok=True)
PORT = 8765
srv = subprocess.Popen([sys.executable, "-m", "http.server", str(PORT), "--bind", "127.0.0.1"], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(0.8)
errors, logs = [], []
try:
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        pg = b.new_page(viewport={"width": 1360, "height": 900}, device_scale_factor=1)
        pg.on("console", lambda m: (errors if m.type == "error" else logs).append(m.text))
        pg.on("pageerror", lambda e: errors.append(str(e)))
        # test-only: local copies of the Google fonts (the sandbox cannot reach fonts.googleapis.com)
        FONTCSS = os.path.join(ROOT, "_shots", "fonts", "test-fonts.css")
        def fonts(page):
            if os.path.exists(FONTCSS): page.add_style_tag(path=FONTCSS)
        pg.goto(f"http://127.0.0.1:{PORT}/?region=konya&seed=4827193")
        pg.wait_for_selector("#stage canvas", timeout=15000)
        fonts(pg); pg.wait_for_timeout(1500)
        print("title:", pg.title())
        print("accession:", pg.text_content("#acc-number"), "|", pg.text_content("#acc-region"))
        print("desc:", pg.text_content("#spec-desc"))
        pg.screenshot(path=f"{OUT}/01-specimen.png")
        # a few more weaves (distinctness check)
        seen = set()
        for i in range(6):
            pg.click("#btn-weave"); pg.wait_for_timeout(400)
            seen.add(pg.text_content("#acc-number") + pg.text_content("#acc-composition"))
        print("distinct weaves out of 6:", len(seen))
        # open first category and first motif
        pg.click("#motif-accordion .acc-btn >> nth=0"); pg.wait_for_timeout(200)
        pg.click("#motif-accordion .motif-btn >> nth=0"); pg.wait_for_timeout(2500)
        n_sw = pg.locator("#motif-accordion .swatch").count()
        print("swatches after opening elibelinde:", n_sw)
        pg.locator("#motif-accordion .motif-btn >> nth=0").scroll_into_view_if_needed()
        pg.screenshot(path=f"{OUT}/02-index-elibelinde.png", full_page=False)
        # hand strength slider
        pg.locator("#motif-elibelinde .var-group >> nth=1").scroll_into_view_if_needed(); pg.wait_for_timeout(300)
        pg.screenshot(path=f"{OUT}/02b-elibelinde-forms.png")
        # open a curvilinear motif (karanfil) via hash
        pg.goto(f"http://127.0.0.1:{PORT}/?region=milas&seed=99#motif=karanfil"); pg.wait_for_selector("#stage canvas"); fonts(pg); pg.wait_for_timeout(1500)
        pg.locator("#motif-karanfil").scroll_into_view_if_needed(); pg.wait_for_timeout(300)
        pg.screenshot(path=f"{OUT}/03-karanfil-curvilinear.png")
        # regions
        pg.click("#region-accordion .acc-btn >> nth=0"); pg.wait_for_timeout(300)
        pg.locator("#region-konya").scroll_into_view_if_needed(); pg.wait_for_timeout(200)
        pg.screenshot(path=f"{OUT}/04-regions-konya.png")
        chips = pg.locator("#region-konya .chip").count(); print("konya chips:", chips)
        # every region opens to its pool; every motif opens
        pool_ok = True
        for r in pg.evaluate("Array.from(document.querySelectorAll('#region-accordion .acc-item')).map(e=>e.id)"):
            pg.click(f"#{r} .acc-btn"); pg.wait_for_timeout(30)
            c = pg.locator(f"#{r} .chip").count()
            if c == 0: pool_ok = False; print("EMPTY REGION", r)
        print("all regions have chips:", pool_ok)
        # all motifs: open each and count groups
        keys = pg.evaluate("Array.from(document.querySelectorAll('#motif-accordion .motif-row')).map(e=>e.id.replace('motif-',''))")
        bad = []
        for k in keys:
            pg.evaluate(f"document.querySelector('#motif-{k} .motif-btn').click()"); pg.wait_for_timeout(120)
            g = pg.locator(f"#motif-{k} .var-group").count()
            if g < 2: bad.append((k, g))
        pg.wait_for_timeout(2000)
        print("motifs with <2 variation groups:", bad)
        # mobile
        m = b.new_page(viewport={"width": 390, "height": 844}, device_scale_factor=2)
        m.on("pageerror", lambda e: errors.append("mobile " + str(e)))
        m.goto(f"http://127.0.0.1:{PORT}/?region=sivas&seed=12"); m.wait_for_selector("#stage canvas"); fonts(m); m.wait_for_timeout(1200)
        sw = m.evaluate("document.documentElement.scrollWidth"); print("mobile scrollWidth:", sw, "(390 expected)")
        m.screenshot(path=f"{OUT}/05-mobile.png", full_page=False)
        # OG image: render a plate at 1200x630
        og = b.new_page(viewport={"width": 1200, "height": 630}, device_scale_factor=1)
        og.goto(f"http://127.0.0.1:{PORT}/tools/og.html?seed=12&region=sivas"); fonts(og); og.wait_for_timeout(2500)
        og.screenshot(path=f"{ROOT}/assets/og-image.png")
        fav = b.new_page(viewport={"width": 180, "height": 180}, device_scale_factor=1)
        fav.goto(f"http://127.0.0.1:{PORT}/assets/favicon.svg"); fav.wait_for_timeout(300)
        fav.screenshot(path=f"{ROOT}/assets/favicon-180.png")
        b.close()
except Exception as e:
    print("FAILED:", e)
finally:
    srv.terminate()
print("console errors:", json.dumps(errors, indent=1) if errors else "none")
