"""
Process building sprites: remove background + resize for tile grid.
Uses rembg for background removal and Pillow for resizing.
"""
import os
from pathlib import Path
from rembg import remove
from PIL import Image

SPRITES_DIR = Path(r"D:\Mine\claude-buddy\renderer\sprites")
BACKUP_DIR = SPRITES_DIR / "originals_backup"

# Building sprite sizes (width x height in pixels) - matched to tile grid
# Each tile is 32px, buildings span multiple tiles — larger for better detail
BUILDING_SIZES = {
    "building_well":     (96, 96),     # 3x3 tiles
    "building_barn":     (192, 160),   # 6x5 tiles
    "building_windmill": (160, 192),   # 5x6 tiles
    "building_market":   (192, 128),   # 6x4 tiles
    "building_clock":    (96, 192),    # 3x6 tiles
    "building_townhall": (192, 160),   # 6x5 tiles
    "building_statue":   (96, 128),    # 3x4 tiles
}

def process_sprite(name):
    src = SPRITES_DIR / f"{name}.png"
    if not src.exists():
        print(f"  [SKIP] {name}.png not found")
        return

    # Backup original
    BACKUP_DIR.mkdir(exist_ok=True)
    backup = BACKUP_DIR / f"{name}_original.png"
    if not backup.exists():
        import shutil
        shutil.copy2(src, backup)
        print(f"  [BACKUP] {name}_original.png")

    # Load and remove background
    print(f"  [REMBG] Processing {name}.png ...")
    with open(src, "rb") as f:
        input_data = f.read()
    output_data = remove(input_data)

    # Open the result
    from io import BytesIO
    img = Image.open(BytesIO(output_data)).convert("RGBA")

    # Crop to content (trim transparent borders)
    bbox = img.getbbox()
    if bbox:
        img = img.crop(bbox)

    # Resize to target size
    target_w, target_h = BUILDING_SIZES.get(name, (96, 96))

    # Maintain aspect ratio, fit within target
    ratio = min(target_w / img.width, target_h / img.height)
    new_w = int(img.width * ratio)
    new_h = int(img.height * ratio)
    img = img.resize((new_w, new_h), Image.NEAREST)  # Pixel art: nearest neighbor

    # Center on transparent canvas of target size
    canvas = Image.new("RGBA", (target_w, target_h), (0, 0, 0, 0))
    offset_x = (target_w - new_w) // 2
    offset_y = target_h - new_h  # Bottom-align (anchor at base)
    canvas.paste(img, (offset_x, offset_y), img)

    # Save
    canvas.save(src)
    print(f"  [DONE] {name}.png -> {target_w}x{target_h} (content: {new_w}x{new_h})")

def main():
    print("=== Building Sprite Processor ===\n")
    for name in BUILDING_SIZES:
        print(f"Processing: {name}")
        try:
            process_sprite(name)
        except Exception as e:
            print(f"  [ERROR] {e}")
        print()
    print("=== Done! ===")

if __name__ == "__main__":
    main()
