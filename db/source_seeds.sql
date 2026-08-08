-- Durable authoritative exception sources that do not belong to the normal
-- USAJOBS inventory. Directory refresh scripts can add/update other sources,
-- while these official legislative-branch hiring surfaces remain present.

INSERT INTO source_directory_entries (
  directory_key, entry_key, entry_type, state_code, organization_name,
  source_url, jobs_url, source_class, lineage_root, metadata, is_active,
  last_seen_at, updated_at
) VALUES
(
  'federal-legislative-exceptions',
  'house-talent-marketplace',
  'federal_exception',
  NULL,
  'U.S. House of Representatives — Talent Marketplace',
  'https://www.house.gov/employment/positions-with-members-and-committees',
  'https://house.csodfed.com/',
  'authoritative',
  'federal-house',
  '{"match_patterns":["united states house of representatives","u.s. house of representatives","us house of representatives","house of representatives","u.s. house","us house"],"shared_inventory":true,"note":"Official House Talent Marketplace for Member, Committee, and Leadership vacancies."}'::jsonb,
  true,
  NOW(),
  NOW()
),
(
  'federal-legislative-exceptions',
  'house-organizations',
  'federal_exception',
  NULL,
  'U.S. House of Representatives — House Organizations',
  'https://www.house.gov/employment/positions-with-other-house-organizations',
  'https://www.house.gov/employment/positions-with-other-house-organizations',
  'authoritative',
  'federal-house',
  '{"match_patterns":["united states house of representatives","u.s. house of representatives","us house of representatives","house of representatives","u.s. house","us house"],"shared_inventory":true,"note":"Official House vacancies for House Officers and other House organizations."}'::jsonb,
  true,
  NOW(),
  NOW()
),
(
  'federal-legislative-exceptions',
  'senate-employment-bulletin',
  'federal_exception',
  NULL,
  'U.S. Senate — Employment Bulletin',
  'https://employment.senate.gov/job-vacancies/',
  'https://careers.employment.senate.gov/',
  'authoritative',
  'federal-senate',
  '{"match_patterns":["united states senate","u.s. senate","us senate","senate employment office","senate"],"shared_inventory":true,"note":"Official Senate Employment Bulletin and careers site for Senate office vacancies."}'::jsonb,
  true,
  NOW(),
  NOW()
)
ON CONFLICT (directory_key, entry_key) DO UPDATE SET
  entry_type = EXCLUDED.entry_type,
  state_code = EXCLUDED.state_code,
  organization_name = EXCLUDED.organization_name,
  source_url = EXCLUDED.source_url,
  jobs_url = EXCLUDED.jobs_url,
  source_class = EXCLUDED.source_class,
  lineage_root = EXCLUDED.lineage_root,
  metadata = EXCLUDED.metadata,
  is_active = true,
  last_seen_at = NOW(),
  updated_at = NOW();
