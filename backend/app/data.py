from __future__ import annotations

import io
import re
import zipfile
from collections import Counter
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

import shapefile
from openpyxl import load_workbook


ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "data"


@dataclass(frozen=True)
class DemoLocation:
    id: str
    circuit_key: str
    damage_records: int
    asset_types: frozenset[str]
    topology_records: int
    weather_latitude: float
    weather_longitude: float

    @property
    def label(self) -> str:
        return f"Sample location {self.id[-1].upper()}"


@dataclass(frozen=True)
class Dataset:
    locations: tuple[DemoLocation, ...]
    install_hours: float
    removal_hours: float
    indirect_multiplier: float
    damage_record_count: int
    topology_record_count: int

    def location(self, location_id: str) -> DemoLocation:
        for location in self.locations:
            if location.id == location_id:
                return location
        raise ValueError("Select one of the available anonymized demo locations.")


def _read_records(
    archive_path: Path, layer_name: str, fields: list[str]
) -> list[dict[str, Any]]:
    try:
        with zipfile.ZipFile(archive_path) as archive:
            reader = shapefile.Reader(
                shp=io.BytesIO(archive.read(layer_name.removesuffix(".dbf") + ".shp")),
                shx=io.BytesIO(archive.read(layer_name.removesuffix(".dbf") + ".shx")),
                dbf=io.BytesIO(archive.read(layer_name)),
                encoding="utf-8",
            )
            return [record.as_dict() for record in reader.iterRecords(fields=fields)]
    except (OSError, KeyError, zipfile.BadZipFile, shapefile.ShapefileException) as exc:
        raise RuntimeError(
            f"Could not read {layer_name} from {archive_path.name}: {exc}"
        ) from exc


def _normalize_circuit(value: object) -> str:
    circuit = str(value or "").strip()
    suffix = re.search(r"(\d+)$", circuit)
    if suffix:
        return str(int(suffix.group(1)))
    return circuit.casefold()


def _customer_circuit_centers(archive_path: Path) -> dict[str, tuple[float, float]]:
    try:
        with zipfile.ZipFile(archive_path) as archive:
            reader = shapefile.Reader(
                shp=io.BytesIO(archive.read("Customer_Clip.shp")),
                shx=io.BytesIO(archive.read("Customer_Clip.shx")),
                dbf=io.BytesIO(archive.read("Customer_Clip.dbf")),
                encoding="utf-8",
            )
            coordinate_sums: dict[str, list[float]] = {}
            for record, shape in zip(
                reader.iterRecords(fields=["circuit_id"]), reader.iterShapes()
            ):
                circuit = _normalize_circuit(record["circuit_id"])
                if not circuit or not shape.points:
                    continue
                longitude, latitude = shape.points[0]
                totals = coordinate_sums.setdefault(circuit, [0.0, 0.0, 0.0])
                totals[0] += latitude
                totals[1] += longitude
                totals[2] += 1
    except (OSError, KeyError, zipfile.BadZipFile, shapefile.ShapefileException) as exc:
        raise RuntimeError(f"Could not read customer region coordinates: {exc}") from exc

    return {
        circuit: (round(totals[0] / totals[2], 1), round(totals[1] / totals[2], 1))
        for circuit, totals in coordinate_sums.items()
        if totals[2]
    }


def _load_labor_reference() -> tuple[float, float, float]:
    path = DATA_DIR / "Install_Labor_HackOHIO.xlsx"
    if not path.is_file():
        raise FileNotFoundError(f"Required labor reference not found: {path}")

    try:
        workbook = load_workbook(path, read_only=True, data_only=True)
        labor_sheet = workbook["Labor time material related"]
        install_hours = float(labor_sheet["C12"].value)
        removal_hours = float(labor_sheet["D12"].value)
        indirect_multiplier = float(workbook["Indirect Labor Multiplier"]["B1"].value)
    except (KeyError, TypeError, ValueError) as exc:
        raise RuntimeError(f"Could not read labor assumptions from {path.name}: {exc}") from exc
    finally:
        if "workbook" in locals():
            workbook.close()

    if install_hours <= 0 or removal_hours < 0 or indirect_multiplier <= 0:
        raise RuntimeError("The labor workbook contains invalid pole-hour assumptions.")
    return install_hours, removal_hours, indirect_multiplier


