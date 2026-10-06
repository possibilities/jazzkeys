"""Reject blank/wrong-sized captures, without pretending this is visual review."""
import json
import sys
from PIL import Image, ImageStat

path, width, height = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
with Image.open(path) as image:
    image.load()
    if image.size != (width, height):
        raise SystemExit(f"Wrong native capture dimensions: {image.size}, expected {(width, height)}")
    rgb = image.convert("RGB")
    extrema = rgb.getextrema()
    deviation = ImageStat.Stat(rgb).stddev
    colors = rgb.getcolors(width * height)
    distinct = len(colors) if colors else width * height
    if distinct < 64 or max(deviation) < 5:
        raise SystemExit(f"Blank or nearly blank native capture: {distinct} colors, deviation {deviation}")
    print(json.dumps({"dimensions": list(image.size), "colors": distinct,
                      "channelExtrema": extrema, "channelStddev": deviation,
                      "visualInspection": "required"}))
