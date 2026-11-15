// The look plan for ASHEN PROTOCOL, a dusk-lit industrial yard. Six values only;
// every colour in the game and the page comes from this table.
export const PALETTE = {
  canvas: '#17130f',
  surface: '#241d18',
  hairline: '#3a2f26',
  ink: '#efe7d8',
  muted: '#a89a86',
  accent: '#e8a13a',
  teal: '#4fae9d',
  danger: '#d95b43',
};

export function shade(name) {
  return PALETTE[name];
}
