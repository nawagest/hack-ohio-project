# Decision Matrices

These matrices define a transparent starting point for the Outage Concierge's outage-risk and restoration explanations. They are designed from the challenge requirements, the supplied GIS/topology archives, the labor workbook, and the structure-drawing PDF.

> **Important:** The weights below are proposed prototype priorities, not weights learned from utility outcomes. The outage score is a relative risk index, not a probability. The restoration range is a scenario estimate, not a utility commitment. Both require validation and calibration before operational use.

## Source interpretation

The written challenge requirements are in `HackOHIO_2026_AI_Outage_Concierge_Challenge.docx`; they call for outage likelihood, credible restoration ranges, preparation advice, alerts, explanations, uncertainty, and privacy protections. `structure_drawings.pdf` contains distribution-structure examples. It can help reviewers reason about which components a damage description might involve, but it does not provide storm exposure data, repair-time observations, or prediction coefficients.

The raw data package is described in [`../data/README.md`](../data/README.md). Attribute names below are the abbreviated names stored in the supplied shapefile DBF tables; display names should be clearer in the app.

## 1. Outage-Risk Decision Matrix

### Ranked factors

| Rank | Factor | Proposed weight | Evidence in supplied data | Why it matters / customer explanation |
| --- | --- | ---: | --- | --- |
| 1 | Storm hazard and severity | 30 points | **Not supplied as a live forecast.** A storm-severity scenario must be entered or simulated and labeled as such. | Wind, ice, rain, and flooding create the loading or access conditions that can damage equipment. Explain which scenario was selected; do not imply the utility or app has a live forecast if it does not. |
| 2 | Historical damage on the connected circuit or nearby assets | 25 points | `Data1.zip`: `arcos_prod_damage_09_28_Clip.dbf` fields `Event`, `Circuit`, `Asset_Type`, `Inform_Wor`, `Report_Tim`, `Status`, `Repaired_D`, `Latitude`, `Longitude`, and `NEAR_DIST`. | Prior damage can identify exposed areas or asset types, but historical events are not a guarantee of repeat damage. Explain the match as historical evidence, not a prediction that the same failure will recur. |
| 3 | Upstream network dependency and protective devices | 20 points | `matched_upstream.zip`: `matched_upstream.txt` links an anonymized premise key to upstream transformer, isolating equipment (such as fuse/recloser), and circuit. GIS layers also include customer `aep_xfmr_l`, `aep_string`, `circuit_id`, plus device `upstream_l` fields in transformer, switch, fuse-bank, and recloser-bank tables. | A fault upstream can affect multiple downstream customers; protective devices and network boundaries influence how broadly an interruption may spread. Explain the dependency in plain language without exposing device identifiers or other customers. |
| 4 | Asset type and condition indicators | 15 points | `Data1.zip`: `Pole_Clip.dbf` fields `material`, `height`, `class`, `status`, and `date_insta`; primary-line fields include `network_ty`, `nominal_vo`, `existing_p`, and `report_len`. `Data2.zip` includes secondary-line, transformer, switch, and recloser layers with type, status, voltage, and configuration fields. | Asset type and recorded condition can affect exposure and failure modes. The supplied attributes are incomplete proxies for condition; avoid presenting them as an engineering inspection. |
| 5 | Geographic proximity to recorded damage | 10 points | Damage coordinates and `NEAR_DIST`; premise and asset point/line geometries in the GIS extracts. | Nearby damage is useful context when it is on a relevant connected circuit. Straight-line proximity alone is weak evidence, so prefer circuit/topology matches and explain when only geographic proximity is available. |
|  | **Total** | **100 points** |  |  |

### Prototype scoring approach

1. Score each factor from 0 to 5 using documented, repeatable rules. A score of 0 means no supporting evidence of added exposure; 5 means strong evidence within the selected scenario. Missing information is **unknown**, not zero.
2. Calculate the relative index as `sum(weight × factor score / 5)` over factors with usable evidence, then normalize by the total weight of those factors. Show which factors were unavailable and the evidence coverage beside the result.
3. Suggested display bands for a prototype only: 0–29 **Lower**, 30–59 **Elevated**, and 60–100 **Higher**. These are not calibrated outage probabilities or operational thresholds.
4. Show confidence separately from risk. Confidence reflects source coverage, recency, and the strength of premise-to-network matching; a high score with limited evidence must still be described as uncertain.

### Required safeguards and current gaps

- The package does not include a live weather forecast or explicit storm-hazard layer. Any wind/ice/rain/flood input must be clearly marked as a user-selected or simulated scenario.
- Before describing a result as likelihood, the team needs an outcome label (premise/circuit outage during a defined storm/time window) and representative historical storm examples to calibrate and test the score. The supplied damage records alone do not establish a calibrated probability.
- Use topology and circuit association before geographic distance. Do not infer that a customer is affected solely because a damage point is nearby.
- Do not reveal premise addresses, premise/customer identifiers, internal asset identifiers, employee/crew details, or exact sensitive-facility locations in customer explanations.

## 2. Restoration-Time Decision Matrix

### Ranked factors

