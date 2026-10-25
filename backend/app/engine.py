from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal

from .data import Dataset, DemoLocation


StormSeverity = Literal["light", "moderate", "severe"]

STORM_SCORES: dict[StormSeverity, int] = {
    "light": 1,
    "moderate": 3,
    "severe": 5,
}
STORM_LABELS: dict[StormSeverity, str] = {
    "light": "Lower simulated storm severity",
    "moderate": "Moderate simulated storm severity",
    "severe": "Higher simulated storm severity",
}


@dataclass(frozen=True)
class Scenario:
    location_id: str
    storm_severity: StormSeverity
    repair_count: int
    crew_size: int


def _hours_label(hours: float) -> float:
    return round(hours * 2) / 2


def greeting_response(question: str) -> str | None:
    normalized = re.sub(r"[^\w\s]", " ", question.casefold())
    normalized = " ".join(normalized.split())
    if re.fullmatch(
        r"(?:hi|hello|hey|good morning|good afternoon|good evening)"
        r"(?: there)?(?: how are you)?",
        normalized,
    ):
        return "Hi! What would you like to know about the selected area: outage risk, restoration time, preparation, or alerts?"
    return None


def _estimate_for_count(
    dataset: Dataset, repair_count: int, crew_size: int, availability: float, delay: float
) -> float:
    direct_labor_hours = repair_count * (
        dataset.install_hours + dataset.removal_hours
    )
    adjusted_labor_hours = direct_labor_hours * dataset.indirect_multiplier
    capacity_per_hour = crew_size * availability
    return adjusted_labor_hours / capacity_per_hour + delay


def restoration_scenarios(
    dataset: Dataset, crew_size: int
) -> list[dict[str, int | float]]:
    return [
        {
            "repair_count": count,
            "hours": _hours_label(
                _estimate_for_count(dataset, count, crew_size, 0.75, 1)
            ),
        }
        for count in range(1, 5)
    ]


