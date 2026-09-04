#!/usr/bin/env python3
"""
build-data.py — turns the motif library (motifs/*.json) + the research catalog
into the static data layer the site reads:

    data/motifs.json          28 core motifs: loom-scale grid, category, meaning,
                              regions (reverse-mapped from regions.json), notes
    data/regions.json         the 20 research regions (RESEARCH.md §3)
    data/compositions.json    the 10 composition zone-maps (RESEARCH.md §2)
    data/dyes.json            natural-dye palette (RESEARCH.md §4.1)
    data/variants/<key>.json  the auto-traced book variants per motif family,
                              bit-packed per row ('.' empty, '1' primary,
                              '2' secondary) — loaded lazily by the index.

Re-runnable:  python3 tools/build-data.py
"""
import os, json, glob, re, collections

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
LIB = os.path.join(ROOT, "motifs")
OUT = os.path.join(ROOT, "data")
os.makedirs(os.path.join(OUT, "variants"), exist_ok=True)

# ---------------------------------------------------------------- dyes (§4.1)
DYES = {
    "madder_deep":  ("#8B3A2A", "primary red, oxidized"),
    "madder_brick": ("#A0432F", "lighter red field"),
    "madder_faded": ("#B86A52", "sun-bleached red"),
    "indigo_deep":  ("#2D4159", "primary blue"),
    "indigo_dusty": ("#3B5876", "faded blue"),
    "walnut_dark":  ("#4A3826", "dark outline brown"),
    "walnut_light": ("#6B5240", "field brown"),
    "henna_gold":   ("#B89456", "aged yellow"),
    "henna_pale":   ("#C8A86A", "pale yellow / cream-gold"),
    "ivory_wool":   ("#E8DCC4", "undyed wool ground"),
    "oatmeal":      ("#C4B594", "aged ivory"),
    "aubergine":    ("#4A2D3A", "wild-grape purple"),
    "sage":         ("#6E7240", "olive green"),
    "iron_black":   ("#2C2620", "iron-mordant near-black"),
    "terracotta":   ("#B05535", "burnt orange"),
}
HEX2DYE = {v[0].lower(): k for k, v in DYES.items()}

