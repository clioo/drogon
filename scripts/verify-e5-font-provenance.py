#!/usr/bin/env python3
"""Read pinned font provenance; never rewrite or install product assets."""

import base64
import hashlib
import importlib.metadata
import io
import json
from pathlib import Path
import re
import subprocess
import sys
import tarfile
import urllib.request
import zipfile

from fontTools.ttLib import TTFont

SOURCE_REVISION = "c97906287bb7a390b25e2025b600d9fb3c25d9c3"
NERD_REVISION = "fa7b859994228a9c8759f99c55a8d31ee92a1b5e"
GEIST_REVISION = "10dc7658f13c38a474cde201bb09a4617267545b"
NERD = "src/renderer/src/assets/fonts/SymbolsNerdFontMono-Regular.woff2"
GEIST = "src/renderer/src/assets/fonts/Geist-Variable.woff2"
SITE_GEIST = "docs/site/src/assets/fonts/Geist-Variable.woff2"
SOURCE_PATHS = [
    NERD, GEIST, SITE_GEIST,
    "src/renderer/src/assets/fonts/SymbolsNerdFontMono-OFL.txt",
    "docs/site/THIRD_PARTY_NOTICES.md",
]


def digest(data):
    return hashlib.sha256(data).hexdigest()


def fetch_pinned(url, expected_hash, limit):
    request = urllib.request.Request(url, headers={"User-Agent": "Drogon-font-provenance-review"})
    with urllib.request.urlopen(request, timeout=15) as response:
        data = response.read(limit + 1)
    if len(data) > limit or digest(data) != expected_hash:
        raise ValueError(f"Upstream size/hash mismatch: {url}")
    return data


def metadata(data):
    with TTFont(io.BytesIO(data), recalcTimestamp=False) as font:
        return {
            "names": [
                {"id": name.nameID, "platform": name.platformID, "value": name.toUnicode()}
                for name in font["name"].names if name.nameID in [0, 1, 3, 5, 13, 14]
            ],
            "glyphCount": font["maxp"].numGlyphs,
            "fontRevision": font["head"].fontRevision,
        }


def converted_woff2(data):
    with TTFont(io.BytesIO(data), recalcTimestamp=False) as font:
        font.flavor = "woff2"
        output = io.BytesIO()
        font.save(output)
    return output.getvalue()


def verify_geist_distribution(local, source_notice):
    metadata_url = "https://registry.npmjs.org/geist/1.7.0"
    raw_metadata = fetch_pinned(metadata_url, "9bf4ce965fbd026e301f991a29863184a57e9c9efefc2a823e7c0ed245e8dc60", 1024 * 1024)
    package_metadata = json.loads(raw_metadata)
    archive_url = "https://registry.npmjs.org/geist/-/geist-1.7.0.tgz"
    archive_bytes = fetch_pinned(archive_url, "eacd923c2f0e6b2fc27a3a9068bcdba2b89ddd3f4304dbef414117f280e72965", 16 * 1024 * 1024)
    integrity = "sha512-" + base64.b64encode(hashlib.sha512(archive_bytes).digest()).decode()
    if package_metadata["dist"]["tarball"] != archive_url or integrity != package_metadata["dist"]["integrity"]:
        raise ValueError("Geist registry/archive integrity mismatch")
    selected = {}
    font_member = "package/dist/fonts/geist-sans/Geist-Variable.woff2"
    with tarfile.open(fileobj=io.BytesIO(archive_bytes), mode="r:gz") as archive:
        members = archive.getmembers()
        if len(members) != 106 or len({m.name for m in members}) != 106:
            raise ValueError("Unexpected/duplicate Geist archive members")
        for name in [font_member, "package/LICENSE.txt", "package/package.json"]:
            member = archive.getmember(name)
            if not member.isfile() or member.size > 2 * 1024 * 1024:
                raise ValueError("Invalid Geist archive member")
            selected[name] = archive.extractfile(member).read()
    if selected[font_member] != local:
        raise ValueError("Geist package does not reproduce source font")
    identity = json.loads(selected["package/package.json"])
    if identity["name"] != "geist" or identity["version"] != "1.7.0":
        raise ValueError("Geist package identity mismatch")
    notice = selected["package/LICENSE.txt"]
    fences = re.findall(r"```text\n(.*?)\n```", source_notice.decode(), re.S)
    if len(fences) != 1 or fences[0].split() != notice.decode().split():
        raise ValueError("Source embedded notice differs beyond whitespace")
    return {
        "package": "geist", "version": "1.7.0", "metadataUrl": metadata_url,
        "metadataSha256": digest(raw_metadata), "archiveUrl": archive_url,
        "archiveSha256": digest(archive_bytes), "archiveBytes": len(archive_bytes),
        "integrity": integrity, "archiveMembers": len(members), "sourceByteEqual": True,
        "selected": [{"member": key, "bytes": len(value), "sha256": digest(value)} for key, value in selected.items()],
        "sourceEmbeddedNoticeSha256": digest(fences[0].encode()),
        "sourceEmbeddedNoticeByteEqual": fences[0].encode() == notice,
        "sourceEmbeddedNoticeWhitespaceNormalizedEqual": True,
        "signatureVerified": False,
    }


