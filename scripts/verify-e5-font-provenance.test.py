"""Offline rejection fixtures for the component notice verifier."""

import copy
import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("font_provenance", Path(__file__).with_name("verify-e5-font-provenance.py"))
provenance = importlib.util.module_from_spec(spec)
spec.loader.exec_module(provenance)
CATALOG = json.loads((Path(__file__).parent.parent / "docs/migration/e5-nerd-component-notices.json").read_bytes())


class ComponentNoticeTests(unittest.TestCase):
    def run_catalog(self, catalog, payload_delta=0):
        def fake_fetch(url, expected, size):
            self.assertTrue(url.startswith(f"https://raw.githubusercontent.com/ryanoasis/nerd-fonts/{provenance.NERD_REVISION}/src/glyphs/"))
            self.assertRegex(expected, r"^[0-9a-f]{64}$")
            return b"x" * (size + payload_delta)

        with patch.object(Path, "read_bytes", return_value=json.dumps(catalog).encode()):
            with patch.object(provenance, "fetch_pinned", side_effect=fake_fetch) as fetch:
                result = provenance.verify_component_notices()
                self.assertEqual(fetch.call_count, 15)
                return result

    def test_all_fifteen_entries_and_remaining_obligations(self):
        result = self.run_catalog(CATALOG)
        self.assertEqual(len(result["files"]), 15)
        self.assertEqual(result["remaining"], CATALOG["remaining"])

    def test_wrong_revision(self):
        catalog = copy.deepcopy(CATALOG)
        catalog["upstreamRevision"] = "main"
        with self.assertRaisesRegex(ValueError, "revision"):
            self.run_catalog(catalog)

    def test_duplicate_entry(self):
        catalog = copy.deepcopy(CATALOG)
        catalog["files"][1] = catalog["files"][0]
        with self.assertRaisesRegex(ValueError, "duplicate"):
            self.run_catalog(catalog)

    def test_nonliteral_extension_and_parent_path(self):
        for name in ["src/glyphs/codicons/LICENSEXtxt", "src/glyphs/../LICENSE"]:
            catalog = copy.deepcopy(CATALOG)
            catalog["files"][0]["path"] = name
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, "path"):
                self.run_catalog(catalog)

    def test_oversized_entry(self):
        catalog = copy.deepcopy(CATALOG)
        catalog["files"][0]["bytes"] = 65537
        with self.assertRaisesRegex(ValueError, "size"):
            self.run_catalog(catalog)

    def test_short_payload(self):
        with self.assertRaisesRegex(ValueError, "length"):
            self.run_catalog(CATALOG, -1)


class OriginJoinTests(unittest.TestCase):
    def setUp(self):
        self.catalog = json.loads((Path(__file__).parent.parent / "docs/migration/e5-nerd-origin-joins.json").read_bytes())

    def verify_mock(self, mismatch=False):
        targets = {j["target"]["url"] for j in self.catalog["joins"]}

        def fake_fetch(url, expected, size):
            return (b"y" if mismatch and url in targets else b"x") * size

        with patch.object(Path, "read_bytes", return_value=json.dumps(self.catalog).encode()):
            with patch.object(provenance, "fetch_pinned", side_effect=fake_fetch):
                return provenance.verify_origin_joins()

    def test_three_matching_binary_pairs(self):
        result = self.verify_mock()
        self.assertEqual(len(result["joins"]), 3)
        self.assertTrue(all(j["byteEqual"] for j in result["joins"]))

    def test_different_binary_bytes_rejected(self):
        with self.assertRaisesRegex(ValueError, "binary mismatch"):
            self.verify_mock(mismatch=True)

    def test_floating_upstream_ref_rejected(self):
        entry = self.catalog["joins"][0]["target"]
        entry["url"] = entry["url"].replace("09d80249058ee8018a45da30add4339289dbb466", "main")
        with self.assertRaisesRegex(ValueError, "Unpinned"):
            self.verify_mock()


if __name__ == "__main__":
    unittest.main()
