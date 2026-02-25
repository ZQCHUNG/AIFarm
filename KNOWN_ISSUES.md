# Known Issues

## Sprint 10 Priority

### Orange/Red Character Frame Incomplete Extraction
- **Severity**: Visual (cosmetic)
- **Description**: Some orange and red character direction frames have incomplete rembg extraction, resulting in very small sprites (200-500 bytes vs expected 1000-1700 bytes for clean frames).
- **Affected Files**:
  - `char_orange_front_0.png` (502B vs ~1500B expected)
  - `char_orange_left_0.png` (477B)
  - `char_orange_right_0.png` (442B)
  - `char_orange_right_1.png` (359B)
  - `char_red_left_0.png` (431B)
  - `char_red_left_2.png` (414B)
  - `char_red_right_1.png` (246B — smallest, likely nearly empty)
- **Root Cause**: FLUX.1 generated these frames with backgrounds that blend heavily with the character, making rembg extraction produce tiny residual artifacts instead of clean character silhouettes.
- **Fix Plan**: Re-generate these specific frames with stronger isolation prompts, or manually touch up in pixel editor. Alternative: use procedural fallback for these specific color/direction combos.
- **Comparison**: Blue character frames average ~1200-1500B each after processing — clean extraction.
