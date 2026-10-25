from __future__ import annotations

import copy
import json
import threading
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlencode


SOURCE = "National Weather Service"
CACHE_TTL_SECONDS = 15 * 60
RETRY_AFTER_FAILURE_SECONDS = 60
REQUEST_TIMEOUT_SECONDS = 6
OBSERVATION_MAX_AGE_SECONDS = 90 * 60
USER_AGENT = "OutageConciergeDemo/1.0"


@dataclass
class _CacheEntry:
    data: dict[str, Any]
    fetched_at_epoch: float
    attempted_at_epoch: float


_cache: dict[tuple[float, float], _CacheEntry] = {}
_cache_lock = threading.Lock()


def _timestamp(value: float | None = None) -> str:
    moment = datetime.fromtimestamp(value, timezone.utc) if value is not None else datetime.now(timezone.utc)
    return moment.isoformat(timespec="seconds").replace("+00:00", "Z")


def _observation_is_stale(current: dict[str, Any] | None, now: float) -> bool:
    observed_at = current.get("observed_at") if current else None
    if not observed_at:
        return False
    try:
        observed = datetime.fromisoformat(str(observed_at).replace("Z", "+00:00"))
    except ValueError:
        return True
    return now - observed.timestamp() > OBSERVATION_MAX_AGE_SECONDS


def _cached_result(
    entry: _CacheEntry, now: float, *, stale: bool
) -> dict[str, Any]:
    result = copy.deepcopy(entry.data)
    result.update(
        {
            "fetched_at": _timestamp(entry.fetched_at_epoch),
            "stale": stale,
            "current_stale": _observation_is_stale(result.get("current"), now),
        }
    )
    return result


def _get_json(url: str) -> dict[str, Any]:
    if not url.startswith("https://api.weather.gov/"):
        raise ValueError("Unexpected URL returned by the weather service.")
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "application/geo+json",
            "User-Agent": USER_AGENT,
        },
    )
    with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
        payload = json.loads(response.read())
    if not isinstance(payload, dict):
        raise ValueError("The weather service returned an invalid response.")
    return payload


def _temperature_f(property_data: dict[str, Any] | None) -> float | None:
    if not property_data or property_data.get("value") is None:
        return None
    value = float(property_data["value"])
    if str(property_data.get("unitCode", "")).endswith("degC"):
        value = value * 9 / 5 + 32
    return round(value)


def _wind_mph(property_data: dict[str, Any] | None) -> float | None:
    if not property_data or property_data.get("value") is None:
        return None
    value = float(property_data["value"])
    unit = str(property_data.get("unitCode", ""))
    if unit.endswith("km_h-1"):
        value *= 0.621371
    elif unit.endswith("m_s-1"):
        value *= 2.23694
    return round(value, 1)


def _wind_direction(degrees: float | None) -> str | None:
    if degrees is None:
        return None
    directions = ("N", "NE", "E", "SE", "S", "SW", "W", "NW")
    return directions[round(float(degrees) / 45) % len(directions)]


def _current_observation(station_url: str) -> dict[str, Any] | None:
    stations = _get_json(station_url)
    features = stations.get("features", [])
    if not features:
        return None
    station_url = features[0].get("id", "")
    if not station_url.startswith("https://api.weather.gov/"):
        return None
    observation = _get_json(f"{station_url.rstrip('/')}/observations/latest")
    properties = observation.get("properties", {})
    temperature = _temperature_f(properties.get("temperature"))
    description = properties.get("textDescription")
    if temperature is None and not description:
        return None
    return {
        "temperature_f": temperature,
        "description": description or "Current conditions available",
        "wind_mph": _wind_mph(properties.get("windSpeed")),
        "wind_direction": _wind_direction(
            (properties.get("windDirection") or {}).get("value")
        ),
        "observed_at": properties.get("timestamp"),
    }


