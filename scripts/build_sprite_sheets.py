"""
Build sprite sheets from processed individual frames.
Assembles rembg-processed transparent PNG frames into sprite sheet grids.
"""
from pathlib import Path
from PIL import Image

SPRITES_DIR = Path(r"D:\Mine\claude-buddy\renderer\sprites")

# Direction order in sprite sheets (rows top-to-bottom)
# Maps: sheet row index -> file name direction part
DIRECTIONS = ['front', 'left', 'right', 'back']  # down, left, right, up

CHAR_COLORS = ['blue', 'red', 'green', 'purple', 'orange', 'teal', 'pink', 'yellow']
ANIMALS = ['chicken', 'cow', 'pig', 'sheep', 'cat', 'dog']

def build_character_sheets():
    """Build character sprite sheets: 3 frames x 4 directions."""
    print("=== Building Character Sprite Sheets ===\n")
    frames_per_dir = 3

    for color in CHAR_COLORS:
        # Check if frames exist
        test_frame = SPRITES_DIR / f"char_{color}_front_0.png"
        if not test_frame.exists():
            print(f"  [SKIP] char_{color} — no frames found")
            continue

        # Read first frame to get dimensions
        sample = Image.open(test_frame)
        fw, fh = sample.size  # should be 48x64
        sheet_w = fw * frames_per_dir
        sheet_h = fh * len(DIRECTIONS)

        sheet = Image.new("RGBA", (sheet_w, sheet_h), (0, 0, 0, 0))

        missing = 0
        for row, direction in enumerate(DIRECTIONS):
            for col in range(frames_per_dir):
                frame_path = SPRITES_DIR / f"char_{color}_{direction}_{col}.png"
                if frame_path.exists():
                    frame = Image.open(frame_path).convert("RGBA")
                    # Resize to match if needed
                    if frame.size != (fw, fh):
                        frame = frame.resize((fw, fh), Image.NEAREST)
                    sheet.paste(frame, (col * fw, row * fh), frame)
                else:
                    missing += 1

        out_path = SPRITES_DIR / f"char_{color}_sheet.png"
        sheet.save(out_path)
        status = f"({missing} missing)" if missing > 0 else "OK"
        print(f"  [DONE] char_{color}_sheet.png  {sheet_w}x{sheet_h}  {status}")

    print()

def build_animal_sheets():
    """Build animal sprite sheets: 2 frames x 4 directions."""
    print("=== Building Animal Sprite Sheets ===\n")
    frames_per_dir = 2

    for animal in ANIMALS:
        test_frame = SPRITES_DIR / f"animal_{animal}_front_0.png"
        if not test_frame.exists():
            print(f"  [SKIP] animal_{animal} — no frames found")
            continue

        sample = Image.open(test_frame)
        fw, fh = sample.size  # should be 48x48

        sheet_w = fw * frames_per_dir
        sheet_h = fh * len(DIRECTIONS)

        sheet = Image.new("RGBA", (sheet_w, sheet_h), (0, 0, 0, 0))

        missing = 0
        for row, direction in enumerate(DIRECTIONS):
            for col in range(frames_per_dir):
                frame_path = SPRITES_DIR / f"animal_{animal}_{direction}_{col}.png"
                if frame_path.exists():
                    frame = Image.open(frame_path).convert("RGBA")
                    if frame.size != (fw, fh):
                        frame = frame.resize((fw, fh), Image.NEAREST)
                    sheet.paste(frame, (col * fw, row * fh), frame)
                else:
                    missing += 1

        out_path = SPRITES_DIR / f"animal_{animal}_sheet.png"
        sheet.save(out_path)
        status = f"({missing} missing)" if missing > 0 else "OK"
        print(f"  [DONE] animal_{animal}_sheet.png  {sheet_w}x{sheet_h}  {status}")

    print()

def main():
    print("=" * 50)
    print("  Sprite Sheet Builder — from processed frames")
    print("=" * 50 + "\n")

    build_character_sheets()
    build_animal_sheets()

    print("=" * 50)
    print("  Done! Sheets ready for SpriteManager.")
    print("=" * 50)

if __name__ == "__main__":
    main()
