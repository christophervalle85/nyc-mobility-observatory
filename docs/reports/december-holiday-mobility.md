# When should a Rockefeller Center café test extra holiday staffing?

For a café near Rockefeller Center, test staggered start times for two regular shifts on two days between December 8 and 14. Use past receipts to find the two busiest hours and overlap both shifts during that window. Compare hourly orders and wait times with the same weekdays and clock hours on the usual schedule. Check the rush and the quieter hours that lose coverage. If the change adds any payroll costs across the schedule, check whether the gain in gross profit before labor covers them. This is a proposed experiment. The archive contains no café sales or staffing results.

## Why start with December 8–14?

December 8–14 was the busiest of four fixed seven-day blocks spanning December 1–28 for both covered travel measures in 2023, 2024 and 2025. In the two years with a November baseline, counts were higher in the first three weeks of December even though the full-month totals were lower.

| Period and comparison | 2023 yellow taxi | 2024 yellow taxi | 2025 yellow taxi | 2023 subway | 2024 subway | 2025 subway |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| December 1–21 vs. November | +6.3% | +7.8% | — | +2.6% | +4.2% | — |
| Full December vs. November | −6.1% | −4.6% | — | −5.0% | −5.3% | — |
| December 26–30 vs. December 1–21 | −38.6% | −39.6% | −41.1% | −24.3% | −21.6% | −23.6% |

## Rockefeller Center and Union Square

Entries at **47–50 Sts–Rockefeller Ctr** (complex 225) were 28.9% above the November baseline for the full December in 2023 and 31.1% above in 2024. From December 26–30, entries eased at both Rockefeller Center and **14 St–Union Sq** (complex 602). The drop at Rockefeller was smaller each year.

| Subway complex, December 26–30 vs. December 1–21 | 2023 | 2024 | 2025 |
| --- | ---: | ---: | ---: |
| Rockefeller Center | −12.4% | −13.6% | −11.7% |
| Union Square | −37.5% | −32.6% | −38.5% |

Use these station results to decide when to check demand again after Christmas. The Rockefeller café can use its own orders and queues to decide whether any late-December shifts merit a separate test. A café near Union Square should make that call from its own receipts.

## How the comparisons work

The analysis uses the checked-in monthly archives in `web/public/data/`. It covers 263 TLC taxi zones and 118 of the 424 subway complexes in the December archives with fully observed hours across December 2023–2025 and the eligible November 2023 and 2024 comparator days. Each baseline sums the median aggregate daily count for the matching weekday of every date being compared. The late-December comparison uses December 1–21 in the same year as its baseline. November excludes November 5, 23 and 24 in 2023 and November 3, 28 and 29 in 2024 for the fall clock change, Thanksgiving and the following day. The November 2025 archives are absent from this checkout.

Yellow taxi dropoffs and estimated subway entries measure different travel activity. The taxi counts cover in-month dropoffs in the corresponding pickup-month file, and the subway sample covers only the complexes with complete eligible hours. Neither measure identifies café customers or counts storefront foot traffic. Weather, events, office schedules and transit changes may also help explain the differences. [NYC TLC Trip Record Data](https://www.nyc.gov/site/tlc/about/tlc-trip-record-data.page) · [MTA Subway Hourly Ridership, 2020–2024](https://data.ny.gov/d/wujg-7c2s) · [MTA Subway Hourly Ridership, beginning 2025](https://data.ny.gov/d/5wq4-mkjj)

Run from the repository root.

```sh
python3 docs/reports/december_holiday_mobility.py
```