# ------------------------------------------------------------- regions (§3)
# key, name, group, signature, palette (dye keys), motif_pool, compositions, ratios, weave, thin(⚠️)
REGIONS = [
 ("konya", "Konya", "Central Anatolia",
  "Bold, clear, large-scale; the opposite of busy; ivory ground common; historically the most prestigious center.",
  ["madder_brick","henna_gold","iron_black","sage","ivory_wool","terracotta","indigo_deep"],
  ["elibelinde","kocboynuzu","goz","cengel","basamakli-gobek","suyolu"],
  ["mihrabli","khesti","madalyonlu","tumzemin"], ["namazlik","buyuk","sergi"], "slit", False),
 ("karapinar", "Karapınar", "Central Anatolia",
  "Konya province. Prayer kilims, primitive and tribal; the tell is sawtoothed diamonds — a slit-avoidance technique; pale ground, darker motifs.",
  ["oatmeal","ivory_wool","madder_deep","indigo_deep","iron_black"],
  ["goz","cengel","disli-baklava","muska","kandil"],
  ["mihrabli","khesti"], ["namazlik","sergi"], "slit", False),
 ("cappadocia", "Cappadocia (Niğde / Taşpınar)", "Central Anatolia",
  "Central-medallion and all-over geometric; Taşpınar is the fine-weave center; softer than Konya.",
  ["madder_brick","indigo_dusty","henna_pale","ivory_wool","walnut_light"],
  ["basamakli-gobek","elibelinde","yildiz","bereket"],
  ["madalyonlu","tumzemin"], ["sergi","buyuk"], "slit", False),
 ("kirsehir", "Kırşehir", "Central Anatolia",
  "Strong prayer-niche tradition; clear red with a characteristic yellow-green. Fame is mostly in pile prayer rugs; kilim identity under-documented.",
  ["madder_brick","sage","ivory_wool","indigo_deep"],
  ["kandil","suyolu","goz"],
  ["mihrabli"], ["namazlik"], "slit", True),
 ("sivrihisar", "Sivrihisar", "Central Anatolia",
  "West of Ankara. Vertically stacked prayer arches (bacalı, the chimney); a column of niches makes it unmistakable; elibelinde common.",
  ["madder_deep","ivory_wool","indigo_deep","henna_gold"],
  ["elibelinde","kandil"],
  ["bacali","mihrabli"], ["namazlik","yolluk"], "slit", False),
 ("manisa", "Manisa", "Western Anatolia",
  "Fine work, lighter and warmer palette, smaller motifs; the Gördes / Kula / Manastır group uses simple patterns in vivid colours.",
  ["henna_pale","madder_faded","indigo_dusty","ivory_wool"],
  ["yildiz","karanfil","goz"],
  ["mihrabli","madalyonlu"], ["sergi","namazlik"], "slit", False),
 ("aydin", "Aydın", "Western Anatolia",
  "The busy one — more infill than Konya; small squarish emblems repeated vertically, hooked motifs, large medallions, long narrow mihrab; also two-half aynalı.",
  ["madder_brick","henna_gold","indigo_deep","ivory_wool","sage"],
  ["elibelinde","cengel","goz","yildiz"],
  ["aynali","mihrabli","madalyonlu","tumzemin"], ["sergi","buyuk"], "slit", False),
 ("usak", "Uşak", "Western Anatolia",
  "Large-scale, open, balanced; origin of the star-and-medallion carpet; muted warm earth tones.",
  ["henna_gold","terracotta","indigo_dusty","ivory_wool","sage"],
  ["yildiz","akrep","el-parmak-tarak","basamakli-gobek"],
  ["madalyonlu","tumzemin"], ["buyuk","sergi"], "slit", False),
 ("bergama", "Bergama", "Western Anatolia",
  "Bright reds, bold medallions; faithful to Seljuk geometry; stylized tree of life and ram's horn; zili / cicim with crosses-in-squares.",
  ["madder_brick","indigo_deep","ivory_wool","iron_black"],
  ["kocboynuzu","hayatagaci","sandik","hac"],
  ["madalyonlu","tumzemin","bandli"], ["sergi","heybe"], "cicim", False),
 ("milas", "Milas", "Western Anatolia",
  "Aegean south-west. Red-ground prayer rugs, long narrow fields, angular gabled mihrab, wide borders; an alem panel of carnation and tulip above the niche.",
  ["madder_deep","terracotta","sage","ivory_wool"],
  ["kandil","karanfil","lale","suyolu"],
  ["mihrabli","madalyonlu"], ["namazlik"], "slit", False),
 ("balikesir", "Balıkesir (Yüncü)", "Western Anatolia",
  "Dark ground, bold and sparing; the signature is a tree of life or a pole with ram's horns; madder and indigo; small square format; saf niches side by side.",
  ["aubergine","madder_deep","indigo_deep","sage"],
  ["hayatagaci","kocboynuzu","goz"],
  ["aynali","tumzemin","saf"], ["heybe","sergi"], "slit", False),
 ("kars", "Kars", "Eastern Anatolia",
  "Far east, near the Caucasus. Bold tribal; large stepped medallions; vertical diamonds with crosses inside; yellow and black prominent.",
  ["terracotta","henna_gold","iron_black","madder_brick","sage"],
  ["basamakli-gobek","hac","goz","kurtagzi"],
  ["madalyonlu","tumzemin","bandli"], ["yolluk","buyuk"], "slit", False),
 ("erzurum", "Erzurum", "Eastern Anatolia",
  "Eastern caravan route. Prayer kilims larger than elsewhere; double-ended niches; tree of life as border and centre; wolf-track borders.",
  ["madder_deep","ivory_wool","indigo_deep","walnut_dark"],
  ["hayatagaci","kurtagzi","kandil"],
  ["cift-mihrab","mihrabli"], ["namazlik","buyuk"], "slit", False),
 ("van", "Van", "Eastern Anatolia",
  "Lake Van, far south-east. Heavy wolf-track presence, bold geometric medallions, dark saturated grounds; the most protective-motif-dense region.",
  ["indigo_deep","madder_deep","iron_black","henna_gold"],
  ["kurtagzi","goz","ejder","muska","hac"],
  ["madalyonlu","tumzemin","saf"], ["sergi","heybe"], "slit", True),
 ("sivas", "Sivas", "Eastern Anatolia",
  "Eastern central. Bold vibrant colours; geometry and stripes; nature motifs alongside geometry; dense horizontal banding.",
  ["madder_deep","indigo_deep","sage","henna_gold","ivory_wool"],
  ["elibelinde","kocboynuzu","yildiz","suyolu"],
  ["bandli","tumzemin"], ["sergi","yolluk"], "slit", False),
 ("malatya", "Malatya", "South-eastern Anatolia",
  "Fine workshop and regional kilims; large Kurdish-format kilims use a limited bold design set; runner format, elibelinde-heavy, deep reds.",
  ["madder_deep","indigo_deep","walnut_dark","ivory_wool"],
  ["elibelinde","kocboynuzu","suyolu"],
  ["bandli","mihrabli"], ["yolluk","namazlik"], "slit", False),
 ("gaziantep", "Gaziantep", "South-eastern Anatolia",
  "Horizontal colour bands with three joined serrated diamonds filled with stars; white-cotton highlights; narrow reciprocal borders; red-predominant; large kilims in two halves.",
  ["madder_deep","indigo_deep","sage","walnut_light","ivory_wool"],
  ["disli-baklava","yildiz","ask-birlesim"],
  ["bandli","aynali"], ["sergi","yolluk"], "slit", False),
 ("adiyaman", "Adıyaman", "South-eastern Anatolia",
  "Dark-ground bold geometric; cicim supplementary-weft gives a raised, textured surface. Adıyaman-specific documentation is sparse.",
  ["madder_deep","indigo_deep","iron_black","ivory_wool"],
  ["goz","muska","disli-baklava","kurtagzi"],
  ["tumzemin","bandli"], ["sergi","heybe"], "cicim", True),
 ("dosemealti", "Döşemealtı (Antalya)", "Mediterranean",
  "Earthy beige, brown and rust grounds with blue, red and green accents; root-dyed wool; a horizontal loom allows larger, more complex designs.",
  ["walnut_light","terracotta","indigo_deep","madder_brick","sage","ivory_wool"],
  ["basamakli-gobek","kocboynuzu","yildiz","goz"],
  ["madalyonlu","tumzemin"], ["sergi","buyuk"], "slit", False),
 ("fethiye-mut", "Fethiye – Mut", "Mediterranean",
  "Taurus and coast. Fethiye favours an empty monochrome centre flanked by two diamond-packed ends; Mut is nomadic with bold serrated medallions; sun-faded reds and pinks.",
  ["madder_faded","henna_gold","indigo_dusty","ivory_wool"],
  ["elibelinde","hayatagaci","kus","basamakli-gobek"],
  ["bos-gobek","madalyonlu"], ["sergi","buyuk"], "slit", False),
]

