#!/usr/bin/env python3
"""
Generate PrismGit application icons from an inline SVG source.

Outputs (committed to the repo, consumed by electron-builder):
  build/icon.png          1024x1024 master PNG
  build/icon-512.png      512x512 (BrowserWindow / window icon at runtime)
  build/logo-256.png      256x256 (About window logo)
  build/icon.ico          Windows multi-size 16..256
  build/icon.icns         macOS ic07..ic14 (PNG chunks)
  build/icons/*.png       Linux icon set 16..512 (electron-builder expects 512x512.png)

Requires: cairosvg, Pillow  (pip install cairosvg pillow)

Usage: python3 scripts/make-icons.py
"""
import io
import os
import struct

import cairosvg
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILD = os.path.join(ROOT, "build")

SVG = """<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#2A3054"/>
      <stop offset="55%" stop-color="#1B2038"/>
      <stop offset="100%" stop-color="#12152A"/>
    </linearGradient>
    <linearGradient id="prism" x1="15%" y1="0%" x2="85%" y2="100%">
      <stop offset="0%" stop-color="#4EE0FF"/>
      <stop offset="50%" stop-color="#8B7BFF"/>
      <stop offset="100%" stop-color="#FF7AC0"/>
    </linearGradient>
    <linearGradient id="beam" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.95"/>
      <stop offset="100%" stop-color="#FFFFFF" stop-opacity="0.25"/>
    </linearGradient>
  </defs>

  <!-- rounded-square dark background -->
  <rect width="1024" height="1024" rx="230" fill="url(#bg)"/>
  <circle cx="512" cy="492" r="356" fill="#8B7BFF" opacity="0.09"/>

  <!-- light beam entering the prism from the left -->
  <path d="M168 402 L500 505" stroke="url(#beam)" stroke-width="22" stroke-linecap="round"/>
  <!-- refracted beams leaving the right face -->
  <path d="M540 518 L790 470" stroke="#4EE0FF" stroke-width="16" stroke-linecap="round" opacity="0.9"/>
  <path d="M540 528 L770 620" stroke="#FF7AC0" stroke-width="16" stroke-linecap="round" opacity="0.9"/>

  <!-- prism (triangle) -->
  <path d="M512 236 L802 748 L222 748 Z" fill="none" stroke="url(#prism)"
        stroke-width="44" stroke-linejoin="round"/>

  <!-- git branch graph inside the prism -->
  <path d="M330 646 C 402 646 404 566 474 566 C 546 566 548 646 618 646"
        fill="none" stroke="#E8ECFF" stroke-width="24" stroke-linecap="round"/>
  <circle cx="330" cy="646" r="37" fill="#4EE0FF" stroke="#141830" stroke-width="11"/>
  <circle cx="474" cy="566" r="37" fill="#8B7BFF" stroke="#141830" stroke-width="11"/>
  <circle cx="618" cy="646" r="37" fill="#FF7AC0" stroke="#141830" stroke-width="11"/>
</svg>
"""

PNG_SIZES_LINUX = [16, 24, 32, 48, 64, 96, 128, 256, 512]
ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]
ICNS_CHUNKS = [  # (chunk type, pixel size of the embedded PNG)
    ("ic07", 128),
    ("ic08", 256),
    ("ic09", 512),
    ("ic10", 1024),
    ("ic11", 32),
    ("ic12", 64),
    ("ic13", 256),
    ("ic14", 512),
]


def render_master() -> Image.Image:
    png = cairosvg.svg2png(bytestring=SVG.encode("utf-8"), output_width=1024, output_height=1024)
    return Image.open(io.BytesIO(png)).convert("RGBA")


def resize(master: Image.Image, size: int) -> Image.Image:
    return master.resize((size, size), Image.LANCZOS)


def write_icns(path: str, master: Image.Image) -> None:
    """Write a macOS .icns using PNG-embedded chunk types (macOS 10.9+)."""
    chunks = b""
    for chunk_type, px in ICNS_CHUNKS:
        buf = io.BytesIO()
        resize(master, px).save(buf, format="PNG")
        data = buf.getvalue()
        chunks += chunk_type.encode("ascii") + struct.pack(">I", len(data) + 8) + data
    total = 8 + len(chunks)
    with open(path, "wb") as f:
        f.write(b"icns" + struct.pack(">I", total) + chunks)


def write_ico(path: str, images: list) -> None:
    """Write a Windows .ico with PNG-compressed entries (Vista+ format).

    images: list of (pixel_size, PIL.Image), one per directory entry.
    Writing it manually because PIL's ICO plugin derives sizes from the base
    image and silently drops larger entries.
    """
    blobs = []
    for px, im in images:
        buf = io.BytesIO()
        im.save(buf, format="PNG")
        blobs.append((px, buf.getvalue()))
    count = len(blobs)
    header = struct.pack("<HHH", 0, 1, count)
    offset = 6 + 16 * count
    directory = b""
    for px, blob in blobs:
        w = 0 if px >= 256 else px  # 0 means 256 in the ICO directory
        directory += struct.pack(
            "<BBBBHHII", w, w, 0, 0, 1, 32, len(blob), offset
        )
        offset += len(blob)
    with open(path, "wb") as f:
        f.write(header + directory + b"".join(blob for _, blob in blobs))


def main() -> None:
    os.makedirs(BUILD, exist_ok=True)
    os.makedirs(os.path.join(BUILD, "icons"), exist_ok=True)

    master = render_master()

    # Master + runtime assets
    master.save(os.path.join(BUILD, "icon.png"), format="PNG")
    resize(master, 512).save(os.path.join(BUILD, "icon-512.png"), format="PNG")
    resize(master, 256).save(os.path.join(BUILD, "logo-256.png"), format="PNG")

    # Linux icon set (electron-builder linux.icon directory convention)
    for size in PNG_SIZES_LINUX:
        resize(master, size).save(os.path.join(BUILD, "icons", f"{size}x{size}.png"), format="PNG")

    # Windows .ico (multi-size, PNG-compressed entries)
    write_ico(
        os.path.join(BUILD, "icon.ico"),
        [(s, resize(master, s)) for s in ICO_SIZES],
    )

    # macOS .icns
    write_icns(os.path.join(BUILD, "icon.icns"), master)

    # Sanity checks: every artifact must parse back with the expected format/size
    checks = [
        ("build/icon.png", 1024), ("build/icon-512.png", 512), ("build/logo-256.png", 256),
    ]
    for rel, expected in checks:
        with Image.open(os.path.join(ROOT, rel)) as im:
            assert im.size == (expected, expected), f"{rel}: {im.size}"
    for size in PNG_SIZES_LINUX:
        rel = f"build/icons/{size}x{size}.png"
        with Image.open(os.path.join(ROOT, rel)) as im:
            assert im.size == (size, size), f"{rel}: {im.size}"
    ico_path = os.path.join(ROOT, "build/icon.ico")
    with open(ico_path, "rb") as f:
        header = f.read(6)
        assert header[:4] == b"\x00\x00\x01\x00", f"bad ico header: {header!r}"
        entry_count = struct.unpack("<H", header[4:6])[0]
        assert entry_count == len(ICO_SIZES), f"ico entries: {entry_count}"
    with Image.open(ico_path) as im:
        assert im.format == "ICO", im.format
    with Image.open(os.path.join(ROOT, "build/icon.icns")) as im:
        assert im.format == "ICNS", im.format
        assert im.size[0] >= 512, im.size

    print("OK: icons generated in build/ (png, ico, icns, icons/*.png)")


if __name__ == "__main__":
    main()
