"""Generates the FinDeck desktop shell icon assets.

The mark is a flat, two-colour tile: an ink-navy rounded square
(`--dsw-static-neutral-bluish-950` blended 18% toward `--ad-accent` #2f54eb,
giving #1a203d) carrying a rising three-segment sparkline in
`--dsw-static-deepseek-450` (#5686fe, the dark-theme brand primary). It is
drawn in code -- no vector source to keep in sync -- at 8x and downsampled
with LANCZOS, so every emitted size is antialiased, and the 16px tray size
keeps the sparkline readable as a rising zigzag.

Run from the repository root with the finance venv (Pillow is only needed to
regenerate these assets, not at runtime):

    & "finance\\python\\.venv\\Scripts\\python.exe" apps\\desktop\\assets\\generate-icons.py

Writes `icon.png` (256), `icon-32.png`, `icon-16.png` (Windows tray), and
`icon.ico` (16/32/48/256, for the window and taskbar) next to this file.
"""

from pathlib import Path

from PIL import Image, ImageDraw

ASSETS_DIR = Path(__file__).resolve().parent

# Geometry lives in a 256-unit design space and scales to every output size.
DESIGN = 256.0
TILE_RADIUS = 0.22 * DESIGN
STROKE = 28.0
# Left-low to right-high with one pullback: a chart that is unmistakably rising.
SPARKLINE = ((44.0, 178.0), (106.0, 120.0), (148.0, 154.0), (208.0, 70.0))

TILE_FILL = (26, 32, 61, 255)
MARK_FILL = (86, 134, 254, 255)

SUPERSAMPLE = 8
ICO_SIZES = ((16, 16), (32, 32), (48, 48), (256, 256))


def render(size: int) -> Image.Image:
    """Draws the icon at `size` square, transparent outside the rounded tile."""
    scaled = size * SUPERSAMPLE
    image = Image.new("RGBA", (scaled, scaled), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle(
        (0, 0, scaled - 1, scaled - 1),
        radius=round(TILE_RADIUS / DESIGN * scaled),
        fill=TILE_FILL,
    )

    stroke = round(STROKE / DESIGN * scaled)
    points = [(x / DESIGN * scaled, y / DESIGN * scaled) for x, y in SPARKLINE]
    # PIL joins polyline segments with a mitre and caps them flat; a disc at
    # every vertex supplies the round join and round cap instead.
    cap = stroke / 2.0
    for start, end in zip(points, points[1:]):
        draw.line((start, end), fill=MARK_FILL, width=stroke)
    for x, y in points:
        draw.ellipse((x - cap, y - cap, x + cap, y + cap), fill=MARK_FILL)

    return image.resize((size, size), Image.LANCZOS)


def main() -> None:
    master = render(256)
    master.save(ASSETS_DIR / "icon.png")
    for size in (32, 16):
        render(size).save(ASSETS_DIR / f"icon-{size}.png")
    # The ICO and PNG sizes come from one 256px master so the shell, the
    # taskbar, and the tray never disagree about the mark.
    master.save(ASSETS_DIR / "icon.ico", format="ICO", sizes=list(ICO_SIZES))


if __name__ == "__main__":
    main()