RATIOS = {
    "namazlik": {"name": "Namazlık", "en": "prayer kilim", "w": 3, "h": 5},
    "yolluk":   {"name": "Yolluk",   "en": "runner",       "w": 1, "h": 3},
    "sergi":    {"name": "Sergi",    "en": "throw kilim",  "w": 2, "h": 3},
    "buyuk":    {"name": "Büyük",    "en": "large floor kilim", "w": 3, "h": 4},
    "heybe":    {"name": "Heybe",    "en": "saddlebag face", "w": 1, "h": 1},
}

# -------------------------------------------------------- compositions (§2)
COMPOSITIONS = {
 "mihrabli": ("Mihrablı", "prayer niche", "Single niche pointing to the qibla; a kandil hangs from the apex or a tree of life rises from the base. Directional.", True, """
B B B B B B B B B B B B B B B B
B g g g g g g g g g g g g g g B
B g . . . . a a a a . . . . g B
B g . . . A A N N A A . . . g B
B g . . A A N N N N A A . . g B
B g . A A N N N N N N A A . g B
B g . A N N N N N N N N A . g B
B g A A N N N N N N N N A A g B
B g A N N N N N k N N N N A g B
B g A N N N N N N N N N N A g B
B g A N N N N N N N N N N A g B
B g A N N N N N N N N N N A g B
B g A A A A A A A A A A A A g B
B g g g g g g g g g g g g g g B
B B B B B B B B B B B B B B B B"""),
 "cift-mihrab": ("Çift mihrab", "double niche", "Two facing arches mirrored across the horizontal centre, an anchor in each. Erzurum.", True, """
B B B B B B B B B B B B B B B B
B g g g g g g g g g g g g g g B
B g . . . A a a a a A . . . g B
B g . . A A N N N N A A . . g B
B g . A A N N N N N N A A . g B
B g A A N N N N N N N N A A g B
B g A N N N N k N N N N N A g B
B g A N N N N N N N N N N A g B
B g A N N N N k N N N N N A g B
B g A A N N N N N N N N A A g B
B g . A A N N N N N N A A . g B
B g . . A A N N N N A A . . g B
B g . . . A a a a a A . . . g B
B g g g g g g g g g g g g g g B
B B B B B B B B B B B B B B B B"""),
 "bacali": ("Bacalı", "chimney stack", "Niches stacked vertically, all pointing up; each a small arch, a field and an anchor. Sivrihisar.", True, """
B B B B B B B B B B B B
B g g g g g g g g g g B
B g . a a a a a a . g B
B g A N N N N N N A g B
B g A N N k N N N A g B
B g A A A A A A A A g B
B g . a a a a a a . g B
B g A N N N N N N A g B
B g A N N k N N N A g B
B g A A A A A A A A g B
B g . a a a a a a . g B
B g A N N N N N N A g B
B g A N N k N N N A g B
B g g g g g g g g g g B
B B B B B B B B B B B B"""),
 "saf": ("Saf", "row of niches", "Vertical walls divide the field into compartments side by side, each capped by an apex and holding an anchor. Communal prayer kilim; Yüncü, Van.", True, """
B B B B B B B B B B B B B
B g g g g g g g g g g g B
B g A a A a A a A a A g B
B g A N A N A N A N A g B
B g A k A k A k A k A g B
B g A N A N A N A N A g B
B g A N A N A N A N A g B
B g g g g g g g g g g g B
B B B B B B B B B B B B B"""),
 "bandli": ("Bandlı", "banded field", "Three to nine horizontal bands, each one motif repeated across; plain strips between; palette may shift band to band. Gaziantep, Sivas.", False, """
B B B B B B B B B B B B B B B B
B g g g g g g g g g g g g g g B
B g r r r r r r r r r r r r g B
B g . . . . . . . . . . . . g B
B g s s s s s s s s s s s s g B
B g . . . . . . . . . . . . g B
B g r r r r r r r r r r r r g B
B g . . . . . . . . . . . . g B
B g s s s s s s s s s s s s g B
B g . . . . . . . . . . . . g B
B g r r r r r r r r r r r r g B
B g g g g g g g g g g g g g g B
B B B B B B B B B B B B B B B B"""),
 "tumzemin": ("Tüm zemin", "all-over field", "One motif tiled on a half-drop lattice; orientation and colour alternate per row; no focal point. Konya elibelinde grids.", False, """
B B B B B B B B B B B B B B B B
B g g g g g g g g g g g g g g B
B g m . m . m . m . m . m . g B
B g . m . m . m . m . m . m g B
B g m . m . m . m . m . m . g B
B g . m . m . m . m . m . m g B
B g m . m . m . m . m . m . g B
B g . m . m . m . m . m . m g B
B g m . m . m . m . m . m . g B
B g g g g g g g g g g g g g g B
B B B B B B B B B B B B B B B B"""),
 "khesti": ("Khesti", "staggered compartments", "The field split into compartments on a brick grid, each holding one motif; the row-to-row offset is the rhythm. Konya panelled kilims.", False, """
B B B B B B B B B B B B B B B B
B g g g g g g g g g g g g g g B
B g C C C | C C C | C C C | g B
B g C m C | C m C | C m C | g B
B g C C C | C C C | C C C | g B
B g - - - - - - - - - - - - g B
B g | C C C | C C C | C C C g B
B g | C m C | C m C | C m C g B
B g | C C C | C C C | C C C g B
B g - - - - - - - - - - - - g B
B g C C C | C C C | C C C | g B
B g C m C | C m C | C m C | g B
B g C C C | C C C | C C C | g B
B g g g g g g g g g g g g g g B
B B B B B B B B B B B B B B B B"""),
 "madalyonlu": ("Madalyonlu", "medallion", "A diamond medallion on an open field, its anchor a stepped göbek; one or three stacked; corners often carry quarter-medallions. Uşak, Kars.", False, """
B B B B B B B B B B B B B B B B
B g g g g g g g g g g g g g g B
B g N N N N N N N N N N N N g B
B g N N N N N M M N N N N N g B
B g N N N N M M M M N N N N g B
B g N N N M M M M M M N N N g B
B g N N M M M m m M M M N N g B
B g N M M M m m m m M M M N g B
B g N N M M M m m M M M N N g B
B g N N N M M M M M M N N N g B
B g N N N N M M M M N N N N g B
B g N N N N N M M N N N N N g B
B g N N N N N N N N N N N N g B
B g g g g g g g g g g g g g g B
B B B B B B B B B B B B B B B B"""),
 "bos-gobek": ("Boş göbek", "open centre", "Centre deliberately sparse — one open medallion outline on plain ground; two end panels packed with diamonds. The negative space is the point. Fethiye.", False, """
B B B B B B B B B B B B B B B B
B g g g g g g g g g g g g g g B
B g D m D m D m D m D m D m g B
B g D D D D D D D D D D D D g B
B g N N N N N N N N N N N N g B
B g N N N N O O O O N N N N g B
B g N N N N O . . O N N N N g B
B g N N N N O O O O N N N N g B
B g N N N N N N N N N N N N g B
B g D D D D D D D D D D D D g B
B g D m D m D m D m D m D m g B
B g g g g g g g g g g g g g g B
B B B B B B B B B B B B B B B B"""),
 "aynali": ("Aynalı", "mirrored panels", "The field split by a central axis; the top panel is designed and the bottom is its mirror. Aydın, Yüncü.", False, """
B B B B B B B B B B B B B B B B
B g g g g g g g g g g g g g g B
B g T T T T m m m m T T T T g B
B g T T m m m m m m T T T T g B
B g T m m m T T m m m T T T g B
B g M M M M M M M M M M M M g B
B g L m m m T T m m m L L L g B
B g L L m m m m m m L L L L g B
B g L L L L m m m m L L L L g B
B g g g g g g g g g g g g g g B
B B B B B B B B B B B B B B B B"""),
}

