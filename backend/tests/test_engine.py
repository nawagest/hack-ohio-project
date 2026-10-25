import unittest

from backend.app.data import Dataset, DemoLocation
from backend.app.engine import Scenario, analyze, deterministic_answer, restoration_scenarios


def sample_dataset() -> Dataset:
    return Dataset(
        locations=(
            DemoLocation("location_a", "internal-circuit-a", 2, frozenset({"pole"}), 10, 37.3, -80.0),
            DemoLocation(
                "location_b",
                "internal-circuit-b",
                8,
                frozenset({"pole", "primary", "fuse"}),
                50,
                37.2,
                -80.0,
            ),
        ),
        install_hours=2,
        removal_hours=1,
        indirect_multiplier=4.5,
        damage_record_count=1659,
        topology_record_count=100,
    )


class AnalysisTests(unittest.TestCase):
    def test_risk_labels_are_relative_not_probabilities(self) -> None:
        dataset = sample_dataset()
        low = analyze(dataset, Scenario("location_a", "light", 1, 2))
        high = analyze(dataset, Scenario("location_b", "severe", 1, 2))

        self.assertEqual(low["risk"]["band"], "Lower")
        self.assertGreater(high["risk"]["index"], low["risk"]["index"])
        self.assertIn("not a probability", low["risk"]["basis"])
        self.assertIn("not currently inputs", low["risk"]["basis"])
        self.assertEqual(
            low["risk"]["factors"][2]["label"],
            "Historical damage on one asset type",
        )
        self.assertEqual(
            sum(factor["contribution"] for factor in low["risk"]["factors"]),
            low["risk"]["index"],
        )

    def test_restoration_range_grows_with_damage_and_has_valid_bounds(self) -> None:
        dataset = sample_dataset()
        one = analyze(dataset, Scenario("location_a", "moderate", 1, 2))
        three = analyze(dataset, Scenario("location_a", "moderate", 3, 2))
        bounds = one["restoration"]["range_hours"]

        self.assertLess(bounds["low"], bounds["central"])
        self.assertLess(bounds["central"], bounds["high"])
        self.assertGreater(
            three["restoration"]["range_hours"]["central"],
            bounds["central"],
        )

    def test_scenario_chart_contains_one_through_four_repairs(self) -> None:
        scenarios = restoration_scenarios(sample_dataset(), crew_size=2)

        self.assertEqual([item["repair_count"] for item in scenarios], [1, 2, 3, 4])
        hours = [item["hours"] for item in scenarios]
        self.assertEqual(hours, sorted(hours))

    def test_assistant_answers_using_calculated_result(self) -> None:
        result = analyze(sample_dataset(), Scenario("location_a", "moderate", 1, 2))

        answer = deterministic_answer("How long could repairs take?", result)

        self.assertIn("not a confirmed utility estimate", answer)

    def test_assistant_responds_naturally_to_greetings(self) -> None:
        result = analyze(sample_dataset(), Scenario("location_a", "moderate", 1, 2))

        answer = deterministic_answer("Hello!", result)

        self.assertTrue(answer.startswith("Hi!"))
        self.assertIn("outage risk", answer)
        self.assertNotIn("/100", answer)

    def test_unrelated_question_gets_a_concise_prompt_for_direction(self) -> None:
        result = analyze(sample_dataset(), Scenario("location_a", "moderate", 1, 2))

        answer = deterministic_answer("What is your favorite color?", result)

        self.assertLess(len(answer), 150)
        self.assertNotIn("/100", answer)
        self.assertIn("Which would you like", answer)

    def test_risk_explanation_shows_normalized_factor_points(self) -> None:
        result = analyze(sample_dataset(), Scenario("location_a", "moderate", 1, 2))

        answer = deterministic_answer("Why is this risk elevated?", result)

        self.assertIn(f"{result['risk']['index']}/100", answer)
        for factor in result["risk"]["factors"]:
            self.assertIn(f"+{factor['contribution']}", answer)

    def test_weather_question_uses_observed_conditions_and_timestamp(self) -> None:
        result = analyze(sample_dataset(), Scenario("location_a", "moderate", 1, 2))
        result["weather"] = {
            "status": "available",
            "stale": False,
            "current_stale": True,
            "fetched_at": "2026-10-25T05:05:36Z",
            "current": {
                "temperature_f": 49,
                "description": "Clear",
                "wind_mph": 0,
                "observed_at": "2026-10-25T01:54:00+00:00",
            },
            "forecast": None,
        }

        answer = deterministic_answer("What's the current weather?", result)

        self.assertIn("Clear, 49°F", answer)
        self.assertIn("Last observed at", answer)
        self.assertIn("over 90 minutes old", answer)
        self.assertIn("not an outage prediction", answer)

    def test_weather_alert_question_reports_official_alert(self) -> None:
        result = analyze(sample_dataset(), Scenario("location_a", "moderate", 1, 2))
        result["weather"] = {
            "status": "available",
            "stale": False,
            "fetched_at": "2026-10-25T05:05:36Z",
            "alerts": [
                {
                    "event": "Wind Advisory",
                    "headline": "Wind Advisory until this evening",
                    "severity": "Moderate",
                    "expires": "2026-10-25T22:00:00Z",
                }
            ],
        }

        answer = deterministic_answer("Are there any weather alerts?", result)

        self.assertIn("NWS alert", answer)
        self.assertIn("Wind Advisory", answer)
        self.assertIn("Severity: moderate", answer)


if __name__ == "__main__":
    unittest.main()
