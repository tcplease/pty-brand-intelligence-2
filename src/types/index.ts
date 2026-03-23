// ============================================================
// Types matching the intel_ Supabase tables
// ============================================================

export interface Artist {
  chartmetric_id: number
  name: string
  image_url: string | null
  career_stage: string | null
  cm_score: number | null
  general_manager: string | null
  spotify_followers: number | null
  spotify_monthly_listeners: number | null
  instagram_followers: number | null
  youtube_subscribers: number | null
  tiktok_followers: number | null
  primary_genre: string | null
  primary_market: string | null
  secondary_market: string | null
  audience_male_pct: number | null
  audience_female_pct: number | null
  age_13_17_pct: number | null
  age_18_24_pct: number | null
  age_25_34_pct: number | null
  age_35_44_pct: number | null
  age_45_64_pct: number | null
  age_65_plus_pct: number | null
  audience_ethnicity: Record<string, number> | null
  top_countries: { name: string; code: string; pct: number }[] | null
  source: 'monday' | 'festival_signal' | 'manual' | 'both'
  cm_last_refreshed_at: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface ArtistContact {
  id: string
  chartmetric_id: number
  role: 'manager' | 'agent' | 'business_manager'
  contact_name: string | null
  company_name: string | null
  email: string | null
  phone: string | null
  street: string | null
  city: string | null
  state: string | null
  zip: string | null
  country: string | null
  linkedin_url: string | null
  region: string | null
  source: 'monday' | 'rostr' | 'manual'
  last_verified_at: string | null
  created_at: string
  updated_at: string
}

export interface MondayItem {
  id: string
  monday_item_id: number
  artist_name: string
  chartmetric_id: number | null
  tour: string | null
  sales_lead: string | null
  stage: string | null
  close_probability: number | null
  project_type: string | null
  priority: string | null
  total_events: number | null
  first_show: string | null
  last_show: string | null
  proj_gross: number | null
  proj_pty_net: number | null
  announce_date: string | null
  pre_sale_date: string | null
  on_sale_date: string | null
  deal_creation_date: string | null
  monday_last_synced_at: string
  created_at: string
}

export interface BrandAffinity {
  id: string
  chartmetric_id: number
  brand_id: number
  brand_name: string
  affinity_scale: number
  follower_count: number | null
  interest_category: string | null
  created_at: string
}

export interface SectorAffinity {
  id: string
  chartmetric_id: number
  sector_id: number
  sector_name: string
  affinity_scale: number
  created_at: string
}

export interface FestivalAppearance {
  id: string
  chartmetric_id: number
  festival_cm_id: number
  festival_name: string
  festival_date: string | null
  festival_location: string | null
  festival_size: string | null
  bill_position: number | null
  detected_at: string
  created_at: string
}

export interface ActivityLogEntry {
  id: string
  chartmetric_id: number
  event_type: 'festival_added' | 'album_presave' | 'stage_change' | 'added_to_pipeline' | 'metric_spike'
  event_title: string
  event_detail: Record<string, any> | null
  event_date: string | null
  created_at: string
}

// View types (joined data for the UI)
export interface ActiveRosterItem extends Artist {
  stage: string | null
  tour: string | null
  sales_lead: string | null
  close_probability: number | null
  project_type: string | null
  priority: string | null
  total_events: number | null
  first_show: string | null
  last_show: string | null
  proj_gross: number | null
  proj_pty_net: number | null
  monday_item_id: number | null
  is_outbound: boolean
}

export interface DiscoveryFeedItem {
  chartmetric_id: number
  name: string
  image_url: string | null
  career_stage: string | null
  cm_score: number | null
  primary_genre: string | null
  source: string
  artist_added_at: string
  festival_count: number
  festivals: string[]
  management_company: string | null
}

// Monday.com Stage values — canonical order for all dropdowns/displays
export const STAGE_ORDER = [
  'Outbound - No Contact',
  'Outbound - Automated Contact',
  'Prospect - Direct Sales Agent Contact',
  'Active Leads (Contact Has Responded)',
  'Proposal (financials submitted)',
  'Negotiation (Terms Being Discussed)',
  'Finalizing On-Sale (Terms Agreed)',
  'Won (Final On-Sale Planned)',
  'Lost',
] as const

export const HIDDEN_STAGES = ['Lost'] as const
export const DIMMED_STAGES = ['Outbound - No Contact', 'Outbound - Automated Contact'] as const

export const STAGE_COLORS: Record<string, string> = {
  'Outbound - No Contact': '#666',
  'Outbound - Automated Contact': '#666',
  'Prospect - Direct Sales Agent Contact': '#4A9EFF',
  'Active Leads (Contact Has Responded)': '#4A9EFF',
  'Proposal (financials submitted)': '#E8FF00',
  'Negotiation (Terms Being Discussed)': '#E8FF00',
  'Finalizing On-Sale (Terms Agreed)': '#00D26A',
  'Won (Final On-Sale Planned)': '#00D26A',
  'Lost': '#FF4444',
}