# --------------------------------------------------------- core motifs (§5)
# key -> (nameTr, nameEn, category, meaning, curvilinear, variations_note)
CORE = {
 "elibelinde": ("Elibelinde", "Hands on hips", "feminine", "Mother goddess; motherhood, fertility, femininity.", False,
   "Arms hook open or closed; skirt ±1 cell; feet splayed or joined; sometimes paired vertically, mother and daughter."),
 "yildiz": ("Yıldız", "Star", "feminine", "Happiness, productivity, a woman's fertility.", False,
   "Six- and eight-pointed forms; often nested inside a diamond or a serrated band."),
 "sandik": ("Sandık", "Chest / dowry", "feminine", "A girl ready for marriage.", False, None),
 "sacbagi": ("Saç Bağı", "Hair-band", "feminine", "Desire for marriage.", False, None),
 "kupe": ("Küpe", "Earring", "feminine", "Desire for marriage.", False, None),
 "kocboynuzu": ("Koçboynuzu", "Ram's horn", "masculine", "Masculinity, heroism, power, fertility.", False,
   "Horns curl inward or outward; single, doubled, or stacked on a pole; the hook count varies with the loom count."),
 "bereket": ("Bereket", "Fertility", "union", "Elibelinde and ram's horn combined; abundance, family.", False, None),
 "bukagi": ("Bukağı", "Fetter", "union", "The horse hobble: family unity and the inseparable bond of lovers; continuity of the family.", False, None),
 "ask-birlesim": ("Aşk Birleşimi", "Love & union", "union", "Two interlocking halves embracing; love, togetherness. A two-colour motif.", False,
   "Always two-colour: primary and secondary halves interlock; sometimes set inside a six-pointed star (Gaziantep)."),
 "goz": ("Göz / Nazarlık", "Eye", "protective", "Protection from the evil eye.", False, None),
 "cengel": ("Çengel", "Hook", "protective", "Protection from the evil eye.", False, None),
 "pitrak": ("Pıtrak", "Burr", "protective", "Clings to trouble; protection from the evil eye.", False, None),
 "muska": ("Muska", "Amulet / triangle", "protective", "Protection from the evil eye.", False, None),
 "el-parmak-tarak": ("El, Parmak, Tarak", "Hand, finger, comb", "protective", "Protection, motherhood, marriage.", False, None),
 "kurtagzi": ("Kurt Ağzı / Kurt İzi", "Wolf's mouth / track", "protective", "Protection from wolves.", False, None),
 "akrep": ("Akrep", "Scorpion", "protective", "Protection from a scorpion's sting.", False, None),
 "hac": ("Haç", "Cross", "protective", "Divides the evil eye into four; faith and spirituality.", False,
   "Found inside diamonds and medallions; arms equal or slightly flared."),
 "suyolu": ("Su Yolu", "Running water", "life", "Vitality, the source of life.", False,
   "A meander band: stepped, hooked, or zig-zag; runs as a border more often than in the field."),
 "hayatagaci": ("Hayat Ağacı", "Tree of life", "life", "Eternity, immortality, paradise.", False, None),
 "kandil": ("Kandil", "Hanging oil lamp", "life", "Woven as a vow; hangs inside the mihrab niche.", False, None),
 "nar": ("Nar", "Pomegranate", "life", "Sacred fruit of paradise; fortune, fertility, longevity.", False, None),
 "kus": ("Kuş", "Bird", "life", "A flying bird brings good news; paired birds mean happiness.", False,
   "Single or paired; paired birds face each other across an axis."),
 "insan": ("İnsan", "Human figure", "life", "The human figure: creativity and the productive mind; longing, remembrance and the wish for children.", False, None),
 "karanfil": ("Karanfil", "Carnation", "life", "Garden-of-paradise border flower.", True,
   "Drawn curved in reality; on the loom the petals step diagonally and the stem softens to half-cells."),
 "lale": ("Lale", "Tulip", "life", "Paradise and abundance; the iconic Ottoman flower.", True,
   "Drawn curved in reality; the bud is stepped, the leaves soften at the edges."),
 "basamakli-gobek": ("Basamaklı Göbek", "Stepped medallion", "structural", "Kars / Caucasian centrepiece; a concentric hooked diamond.", False, None),
 "disli-baklava": ("Dişli Baklava", "Toothed diamond", "structural", "The Karapınar serration; also a chained band motif.", False,
   "Serration depth one or two cells; chained into a band (Gaziantep) or standing alone."),
 "ejder": ("Ejder", "Dragon", "mythical", "Guardian of treasures; master of air and water.", False, None),
}
CATEGORY_ORDER = ["feminine", "masculine", "union", "protective", "life", "structural", "mythical"]
CATEGORY_NAMES = {
    "feminine": ("Feminine", "Doğum ve Çoğalma", "Birth, motherhood, the wish to marry"),
    "masculine": ("Masculine", "Erkeklik", "Power, heroism, the ram's horn"),
    "union": ("Union", "Birleşim", "Man and woman, family, the bond"),
    "protective": ("Protective", "Koruma", "Against the evil eye, the wolf, the scorpion"),
    "life": ("Life", "Hayat", "Water, trees, birds, flowers, the lamp"),
    "structural": ("Structural", "Yapısal", "Medallions and bands that organise the field"),
    "mythical": ("Mythical", "Mitolojik", "Guardians of the other world"),
}