def analyze(dataset: Dataset, scenario: Scenario) -> dict:
    location = dataset.location(scenario.location_id)
    storm_score = STORM_SCORES[scenario.storm_severity]
    historical_score = min(float(location.damage_records), 5.0)
    asset_score = min(float(len(location.asset_types)), 5.0)
    if location.damage_records <= 1:
        history_summary = "limited"
    elif location.damage_records <= 5:
        history_summary = "some"
    else:
        history_summary = "multiple"

    available_factors = [
        (30, storm_score),
        (25, historical_score),
    ]
    if asset_score:
        available_factors.append((15, asset_score))
    risk_index = round(
        sum(weight * score / 5 for weight, score in available_factors)
        / sum(weight for weight, _ in available_factors)
        * 100
    )
    factor_contributions = [
        round(weight * score / 5 / sum(item[0] for item in available_factors) * 100)
        for weight, score in available_factors
    ]
    factor_contributions[-1] += risk_index - sum(factor_contributions)
    if risk_index >= 60:
        risk_band = "Higher"
    elif risk_index >= 30:
        risk_band = "Elevated"
    else:
        risk_band = "Lower"

    direct_hours = scenario.repair_count * (
        dataset.install_hours + dataset.removal_hours
    )
    adjusted_hours = direct_hours * dataset.indirect_multiplier
    low = _estimate_for_count(
        dataset, scenario.repair_count, scenario.crew_size, 0.9, 0.5
    )
    central = _estimate_for_count(
        dataset, scenario.repair_count, scenario.crew_size, 0.75, 1
    )
    high = _estimate_for_count(
        dataset, scenario.repair_count, scenario.crew_size, 0.5, 2
    )

    return {
        "location": {"id": location.id, "label": location.label},
        "risk": {
            "index": risk_index,
            "band": risk_band,
            "confidence": "Limited",
            "basis": (
                "Relative prototype index, not a probability. It combines the "
                "selected simulated storm scenario, historical damage count, and "
                "recorded asset-type diversity. Customer and upstream topology "
                "records are used to build and validate sample locations, but are "
                "not currently inputs to this score."
            ),
            "factors": [
                {
                    "label": STORM_LABELS[scenario.storm_severity],
                    "contribution": factor_contributions[0],
                },
                {
                    "label": f"{history_summary.capitalize()} historical damage records",
                    "contribution": factor_contributions[1],
                },
                *(
                    [
                        {
                            "label": (
                                "Historical damage across multiple asset types"
                                if len(location.asset_types) > 1
                                else "Historical damage on one asset type"
                            ),
                            "contribution": factor_contributions[2],
                        }
                    ]
                    if asset_score
                    else []
                ),
            ],
            "limitations": [
                "Live regional NWS weather is shown separately and does not affect this score; storm severity is a demo scenario.",
                "Historical damage records are not calibrated outage outcomes.",
                "No customer-specific outage or restoration status is available.",
            ],
        },
        "restoration": {
            "range_hours": {
                "low": _hours_label(low),
                "central": _hours_label(central),
                "high": _hours_label(high),
            },
            "direct_labor_hours": round(direct_hours, 2),
            "adjusted_labor_hours": round(adjusted_hours, 2),
            "repair_count": scenario.repair_count,
            "crew_size": scenario.crew_size,
            "install_hours_per_pole": round(dataset.install_hours, 2),
            "removal_hours_per_pole": round(dataset.removal_hours, 2),
            "indirect_multiplier": dataset.indirect_multiplier,
            "assumptions": [
                "Pole work uses the workbook's small-pole average install and removal labor hours.",
                "The supplied 4.5 indirect-labor multiplier is applied to direct labor.",
                f"One simulated crew has {scenario.crew_size} qualified workers.",
                "Low, central, and high cases assume 90%, 75%, and 50% labor availability.",
                "The high case adds a 2-hour sequencing/access allowance; these are scenario assumptions.",
            ],
            "status": "Planning estimate only; no utility restoration time is confirmed.",
        },
        "alert": {
            "eligible": risk_index >= 30,
            "rule": "Demo rule: suggest an alert for Elevated or Higher relative risk.",
            "message": (
                "A storm scenario may affect your area. Charge essential devices, "
                "keep flashlights ready, and follow official utility updates."
            ),
            "delivery": "Suggested message only; this prototype does not send alerts.",
        },
        "preparation": [
            "Charge phones and essential battery-powered devices.",
            "Keep flashlights and fresh batteries accessible.",
            "Follow official utility updates and never approach downed wires.",
        ],
        "chart": restoration_scenarios(dataset, scenario.crew_size),
        "data": {
            "historical_damage_evidence": history_summary,
            "historical_damage_records_in_package": dataset.damage_record_count,
            "upstream_topology_records_in_package": dataset.topology_record_count,
        },
    }


