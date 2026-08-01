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


if __name__ == "__main__":
    unittest.main()