# family slug in the traced library -> core motif key
FAMILY2KEY = {"sandikli": "sandik"}

# book province string -> region key (substring match, first hit wins)
PROVINCE_RULES = [
 ("karapınar", "karapinar"), ("konya", "konya"), ("obruk", "konya"), ("hotamış", "konya"), ("ladik", "konya"),
 ("taşpınar", "cappadocia"), ("niğde", "cappadocia"), ("kayseri", "cappadocia"), ("nevşehir", "cappadocia"), ("cappadocia", "cappadocia"),
 ("kırşehir", "kirsehir"), ("mucur", "kirsehir"),
 ("sivrihisar", "sivrihisar"), ("eskişehir", "sivrihisar"),
 ("manisa", "manisa"), ("gördes", "manisa"), ("kula", "manisa"), ("manastır", "manisa"),
 ("aydın", "aydin"), ("çine", "aydin"),
 ("uşak", "usak"), ("eşme", "usak"),
 ("bergama", "bergama"), ("izmir", "bergama"), ("i̇zmir", "bergama"),
 ("milas", "milas"),
 ("fethiye", "fethiye-mut"), ("mut", "fethiye-mut"), ("mersin", "fethiye-mut"), ("muğla", "fethiye-mut"),
 ("balıkesir", "balikesir"), ("yüncü", "balikesir"), ("yağcıbedir", "balikesir"),
 ("kars", "kars"), ("ardahan", "kars"), ("digor", "kars"), ("kağızman", "kars"),
 ("erzurum", "erzurum"),
 ("van", "van"), ("hakkari", "van"), ("bitlis", "van"),
 ("sivas", "sivas"), ("şarkışla", "sivas"), ("yıldızeli", "sivas"), ("divriği", "sivas"),
 ("malatya", "malatya"), ("pötürge", "malatya"), ("elazığ", "malatya"), ("keban", "malatya"),
 ("gaziantep", "gaziantep"), ("kahramanmaraş", "gaziantep"), ("hatay", "gaziantep"), ("reyhanlı", "gaziantep"),
 ("adıyaman", "adiyaman"),
 ("döşemealtı", "dosemealti"), ("antalya", "dosemealti"), ("korkuteli", "dosemealti"),
]
def province2region(p):
    if not p: return None
    s = p.lower()
    for needle, key in PROVINCE_RULES:
        if needle in s: return key
    return None

