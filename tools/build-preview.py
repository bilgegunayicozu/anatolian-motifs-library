#!/usr/bin/env python3
"""
build-preview.py — writes preview.html: the whole library in ONE self-contained file
(styles, p5, the data layer, all variants and the ES modules inlined) so it opens by
double-click from disk, without a server. The live site stays modular; this is a
review/portable copy.   python3 tools/build-preview.py
"""
import os, re, json

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
R = lambda *p: open(os.path.join(ROOT, *p), encoding="utf-8").read()

ORDER = ["rng.js", "palette.js", "motif.js", "weaverhand.js", "composition.js", "loom.js",
         "generator.js", "swatch.js", "index.js", "regions.js", "sketch.js"]

def bundle_module(name):
    src = R("src", name)
    exports = []
    # imports → destructure from the module table
    def imp(m):
        names = [n.strip() for n in m.group(1).split(",") if n.strip()]
        mod = os.path.basename(m.group(2))
        return "const { %s } = __M[%r];" % (", ".join(names), mod)
    src = re.sub(r"import\s*\{([^}]*)\}\s*from\s*'([^']+)';", imp, src)
    def exp(m):
        kind, rest = m.group(1), m.group(2)
        if kind in ("function", "async function", "class"):
            exports.append(re.match(r"\s*([A-Za-z_$][\w$]*)", rest).group(1))
            return f"{kind} {rest}"
        # const/let: one declaration per export line in this codebase
        exports.append(re.match(r"\s*([A-Za-z_$][\w$]*)", rest).group(1))
        return f"{kind} {rest}"
    src = re.sub(r"^export\s+(async function|function|class|const|let)\s+(.*)$", exp, src, flags=re.M)
    assert not re.search(r"^export ", src, flags=re.M), f"unhandled export in {name}"
    body = src
    return "__M[%r] = (() => {\n%s\nreturn { %s };\n})();\n" % (name, body, ", ".join(dict.fromkeys(exports)))

html = R("index.html")
css = R("style.css")
p5 = R("vendor", "p5.min.js")

data = {f: json.load(open(os.path.join(ROOT, "data", f), encoding="utf-8")) for f in ["motifs.json", "regions.json", "compositions.json", "dyes.json"]}
variants = {}
for f in sorted(os.listdir(os.path.join(ROOT, "data", "variants"))):
    variants[f[:-5]] = json.load(open(os.path.join(ROOT, "data", "variants", f), encoding="utf-8"))
fav = R("assets", "favicon.svg")
fav_uri = "data:image/svg+xml;utf8," + fav.replace("#", "%23").replace('"', "'")

modules = "\n".join(bundle_module(n) for n in ORDER)
js = "const __M = {};\n" + modules

out = html
out = out.replace('<link rel="stylesheet" href="./style.css" />', "<style>\n" + css + "\n</style>")
out = out.replace('<script src="./vendor/p5.min.js"></script>', "<script>\n" + p5 + "\n</script>")
out = out.replace('<link rel="icon" href="./assets/favicon.svg" type="image/svg+xml" />', f'<link rel="icon" href="{fav_uri}" type="image/svg+xml" />')
out = re.sub(r'\s*<link rel="apple-touch-icon"[^>]*/>', "", out)
out = re.sub(r'\s*<meta (property="og:image[^"]*"|name="twitter:image")[^>]*/>', "", out)
inline_data = ("<script>\nwindow.__KILIM_DATA__ = " + json.dumps(data, ensure_ascii=False, separators=(",", ":")) +
               ";\nwindow.__KILIM_VARIANTS__ = " + json.dumps(variants, ensure_ascii=False, separators=(",", ":")) + ";\n</script>")
out = out.replace('<script type="module" src="./src/sketch.js"></script>',
                  inline_data + '\n<script type="module">\n' + js + '\n</script>')
out = out.replace('href="./README.md">source &amp; method</a>', 'href="https://github.com">source &amp; method</a>')

path = os.path.join(ROOT, "preview.html")
open(path, "w", encoding="utf-8").write(out)
print("wrote preview.html", round(os.path.getsize(path) / 1e6, 2), "MB")
