"""
Recolor character sprites — generate orange/red from clean blue extraction.
Blue frames have the best rembg extraction quality, so we use them as source
and hue-shift to create consistent orange and red variants.
"""
from pathlib import Path
from PIL import Image
import colorsys

SPRITES_DIR = Path(r"D:\Mine\claude-buddy\renderer\sprites")

DIRECTIONS = ['front', 'left', 'right', 'back']
FRAMES_PER_DIR = 3

# Blue hue range (in HSV, hue 0-360)
# Blue hoodie pixels are roughly in the 190-240 hue range
BLUE_HUE_MIN = 170
BLUE_HUE_MAX = 260

# Target color configs (hue shift targets)
RECOLOR_TARGETS = {
    'red': {
        'target_hue': 12,       # Red/coral hue
        'sat_boost': 1.1,       # Slightly more saturated
        'val_boost': 0.95,      # Slightly darker for depth
    },
    'orange': {
        'target_hue': 30,       # Orange hue
        'sat_boost': 1.15,      # More saturated
        'val_boost': 1.05,      # Slightly brighter
    },
}


def recolor_pixel(r, g, b, a, target_hue, sat_boost, val_boost):
    """Recolor a single pixel if it's in the blue hue range."""
    if a < 10:
        return r, g, b, a  # Skip transparent pixels

    # Convert to HSV
    h, s, v = colorsys.rgb_to_hsv(r / 255.0, g / 255.0, b / 255.0)
    hue_deg = h * 360

    # Check if pixel is in blue range
    if BLUE_HUE_MIN <= hue_deg <= BLUE_HUE_MAX and s > 0.15:
        # Shift hue to target
        new_h = target_hue / 360.0
        new_s = min(1.0, s * sat_boost)
        new_v = min(1.0, v * val_boost)
        nr, ng, nb = colorsys.hsv_to_rgb(new_h, new_s, new_v)
        return int(nr * 255), int(ng * 255), int(nb * 255), a

    return r, g, b, a


def recolor_image(img, target_hue, sat_boost, val_boost):
    """Recolor all blue pixels in an RGBA image."""
    img = img.convert('RGBA')
    pixels = img.load()
    w, h = img.size

    for y in range(h):
        for x in range(w):
            r, g, b, a = pixels[x, y]
            pixels[x, y] = recolor_pixel(r, g, b, a, target_hue, sat_boost, val_boost)

    return img


def process_color(color_name, config):
    """Recolor all blue frames to create a new color variant."""
    print(f"\n=== Recoloring blue → {color_name} ===\n")
    count = 0
    skipped = 0

    for direction in DIRECTIONS:
        for frame in range(FRAMES_PER_DIR):
            src_path = SPRITES_DIR / f"char_blue_{direction}_{frame}.png"
            dst_path = SPRITES_DIR / f"char_{color_name}_{direction}_{frame}.png"

            if not src_path.exists():
                print(f"  [SKIP] Source not found: {src_path.name}")
                skipped += 1
                continue

            # Check if blue source is reasonable size (> 300 bytes = good extraction)
            if src_path.stat().st_size < 300:
                print(f"  [WARN] Blue source too small: {src_path.name} ({src_path.stat().st_size}B)")
                skipped += 1
                continue

            img = Image.open(src_path)
            recolored = recolor_image(img, config['target_hue'], config['sat_boost'], config['val_boost'])
            recolored.save(dst_path)
            count += 1

    print(f"  Recolored {count} frames, skipped {skipped}")
    return count


def rebuild_sheets():
    """Rebuild sprite sheets for recolored characters."""
    print("\n=== Rebuilding sprite sheets ===\n")

    for color_name in RECOLOR_TARGETS:
        sheet_path = SPRITES_DIR / f"char_{color_name}_sheet.png"
        frame_w, frame_h = 48, 64
        cols, rows = FRAMES_PER_DIR, len(DIRECTIONS)

        sheet = Image.new('RGBA', (cols * frame_w, rows * frame_h), (0, 0, 0, 0))

        direction_order = ['front', 'left', 'right', 'back']  # Match sprite-manager.js
        missing = 0

        for row_idx, direction in enumerate(direction_order):
            for frame in range(cols):
                frame_path = SPRITES_DIR / f"char_{color_name}_{direction}_{frame}.png"
                if not frame_path.exists():
                    missing += 1
                    continue

                frame_img = Image.open(frame_path).convert('RGBA')
                # Resize to expected frame size if needed
                if frame_img.size != (frame_w, frame_h):
                    frame_img = frame_img.resize((frame_w, frame_h), Image.NEAREST)

                sheet.paste(frame_img, (frame * frame_w, row_idx * frame_h))

        sheet.save(sheet_path)
        print(f"  [OK] {sheet_path.name} — {cols}x{rows} grid ({missing} frames missing)")

    print()


def show_comparison():
    """Show file size comparison before/after."""
    print("\n=== File Size Comparison ===\n")
    for color in ['blue', 'red', 'orange']:
        sizes = []
        for d in DIRECTIONS:
            for f in range(FRAMES_PER_DIR):
                p = SPRITES_DIR / f"char_{color}_{d}_{f}.png"
                if p.exists():
                    sizes.append(p.stat().st_size)
        if sizes:
            avg = sum(sizes) / len(sizes)
            mn = min(sizes)
            mx = max(sizes)
            print(f"  {color:8s}: avg={avg:.0f}B, min={mn}B, max={mx}B ({len(sizes)} frames)")


def main():
    print("=" * 50)
    print("  Sprite Recoloring — Blue → Orange/Red")
    print("=" * 50)

    show_comparison()

    for color_name, config in RECOLOR_TARGETS.items():
        process_color(color_name, config)

    rebuild_sheets()
    show_comparison()

    print("=" * 50)
    print("  Done! Orange/Red sprites now match Blue quality.")
    print("  Run pixelate_sprites.py to apply SNES post-processing.")
    print("=" * 50)


if __name__ == "__main__":
    main()