def deterministic_answer(question: str, result: dict) -> str:
    greeting = greeting_response(question)
    if greeting:
        return greeting

    normalized = re.sub(r"[^\w\s]", " ", question.casefold())
    normalized = f" { ' '.join(normalized.split()) } "

    def asks_about(*phrases: str) -> bool:
        return any(f" {phrase} " in normalized for phrase in phrases)

    risk = result["risk"]
    restoration = result["restoration"]
    weather = result.get("weather", {})
    if asks_about("weather", "forecast", "temperature", "rain", "wind", "snow") and not asks_about(
        "alert", "alerts", "warning", "warnings"
    ):
        if weather.get("status") != "available":
            return weather.get(
                "message",
                "Live weather is unavailable right now. The outage-risk score does not include live weather.",
            )
        current = weather.get("current")
        forecast = weather.get("forecast")
        details = []
        if current:
            conditions = current.get("description") or "Current conditions"
            if current.get("temperature_f") is not None:
                conditions += f", {current['temperature_f']}°F"
            if current.get("wind_mph") is not None:
                conditions += f", wind {current['wind_mph']} mph"
            details.append(conditions)
        if forecast and forecast.get("short_forecast"):
            period = forecast.get("period") or "Next forecast period"
            details.append(f"{period}: {forecast['short_forecast']}")
        if not details:
            return "The weather service has no current observation or forecast for this sample area."
        freshness = " The latest station observation is over 90 minutes old." if weather.get("current_stale") else ""
        if weather.get("stale"):
            freshness += " This information is from a cached response."
        observed_at = current.get("observed_at") if current else None
        updated = f" Last observed at {observed_at}." if observed_at else f" Data fetched at {weather.get('fetched_at')}."
        return f"{' '.join(details)}.{updated}{freshness} This is regional weather context, not an outage prediction."
    if asks_about("prepare", "preparation", "ready", "safety", "safe"):
        return (
            "Charge phones and essential battery-powered devices, keep a flashlight "
            "and batteries nearby, and follow official utility updates. Stay away "
            "from downed wires."
        )
    if asks_about("chart", "graph", "plot", "compare"):
        return (
            "The chart compares estimated restoration time for one to four pole "
            "repairs. More assumed repairs increase the estimate; these are planning "
            "scenarios, not confirmed restoration times."
        )
    if asks_about("alert", "alerts", "notify", "notification", "notifications"):
        official_alerts = weather.get("alerts", [])
        if weather.get("status") == "available" and official_alerts:
            alert = official_alerts[0]
            headline = alert.get("headline") or alert.get("event") or "Active weather alert"
            severity = alert.get("severity")
            severity_text = f" Severity: {severity.lower()}." if severity else ""
            expiry = f" It expires at {alert['expires']}." if alert.get("expires") else ""
            freshness = " This is cached information." if weather.get("stale") else ""
            return f"NWS alert: {headline}.{severity_text}{expiry}{freshness} Check the official alert for instructions."
        official_status = (
            f"No active NWS alerts were returned for this sample area as of {weather.get('fetched_at')}."
            if weather.get("status") == "available"
            else "Live NWS alerts are temporarily unavailable."
        )
        return (
            f"{official_status} The separate demo outage-alert rule "
            f"{'is met' if result['alert']['eligible'] else 'is not met'}; "
            "this prototype does not send notifications."
        )
    if asks_about("why") and asks_about("restore", "restoration", "repair", "time"):
        return (
            f"The estimate uses about {restoration['install_hours_per_pole']} install "
            f"hours and {restoration['removal_hours_per_pole']} removal hours per "
            f"pole, then applies the supplied {restoration['indirect_multiplier']} "
            "factor for travel, setup, and safety time. It adjusts for the assumed "
            f"{restoration['crew_size']}-person crew and work delays. These are "
            "planning assumptions, not confirmed crew or utility information."
        )
    if asks_about("restore", "restoration", "how long", "time", "repair", "repairs"):
        bounds = restoration["range_hours"]
        repair_word = "repair" if restoration["repair_count"] == 1 else "repairs"
        return (
            f"For this scenario, plan for about {bounds['low']}–{bounds['high']} hours "
            f"(middle estimate: {bounds['central']} hours). This assumes "
            f"{restoration['repair_count']} pole {repair_word} and a "
            f"{restoration['crew_size']}-person crew. It is not a confirmed utility estimate."
        )
    if asks_about("risk", "outage", "storm", "why"):
        factors = ", ".join(
            f"{item['label'].lower()} (+{item['contribution']})"
            for item in risk["factors"]
        )
        return (
            f"The relative outage-risk score is {risk['index']}/100 ({risk['band']}). "
            f"Its factors are {factors}. This is a limited-confidence scenario "
            "score, not the chance that your power will go out."
        )
    return (
        "I can help with outage risk, restoration time, storm preparation, or alerts "
        "for the selected sample area. Which would you like to know about?"
    )
