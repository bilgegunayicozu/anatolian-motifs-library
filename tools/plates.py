#!/usr/bin/env python3
"""Render the plates sanity sheet to a PNG.  python3 tools/plates.py out.png "regions=konya,kars&seeds=1,2,3&cols=6&cs=3" """
import os, sys, subprocess, time
from playwright.sync_api import sync_playwright
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
out = sys.argv[1]; q = sys.argv[2] if len(sys.argv) > 2 else ""
srv = subprocess.Popen([sys.executable, "-m", "http.server", "8767", "--bind", "127.0.0.1"], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(0.8)
try:
    with sync_playwright() as pw:
        b = pw.chromium.launch(); pg = b.new_page(viewport={"width": 1600, "height": 1000})
        pg.on("pageerror", lambda e: print("PAGEERROR", e))
        pg.goto(f"http://127.0.0.1:8767/tools/plates.html?{q}"); pg.wait_for_function("document.title==='plates ready'"); pg.wait_for_timeout(2500)
        pg.screenshot(path=out, full_page=True); b.close()
finally: srv.terminate()
print("wrote", out)
