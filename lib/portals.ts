export interface Portal {
  id: string;
  label: string;
  icon: string;
  mapType: 'world' | 'usa';
}

export const PORTALS: Portal[] = [
  { id: 'current_clients',     label: 'Current Clients',   icon: '🏢', mapType: 'world' },
  { id: 'prospects',           label: 'Prospects',         icon: '🔭', mapType: 'world' },
  { id: 'private_companies',   label: 'Private Companies', icon: '🏗️', mapType: 'usa' },
  { id: 'federal_agencies',    label: 'Federal Agencies',  icon: '🦅', mapType: 'usa' },
  { id: 'state_agencies',      label: 'State Agencies',    icon: '🏛️', mapType: 'usa' },
  { id: 'counties_and_cities', label: 'Counties & Cities', icon: '🏙️', mapType: 'usa' },
];