@lru_cache(maxsize=1)
def load_dataset() -> Dataset:
    damage_path = DATA_DIR / "raw" / "Data1.zip"
    customer_path = DATA_DIR / "raw" / "Data1.zip"
    topology_path = DATA_DIR / "raw" / "matched_upstream.zip"
    for path in (damage_path, customer_path, topology_path):
        if not path.is_file():
            raise FileNotFoundError(
                f"Required challenge data not found: {path}. "
                "Restore the supplied files listed in data/README.md."
            )

    damage_records = _read_records(
        damage_path,
        "arcos_prod_damage_09_28_Clip.dbf",
        ["Circuit", "Asset_Type"],
    )
    customer_records = _read_records(
        customer_path,
        "Customer_Clip.dbf",
        ["circuit_id"],
    )

    damage_counts: Counter[str] = Counter()
    assets_by_circuit: dict[str, set[str]] = {}
    for record in damage_records:
        circuit = _normalize_circuit(record.get("Circuit"))
        if not circuit:
            continue
        damage_counts[circuit] += 1
        asset_type = str(record.get("Asset_Type") or "").strip().casefold()
        if asset_type:
            assets_by_circuit.setdefault(circuit, set()).add(asset_type)

    customer_circuits = {
        _normalize_circuit(record.get("circuit_id"))
        for record in customer_records
        if str(record.get("circuit_id") or "").strip()
    }
    customer_centers = _customer_circuit_centers(customer_path)
    matched_circuits = customer_circuits.intersection(damage_counts, customer_centers)
    if not matched_circuits:
        raise RuntimeError(
            "No customer circuits matched the historical damage records. "
            "The demo cannot produce a data-backed location list."
        )

    ranked_circuits = sorted(
        matched_circuits,
        key=lambda circuit: (damage_counts[circuit], circuit),
    )
    sample_positions = sorted(
        {round(index * (len(ranked_circuits) - 1) / 2) for index in range(3)}
    )
    selected_circuits = [ranked_circuits[index] for index in sample_positions]

    topology_counts: Counter[str] = Counter()
    try:
        with zipfile.ZipFile(topology_path) as archive:
            topology_name = next(
                (name for name in archive.namelist() if name.endswith(".txt")), None
            )
            if topology_name is None:
                raise RuntimeError("The upstream archive does not contain a text file.")
            with archive.open(topology_name) as topology_file:
                for raw_line in topology_file:
                    if not raw_line.strip():
                        continue
                    fields = raw_line.decode("utf-8", errors="replace").rstrip().split("\t")
                    if fields:
                        topology_counts[
                            _normalize_circuit(fields[-1].rsplit("*", 1)[-1])
                        ] += 1
    except (OSError, zipfile.BadZipFile) as exc:
        raise RuntimeError(f"Could not read upstream topology: {exc}") from exc

    topology_record_count = sum(topology_counts.values())
    selected_topology_records = [
        topology_counts[circuit] for circuit in selected_circuits
    ]
    if not all(selected_topology_records):
        raise RuntimeError(
            "The selected sample circuits do not have matching upstream topology records."
        )

    locations = tuple(
        DemoLocation(
            id=f"location_{chr(ord('a') + index)}",
            circuit_key=circuit,
            damage_records=damage_counts[circuit],
            asset_types=frozenset(assets_by_circuit.get(circuit, set())),
            topology_records=topology_counts[circuit],
            weather_latitude=customer_centers[circuit][0],
            weather_longitude=customer_centers[circuit][1],
        )
        for index, circuit in enumerate(selected_circuits)
    )

    install_hours, removal_hours, indirect_multiplier = _load_labor_reference()
    return Dataset(
        locations=locations,
        install_hours=install_hours,
        removal_hours=removal_hours,
        indirect_multiplier=indirect_multiplier,
        damage_record_count=sum(damage_counts.values()),
        topology_record_count=topology_record_count,
    )
