#!/usr/bin/env python3
"""Pack the art pack for shipping: picked variants only, resized, as WebP.

assets/ (from hush_asset_forge.py) is hundreds of MB, with every variant. This writes the small
copy the game loads and git stores to apps/game/public/hush-assets/. Re-run after changing a pick
or generating more art:  pnpm assets:pack   (needs Pillow)
"""
import json
import shutil
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "assets"
OUT = ROOT / "apps/game/public/hush-assets"

# Longest side in pixels. Anything bigger is wasted on a 1600x900 stage.
MAX_SIDE = {
    "backgrounds": 1920,
    "keyart": 1920,
    "report": 1600,
    "story": 1280,
    "ui": 1400,
    "foregrounds": 1600,
    "characters": 1100,
    "effects": 1280,
    "props": 512,
    "icons": 160,
    "badges": 200,
    "stamps": 512,
    "tutorial": 640,
    "tapes": 640,
    "loading": 960,
}
SKIP_CATEGORIES = {"anchors", "frames"}
# Only sheets the game actually plays. The rest are too large to be worth shipping.
SHEETS = ["listener_walk"]


def main() -> None:
    manifest = json.loads((SOURCE / "manifest.json").read_text(encoding="utf-8"))
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)

    packed: dict = {"images": {}, "animations": {}}
    total = 0
    for image_id, info in manifest["images"].items():
        category = info["category"]
        # station_plate is a real image in the anchors group, used as title art.
        if category in SKIP_CATEGORIES and image_id != "station_plate":
            continue
        files = info["files"]
        picked = info.get("picked", 1)
        source_file = files[picked - 1] if 0 < picked <= len(files) else files[0]
        source = SOURCE / source_file
        if not source.exists():
            print(f"missing {source_file}")
            continue
        image = Image.open(source)
        image = image.convert("RGBA" if info.get("transparent") else "RGB")
        image.thumbnail((MAX_SIDE.get(category, 1280),) * 2, Image.LANCZOS)
        name = f"{image_id}.webp"
        path = OUT / category / name
        path.parent.mkdir(exist_ok=True)
        image.save(path, "WEBP", quality=84, method=6)
        total += path.stat().st_size
        packed["images"][image_id] = {
            "category": category,
            "transparent": bool(info.get("transparent")),
            "picked": 1,
            "files": [f"{category}/{name}"],
            "width": image.width,
            "height": image.height,
        }

    for name in SHEETS:
        info = manifest["animations"].get(name)
        if not info or not info.get("sheet") or not (SOURCE / info["sheet"]).exists():
            print(f"missing sheet {name}")
            continue
        sheet = Image.open(SOURCE / info["sheet"]).convert("RGBA")
        path = OUT / "anim" / f"{name}.webp"
        path.parent.mkdir(exist_ok=True)
        sheet.save(path, "WEBP", quality=84, method=6)
        total += path.stat().st_size
        packed["animations"][name] = {
            "kind": info["kind"],
            "fps": info["fps"],
            "frameWidth": info["frameWidth"],
            "frameHeight": info["frameHeight"],
            "frameCount": info["frameCount"],
            "sheet": f"anim/{name}.webp",
        }

    (OUT / "manifest.json").write_text(json.dumps(packed, indent=1), encoding="utf-8")
    print(f"{len(packed['images'])} images, {total / 1e6:.1f} MB -> {OUT}")


if __name__ == "__main__":
    main()
