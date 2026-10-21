"""Rebuild with fonttools 4.63.0 + Brotli 1.2.0; see README.md for upstream URLs.
Run from repository root: python3 tests/fixtures/fonts/subset.py
"""
from pathlib import Path
from hashlib import sha256
from fontTools.ttLib import TTFont
from fontTools import subset

output = Path("tests/fixtures/fonts")
sources = [
    ("/tmp/studio-ptmono.ttf", "studio-fixture.ttf", "Studio Fixture Mono",
     "cbe732b3b8fd211fd986ebdfc9b870ddeca4faab0bb5425fc509b37f9b4ac804"),
    ("/tmp/studio-sourcesans.otf", "studio-fixture.otf", "Studio Fixture Sans",
     "08df266400933d3178d081a45f94a08814c3e55b4b7dd2e0ff69cb1329f13ab6"),
]
for source, target, family, expected_hash in sources:
    if sha256(Path(source).read_bytes()).hexdigest() != expected_hash:
        raise ValueError("Upstream file hash differs: " + source)
    font = TTFont(source, recalcTimestamp=False)
    options = subset.Options()
    options.name_IDs = ["*"]
    options.name_legacy = True
    options.name_languages = ["*"]
    subsetter = subset.Subsetter(options=options)
    subsetter.populate(unicodes=list(range(32, 127)) + list(range(0x410, 0x450)) + [0x401, 0x451])
    subsetter.subset(font)
    for record in font["name"].names:
        if record.nameID in [1, 3, 4, 6, 16, 17, 18]:
            value = (family.replace(" ", "") + "-Regular" if record.nameID in [3, 6]
                     else "Regular" if record.nameID == 17 else family)
            record.string = value.encode(record.getEncoding())
    if "CFF " in font:
        cff = font["CFF "].cff
        cff.topDictIndex[0].FamilyName = family
        cff.topDictIndex[0].FullName = family
        cff.fontNames = [family.replace(" ", "") + "-Regular"]
    font.save(output / target)
    if target.endswith("ttf"):
        for flavor in ["woff", "woff2"]:
            font.flavor = flavor
            font.save(output / ("studio-fixture." + flavor))
