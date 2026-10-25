import unittest

from backend.app.data import _normalize_circuit, load_dataset


class ChallengeDataTests(unittest.TestCase):
    def test_circuit_labels_match_numeric_gis_keys(self) -> None:
        self.assertEqual(_normalize_circuit("CIR00027"), "27")
        self.assertEqual(_normalize_circuit("0000027"), "27")
        self.assertEqual(_normalize_circuit("TINKER"), "tinker")

    def test_supplied_files_build_anonymized_sample_locations(self) -> None:
        dataset = load_dataset()

        self.assertGreaterEqual(len(dataset.locations), 2)
        self.assertTrue(all(location.topology_records > 0 for location in dataset.locations))
        self.assertEqual(dataset.indirect_multiplier, 4.5)
        self.assertGreater(dataset.install_hours, 0)
        self.assertGreater(dataset.damage_record_count, 0)
        self.assertGreater(dataset.topology_record_count, 0)
        self.assertTrue(all(location.label.startswith("Sample location ") for location in dataset.locations))


if __name__ == "__main__":
    unittest.main()
