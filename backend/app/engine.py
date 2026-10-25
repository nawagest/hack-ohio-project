from __future__ import annotations

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

    if location.damage_records <= 1:
        history_summary = "limited"
    elif location.damage_records <= 5:
        history_summary = "some"
    else:
        history_summary = "multiple"

    return {
        "location": {"id": location.id, "label": location.label},
        "risk": {
            "index": risk_index,
            "band": risk_band,
            "confidence": "Limited",
            "basis": (
                "Relative prototype index, not a probability. It combines the "
                "selected simulated storm scenario with historical damage records "
                "and asset diversity for an anonymized circuit linked to customer "
                "and upstream network records."
            ),
            "factors": [
                {
                    "label": STORM_LABELS[scenario.storm_severity],
                    "contribution": round(30 * storm_score / 5),
                },
                {
                    "label": f"{history_summary.capitalize()} historical damage records",
                    "contribution": round(25 * historical_score / 5),
                },
                *(
                    [
                        {
                            "label": (
                                "Historical damage across multiple asset types"
                                if len(location.asset_types) > 1
                                else "Historical damage on one asset type"
                            ),
                            "contribution": round(15 * asset_score / 5),
                        }
                    ]
                    if asset_score
                    else []
                ),
            ],
            "limitations": [
                "No live weather forecast is connected; storm severity is a demo scenario.",
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
    normalized = question.casefold()
    risk = result["risk"]
    restoration = result["restoration"]
    if any(word in normalized for word in ("prepare", "ready", "safety", "safe")):
        return " ".join(result["preparation"]) + " Never approach downed wires; contact emergency services if there is immediate danger."
    if any(word in normalized for word in ("alert", "notify", "notification")):
        return (
            f"{result['alert']['rule']} "
            f"{'This sample qualifies under that demo rule.' if result['alert']['eligible'] else 'This sample does not qualify under that demo rule.'} "
            f"{result['alert']['delivery']}"
        )
    if any(word in normalized for word in ("restore", "how long", "time", "repair")):
        bounds = restoration["range_hours"]
        repair_word = "repair" if restoration["repair_count"] == 1 else "repairs"
        return (
            f"For this simulated scenario, the planning range is about {bounds['low']}–"
            f"{bounds['high']} hours, with a central estimate near {bounds['central']} hours. "
            f"This assumes {restoration['repair_count']} pole {repair_word}, a {restoration['crew_size']}-person "
            "crew, workbook labor averages, and the 4.5 indirect-labor multiplier. "
            "It is not a confirmed utility estimate."
        )
    if any(word in normalized for word in ("risk", "why", "outage", "storm")):
        factors = ", ".join(item["label"].lower() for item in risk["factors"])
        return (
            f"The relative risk index is {risk['index']}/100 ({risk['band']}), based on {factors}. "
            f"It is not a probability: {risk['basis']}"
        )
    return (
        f"For {result['location']['label']}, the relative outage-risk index is "
        f"{risk['index']}/100 ({risk['band']}) and the simulated restoration planning range is "
        f"{restoration['range_hours']['low']}–{restoration['range_hours']['high']} hours. "
        "Ask me about the risk factors, restoration assumptions, alerts, or preparation steps."
    )
