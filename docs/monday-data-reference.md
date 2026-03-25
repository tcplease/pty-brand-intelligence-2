# Monday.com Data Reference

> Reference doc for how Monday.com data maps to our Supabase schema.
> Last updated: March 24, 2026

---

## Board IDs

| Board | ID | Purpose |
|-------|----|---------|
| Events Deals | `2696356409` | Main deal board - one row per deal per artist |
| CRM Contacts | `2696356486` | Contact records linked to deals via board relations |

---

## Deal Board Column Mapping (`2696356409`)

### Deal Fields (stored in `intel_monday_items`)

| Monday Column ID | Type | Maps To | Notes |
|-----------------|------|---------|-------|
| `text__1` | text | `tour` | e.g. "Fall 2026" |
| `person` | people | `sales_lead` | e.g. "Ian Porter" |
| `status` | status | `stage` | e.g. "Proposal (financials submitted)" |
| `numbers0` | numbers | `close_probability` | |
| `tags6` | tags | `project_type` | e.g. "TourVIP, BrandPartnerships" |
| `priority` | status | `priority` | "High", "Medium", "Low" |
| `numbers__1` | numbers | `total_events` | |
| `mirror6` | mirror | `first_show` | Date, mirrored from connected board |
| `mirror23` | mirror | `last_show` | Date, mirrored from connected board |
| `numbers02` | numbers | `proj_gross` | |
| `numbers` | numbers | `proj_pty_net` | |
| `mirror21` | mirror | `announce_date` | Date |
| `mirror20` | mirror | `pre_sale_date` | Date |
| `mirror16` | mirror | `on_sale_date` | Date |
| `date1` | date | `deal_creation_date` | |

### Contact Mirror Fields (on deal board, stored in `intel_artist_contacts`)

These are **mirror columns on the deal board** that pull data from the CRM board.
This is the PRIMARY source for contact data.

| Monday Column ID | Type | Maps To | Example |
|-----------------|------|---------|---------|
| `mirror0` | mirror | Management Company | "Palm Tree Crew" |
| `lookup_mkkyxpdw` | mirror | Manager Email(s) | "myles@palmtreemgmt.com, mike@palmtreemgmt.com" |
| `mirror_mkkbdz5z` | mirror | Agent Company | "Wasserman" |
| `dup__of_agent_company_mkkywgqg` | mirror | Agent Email(s) | "ehancock@teamwass.com, kismael@teamwass.com" |

**Important:** These mirror columns can contain comma-separated values when multiple contacts exist.

### Board Relation Columns (links to CRM board)

| Monday Column ID | Type | Links To |
|-----------------|------|----------|
| `connect_boards_mkkb1wje` | board_relation | Manager contacts on CRM board |
| `link_to_contacts_mkkbc7aa` | board_relation | Agent contacts on CRM board |
| `link_to___accounts` | board_relation | Account records |

---

## CRM Board Column Mapping (`2696356486`)

The CRM board contains individual contact records. These are linked back to deals
via board relation columns and provide additional data (contact names, phone numbers)
that aren't available in the deal board mirrors.

### Contact Fields

| Monday Column ID | Type | Maps To | Notes |
|-----------------|------|---------|-------|
| (item name) | - | `contact_name` | The item name IS the contact name |
| `email` | email | `email` | |
| `phone` | phone | `phone` | |
| `status` | status | Contact type | "Manager", "Agent", etc. |

### Deal Link Columns (how contacts connect to deals)

| Monday Column ID | Type | Role | Notes |
|-----------------|------|------|-------|
| `link_to___deals` | board_relation | Manager | Links to deal items where this person is manager |
| `link_to_events_deals_mkkbg5x5` | board_relation | Agent | Links to deal items where this person is agent |
| `connect_boards_mkkbkjg7` | board_relation | Business Manager | Links to deal items where this person is biz manager |

---

## Contact Sync Logic

1. **Primary source:** Deal board mirror columns (`mirror0`, `lookup_mkkyxpdw`, etc.)
   - Extracts management company + emails, agent company + emails
   - Deduplicates by `chartmetric_id|role|email`

2. **Enrichment source:** CRM board contacts
   - Adds contact names and phone numbers
   - Matches via linked deal IDs -> chartmetric_id mapping
   - Merges with existing records from step 1

3. **Mapping:** Deal items -> chartmetric_id via `intel_monday_items` table
   - Monday items must have `chartmetric_id` populated (via name matching or manual linking)
   - Unlinked Monday items = contacts can't be matched to artists

---

## Stage Values and Visibility Rules

| Stage | Pipeline Visibility | Deal Active? |
|-------|-------------------|-------------|
| Outbound - No Contact | Dimmed (opacity-60) | Yes |
| Outbound - Automated Contact | Dimmed (opacity-60) | Yes |
| Prospect - Direct Sales Agent Contact | Full | Yes |
| Active Leads (Contact Has Responded) | Full | Yes |
| Proposal (financials submitted) | Full | Yes |
| Negotiation (Terms Being Discussed) | Full | Yes |
| Finalizing On-Sale (Terms Agreed) | Full | Yes |
| Won (Final On-Sale Planned) | Full | Yes, unless `last_show` is in the past |
| Lost | Hidden | No |
| Tour Canceled | Hidden | No |
| Fell Off (Not Lost) | Hidden | No |
| Closed Deals (Events Completed) | Hidden | No |

### Deal Priority Logic

When an artist has multiple deals, the **highest priority active deal** is displayed:
1. Filter out hidden stages (Lost, Tour Canceled, Fell Off, Closed Deals)
2. Filter out expired deals (Won with `last_show` in the past)
3. From remaining, pick the highest priority stage (Won > Finalizing > Negotiation > Proposal > Active Lead > Prospect > Outbound)
4. If no active deals remain, artist is hidden from Pipeline

---

## Common Issues

### Artists missing from Pipeline
- Check if Monday item has `chartmetric_id` linked in `intel_monday_items`
- If not, run fuzzy name match or manually set the ID
- Check if all deals are in hidden/expired stages

### Contacts missing for an artist
- Verify the Monday deal item has mirror columns populated (check in Monday UI)
- Verify the Monday item has `chartmetric_id` set in our DB
- Re-run Monday sync: `POST /api/sync/monday`

### Name mismatches between Monday and Chartmetric
Common patterns: accented characters (Jhene vs Jhene), typos (Courntey vs Courtney),
articles (All American Rejects vs The All-American Rejects), punctuation (Dan + Shay)

---

*P&TY Internal — Do not share externally*