def _forecast_period(forecast_url: str) -> dict[str, Any] | None:
    forecast = _get_json(forecast_url)
    periods = forecast.get("properties", {}).get("periods", [])
    if not periods:
        return None
    period = periods[0]
    precipitation = period.get("probabilityOfPrecipitation", {}).get("value")
    return {
        "period": period.get("name"),
        "temperature_f": period.get("temperature"),
        "short_forecast": period.get("shortForecast"),
        "precipitation_probability": precipitation,
        "starts_at": period.get("startTime"),
    }


def _active_alerts(latitude: float, longitude: float) -> list[dict[str, Any]]:
    query = urlencode({"point": f"{latitude:.1f},{longitude:.1f}"})
    payload = _get_json(f"https://api.weather.gov/alerts/active?{query}")
    alerts = []
    for feature in payload.get("features", [])[:5]:
        properties = feature.get("properties", {})
        alerts.append(
            {
                "event": properties.get("event"),
                "headline": properties.get("headline"),
                "severity": properties.get("severity"),
                "effective": properties.get("effective"),
                "expires": properties.get("expires"),
            }
        )
    return alerts


def _fetch_weather_data(latitude: float, longitude: float) -> dict[str, Any]:
    point_url = f"https://api.weather.gov/points/{latitude:.1f},{longitude:.1f}"
    point = _get_json(point_url).get("properties", {})

    current = None
    forecast = None
    alerts: list[dict[str, Any]] = []
    for fetch, args, key in (
        (_current_observation, (point.get("observationStations", ""),), "current"),
        (_forecast_period, (point.get("forecast", ""),), "forecast"),
        (_active_alerts, (latitude, longitude), "alerts"),
    ):
        try:
            value = fetch(*args)
            if key == "current":
                current = value
            elif key == "forecast":
                forecast = value
            else:
                alerts = value
        except (OSError, ValueError, KeyError, TypeError, json.JSONDecodeError, urllib.error.URLError):
            continue

    if current is None and forecast is None and not alerts:
        raise RuntimeError("The weather service returned no current conditions, forecast, or alerts.")
    return {
        "status": "available",
        "source": SOURCE,
        "current": current,
        "forecast": forecast,
        "alerts": alerts,
    }


def get_weather(latitude: float, longitude: float) -> dict[str, Any]:
    """Return regional NWS observations, forecast, and alerts with a 15-minute cache."""
    key = (round(latitude, 1), round(longitude, 1))
    now = time.time()
    with _cache_lock:
        entry = _cache.get(key)
        if entry and now - entry.fetched_at_epoch < CACHE_TTL_SECONDS:
            return _cached_result(entry, now, stale=False)
        if entry and now - entry.attempted_at_epoch < RETRY_AFTER_FAILURE_SECONDS:
            result = _cached_result(entry, now, stale=True)
            if result["status"] == "available":
                result["message"] = "Live refresh failed; showing the last cached weather data."
            return result

        try:
            data = _fetch_weather_data(*key)
        except (OSError, RuntimeError, ValueError, KeyError, TypeError, json.JSONDecodeError, urllib.error.URLError):
            if entry:
                entry.attempted_at_epoch = now
                result = _cached_result(entry, now, stale=True)
                if result["status"] == "available":
                    result["message"] = "Live refresh failed; showing the last cached weather data."
                return result
            unavailable = {
                "status": "unavailable",
                "source": SOURCE,
                "fetched_at": _timestamp(now),
                "stale": False,
                "current_stale": False,
                "current": None,
                "forecast": None,
                "alerts": [],
                "message": "Live weather is temporarily unavailable. Risk and restoration estimates are unchanged.",
            }
            _cache[key] = _CacheEntry(unavailable, now, now)
            return copy.deepcopy(unavailable)

        _cache[key] = _CacheEntry(data, now, now)
        return _cached_result(_cache[key], now, stale=False)


def clear_weather_cache() -> None:
    """Clear cached weather data; intended for deterministic tests."""
    with _cache_lock:
        _cache.clear()