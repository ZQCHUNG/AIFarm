"""
Process ALL sprites: remove background + resize for tile grid.
Handles both building sprites and character sprites.
"""
import os
import shutil
from pathlib import Path
from io import BytesIO
from rembg import remove
from PIL import Image

SPRITES_DIR = Path(r"D:\Mine\claude-buddy\renderer\sprites")
BACKUP_DIR = SPRITES_DIR / "originals_backup"
BACKUP_DIR.mkdir(exist_ok=True)

# Character sprite target size (single character on transparent bg)
CHAR_SIZE = (48, 64)  # width x height — fits nicely in 1.5x2 tiles

# Building sprite sizes
BUILDING_SIZES = {
    "building_well":     (96, 96),
    "building_barn":     (192, 160),
    "building_windmill": (160, 192),
    "building_market":   (192, 128),
    "building_clock":    (96, 192),
    "building_townhall": (192, 160),
    "building_statue":   (96, 128),
}

# Animal sprite sizes
ANIMAL_SIZE = (48, 48)

def backup_file(src):
    """Backup original file if not already backed up."""
    name = src.stem + "_original" + src.suffix
    backup = BACKUP_DIR / name
    if not backup.exists():
        shutil.copy2(src, backup)
        return True
    return False

def process_sprite(src, target_w, target_h, use_lanczos=False):
    """Remove background, crop, resize, center on transparent canvas."""
    with open(src, "rb") as f:
        input_data = f.read()

    output_data = remove(input_data)
    img = Image.open(BytesIO(output_data)).convert("RGBA")

    # Crop to content
    bbox = img.getbbox()
    if bbox:
        img = img.crop(bbox)

    if img.width == 0 or img.height == 0:
        return False

    # Resize to fit target, maintain aspect ratio
    ratio = min(target_w / img.width, target_h / img.height)
    new_w = max(1, int(img.width * ratio))
    new_h = max(1, int(img.height * ratio))

    resample = Image.LANCZOS if use_lanczos else Image.NEAREST
    img = img.resize((new_w, new_h), resample)

    # Center horizontally, bottom-align vertically (anchor at feet/base)
    canvas = Image.new("RGBA", (target_w, target_h), (0, 0, 0, 0))
    offset_x = (target_w - new_w) // 2
    offset_y = target_h - new_h
    canvas.paste(img, (offset_x, offset_y), img)

    canvas.save(src)
    return True

def process_characters():
    """Process all char_*_*.png sprites."""
    print("=== Processing Character Sprites ===\n")
    char_files = sorted(SPRITES_DIR.glob("char_*_*.png"))
    # Skip sheet files
    char_files = [f for f in char_files if "sheet" not in f.stem]

    count = 0
    for src in char_files:
        backed_up = backup_file(src)
        status = "NEW" if backed_up else "UPDATE"
        print(f"  [{status}] {src.name} ...", end=" ", flush=True)
        try:
            if process_sprite(src, CHAR_SIZE[0], CHAR_SIZE[1]):
                print("OK")
                count += 1
            else:
                print("EMPTY")
        except Exception as e:
            print(f"ERROR: {e}")

    print(f"\n  Processed {count} character sprites.\n")

def process_buildings():
    """Process all building_*.png sprites."""
    print("=== Processing Building Sprites ===\n")
    for name, (tw, th) in BUILDING_SIZES.items():
        src = SPRITES_DIR / f"{name}.png"
        if not src.exists():
            print(f"  [SKIP] {name}.png not found")
            continue

        # Use original backup for reprocessing
        orig = BACKUP_DIR / f"{name}_original.png"
        if orig.exists():
            shutil.copy2(orig, src)
        else:
            backup_file(src)

        print(f"  [REMBG] {name}.png -> {tw}x{th} ...", end=" ", flush=True)
        try:
            if process_sprite(src, tw, th, use_lanczos=True):
                print("OK")
            else:
                print("EMPTY")
        except Exception as e:
            print(f"ERROR: {e}")

    print()

def process_animals():
    """Process animal_*.png sprites."""
    print("=== Processing Animal Sprites ===\n")
    animal_files = sorted(SPRITES_DIR.glob("animal_*.png"))
    animal_files = [f for f in animal_files if "sheet" not in f.stem]

    count = 0
    for src in animal_files:
        backed_up = backup_file(src)
        status = "NEW" if backed_up else "UPDATE"
        print(f"  [{status}] {src.name} ...", end=" ", flush=True)
        try:
            if process_sprite(src, ANIMAL_SIZE[0], ANIMAL_SIZE[1]):
                print("OK")
                count += 1
            else:
                print("EMPTY")
        except Exception as e:
            print(f"ERROR: {e}")

    print(f"\n  Processed {count} animal sprites.\n")

def main():
    print("=" * 50)
    print("  AIFarm Sprite Processor — rembg + resize")
    print("=" * 50 + "\n")

    process_buildings()
    process_characters()
    process_animals()

    print("=" * 50)
    print("  All done! Check preview.html to verify.")
    print("=" * 50)

if __name__ == "__main__":
    main()