def verify_font_logos_component():
    component_url = f"https://raw.githubusercontent.com/ryanoasis/nerd-fonts/{NERD_REVISION}/src/glyphs/font-logos.ttf"
    component = fetch_pinned(component_url, "7f0b055275bb3710afee586519884f3e302ec295a2f4ff4158daacf437c49852", 1024 * 1024)
    release_url = "https://github.com/lukas-w/font-logos/releases/download/v1.3.0/font-logos-1.3.0.zip"
    release = fetch_pinned(release_url, "53376d5496cfbc78035ca60f58791ba5b2bfec6a9e751ac521aace6acdacb012", 2 * 1024 * 1024)
    selected = {}
    with zipfile.ZipFile(io.BytesIO(release)) as archive:
        members = archive.infolist()
        if len(members) != 141 or len({m.filename for m in members}) != 141:
            raise ValueError("Unexpected/duplicate Font Logos release entries")
        for name in ["font-logos-1.3.0/assets/font-logos.ttf", "font-logos-1.3.0/LICENSE"]:
            member = archive.getinfo(name)
            if member.is_dir() or member.file_size > 1024 * 1024:
                raise ValueError("Invalid Font Logos release member")
            selected[name] = archive.read(member)
    if selected["font-logos-1.3.0/assets/font-logos.ttf"] != component:
        raise ValueError("Font Logos release differs from Nerd glyph component")
    revision = "e92426e28ee5bbf4ca328b33e3a393b7a5045f01"
    license_url = f"https://raw.githubusercontent.com/lukas-w/font-logos/{revision}/LICENSE"
    license_bytes = fetch_pinned(license_url, "88d9b4eb60579c191ec391ca04c16130572d7eedc4a86daa58bf28c6e14c9bcd", 64 * 1024)
    if selected["font-logos-1.3.0/LICENSE"] != license_bytes:
        raise ValueError("Font Logos tag/release license mismatch")
    readme_url = f"https://raw.githubusercontent.com/lukas-w/font-logos/{revision}/README.md"
    readme = fetch_pinned(readme_url, "b7c98abe0c74e0804e5852fa508ee2bc51b44a4aee45a8384204938a705fabf8", 64 * 1024)
    return {
        "componentUrl": component_url, "componentSha256": digest(component),
        "componentBytes": len(component), "metadata": metadata(component),
        "releaseUrl": release_url, "releaseSha256": digest(release),
        "releaseBytes": len(release), "releaseEntries": len(members),
        "componentByteEqual": True, "licenseByteEqual": True,
        "upstreamRevision": revision, "licenseUrl": license_url,
        "licenseSha256": digest(license_bytes), "licenseBytes": len(license_bytes),
        "readmeUrl": readme_url, "readmeSha256": digest(readme),
        "declaredLicense": "Unlicense", "signatureVerified": False,
        "finding": "The ambiguous Unlicensed row is not absence of a license: exact release1.3.0 carries Unlicense and matches the Nerd3.4.0 source glyph file. Preserve the separate trademark/identity-use warning; this is not a complete aggregate-font build or every-glyph rights audit.",
    }


def verify_component_notices():
    catalog_path = Path(__file__).resolve().parent.parent / "docs/migration/e5-nerd-component-notices.json"
    catalog_bytes = catalog_path.read_bytes()
    catalog = json.loads(catalog_bytes)
    if catalog["schemaVersion"] != 1 or catalog["upstreamRevision"] != NERD_REVISION:
        raise ValueError("Unexpected component notice catalog revision")
    entries = catalog["files"]
    if len(entries) != 15 or len({entry["path"] for entry in entries}) != 15:
        raise ValueError("Unexpected/duplicate component notice entries")
    verified = []
    for entry in entries:
        relative = entry["path"]
        if not re.fullmatch(r"src/glyphs/[a-z-]+/(?:README\.md|LICENSE(?:\.txt)?|OFL\.txt)", relative):
            raise ValueError("Unexpected component notice path")
        if not isinstance(entry["bytes"], int) or not 0 < entry["bytes"] <= 64 * 1024:
            raise ValueError("Invalid component notice size")
        url = f"https://raw.githubusercontent.com/ryanoasis/nerd-fonts/{NERD_REVISION}/{relative}"
        data = fetch_pinned(url, entry["sha256"], entry["bytes"])
        if len(data) != entry["bytes"]:
            raise ValueError("Component notice length mismatch")
        verified.append({**entry, "url": url})
    return {
        "catalogSha256": digest(catalog_bytes), "files": verified,
        "limits": catalog["scope"], "remaining": catalog["remaining"],
    }


