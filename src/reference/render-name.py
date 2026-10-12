"""Render the fixed mixed-case name as artwork, using a local Comic Sans MS font.

Usage: python render-name.py "/path/to/Comic Sans MS.ttf"
Only rendered name artwork is shipped; the system font file is never copied.
"""
import json
import math
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

font = ImageFont.truetype(sys.argv[1], 256)
words = ["Jinyuan", "Xu"]
tiles, layout, offset = [], {}, 0
for word in words:
    left, top, right, bottom = font.getbbox(word, anchor="ls")
    width, height = math.ceil(right-left)+8, math.ceil(bottom-top)+8
    tile = Image.new("L", (width, height))
    origin, baseline = 4-left, 4-top
    ImageDraw.Draw(tile).text((origin, baseline), word, font=font, fill=255, anchor="ls")
    tiles.append(tile)
    layout[word] = dict(y=offset, width=width, height=height,
                       origin=origin, baseline=baseline,
                       advance=font.getlength(word),
                       stops=[font.getlength(word[:i]) for i in range(len(word)+1)])
    offset += height

atlas = Image.new("L", (max(t.width for t in tiles), offset))
for word, tile in zip(words, tiles):
    atlas.paste(tile, (0, layout[word]["y"]))
here = Path(__file__).resolve().parent
atlas.save(here / "name-artwork.png", optimize=True)
(here / "name-artwork.json").write_text(json.dumps(dict(
    label="Jinyuan Xu — Comic Sans MS Regular rendered name artwork",
    capHeight=-font.getbbox("H", anchor="ls")[1], words=layout
), separators=(",", ":")) + "\n")
print("Rendered Comic Sans MS Regular name artwork:", atlas.size)
