from __future__ import annotations

import hashlib
import json
import struct
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class ArtifactFormatTest(unittest.TestCase):
    def test_bundle_is_complete_and_self_consistent(self) -> None:
        metadata_path = ROOT / "artifacts" / "metadata.json"
        tensor_path = ROOT / "artifacts" / "vectors.safetensors"
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        raw = tensor_path.read_bytes()
        header_length = struct.unpack("<Q", raw[:8])[0]
        header = json.loads(raw[8 : 8 + header_length].decode("utf-8"))
        data_length = len(raw) - 8 - header_length

        self.assertEqual(metadata["schemaVersion"], 1)
        self.assertEqual(metadata["projectionRank"], 8)
        self.assertEqual(metadata["sharedLayer"], 36)
        self.assertEqual(metadata["hiddenSize"], 3840)
        self.assertEqual(len(metadata["axes"]), 8)
        self.assertEqual(
            [axis["traitId"] for axis in metadata["axes"]],
            [
                "factual",
                "serious",
                "casual",
                "creative",
                "honest",
                "confident",
                "empathetic",
                "calm",
            ],
        )
        self.assertEqual(header["unit_vectors"]["dtype"], "F16")
        self.assertEqual(header["unit_vectors"]["shape"], [8, 3840])
        self.assertEqual(header["raw_vectors"]["shape"], [8, 3840])
        final_offset = max(
            header["unit_vectors"]["data_offsets"][1],
            header["raw_vectors"]["data_offsets"][1],
        )
        self.assertEqual(final_offset, data_length)
        self.assertEqual(
            hashlib.sha256(raw).hexdigest(),
            metadata["tensorFile"]["sha256"],
        )

    def test_deployed_recenter_tables_cover_model_routing(self) -> None:
        recenter_path = ROOT / "artifacts" / "recenter-deployed-2026-08-02.json"
        recenter = json.loads(recenter_path.read_text(encoding="utf-8"))
        models = recenter["models"]
        expected_traits = {
            "factual",
            "serious",
            "casual",
            "creative",
            "honest",
            "confident",
            "empathetic",
            "calm",
        }

        self.assertEqual(recenter["default"], models["anthropic/claude-sonnet-5"])
        self.assertEqual(set(models), {
            "anthropic/claude-sonnet-5",
            "anthropic/claude-opus-5",
            "openai/gpt-5.6-luna",
            "openai/gpt-5.6-sol",
            "openai/gpt-5.6-terra",
            "x-ai/grok-4.5",
        })
        self.assertNotEqual(models["openai/gpt-5.6-sol"], models["openai/gpt-5.6-luna"])
        self.assertEqual(models["openai/gpt-5.6-sol"]["factual"], {
            "threshold": -57.806,
            "scale": 5.303,
        })
        self.assertEqual(models["openai/gpt-5.6-sol"]["honest"], {
            "threshold": -51.379,
            "scale": 4.473,
        })
        self.assertEqual(models["openai/gpt-5.6-sol"]["confident"], {
            "threshold": 33.348,
            "scale": 6.324,
        })
        self.assertEqual(models["anthropic/claude-opus-5"]["factual"], {
            "threshold": -57.446,
            "scale": 5.348,
        })
        self.assertEqual(models["anthropic/claude-opus-5"]["honest"], {
            "threshold": -50.867,
            "scale": 7.734,
        })
        self.assertEqual(models["openai/gpt-5.6-terra"]["honest"], {
            "threshold": -50.723,
            "scale": 4.969,
        })
        self.assertEqual(models["x-ai/grok-4.5"]["factual"], {
            "threshold": -60.248,
            "scale": 7.966,
        })
        self.assertEqual(models["x-ai/grok-4.5"]["honest"], {
            "threshold": -53.093,
            "scale": 7.238,
        })
        for table in [recenter["default"], *models.values()]:
            self.assertEqual(set(table), expected_traits)
            self.assertTrue(all(entry["scale"] > 0 for entry in table.values()))


if __name__ == "__main__":
    unittest.main()
