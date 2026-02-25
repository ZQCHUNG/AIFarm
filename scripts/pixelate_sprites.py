"""
Pixelate post-processing for all sprites.
Downscale + upscale with NEAREST to create consistent pixel art aesthetic.
Also applies color quantization to reduce AI-generated gradients.
"""
from pathlib import Path
from PIL import Image

SPRITES_DIR = Path(r"D:\Mine\claude-buddy\renderer\sprites")

# Pixelation factor: downscale to this fraction, then upscale back
# Lower = more pixelated. 0.5 = half resolution pixel grid
PIXEL_FACTOR_CHAR = 0.5      # 48x64 -> 24x32 -> 48x64
PIXEL_FACTOR_ANIMAL = 0.5    # 48x48 -> 24x24 -> 48x48
PIXEL_FACTOR_BUILDING = 0.5  # variable -> half -> back

# Color quantization: max colors per sprite (0 = skip)
MAX_COLORS = 32

CHAR_COLORS = ['blue', 'red', 'green', 'purple', 'orange', 'teal', 'pink', 'yellow']
ANIMALS = ['chicken', 'cow', 'pig', 'sheep', 'cat', 'dog']
DIRECTIONS = ['front', 'left', 'right', 'back']

BUILDING_NAMES = [
    'building_well', 'building_barn', 'building_windmill',
    'building_market', 'building_clock', 'building_townhall', 'building_statue',
]


def pixelate(img, factor):
    """Downscale then upscale with NEAREST for pixel art effect."""
    w, h = img.size
    small_w = max(1, int(w * factor))
    small_h = max(1, int(h * factor))

    # Split alpha channel to preserve it better
    if img.mode == 'RGBA':
        r, g, b, a = img.split()
        rgb = Image.merge('RGB', (r, g, b))

        # Downscale RGB
        small_rgb = rgb.resize((small_w, small_h), Image.NEAREST)
        # Upscale RGB
        pixel_rgb = small_rgb.resize((w, h), Image.NEAREST)

        # Downscale alpha (use NEAREST to keep sharp edges)
        small_a = a.resize((small_w, small_h), Image.NEAREST)
        pixel_a = small_a.resize((w, h), Image.NEAREST)

        # Recombine
        pr, pg, pb = pixel_rgb.split()
        return Image.merge('RGBA', (pr, pg, pb, pixel_a))
    else:
        small = img.resize((small_w, small_h), Image.NEAREST)
        return small.resize((w, h), Image.NEAREST)


def quantize_colors(img, max_colors):
    """Reduce color palette to max_colors while preserving alpha."""
    if img.mode != 'RGBA' or max_colors <= 0:
        return img

    # Extract alpha
    r, g, b, a = img.split()
    rgb = Image.merge('RGB', (r, g, b))

    # Quantize RGB
    quantized = rgb.quantize(colors=max_colors, method=Image.Quantize.MEDIANCUT)
    quantized_rgb = quantized.convert('RGB')

    # Recombine with original alpha
    qr, qg, qb = quantized_rgb.split()
    return Image.merge('RGBA', (qr, qg, qb, a))


def process_characters():
    """Pixelate all character frame sprites."""
    print("=== Pixelating Character Sprites ===\n")
    count = 0
    for color in CHAR_COLORS:
        for direction in DIRECTIONS:
            for frame in range(3):
                path = SPRITES_DIR / f"char_{color}_{direction}_{frame}.png"
                if not path.exists():
                    continue
                img = Image.open(path).convert("RGBA")
                img = pixelate(img, PIXEL_FACTOR_CHAR)
                if MAX_COLORS > 0:
                    img = quantize_colors(img, MAX_COLORS)
                img.save(path)
                count += 1
        print(f"  [OK] char_{color} — 12 frames pixelated")

    print(f"\n  Pixelated {count} character frames.\n")


def process_animals():
    """Pixelate all animal frame sprites."""
    print("=== Pixelating Animal Sprites ===\n")
    count = 0
    for animal in ANIMALS:
        for direction in DIRECTIONS:
            for frame in range(2):
                path = SPRITES_DIR / f"animal_{animal}_{direction}_{frame}.png"
                if not path.exists():
                    continue
                img = Image.open(path).convert("RGBA")
                img = pixelate(img, PIXEL_FACTOR_ANIMAL)
                if MAX_COLORS > 0:
                    img = quantize_colors(img, MAX_COLORS)
                img.save(path)
                count += 1
        print(f"  [OK] animal_{animal} — 8 frames pixelated")

    print(f"\n  Pixelated {count} animal frames.\n")


def process_buildings():
    """Pixelate all building sprites."""
    print("=== Pixelating Building Sprites ===\n")
    for name in BUILDING_NAMES:
        path = SPRITES_DIR / f"{name}.png"
        if not path.exists():
            print(f"  [SKIP] {name}.png not found")
            continue
        img = Image.open(path).convert("RGBA")
        img = pixelate(img, PIXEL_FACTOR_BUILDING)
        if MAX_COLORS > 0:
            img = quantize_colors(img, MAX_COLORS)
        img.save(path)
        print(f"  [OK] {name}.png pixelated")

    print()


def main():
    print("=" * 50)
    print("  Sprite Pixelation — SNES aesthetic pass")
    print("=" * 50 + "\n")

    process_characters()
    process_animals()
    process_buildings()

    print("=" * 50)
    print("  Done! Run build_sprite_sheets.py next to rebuild sheets.")
    print("=" * 50)


if __name__ == "__main__":
    main()
