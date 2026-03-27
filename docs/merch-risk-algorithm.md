# Merch Risk Evaluation Algorithm

> Reference doc for the merch risk scoring model.
> Last updated: March 26, 2026

---

## Data Protection Rules

1. **NEVER store PII from ticket/merch datasets** — no names, emails, addresses, phone numbers, order IDs
2. **Only store aggregate stats per artist** — total orders, total revenue, avg order value, event count, date range
3. **Source data files stay local** — never committed to git, never uploaded to Supabase
4. **Aggregated benchmarks table only** — `merch_artist_benchmarks` stores anonymized performance metrics

---

## Algorithm Logic

### The Core Question
"Given an artist with CM score X and momentum Y, and a front amount of $Z, what is the risk that we don't recoup?"

### Data Sources

| Source | What it tells us | Key metric |
|--------|-----------------|------------|
| Chartmetric | Artist size, momentum, social reach | cm_score, career_stage, momentum |
| Ticketmaster VIP | Fan willingness to pay for premium | total VIP revenue, orders, avg ticket price |
| AXS VIP | Same as TM, different platform | total VIP revenue, orders, avg ticket price |
| Shopify (artist stores) | Actual merch revenue benchmarks | monthly revenue, avg order value, order frequency |

### The Model

**Step 1: Establish VIP-to-Merch ratio**

Using artists where we have BOTH VIP ticket data AND merch store data:

| Artist | CM Score | VIP Revenue (TM+AXS) | Monthly Merch Rev | VIP:Merch Ratio |
|--------|----------|----------------------|-------------------|----------------|
| Deadmau5 | ~90 | $X from TM/AXS | $48,258/mo | TBD |
| Kx5 | ~85 | $X from TM/AXS | $3,145/mo | TBD |
| Morphine | TBD | $X from TM/AXS | $2,212/mo | TBD |

This ratio tells us: "For every $1 in VIP ticket sales, expect $Y in monthly merch."

**Step 2: CM Score as a scaling factor**

Group all TM/AXS artists by CM score bands:
- 90+ (superstar): avg VIP revenue = $X
- 80-89 (mainstream): avg VIP revenue = $X
- 70-79 (mid-level): avg VIP revenue = $X
- 60-69 (developing): avg VIP revenue = $X
- <60 (undiscovered): avg VIP revenue = $X

This creates a baseline expectation for any artist based on their CM score.

**Step 3: Project merch revenue for new artist**

```
projected_monthly_merch = vip_to_merch_ratio × estimated_vip_revenue(cm_score, momentum)
```

If the artist has actual TM/AXS data in our system, use that instead of the estimate.

**Step 4: Calculate risk against front amount**

```
break_even_months = front_amount / projected_monthly_merch
```

| Break-Even | Risk Level |
|-----------|------------|
| < 6 months | Low |
| 6-12 months | Moderate |
| 12-18 months | High |
| > 18 months | Pass |

**Step 5: Adjustment factors**

Increase confidence (lower risk):
- Artist has actual TM/AXS data showing strong VIP sales
- CM momentum is "growth" or "accelerating"
- Artist is currently touring (active deal in our pipeline)
- Artist has festival appearances (demand signal)

Decrease confidence (higher risk):
- No TM/AXS history (unproven VIP demand)
- CM momentum is "declining" or "gradual decline"
- Legacy/inactive artist with no current tour
- Low social engagement relative to follower count

---

## Database Table: `merch_artist_benchmarks`

Stores ONLY aggregate performance data. NO PII.

| Field | Type | Description |
|-------|------|-------------|
| chartmetric_id | INTEGER (FK) | Links to intel_artists |
| tm_total_orders | INTEGER | Total non-voided TM VIP orders |
| tm_total_revenue | NUMERIC | Total TM VIP revenue |
| tm_event_count | INTEGER | Unique TM events |
| tm_avg_order_value | NUMERIC | Avg revenue per order |
| axs_total_orders | INTEGER | Total AXS VIP orders |
| axs_total_revenue | NUMERIC | Total AXS VIP revenue |
| axs_event_count | INTEGER | Unique AXS events |
| axs_avg_order_value | NUMERIC | Avg revenue per order |
| shopify_monthly_revenue | NUMERIC | Avg monthly merch revenue (if we have store data) |
| shopify_avg_order_value | NUMERIC | Avg merch order value |
| shopify_date_range_months | INTEGER | How many months of data |
| data_source | TEXT | "tm", "axs", "shopify", "tm+axs", etc. |
| last_updated | TIMESTAMPTZ | When benchmarks were last refreshed |

---

## Calibration Process

1. Aggregate TM data → per-artist stats (done: 899 artists, $68.6M total)
2. Aggregate AXS data → per-artist stats (pending: ~58K orders)
3. Map Shopify stores to artists → monthly merch revenue (3 stores mapped so far)
4. Cross-reference: find artists that appear in both TM/AXS AND Shopify
5. Calculate VIP-to-Merch ratios from those overlapping artists
6. Build CM score bands from the full TM/AXS dataset
7. Validate: run model on known artists, compare projected vs actual merch revenue

---

## Future Enhancements

- More Shopify stores → better VIP-to-Merch ratio calibration
- ROSTR data → factor in management quality/track record
- Google Trends → household income data for market sizing
- Seasonal adjustments → touring season vs off-season revenue patterns
- Genre-specific models → metal fans buy different merch than pop fans

---

*P&TY Internal — Confidential — Do not share externally*
