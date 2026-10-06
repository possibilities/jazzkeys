"""Reject blank/wrong-sized captures, without pretending this is visual review."""
import json
import re
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
    canvas = None
    if len(sys.argv) == 5:
        color = sys.argv[4]
        if not re.fullmatch(r"#[0-9a-fA-F]{6}", color):
            raise SystemExit("Invalid expected canvas color")
        expected = tuple(int(color[index:index + 2], 16) for index in (1, 3, 5))
        # The production disconnected layout leaves this margin as solid canvas.
        # This checks actual window pixels, independent of retained style metadata.
        sample = ImageStat.Stat(rgb.crop((4, 64, 12, 72))).mean
        if max(abs(actual - wanted) for actual, wanted in zip(sample, expected)) > 2:
            raise SystemExit(f"Canvas color mismatch: {sample}, expected {expected}")
        canvas = {"rectangle": [4, 64, 8, 8], "actualRGB": sample, "expectedRGB": expected}
    print(json.dumps({"dimensions": list(image.size), "colors": distinct,
                      "channelExtrema": extrema, "channelStddev": deviation,
                      "canvasColorCheck": canvas,
                      "visualInspection": "required"}))