def verify(source):
    versions = {name: importlib.metadata.version(name) for name in ["fonttools", "brotli", "zopfli"]}
    if versions != {"fonttools": "4.64.0", "brotli": "1.2.0", "zopfli": "0.4.3"}:
        raise ValueError(f"Use recorded inspection-tool versions: {versions}")
    head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=source, timeout=10).decode().strip()
    if head != SOURCE_REVISION:
        raise ValueError("Source HEAD differs from admitted revision")
    files = {}
    for relative in SOURCE_PATHS:
        data = (source / relative).read_bytes()
        frozen = subprocess.check_output(["git", "show", f"{SOURCE_REVISION}:{relative}"], cwd=source, timeout=10)
        if data != frozen:
            raise ValueError(f"Source working bytes differ: {relative}")
        files[relative] = data
    if files[GEIST] != files[SITE_GEIST]:
        raise ValueError("Renderer and site Geist fonts differ")

    nerd_base = f"https://raw.githubusercontent.com/ryanoasis/nerd-fonts/{NERD_REVISION}/"
    nerd_url = nerd_base + "patched-fonts/NerdFontsSymbolsOnly/SymbolsNerdFontMono-Regular.ttf"
    nerd_ttf = fetch_pinned(nerd_url, "f0f624d9b474bea1662cf7e862d44aebe1ae1f6c7f9cb7a0ca5d0e5ac9561c60", 8 * 1024 * 1024)
    nerd_converted = converted_woff2(nerd_ttf)
    if nerd_converted != files[NERD]:
        raise ValueError("Nerd3.4.0 conversion no longer reproduces source WOFF2")

    declarations = []
    for relative, expected_hash in [
        ("patched-fonts/NerdFontsSymbolsOnly/LICENSE", "84a7a98c82140fb12c37fe42b93805baa16024cb3e5acc599b7ffe612c55d847"),
        ("LICENSE", "1f6ad4edae6479aaace3112ede5279a23284ae54b2a34db66357aef5f64df160"),
        ("license-audit.md", "22c490a48e08adcabab0b06d317fe6c6310a420e081d8ebff7f44d0210096cd1"),
    ]:
        url = nerd_base + relative
        data = fetch_pinned(url, expected_hash, 64 * 1024)
        declarations.append({"url": url, "sha256": digest(data), "bytes": len(data)})

    geist_url = f"https://raw.githubusercontent.com/vercel/geist-font/{GEIST_REVISION}/fonts/Geist/variable/Geist%5Bwght%5D.ttf"
    geist_ttf = fetch_pinned(geist_url, "73894e0448cae90a92b6c2f8732b7bb9acb7b94c418bff559dad4a18e1de9659", 1024 * 1024)
    geist_converted = converted_woff2(geist_ttf)
    geist_distribution = verify_geist_distribution(files[GEIST], files["docs/site/THIRD_PARTY_NOTICES.md"])
    return {
        "schema": "drogon.audit.font-provenance.v1",
        "sourceRevision": SOURCE_REVISION,
        "inspectionTools": versions,
        "sourceFiles": [{"path": key, "sha256": digest(value), "bytes": len(value)} for key, value in files.items()],
        "nerd": {
            "upstreamRevision": NERD_REVISION, "tagObserved": "v3.4.0",
            "url": nerd_url, "ttfSha256": digest(nerd_ttf), "ttfBytes": len(nerd_ttf),
            "conversion": "TTFont(recalcTimestamp=False), flavor=woff2, in-memory save",
            "convertedSha256": digest(nerd_converted), "convertedBytes": len(nerd_converted),
            "byteEqual": True, "metadata": metadata(files[NERD]),
            "declarations": declarations,
            "fontLogos": verify_font_logos_component(),
            "componentNotices": verify_component_notices(),
            "finding": "Exact pinned TTF-to-WOFF2 reproduction; adjacent source OFL notice differs from upstream SymbolsOnly MIT declaration. Upstream root license/audit explicitly retains multiple glyph-source licenses; a single MIT or OFL label is not complete component notice accounting.",
        },
        "geist": {
            "metadata": metadata(files[GEIST]), "rendererEqualsSite": True,
            "distribution": geist_distribution,
            "candidateUrl": geist_url, "candidateTtfSha256": digest(geist_ttf),
            "candidateMetadata": metadata(geist_ttf),
            "candidateConvertedSha256": digest(geist_converted),
            "candidateConvertedBytes": len(geist_converted),
            "candidateByteEqual": geist_converted == files[GEIST],
            "finding": "Exact source font matches geist@1.7.0 archive; its2023 Vercel OFL notice matches the site's embedded notice after whitespace normalization. Internal2024 Project Authors metadata also remains preserved. The prior upstream1.800 TTF candidate is not a match and must not replace the source font. Distribution-byte/notice correspondence is established, not publisher-signature verification or final installed notices.",
        },
        "limits": "Source provenance/notice evidence only; not publisher-signature verification, per-glyph clearance, actual installed notices, rendered glyph coverage, permission for unrelated assets or full E5 acceptance. HTTP downloads and font conversion remain in memory; no product assets or source files are changed.",
    }


if __name__ == "__main__":
    if len(sys.argv) != 2 or not Path(sys.argv[1]).is_absolute():
        raise SystemExit("Usage: verify-e5-font-provenance.py ABSOLUTE_SOURCE_ROOT")
    print(json.dumps(verify(Path(sys.argv[1])), indent=2, ensure_ascii=False))
