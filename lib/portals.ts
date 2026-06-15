export interface Portal {
  id: string;
  label: string;
  icon: string;
  mapType: 'world' | 'usa';
}

export const PORTALS: Portal[] = [
  { id: 'current_clients',     label: 'Current Clients',   icon: 'CC', mapType: 'world' },
  { id: 'prospects',           label: 'Prospects',         icon: 'PR', mapType: 'world' },
  { id: 'private_companies',   label: 'Private Companies', icon: 'PC', mapType: 'usa' },
  { id: 'federal_agencies',    label: 'Federal Agencies',  icon: 'FA', mapType: 'usa' },
  { id: 'state_agencies',      label: 'State Agencies',    icon: 'SA', mapType: 'usa' },
  { id: 'counties_and_cities', label: 'Counties & Cities', icon: 'LC', mapType: 'usa' },
];
