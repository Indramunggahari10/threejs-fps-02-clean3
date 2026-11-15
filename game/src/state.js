// Match state in one place: teams, rounds, economy, the charge objective and the
// kill feed. The simulation reads and writes this object; rendering only reads it.
export const ROUND_SECONDS = 100;
export const FREEZE_SECONDS = 4;
export const WIN_ROUNDS = 5;
export const MAX_ROUNDS = 9;
export const PLANT_SECONDS = 3;
export const DEFUSE_SECONDS = 4;
export const DETONATE_SECONDS = 35;

export const ECONOMY = {
  start: 800,
  kill: 300,
  win: 3250,
  loss: 1900,
  plant: 300,
};

export function createMatch() {
  return {
    phase: 'freeze', // freeze | live | planted | over
    round: 1,
    wins: { ash: 0, cinder: 0 },
    timer: FREEZE_SECONDS,
    money: ECONOMY.start,
    kills: 0,
    deaths: 0,
    charge: 'player', // player | carrier | planted | gone
    plantProgress: 0,
    defuseProgress: 0,
    detonateLeft: 0,
    winner: null,
    matchWinner: null,
    feed: [],
    log: [],
  };
}

export function feedEvent(match, text) {
  match.feed.unshift({ text, at: match.round });
  if (match.feed.length > 6) match.feed.pop();
  match.log.push(`R${match.round} ${text}`);
}

export function award(match, amount, reason) {
  match.money = Math.max(0, match.money + amount);
  match.log.push(`R${match.round} $${amount} ${reason}`);
}
