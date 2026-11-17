"""Reproduce the December holiday mobility case study from dashboard archives."""

import json
from datetime import date
from pathlib import Path
from statistics import median

DATA = Path(__file__).resolve().parents[2] / "web/public/data"
YEARS = (2023, 2024, 2025)
NOVEMBER_EXCLUSIONS = {2023: {5, 23, 24}, 2024: {3, 28, 29}}
EARLY_DECEMBER = range(1, 22)
LATE_DECEMBER = range(26, 31)
COMPLETE_WEEKS = tuple(range(start, start + 7) for start in (1, 8, 15, 22))


def load_daily_counts(mode, year, month, days):
    path = DATA / f"{mode}-{year}-{month:02}.json"
    with path.open(encoding="utf-8") as file:
        data = json.load(file)

    hourly_counts = (
        data["zones"]
        if mode == "yellow-taxi"
        else {str(station["id"]): station["counts"] for station in data["stations"]}
    )
    daily = {}
    for location, hours in hourly_counts.items():
        day_counts = {}
        for day in days:
            values = hours[(day - 1) * 24 : day * 24]
            if len(values) == 24 and all(value is not None for value in values):
                day_counts[date(year, month, day)] = sum(values)
        if len(day_counts) == len(days):
            daily[location] = day_counts
    return daily


def aggregate(counts, locations):
    # Every retained location covers the same dates in this archive.
    dates = counts[next(iter(locations))]
    return {day: sum(counts[location][day] for location in locations) for day in dates}


def percent_change(december, baseline, period):
    typical_by_weekday = [
        median(value for day, value in baseline.items() if day.weekday() == weekday)
        for weekday in range(7)
    ]
    days = [day for day in december if day.day in period]
    expected = sum(typical_by_weekday[day.weekday()] for day in days)
    return f"{100 * (sum(december[day] for day in days) / expected - 1):+.1f}%"


def report(mode):
    december = {year: load_daily_counts(mode, year, 12, range(1, 32)) for year in YEARS}
    november = {
        year: load_daily_counts(mode, year, 11, sorted(set(range(1, 31)) - excluded))
        for year, excluded in NOVEMBER_EXCLUSIONS.items()
    }
    locations = set.intersection(
        *(set(month) for month in [*december.values(), *november.values()])
    )
    print(f"\n{mode} ({len(locations)} complete locations)")
    print("Location | Year | Dec 1–21 vs Nov | Dec 1–31 vs Nov | Dec 26–30 vs Dec 1–21")

    groups = {"All covered locations": locations}
    if mode == "subway":
        groups.update({"Rockefeller Center": {"225"}, "Union Square": {"602"}})

    for name, group in groups.items():
        if not group <= locations:
            raise ValueError(f"{name} has incomplete coverage")
        for year in YEARS:
            dec = aggregate(december[year], group)
            early = {day: value for day, value in dec.items() if day.day in EARLY_DECEMBER}
            early_vs_nov = full_vs_nov = "—"
            if year in november:
                nov = aggregate(november[year], group)
                early_vs_nov = percent_change(dec, nov, EARLY_DECEMBER)
                full_vs_nov = percent_change(dec, nov, range(1, 32))
            late_vs_early = percent_change(dec, early, LATE_DECEMBER)
            print(f"{name} | {year} | {early_vs_nov} | {full_vs_nov} | {late_vs_early}")

    print("Busiest full seven-day block in December")
    print("Location | Year | Week | Count")
    for name, group in groups.items():
        for year in YEARS:
            dec = aggregate(december[year], group)
            totals = {
                week: sum(value for day, value in dec.items() if day.day in week)
                for week in COMPLETE_WEEKS
            }
            busiest = max(totals, key=totals.__getitem__)
            print(f"{name} | {year} | Dec {busiest[0]}–{busiest[-1]} | {totals[busiest]:,.0f}")


if __name__ == "__main__":
    for transport_mode in ("yellow-taxi", "subway"):
        report(transport_mode)