# ------------------------------------------------------------------ helpers
def load(path):
    with open(path, encoding="utf-8") as f: return json.load(f)

def pack_cells(cells, primary="#8b3a2a"):
    """rows of hex-or-null -> list of strings: '.' empty, '1' primary, '2' secondary."""
    colours = collections.Counter(c.lower() for r in cells for c in r if c)
    if not colours: return [ "." * len(cells[0]) ] * len(cells)
    order = [c for c, _ in colours.most_common()]
    prim = primary if primary in order else order[0]
    rows = []
    for r in cells:
        rows.append("".join("." if not c else ("1" if c.lower() == prim else "2") for c in r))
    return rows

def dump(name, obj):
    p = os.path.join(OUT, name)
    with open(p, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
    print(f"  wrote {name:32s} {os.path.getsize(p)/1024:8.1f} KB")

# --------------------------------------------------------------------- main
print("build-data")
dump("dyes.json", {k: {"hex": v[0], "note": v[1]} for k, v in DYES.items()})

regions = []
for (key, name, group, sig, pal, pool, comps, ratios, weave, thin) in REGIONS:
    regions.append({"key": key, "name": name, "group": group, "signature": sig,
                    "palette": pal, "motif_pool": pool, "compositions": comps,
                    "aspect_ratios": ratios, "weave": weave, "thinly_sourced": thin})
dump("regions.json", {"ratios": RATIOS, "regions": regions})

comps = {}
for key, (name, en, note, directional, zmap) in COMPOSITIONS.items():
    rows = [r.split() for r in zmap.strip("\n").split("\n")]
    comps[key] = {"key": key, "name": name, "en": en, "note": note,
                  "directional": directional, "zones": ["".join(r) for r in rows]}
dump("compositions.json", comps)

# reverse map motif -> regions
motif_regions = collections.defaultdict(list)
for r in regions:
    for m in r["motif_pool"]: motif_regions[m].append(r["key"])

# core motifs: grids from motifs/<key>.json
motifs, missing = [], []
for key, (tr, en, cat, meaning, curvi, note) in CORE.items():
    src = os.path.join(LIB, key + ".json")
    if not os.path.exists(src):
        # bukağı / insan have no hand grid yet: seed from their smallest traced variant later
        missing.append(key); grid = None
    else:
        m = load(src); grid = pack_cells(m["cells"])
    motifs.append({"key": key, "nameTr": tr, "nameEn": en, "category": cat, "meaning": meaning,
                   "curvilinear": curvi, "variations_note": note, "regions": motif_regions.get(key, []),
                   "grid": grid, "typical_size": [len(grid[0]), len(grid)] if grid else None})

# traced variants per family
files = sorted(glob.glob(os.path.join(LIB, "*-[0-9][0-9][0-9].json")))
fam_variants = collections.defaultdict(list)
for f in files:
    v = load(f)
    slug = re.sub(r"-\d{3}$", "", v["id"])
    key = FAMILY2KEY.get(slug, slug)
    grid = pack_cells(v["cells"])
    # trim empty margins
    while grid and set(grid[0]) == {"."}: grid = grid[1:]
    while grid and set(grid[-1]) == {"."}: grid = grid[:-1]
    if grid:
        cols = [i for i in range(len(grid[0])) if any(r[i] != "." for r in grid)]
        if cols: grid = [r[cols[0]:cols[-1] + 1] for r in grid]
    prov = (v.get("regions") or [None])[0]
    fam_variants[key].append({
        "id": v["id"], "no": v.get("sourceNo"), "page": v.get("sourcePage"),
        "technique": v.get("technique"), "province": prov, "region": province2region(prov),
        "twoTone": any("2" in r for r in grid), "curvilinear": bool(v.get("curvilinear")),
        "validated": "validate" not in (v.get("tags") or []) or v["id"] in {"kocboynuzu-066", "kocboynuzu-098"},
        "needsRedraw": "needs-redraw" in (v.get("tags") or []),
        "w": len(grid[0]) if grid else 0, "h": len(grid), "grid": grid,
    })

for key in missing:   # seed a loom-scale grid from the smallest clean traced variant
    vs = [x for x in fam_variants.get(key, []) if not x["needsRedraw"]]
    if not vs: continue
    best = min(vs, key=lambda x: x["w"] * x["h"])
    mm = next(m for m in motifs if m["key"] == key)
    mm["grid"] = best["grid"]; mm["typical_size"] = [best["w"], best["h"]]
    mm["grid_source"] = best["id"]
    print(f"  {key}: no hand grid, seeded from {best['id']} ({best['w']}×{best['h']})")

for m in motifs:
    vs = fam_variants.get(m["key"], [])
    m["variant_count"] = len(vs)
    provs = collections.Counter(x["province"] for x in vs if x["province"])
    m["variant_provinces"] = [p for p, _ in provs.most_common()]
    techs = collections.Counter(x["technique"] for x in vs if x["technique"])
    m["variant_techniques"] = [t for t, _ in techs.most_common()]
    # regions where the book places it (mapped), merged after the research pool
    extra = [x["region"] for x in vs if x["region"] and x["region"] not in m["regions"]]
    m["regions_documented"] = [r for r, _ in collections.Counter(extra).most_common()]

dump("motifs.json", {"categories": [{"key": k, "name": CATEGORY_NAMES[k][0], "tr": CATEGORY_NAMES[k][1],
                                     "note": CATEGORY_NAMES[k][2]} for k in CATEGORY_ORDER],
                     "motifs": motifs})

total = 0
for key, vs in fam_variants.items():
    vs.sort(key=lambda x: (x["page"] or 0, x["no"] or 0))
    dump(f"variants/{key}.json", {"key": key, "count": len(vs), "variants": vs})
    total += len(vs)
print(f"  {len(motifs)} motifs · {len(regions)} regions · {len(comps)} compositions · {total} variants")
