import unittest
from datetime import datetime, timezone
from unittest.mock import patch

from backend.app import weather


def sample_weather() -> dict:
    return {
        "status": "available",
        "source": "National Weather Service",
        "current": {
            "temperature_f": 68,
            "description": "Partly Cloudy",
            "wind_mph": 4.0,
            "wind_direction": "NW",
            "observed_at": "2026-10-25T10:00:00+00:00",
        },
        "forecast": {
            "period": "Today",
            "temperature_f": 70,
            "short_forecast": "Partly Sunny",
            "precipitation_probability": 10,
            "starts_at": "2026-10-25T06:00:00-04:00",
        },
        "alerts": [],
    }


class WeatherCacheTests(unittest.TestCase):
    def setUp(self) -> None:
        weather.clear_weather_cache()

    def tearDown(self) -> None:
        weather.clear_weather_cache()

    def test_successful_weather_is_cached_by_rounded_region(self) -> None:
        with patch.object(weather, "_fetch_weather_data", return_value=sample_weather()) as fetch:
            first = weather.get_weather(37.31, -80.04)
            second = weather.get_weather(37.34, -80.02)

        self.assertEqual(fetch.call_count, 1)
        self.assertEqual(first["current"]["temperature_f"], 68)
        self.assertEqual(first["fetched_at"], second["fetched_at"])
        self.assertFalse(second["stale"])

    def test_failed_refresh_returns_timestamped_stale_cache(self) -> None:
        with patch.object(
            weather,
            "_fetch_weather_data",
            side_effect=[sample_weather(), RuntimeError("NWS unavailable")],
        ):
            with patch.object(weather.time, "time", side_effect=[1000.0, 1000.0 + weather.CACHE_TTL_SECONDS + 1]):
                weather.get_weather(37.3, -80.0)
                stale = weather.get_weather(37.3, -80.0)

        self.assertEqual(stale["status"], "available")
        self.assertTrue(stale["stale"])
        self.assertIn("cached", stale["message"])
        self.assertEqual(stale["fetched_at"], "1970-01-01T00:16:40Z")

    def test_first_fetch_failure_is_a_clear_unavailable_result(self) -> None:
        with patch.object(weather, "_fetch_weather_data", side_effect=RuntimeError("NWS unavailable")):
            result = weather.get_weather(37.3, -80.0)

        self.assertEqual(result["status"], "unavailable")
        self.assertEqual(result["alerts"], [])
        self.assertFalse(result["stale"])
        self.assertIn("temporarily unavailable", result["message"])

    def test_station_observation_freshness_uses_ninety_minute_limit(self) -> None:
        now = datetime(2026, 10, 25, 5, 0, tzinfo=timezone.utc).timestamp()

        recent = weather._observation_is_stale(
            {"observed_at": "2026-10-25T04:00:00+00:00"}, now
        )
        old = weather._observation_is_stale(
            {"observed_at": "2026-10-25T03:00:00+00:00"}, now
        )

        self.assertFalse(recent)
        self.assertTrue(old)


if __name__ == "__main__":
    unittest.main()