| Rank | Factor | Proposed influence | Evidence in supplied data | Effect on the estimate / customer explanation |
| --- | --- | ---: | --- | --- |
| 1 | Repair scope: damage type, asset type, and quantity | 25% | Damage layer fields `Asset_Type`, `Inform_Wor`, `Media`, `Access_Iss`, and `Special_Eq`; the challenge describes damage quantity and repair status. The structure PDF provides visual examples of distribution assemblies and components. | More repairs or a more involved component replacement generally increases work. State the assumed repair count and scope; a drawing is context, not proof of the actual damaged component. |
| 2 | Direct installation/removal labor reference | 25% | `Install_Labor_HackOHIO.xlsx`, especially `Labor time material related` and `Labor only work`; per-CU installation/removal hours and representative averages by asset class/size. For example, the workbook reports pole installation averages by size group. | Sum applicable install and removal hours for the assumed work. Identify the reference as representative labor, not a crew schedule or guaranteed duration. |
| 3 | Indirect labor multiplier | 15% | Workbook sheet `Indirect Labor Multiplier`: ILM = **4.5**, described as accounting for driving, safety discussion, setup, and similar time. | Apply the supplied multiplier to direct labor as the challenge's baseline operational assumption. Keep the value visible and adjustable in scenario analysis; validate whether it applies to the modeled work and service area. |
| 4 | Site access and specialized-equipment needs | 15% | Damage fields `Access_Iss` and `Special_Eq`; workbook `Labor only work` includes restricted/confined/remote access, specialized handling, site-complexity, and excavation adders. | Restricted access, difficult excavation, or specialized equipment can extend work. Include only applicable adders and clearly identify unknown access conditions. |
| 5 | Network dependencies, inspection, isolation, and restoration sequence | 10% | `matched_upstream.txt`; transformer, fuse, switch, recloser, and circuit relationships in the GIS extracts; challenge requirement for upstream dependencies and step restoration. | Upstream repair or safe isolation may need to happen before downstream repairs. Partial restoration may occur in stages; distinguish a customer's estimated restoration from final completion of all work. |
| 6 | Crew availability, skills, and parallel work | 5% | Historical damage fields include `TASK_Crew`, `Crew_Area`, and `Status`; the supplied data does not provide a live crew roster, shift schedule, or guaranteed crew count. | More available qualified labor can shorten elapsed time, while competing work or scarce skills can lengthen it. Any current crew assumption must be labeled simulated unless confirmed by operations. |
| 7 | Repair progress and observed completion history | 5% | Damage fields `Report_Tim`, `Status`, `Repaired`, and `Repaired_D`; these can support historical duration checks when records are complete and comparable. | Confirmed work progress can narrow or move the estimate. Historical elapsed time can validate estimates, but should not be used as a direct promise for a new event without comparability checks. |
|  | **Total** | **100%** |  |  |

The influence percentages are a prioritization for explanation and scenario review; they are **not** multipliers in the time equation. The actual time calculation should use the labor references and explicit operational assumptions below.

### Transparent estimate calculation

For each assumed repair task:

`direct labor hours = installation hours + removal hours + applicable labor adders`

Then:

`adjusted labor effort = sum(direct labor hours) × 4.5`

Convert labor effort to elapsed time only when crew capacity is known or explicitly assumed:

`estimated elapsed work time = adjusted labor effort ÷ available labor capacity per clock-hour + dependency / access / sequencing delays`

Available labor capacity should reflect qualified crew size, availability, and whether tasks can safely happen in parallel. Do not divide by a raw count of crews unless crew size and availability are represented. If those inputs are unknown, provide a wider scenario range or explain that a reliable elapsed-time estimate cannot be produced.

### Range construction and update rules

- **Low case:** smaller supported repair scope, normal access, and adequate qualified crew capacity.
- **Central case:** best-supported scope and current documented assumptions.
- **High case:** additional plausible damage, constrained access/equipment, dependency delays, or limited crew capacity.
- Do not apply arbitrary percentage padding and call it data-driven. Until local historical durations are validated, label range bounds as scenario assumptions.
- Recalculate when damage count/type, access, upstream status, crew capacity, or repair progress changes. Show what changed and which input moved the range.
- Separate confirmed utility status from the model: e.g. “No restoration time has been confirmed; this is a planning estimate based on the scenario shown.”

## Customer-facing explanation contract

Every response should separate:

- **What is known:** source data and timestamp/status, summarized without private or internal identifiers.
- **What is estimated:** risk band or restoration range, confidence/data coverage, and the scenario assumptions.
- **Why it changed:** the top two or three contributing factors in plain language.
- **What could change it:** missing weather, newly assessed damage, access, dependency, or crew updates.
- **What to do:** preparation/safety guidance and a fallback to official utility updates or emergency services when appropriate.

If the premise-to-network match is unreliable, required inputs are missing, or the estimate cannot be supported, do not fabricate a result. Explain the limitation and provide general preparation guidance plus the official status/alert channel.

## Data and validation checklist

- Confirm shapefile projections and align coordinates before calculating distance or joining damage to assets.
- Validate premise-to-transformer/circuit links and topology parsing before scoring a premise.
- Check missingness, duplicate events, timestamp quality, repair-status meanings, and whether `NEAR_DIST` is measured in a usable unit.
- Keep sensitive premise, customer, and critical-facility attributes out of generated customer text and demo screenshots.
- Test risk and restoration outputs against held-out historical events where suitable outcomes exist; report calibration/error and limitations before presenting numeric probabilities or operational restoration commitments.