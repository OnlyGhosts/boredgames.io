/**
 * Blackjack's client module under test: the table model and the animation timeline planned from
 * snapshot diffs (deal order, hits, the reveal inside the server's allowance, the discards, splits,
 * snapping to the truth), the bet arithmetic, the copy, the screen per phase (the panel's lit and
 * dimmed controls, the hidden hole card, split hands with no cap: every one as its cards, the row
 * scrolling sideways past what fits; the dealer and my hands in fixed places, the settled table during the next
 * betting), the settings rows (no rounds or table limits) and the player-list hooks. Runs in node:
 * browser globals are stubbed, components render through react-dom/server.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { BLACKJACK_DEAL, BLACKJACK_FINAL_HOLD_MS, BLACKJACK_REVEAL, revealAllowanceMs } from '@shared/games/blackjack/deal';
import {
  DEFAULT_BLACKJACK_SETTINGS,
  type BlackjackRoomState,
  type BlackjackActions,
  type BlackjackView,
  type Card,
  type HandView,
  type LastRoundView,
  type SettledHandView,
} from '@shared/games/blackjack/protocol';
import { installBrowserGlobals, setLocation } from '../../test/env';

installBrowserGlobals();

const { usePlatformStore } = await import('../../platform/store/usePlatformStore');
const { registerGames } = await import('../../platform/registry');
const { blackjackClient } = await import('./module');
const { useBlackjackStore } = await import('./store');
const { dealOrder, discardedCount, tableOf, totalText, shownTotal } = await import('./lib/table');
const T = await import('./lib/timeline');
const H = await import('./lib/hands');
const { fadeOf, sideFade } = await import('../../platform/lib/useScrollFade');
const { betAmount, betWindow, defaultBet, doubleBet, halfBet, parseBet, suggestedBet } = await import('./lib/bet');
const { roundLabel, RIBBON_TEXT, DEALER_RULE_TEXT, payoutText, joinNames, ruleText, standingOf, focusLine } = await import('./lib/text');
const { player, registryOf, resetStore, room, welcome } = await import('../../test/fixtures');
const { tileFigures } = await import('../../platform/table/PlayersGrid');
const P = await import('./lib/pending');
const A = await import('./actions');
const PM = await import('./lib/premove');
const { socket } = await import('../../platform/net/socket');
const { seatLine } = await import('./components/Seats');

const NOW = Date.now();
const NO_ACTIONS = { canHit: false, canStand: false, canDouble: false, canSplit: false };
const NO_CONTROLS = { canSitOut: false, canDealNow: false, canSkip: false };
const c = (rank: Card['rank'], suit: Card['suit'] = 'S'): Card => ({ rank, suit });

function hand(cards: Card[], overrides: Partial<HandView> = {}): HandView {
  return { cards, total: 0, soft: false, bet: 50, status: 'waiting', doubled: false, fromSplit: false, splitAces: false, ...overrides };
}

function settled(cards: Card[], outcome: SettledHandView['outcome'], payout: number, overrides: Partial<HandView> = {}): SettledHandView {
  return { ...hand(cards, overrides), outcome, payout };
}

const EMPTY_DEALER = { cards: [], holeHidden: true, total: 0, soft: false, blackjack: false };

function view(overrides: Partial<BlackjackView> = {}): BlackjackView {
  return {
    phase: 'betting',
    round: 2,
    order: ['host', 'bob'],
    turn: null,
    waitingFor: ['host', 'bob'],
    away: [],
    dealer: EMPTY_DEALER,
    players: {
      host: { chips: 1000, bet: 0, hands: [], inRound: true, sittingOut: false, bustedOut: false },
      bob: { chips: 300, bet: 0, hands: [], inRound: true, sittingOut: false, bustedOut: false },
    },
    actions: NO_ACTIONS,
    controls: NO_CONTROLS,
    lastRound: null,
    endRequested: false,
    ...overrides,
  };
}

/** The deal in play: the host acts on a pair of eights against the dealer's ten, bob waits with 19. */
function acting(overrides: Partial<BlackjackView> = {}): BlackjackView {
  return view({
    phase: 'acting',
    turn: { playerId: 'host', handIndex: 0 },
    waitingFor: [],
    dealer: { cards: [c('10', 'H')], holeHidden: true, total: 10, soft: false, blackjack: false },
    players: {
      host: { chips: 950, bet: 50, hands: [hand([c('8'), c('8', 'D')], { total: 16, status: 'acting' })], inRound: true, sittingOut: false, bustedOut: false },
      bob: { chips: 280, bet: 20, hands: [hand([c('9'), c('10', 'C')], { total: 19, bet: 20 })], inRound: true, sittingOut: false, bustedOut: false },
    },
    actions: { canHit: true, canStand: true, canDouble: true, canSplit: true },
    ...overrides,
  });
}

/** Round 2 settled: the dealer drew to 22; the host's 19 won 100 back on 50, bob hit to 24 and lost. */
function lastRound(overrides: Partial<LastRoundView> = {}): LastRoundView {
  return {
    round: 2,
    order: ['host', 'bob'],
    dealer: { cards: [c('10', 'H'), c('6', 'C'), c('6', 'D')], holeHidden: false, total: 22, soft: false, blackjack: false },
    hands: {
      host: [settled([c('8'), c('8', 'D'), c('3', 'C')], 'win', 100, { status: 'won' })],
      bob: [settled([c('9'), c('10', 'C'), c('5', 'H')], 'loss', 0, { bet: 20, status: 'bust' })],
    },
    peeked: false,
    revealEndsAt: NOW + 1700,
    ...overrides,
  };
}

/** Round 3 betting with round 2's table still up. */
function nextBetting(overrides: Partial<BlackjackView> = {}): BlackjackView {
  return view({
    round: 3,
    players: {
      host: { chips: 1050, bet: 0, hands: [], inRound: true, sittingOut: false, bustedOut: false },
      bob: { chips: 280, bet: 0, hands: [], inRound: true, sittingOut: false, bustedOut: false },
    },
    lastRound: lastRound(),
    ...overrides,
  });
}

function bjRoom(game: BlackjackView, overrides: Partial<BlackjackRoomState> = {}): BlackjackRoomState {
  return {
    ...room({ gameId: 'blackjack', phase: 'playing', players: [player('host', { name: 'Hana' }), player('bob', { name: 'Pia', joinOrder: 1 }), player('carol', { name: 'Quinn', joinOrder: 2, participating: false })] }),
    settings: { contentMode: 'family', ...DEFAULT_BLACKJACK_SETTINGS },
    game,
    ...overrides,
  } as BlackjackRoomState;
}

function render(state: BlackjackRoomState, meId: string, isHost = meId === 'host'): string {
  usePlatformStore.getState().handleServerMessage(welcome(meId, state));
  usePlatformStore.setState({ connection: 'connected' });
  return renderToString(createElement(blackjackClient.Screen, { room: state, meId, isHost }));
}

function tagWith(html: string, testId: string): string {
  const match = html.match(new RegExp(`<[^>]*data-testid="${testId}"[^>]*>`));
  if (!match) throw new Error(`no element with data-testid=${testId}`);
  return match[0];
}

function tagsWith(html: string, testId: string): string[] {
  return html.match(new RegExp(`<[^>]*data-testid="${testId}"[^>]*>`, 'g')) ?? [];
}

const attr = (tag: string, name: string): string | undefined => tag.match(new RegExp(`${name}="([^"]*)"`))?.[1];
const disabled = (html: string, testId: string): boolean => / disabled=""/.test(tagWith(html, testId));
const textOf = (html: string, testId: string): string => html.match(new RegExp(`data-testid="${testId}"[^>]*>(?:<span[^>]*>)*([^<]*)<`))?.[1] ?? '';

beforeEach(() => {
  resetStore();
  useBlackjackStore.getState().reset();
  setLocation('/blackjack/ABCD');
  registerGames(registryOf(blackjackClient));
});

describe('the table model', () => {
  it('is the live round once dealt (the hole card a null), else the last settled round, else nothing', () => {
    expect(tableOf(view())).toBeNull();
    const live = tableOf(acting());
    expect(live?.settled).toBe(false);
    expect(live?.dealer).toEqual([c('10', 'H'), null]);
    expect(live?.hands.host[0].cards).toHaveLength(2);
    const last = tableOf(nextBetting());
    expect(last?.settled).toBe(true);
    expect(last?.round).toBe(2);
    expect(last?.hands.host[0]).toMatchObject({ outcome: 'win', payout: 100 });
    expect(last?.dealer).toHaveLength(3);
  });

  it('orders the cards like a dealer: first cards round the table, the up card, second cards, the hole, then hits, then the draws', () => {
    const table = tableOf(nextBetting());
    if (!table) throw new Error('no table');
    expect(dealOrder(table)).toEqual(['host/0/0/8S', 'bob/0/0/9S', 'd0', 'host/0/1/8D', 'bob/0/1/10C', 'd1', 'host/0/2/3C', 'bob/0/2/5H', 'd2']);
  });

  it('counts the settled round on the felt, not in the discards, until its cards have slid to the tray', () => {
    const settledTable = tableOf(nextBetting());
    const deal3 = tableOf(acting({ round: 3 }));
    // Three cards were swept before round 2; round 2's nine cards are still on the felt.
    expect(discardedCount(3, settledTable, settledTable)).toBe(3);
    // Round 3 is dealt (the store has added round 2's nine) while round 2 slides off: still three in the tray.
    expect(discardedCount(12, deal3, settledTable)).toBe(3);
    // Once they reach the tray, round 2's cards count.
    expect(discardedCount(12, deal3, deal3)).toBe(12);
    expect(discardedCount(0, settledTable, settledTable)).toBe(0);
  });

  it('keeps a count of the cards swept to the discards (the deck itself is endless and shows no count)', () => {
    const store = useBlackjackStore.getState();
    store.applyView(acting(), NOW, true, false);
    expect(useBlackjackStore.getState().swept).toBe(0);
    store.applyView(nextBetting(), NOW, false, false);
    // The same round settling is not a sweep.
    expect(useBlackjackStore.getState().swept).toBe(0);
    store.applyView(acting({ round: 3 }), NOW, false, false);
    expect(useBlackjackStore.getState().swept).toBe(9);
    const html = render(bjRoom(acting({ round: 3 })), 'host');
    expect(tagWith(html, 'shoe')).toContain('aria-label="The shoe"');
    expect(html).not.toContain('tbl-deck__count');
    expect(attr(tagWith(html, 'discard-tray'), 'data-discarded')).toBe('9');
  });

  it('shows soft totals both ways and counts a face-down card for nothing', () => {
    expect(totalText({ total: 17, soft: true })).toBe('7/17');
    expect(totalText({ total: 21, soft: true })).toBe('21');
    expect(totalText({ total: 12, soft: false })).toBe('12');
    expect(shownTotal([c('10'), null])).toEqual({ total: 10, soft: false });
    expect(shownTotal([null])).toBeNull();
  });
});

describe('the animation timeline', () => {
  const plan = (prevView: BlackjackView | null, nextView: BlackjackView, prev = T.EMPTY_TIMELINE, now = NOW) => T.planTimeline(prev, tableOf(prevView), tableOf(nextView), now, false, true);

  it('deals in table order, a card every 150ms, each slide 250ms, the hole card last', () => {
    const tl = plan(view(), acting());
    expect(tl.arrivals['host/0/0/8S']).toBe(NOW);
    expect(tl.arrivals['bob/0/0/9S']).toBe(NOW + 150);
    expect(tl.arrivals.d0).toBe(NOW + 300);
    expect(tl.arrivals['host/0/1/8D']).toBe(NOW + 450);
    expect(tl.arrivals['bob/0/1/10C']).toBe(NOW + 600);
    expect(tl.arrivals.d1).toBe(NOW + 750);
    expect(tl.endsAt).toBe(NOW + 750 + T.DEAL_MS);
    expect(T.holeFlipAt(tl)).toBeNull();
    // Mid-deal only the cards that have landed show.
    expect(T.cardShown(tl, 'd0', NOW + 200)).toBe(false);
    expect(T.cardShown(tl, 'd0', NOW + 300)).toBe(true);
    expect(T.cardMotion(tl, 'd0', NOW + 310)).toBe('deal');
    expect(T.cardMotion(tl, 'd0', NOW + 300 + T.DEAL_MS)).toBeNull();
    expect(T.animating(tl, NOW + 900)).toBe(true);
    expect(T.animating(tl, NOW + 1000)).toBe(false);
    expect(T.nextEvent(tl, NOW + 10)).toBe(NOW + 150);
  });

  it('updates a total pill when a card lands, not when it starts sliding in', async () => {
    const { handOnScreen } = await import('./components/Hand');
    const { dealerOnScreen } = await import('./components/Dealer');
    const tl = plan(view(), acting());
    const table = tableOf(acting());
    if (!table) throw new Error('no table');
    const host = table.hands.host[0];
    // The 8D starts at +450 and lands at +700.
    expect(handOnScreen('host', 0, host, tl, NOW + 500)).toMatchObject({ total: { total: 8 } });
    expect(handOnScreen('host', 0, host, tl, NOW + 500).cards).toHaveLength(2);
    expect(handOnScreen('host', 0, host, tl, NOW + 450 + T.DEAL_MS)).toMatchObject({ total: { total: 16 } });
    expect(dealerOnScreen(table, tl, NOW + 310).map((c) => c.landed)).toEqual([false]);
    expect(dealerOnScreen(table, tl, NOW + 300 + T.DEAL_MS).map((c) => c.landed)).toEqual([true]);
    expect(T.landed(tl, 'host/0/1/8D', NOW + 449 + T.DEAL_MS)).toBe(false);
    expect(T.nextEvent(tl, NOW + 451)).toBe(NOW + 300 + T.DEAL_MS);
  });

  it('slides in one card for a hit, after anything still landing', () => {
    const dealt = plan(view(), acting());
    const hitView = acting({ players: { ...acting().players, host: { ...acting().players.host, hands: [hand([c('8'), c('8', 'D'), c('2', 'C')], { status: 'acting' })] } } });
    const tl = plan(acting(), hitView, dealt, NOW + 2000);
    expect(tl.arrivals['host/0/2/2C']).toBe(NOW + 2000);
    expect(tl.arrivals.d0).toBe(NOW + 300);
    // A snapshot with nothing new keeps the timeline as it is.
    expect(plan(hitView, hitView, tl, NOW + 2100)).toBe(tl);
  });

  it('turns the hole card over, draws the dealer cards 500ms apart and shows the outcomes, all inside the server allowance', () => {
    const dealt = plan(view(), acting());
    const at = NOW + 5000;
    const tl = plan(acting(), nextBetting(), dealt, at);
    // The hits that came with the settle land first, in seat order, then the flip.
    expect(tl.arrivals['host/0/2/3C']).toBe(at);
    expect(tl.arrivals['bob/0/2/5H']).toBe(at + 150);
    expect(T.holeFlipAt(tl)).toBe(at + 400);
    expect(tl.arrivals.d2).toBe(at + 400 + T.FLIP_MS + 100);
    expect(T.holeFaceDown(tl, at + 100)).toBe(true);
    expect(T.holeFlipping(tl, at + 450)).toBe(true);
    expect(T.outcomesShown(tl, at + 1000)).toBe(false);
    expect(T.outcomesAt(tl)).not.toBeNull();
    expect(T.outcomesShown(tl, T.outcomesAt(tl) ?? 0)).toBe(true);
    // The server keeps the table up exactly as long: the hits sliding in (the server counts one slide
    // for the move that settled), then the reveal. The bets open as the outcomes show.
    expect((T.outcomesAt(tl) ?? 0) - (T.holeFlipAt(tl) ?? 0)).toBe(revealAllowanceMs(3));
  });

  it('plays the reveal at the shared pace the server times the results by', () => {
    expect(T.FLIP_MS).toBe(BLACKJACK_REVEAL.flip);
    expect(T.DEALER_GAP_MS).toBe(BLACKJACK_REVEAL.draw);
    expect(T.OUTCOME_DELAY_MS).toBe(BLACKJACK_REVEAL.outcome);
    expect(T.PEEK_PAUSE_MS).toBe(BLACKJACK_REVEAL.peekPause);
    expect(T.DRAW_BEAT_MS).toBe(BLACKJACK_REVEAL.beat);
    expect(T.MOVE_MS).toBe(BLACKJACK_DEAL.move);
    // No draws, then one, two, three: the outcomes show exactly revealAllowanceMs after the flip starts.
    for (const draws of [0, 1, 2, 3]) {
      const dealt = plan(view(), acting());
      const at = NOW + 5000;
      const dealerCards = [c('6'), c('K'), ...[c('2'), c('3'), c('4')].slice(0, draws)];
      const settledView = nextBetting();
      const last = settledView.lastRound;
      if (!last) throw new Error('no last round');
      const withDraws = { ...settledView, lastRound: { ...last, dealer: { ...last.dealer, cards: dealerCards } } };
      const tl = plan(acting(), withDraws, dealt, at);
      expect((T.outcomesAt(tl) ?? 0) - (T.holeFlipAt(tl) ?? 0), `${draws} draws`).toBe(revealAllowanceMs(2 + draws));
    }
  });

  it('keeps the final table up as long as a payout takes to rise and fade, and only a short beat', () => {
    // The server holds the final table this long past the reveal, then the results come up over the lobby.
    const css = readFileSync(fileURLToPath(new URL('../../platform/styles/table.css', import.meta.url)), 'utf8');
    const float = Number(css.match(/\.tbl-payout \{[^}]*animation: tbl-rise (\d+)ms/)?.[1]);
    expect(float).toBeGreaterThan(0);
    expect(BLACKJACK_FINAL_HOLD_MS).toBeGreaterThanOrEqual(float);
    expect(BLACKJACK_FINAL_HOLD_MS).toBeLessThan(2000);
  });

  it('clears the last round to the discards before the next deal, once its outcomes have been up a moment', () => {
    const dealt = plan(view(), acting());
    const revealed = plan(acting(), nextBetting(), dealt, NOW + 5000);
    const outcomesAt = T.outcomesAt(revealed) ?? 0;
    const deal3 = acting({ round: 3, players: { host: { chips: 1000, bet: 50, hands: [hand([c('2'), c('3')], { status: 'acting' })], inRound: true, sittingOut: false, bustedOut: false }, bob: { chips: 260, bet: 20, hands: [hand([c('4'), c('5')])], inRound: true, sittingOut: false, bustedOut: false } } });
    const tl = plan(nextBetting(), deal3, revealed, outcomesAt + 100);
    expect(tl.discard?.from).toBe(outcomesAt + T.OUTCOME_HOLD_MS);
    expect(tl.discard?.until).toBe(outcomesAt + T.OUTCOME_HOLD_MS + T.DISCARD_MS);
    expect(tl.arrivals['host/0/0/2S']).toBe(tl.discard?.until);
    const during = T.frameAt(tl, tableOf(deal3), outcomesAt + T.OUTCOME_HOLD_MS + 10);
    expect(during.leaving).toBe(true);
    expect(during.table?.round).toBe(2);
    expect(T.frameAt(tl, tableOf(deal3), (tl.discard?.until ?? 0) + 1).table?.round).toBe(3);
  });

  it('moves the split card instead of dealing it, and deals the two new cards once it is in place', () => {
    const before = acting();
    const after = acting({
      players: {
        ...before.players,
        host: { chips: 900, bet: 50, hands: [hand([c('8'), c('3', 'H')], { status: 'acting', fromSplit: true }), hand([c('8', 'D'), c('K', 'C')], { fromSplit: true })], inRound: true, sittingOut: false, bustedOut: false },
      },
    });
    const tl = plan(before, after, plan(view(), before), NOW + 3000);
    expect(tl.moved['host/1/0/8D']).toBe(true);
    expect(tl.arrivals['host/1/0/8D']).toBe(NOW + 3000);
    expect(tl.arrivals['host/0/1/3H']).toBe(NOW + 3000 + T.MOVE_MS);
    expect(tl.arrivals['host/1/1/KC']).toBe(NOW + 3000 + T.MOVE_MS + T.DEAL_GAP_MS);
  });

  it('snaps to the truth on a fresh entry, under reduced motion and when it would run far behind', () => {
    const fresh = T.planTimeline(T.EMPTY_TIMELINE, null, tableOf(acting()), NOW, true, true);
    expect(fresh.arrivals).toEqual({});
    expect(fresh.id).toBe(2);
    const still = T.planTimeline(T.EMPTY_TIMELINE, tableOf(view()), tableOf(acting()), NOW, false, false);
    expect(still.arrivals).toEqual({});
    const backlog = { ...plan(view(), acting()), endsAt: NOW + T.MAX_BACKLOG_MS + 1 };
    const hitView = acting({ players: { ...acting().players, host: { ...acting().players.host, hands: [hand([c('8'), c('8', 'D'), c('2', 'C')])] } } });
    expect(plan(acting(), hitView, backlog).arrivals).toEqual({});
  });

  it('is planned by the module from each snapshot, and a welcome shows the table at once', () => {
    const me = 'bob';
    const state = bjRoom(view());
    usePlatformStore.getState().handleServerMessage(welcome(me, state));
    blackjackClient.onRoom?.(state, null);
    const dealt = bjRoom(acting());
    blackjackClient.onRoom?.(dealt, state);
    const tl = useBlackjackStore.getState().timeline;
    expect(Object.keys(tl.arrivals)).toHaveLength(6);
    blackjackClient.onRoom?.(dealt, null);
    expect(useBlackjackStore.getState().timeline.arrivals).toEqual({});
    // A reconnect: a welcome with the old room still in the store snaps too.
    blackjackClient.onRoom?.(state, dealt);
    blackjackClient.onWelcome?.(undefined);
    blackjackClient.onRoom?.(dealt, state);
    expect(useBlackjackStore.getState().timeline.arrivals).toEqual({});
  });
});

describe('sounds under reduced motion', () => {
  it('snaps the table but keeps the deal, the hole card flip and the collect on the sound timeline', async () => {
    const { blackjackSounds } = await import('./sounds');
    const { playBlackjackSounds } = await import('./sfx');
    vi.useFakeTimers();
    try {
      const play = vi.spyOn(blackjackSounds, 'play');
      const store = useBlackjackStore.getState();
      const steps = [view(), acting(), nextBetting()];
      store.applyView(steps[0], Date.now(), false, false);
      for (let i = 1; i < steps.length; i++) {
        const { soundTimeline: before, table: prevTable } = useBlackjackStore.getState();
        useBlackjackStore.getState().applyView(steps[i], Date.now(), false, false);
        const { timeline, soundTimeline, table } = useBlackjackStore.getState();
        expect(timeline.arrivals).toEqual({});
        playBlackjackSounds({ view: steps[i], prevView: steps[i - 1], table, prevTable, before, timeline: soundTimeline, me: 'host' });
        vi.advanceTimersByTime(5000);
      }
      // The schedule reads the real clock while these plans were made on the faked one: let everything due run.
      vi.advanceTimersByTime(20_000);
      const names = play.mock.calls.map(([name]) => name);
      expect(names.filter((n) => n === 'deal').length).toBeGreaterThanOrEqual(6);
      expect(names).toContain('flip');
      expect(names).toContain('collect');
    } finally {
      vi.useRealTimers();
      vi.restoreAllMocks();
    }
  });
});

describe('the bet amount', () => {
  it('takes anything from 1 chip to the whole stack, remembers the last bet and walks with half, 2x and Max', () => {
    const w = betWindow(300, 0);
    expect(w).toEqual({ min: 1, max: 300 });
    // A stake already down counts as available; no chips at all means no bet.
    expect(betWindow(250, 50)).toEqual({ min: 1, max: 300 });
    expect(betWindow(0, 0)).toBeNull();
    expect(betWindow(1, 0)).toEqual({ min: 1, max: 1 });
    if (!w) throw new Error('no window');
    expect(suggestedBet(1000)).toBe(10);
    expect(suggestedBet(100_000)).toBe(1000);
    expect(suggestedBet(50)).toBe(1);
    expect(defaultBet(null, w, suggestedBet(1000))).toBe(10);
    expect(defaultBet(null, w)).toBe(1);
    expect(defaultBet(800, w, 10)).toBe(300);
    expect(halfBet(15, w)).toBe(7);
    expect(halfBet(1, w)).toBe(1);
    expect(doubleBet(200, w)).toBe(300);
    expect(parseBet('')).toBeNull();
    expect(parseBet('12a')).toBeNull();
    expect(parseBet('0')).toBeNull();
    expect(betAmount('9999', w)).toBe(300);
    expect(betAmount('3', w)).toBe(3);
    expect(betAmount('1', w)).toBe(1);
  });
});

describe('copy', () => {
  it('works out where I stand, and says it on the line under the ribbon when it is the news (the panel has no line of its own)', () => {
    const base = { phase: 'acting' as const, seated: true, bustedOut: false, inRound: true, hasChips: true, sittingOut: false };
    expect(standingOf(base)).toBe('playing');
    expect(standingOf({ ...base, seated: false })).toBe('watching');
    expect(standingOf({ ...base, bustedOut: true })).toBe('out');
    // Not dealt in: a seat with chips sat the hand out, a newcomer waits for the next round.
    expect(standingOf({ ...base, inRound: false })).toBe('sat-out');
    expect(standingOf({ ...base, inRound: false, hasChips: false })).toBe('next-round');
    expect(standingOf({ ...base, phase: 'betting', sittingOut: true })).toBe('sat-out');
    expect(standingOf({ ...base, phase: 'betting', inRound: false })).toBe('next-round');
    expect(standingOf({ ...base, phase: 'results', inRound: false })).toBe('playing');
    const names: Record<string, string> = { host: 'Hana', bob: 'Pia' };
    const s = { nameOf: (id: string) => names[id] ?? 'Someone', meId: 'host', handCount: 1 };
    const bets = { kind: 'bets' as const, placed: ['bob'], waiting: ['host'] };
    expect(focusLine(bets, { ...s, standing: 'sat-out' })).toEqual({ state: 'sat-out', text: 'You sit this hand out', tone: 'quiet', sub: '1 of 2 bets in' });
    expect(focusLine(bets, { ...s, standing: 'next-round' }).text).toBe("You’re in from the next round");
    expect(focusLine(bets, { ...s, standing: 'out' })).toMatchObject({ state: 'out', text: "You’re out of chips", tone: 'bad' });
    // While somebody plays, who plays comes first and where I stand is the quieter second part.
    const theirs = { kind: 'turn' as const, playerId: 'bob', handIndex: 0, mine: false, next: null };
    expect(focusLine(theirs, { ...s, standing: 'sat-out' })).toMatchObject({ text: "Pia’s turn", sub: 'You sit this hand out' });
    expect(focusLine(theirs, { ...s, turnAway: true }).text).toBe('Pia is away');
    // A watcher's panel already says they watch: the line keeps to the table.
    expect(focusLine(theirs, { ...s, standing: 'watching' }).sub).toBe('Next: Dealer');
    expect(focusLine({ kind: 'idle', reason: 'next' }, { ...s, betQueued: true })).toMatchObject({ text: 'Next round soon', sub: 'Bet placed' });
    expect(focusLine({ kind: 'idle', reason: 'next' }, { ...s, standing: 'out' })).toMatchObject({ state: 'out', text: "You’re out of chips" });
    expect(joinNames(['A', 'B', 'C'])).toBe('A, B and C');
  });

  it('labels the rounds, the ribbon and the payouts', () => {
    expect(roundLabel(4)).toBe('Round 4');
    expect(roundLabel(0)).toBe('Round 1');
    // Written and shown in sentence case, so it reads as words.
    expect(RIBBON_TEXT).toBe('Blackjack pays 3 to 2');
    expect(DEALER_RULE_TEXT).toBe('Dealer stands on 17');
    expect(payoutText(220)).toBe('+220');
    expect(payoutText(0)).toBe('');
    // Beside the round under the banner: the dealer's rule, or the last hand once the host has ended the game.
    expect(ruleText(acting())).toBe('Dealer stands on 17');
    expect(ruleText(acting({ endRequested: true }))).toBe('Last hand');
    expect(ruleText(acting({ phase: 'betting', endRequested: true }))).toBe('Dealer stands on 17');
  });

  it('holds every seat line while the reveal still plays', async () => {
    const { seatLine } = await import('./components/Seats');
    const next = nextBetting();
    const bobHands = tableOf(next)?.hands.bob ?? [];
    expect(seatLine(next, 'bob', bobHands, false, true)).toMatchObject({ state: 'waiting', text: 'Waiting' });
    expect(seatLine(next, 'bob', bobHands, false, false)).toMatchObject({ state: 'betting', text: 'Betting' });
    expect(seatLine(next, 'bob', bobHands, true, false)).toMatchObject({ state: 'settled', text: 'Lost' });
  });

  it('shows the chips won on a win, but no amount on a push (the stake only comes back)', async () => {
    const { seatLine } = await import('./components/Seats');
    const next = nextBetting();
    const bobHands = tableOf(next)?.hands.bob ?? [];
    expect(bobHands.length).toBeGreaterThan(0);
    const settle = (outcome: 'win' | 'push', payout: number) => bobHands.map((h) => ({ ...h, outcome, payout }));
    const bet = bobHands[0].bet;
    expect(seatLine(next, 'bob', settle('win', bet * 2), true, false)).toMatchObject({ state: 'settled', text: `Win +${bet * 2}` });
    expect(seatLine(next, 'bob', settle('push', bet), true, false)).toMatchObject({ state: 'settled', text: 'Push' });
  });

  it('says the game is over on a seat with no hand on the final table, never an empty line', async () => {
    const { seatLine, seatMark } = await import('./components/Seats');
    const final = view({ phase: 'ending', waitingFor: [] });
    const line = seatLine(final, 'bob', [], false);
    expect(line).toMatchObject({ state: 'over', text: 'Game over', tone: 'quiet' });
    expect(seatMark(line, [], false)).toBe('idle');
    // A seat with its last hand settled on show keeps its outcome; one out of chips says so.
    const bobHands = tableOf(nextBetting())?.hands.bob ?? [];
    expect(seatLine(nextBetting({ phase: 'ending' }), 'bob', bobHands, true)).toMatchObject({ state: 'settled', text: 'Lost' });
    const out = view({ phase: 'ending', players: { ...view().players, bob: { chips: 0, bet: 0, hands: [], inRound: false, sittingOut: false, bustedOut: true } } });
    expect(seatLine(out, 'bob', [], false)).toMatchObject({ state: 'out', text: 'Out' });
  });

  it('says a seat with chips that did not bet is sitting the hand out', async () => {
    const { seatLine } = await import('./components/Seats');
    const satOut = acting({ order: ['host'], players: { ...acting().players, bob: { chips: 300, bet: 0, hands: [], inRound: false, sittingOut: false, bustedOut: false } } });
    expect(seatLine(satOut, 'bob', [], false)).toMatchObject({ state: 'sitting-out', text: 'Sitting out' });
  });

  it("says a seat away during the bets is away, not betting: the deal does not wait for it", async () => {
    const { seatLine, seatMark } = await import('./components/Seats');
    const away = view({ waitingFor: ['host'] });
    const line = seatLine(away, 'bob', [], false);
    expect(line).toMatchObject({ state: 'away', text: 'Away' });
    expect(seatMark(line, [], false)).toBe('idle');
    expect(seatLine(view(), 'bob', [], false)).toMatchObject({ state: 'betting', text: 'Betting' });
  });

  it('names who the bets wait for while it fits a small phone, and counts them once it would not', async () => {
    const { waitingText, betsLabel } = await import('./lib/text');
    expect(waitingText(['Pia'])).toBe('Waiting for Pia');
    expect(waitingText(['Bartholomew'])).toBe('Waiting for Bartholomew');
    expect(waitingText(['Pia', 'Quinn'])).toBe('Waiting for Pia and Quinn');
    expect(waitingText(['Pia', 'Quinn', 'Ada'])).toBe('Waiting for Pia, Quinn and Ada');
    expect(waitingText(['Bartholomew', 'Christabel'])).toBe('Waiting for 2 players');
    expect(waitingText(['A', 'B', 'C', 'D'])).toBe('Waiting for 4 players');
    expect(betsLabel(false, ['Bartholomew', 'Christabel'], true)).toBe('Waiting for 2 players');
  });

  it('says the next round is coming through the results pause', () => {
    const results = nextBetting({ phase: 'results', round: 2, order: [], waitingFor: [] });
    expect(focusLine({ kind: 'idle', reason: 'next' }, { nameOf: () => 'Pia', meId: 'carol', handCount: 0 }).text).toBe('Next round soon');
    // Once the outcomes are up, Bet is on offer through the pause: the tap waits and goes out as the bets open.
    // No sit-out or move is on offer while the settled table is on show.
    const html = render(bjRoom(results), 'host');
    expect(disabled(html, 'place-bet')).toBe(false);
    expect(tagsWith(html, 'sit-out')).toHaveLength(0);
    expect(attr(tagWith(html, 'blackjack-screen'), 'data-phase')).toBe('results');
  });

  it('never shows an em dash or mentions insurance anywhere in the module', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(tsx?|css)$/.test(name) && !name.endsWith('.test.ts')) files.push(path);
      }
    };
    walk(import.meta.dirname);
    expect(files.length).toBeGreaterThan(10);
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      expect(text.includes('\u2014'), file).toBe(false);
      expect(/insurance/i.test(text), file).toBe(false);
    }
  });
});

describe('the screen', () => {
  it('betting: the four moves are dimmed, Bet is lit with the remembered amount, the table shows two empty slots per side', () => {
    useBlackjackStore.setState({ lastBet: 40 });
    const html = render(bjRoom(view()), 'bob');
    expect(attr(tagWith(html, 'blackjack-screen'), 'data-phase')).toBe('betting');
    for (const id of ['action-hit', 'action-stand', 'action-split', 'action-double']) expect(disabled(html, id)).toBe(true);
    expect(disabled(html, 'place-bet')).toBe(false);
    expect(attr(tagWith(html, 'bet-input'), 'value')).toBe('40');
    expect(attr(tagWith(html, 'bet-input'), 'inputMode')).toBe('numeric');
    expect(attr(tagWith(html, 'bj-panel'), 'data-max')).toBe('300');
    expect(tagsWith(html, 'dealer-slot')).toHaveLength(2);
    expect(attr(tagWith(html, 'table-turn'), 'data-state')).toBe('bets');
    expect(html).toContain('Blackjack pays 3 to 2');
    // The round is on the table, beside the dealer's rule under the banner, not in the top bar.
    expect(attr(tagWith(html, 'round-indicator'), 'data-round')).toBe('2');
    expect(html).toMatch(/<span class="tbl-ribbon__sub"><span data-testid="round-indicator" data-round="2">Round 2<\/span><span class="tbl-ribbon__dot"> · <\/span><span data-testid="table-rule">Dealer stands on 17<\/span><\/span>/);
    expect(html.slice(html.indexOf('data-testid="blackjack-header"'), html.indexOf('</header>'))).not.toContain('Round');
    // No status line or shortcut hint in the panel; Sit out is a full-width button under Bet.
    expect(tagsWith(html, 'turn-status')).toHaveLength(0);
    expect(tagsWith(html, 'hotkey-hint')).toHaveLength(0);
    expect(html).toContain('Any bet from 1 to 300 chips');
  });

  it('betting after my stake: Bet is dimmed and says so, my bet shows on the table', () => {
    const v = view({ players: { ...view().players, bob: { chips: 280, bet: 20, hands: [], inRound: true, sittingOut: false, bustedOut: false } } });
    const html = render(bjRoom(v), 'bob');
    expect(disabled(html, 'place-bet')).toBe(true);
    expect(attr(tagWith(html, 'place-bet'), 'data-placed')).toBe('true');
    expect(attr(tagWith(html, 'my-bet'), 'data-bet')).toBe('20');
    expect(attr(tagWith(html, 'table-turn'), 'data-state')).toBe('bets');
  });

  it("puts my next stake beside my empty slots, never over the last round’s hands still on the table", () => {
    const before = render(bjRoom(nextBetting()), 'host');
    const mine = (html: string) => html.slice(html.indexOf('data-testid="my-area"'), html.indexOf('data-testid="bj-panel"'));
    // Before my bet: my settled hand stays up.
    expect(tagsWith(mine(before), 'card').length).toBeGreaterThan(0);
    expect(tagsWith(before, 'my-bet')).toHaveLength(0);
    const bet = nextBetting({ waitingFor: ['bob'], players: { ...nextBetting().players, host: { chips: 1000, bet: 50, hands: [], inRound: true, sittingOut: false, bustedOut: false } } });
    const html = render(bjRoom(bet), 'host');
    // My bet down: my row moves on to two empty slots with the stake where a hand's stake goes.
    expect(tagsWith(mine(html), 'card')).toHaveLength(0);
    expect(tagsWith(mine(html), 'my-slot')).toHaveLength(2);
    // The stake is its own pill of chips right by my empty places, read as "Bet 50": never on a card, never in a column of its own.
    const stake = tagWith(html, 'my-bet');
    expect(attr(stake, 'data-bet')).toBe('50');
    expect(attr(stake, 'aria-label')).toBe('Bet 50');
    expect(attr(stake, 'class')).toBe('tbl-stake tbl-stake--bet tbl-hand__stake');
    expect(mine(html)).toMatch(/<div class="bj-empty"><span class="bj-empty__stake"><span class="tbl-stake tbl-stake--bet tbl-hand__stake" role="img" aria-label="Bet 50" data-testid="my-bet"/);
    // 50 at a 1,000 start is one lime chip, the figure beside it.
    expect(html).toMatch(/data-testid="my-bet" data-bet="50" data-chips="1" data-bands="lime"><span class="tbl-stake__chips"[^>]*>[\s\S]*?<\/span><span class="tbl-stake__value">50<\/span>/);
    // Bob's settled hand is still on his tile.
    expect(tagsWith(html, 'seat-hand').length).toBeGreaterThan(0);
  });

  it('keeps my stake by each total near the width the word Bet gave it on a phone, so split hands stay side by side', async () => {
    const { stakeOf } = await import('./components/Hand');
    const out = (value: number, start: number) => renderToString(stakeOf(value, start, 'hand-bet'));
    // A stake of four digits or more writes both figures, for split hands on a phone's stage to read it short ("1.2k") and a hand on its own in
    // full, at every size: "12,000" by my hand on a desktop beside the seats' "40,500" (it once read "12k" from 10,000 everywhere).
    expect(out(1200, 10_000)).toMatch(/aria-label="Bet 1,200"[^>]*data-chips="4" data-bands="lime lime white"[\s\S]*<span class="tbl-stake__value tbl-figure"><span class="tbl-figure__full">1,200<\/span><span class="tbl-figure__short">1.2k<\/span><\/span>/);
    expect(out(12_000, 10_000)).toMatch(/<span class="tbl-stake__value tbl-figure"><span class="tbl-figure__full">12,000<\/span><span class="tbl-figure__short">12k<\/span><\/span>/);
    expect(out(1_250_000, 100_000)).toMatch(/<span class="tbl-figure__full">1,250,000<\/span><span class="tbl-figure__short">1.3M<\/span>/);
    expect(out(200, 1000)).toMatch(/<span class="tbl-stake__value">200<\/span>/);
    const row = (hands: number) => {
      const mineHands = Array.from({ length: hands }, (_, i) => hand([c('8'), c('9', 'H')], { status: i === 0 ? 'acting' : 'waiting', fromSplit: hands > 1, bet: 1250 }));
      const v = acting({ players: { ...acting().players, host: { chips: 800, bet: 1250, hands: mineHands, inRound: true, sittingOut: false, bustedOut: false } } });
      return tagWith(render(bjRoom(v), 'host'), 'my-hands-row');
    };
    expect(attr(row(1), 'class')).toBe('bj-hands bj-hands--mine scroll-fade scroll-fade--x');
    expect(attr(row(2), 'class')).toBe('bj-hands bj-hands--mine scroll-fade scroll-fade--x bj-hands--side bj-hands--grid');
    // Split hands, on any screen: the stake is a small chip under each hand's cards, one chip and the short figure ("1.3k"), never over the corner by the total.
    const split = (() => {
      const mineHands = Array.from({ length: 2 }, (_, i) => hand([c('8'), c('9', 'H')], { status: i === 0 ? 'acting' : 'waiting', fromSplit: true, bet: 1250 }));
      return render(bjRoom(acting({ players: { ...acting().players, host: { chips: 800, bet: 1250, hands: mineHands, inRound: true, sittingOut: false, bustedOut: false } } })), 'host');
    })();
    expect(split).toMatch(/class="tbl-stake tbl-stake--bet[^"]*tbl-hand__stake bj-hand__foot"[^>]*data-testid="hand-bet"[^>]*><span class="tbl-stake__chips" aria-hidden="true" data-count="1">[\s\S]*?<span class="tbl-stake__value">1\.3k<\/span>/);
    expect(split).not.toMatch(/tbl-hand__head"><span[^>]*tbl-hand__stake/);
    const css = readFileSync(fileURLToPath(new URL('./blackjack.css', import.meta.url)), 'utf8');
    expect(css).toMatch(/\n\.bj-hand__foot \{[^}]*position: absolute;\s*bottom: 0;/);
    const empty = render(bjRoom(view({ players: { ...view().players, host: { chips: 750, bet: 1250, hands: [], inRound: true, sittingOut: false, bustedOut: false } } })), 'host');
    expect(empty).toMatch(/<div class="bj-hands bj-hands--mine" style="[^"]*"><div class="bj-slot"><div class="bj-empty"><span class="bj-empty__stake">/);
  });

  it('acting, my turn: Hit and Stand lit, Split and Double as offered, Bet dimmed, the hole card face down with no rank', () => {
    const html = render(bjRoom(acting()), 'host');
    for (const id of ['action-hit', 'action-stand', 'action-split', 'action-double']) expect(disabled(html, id)).toBe(false);
    expect(disabled(html, 'place-bet')).toBe(true);
    expect(attr(tagWith(html, 'action-hit'), 'aria-keyshortcuts')).toBe('H');
    const dealer = tagWith(html, 'dealer-hand');
    expect(attr(dealer, 'data-hole-hidden')).toBe('true');
    const cards = tagsWith(html, 'dealer-card');
    expect(cards).toHaveLength(2);
    expect(attr(cards[1], 'data-face')).toBe('down');
    expect(attr(cards[1], 'data-rank')).toBeUndefined();
    expect(attr(tagWith(html, 'dealer-total'), 'data-testid')).toBe('dealer-total');
    expect(attr(tagWith(html, 'my-hand'), 'data-active')).toBe('true');
    expect(attr(tagWith(html, 'table-turn'), 'data-state')).toBe('mine');
    // The keys still work (and say so to a screen reader); no hint line spells them out.
    expect(tagsWith(html, 'hotkey-hint')).toHaveLength(0);
    // My stake rides by my hand's total.
    expect(attr(tagWith(html, 'hand-bet'), 'data-bet')).toBe('50');
    // A pair of eights against a ten: Split takes the lime, the rest stay secondary; Bet is quiet.
    expect(attr(tagWith(html, 'action-split'), 'data-primary')).toBe('true');
    for (const id of ['action-hit', 'action-stand', 'action-double']) expect(attr(tagWith(html, id), 'data-primary'), id).toBe('false');
    expect(attr(tagWith(html, 'action-split'), 'class')).toContain('btn--primary');
    // Each move carries its small icon after the label.
    expect(html).toMatch(/data-testid="action-hit"[^>]*><span class="tbl-move__label">Hit<\/span><span class="tbl-move__icon" aria-hidden="true"><svg/);
  });

  it("acting, someone else’s turn: my moves wait as picks for my turn, Bet is dimmed and their seat is lit", () => {
    const v = acting({ actions: NO_ACTIONS });
    const html = render(bjRoom(v), 'bob');
    for (const id of ['action-hit', 'action-stand', 'action-split', 'action-double']) expect(attr(tagWith(html, id), 'aria-pressed'), id).toBe('false');
    expect(disabled(html, 'place-bet')).toBe(true);
    const seat = tagWith(html, 'seat');
    expect(attr(seat, 'data-name')).toBe('Hana');
    expect(attr(seat, 'data-turn')).toBe('true');
    expect(html).toContain('Hana’s turn');
  });

  it('re-split hands: four hands side by side, the one in play lit, each with its stake and a big total', () => {
    const hands = [
      hand([c('8'), c('3')], { status: 'stood', fromSplit: true }),
      hand([c('8', 'D'), c('10')], { status: 'stood', fromSplit: true }),
      hand([c('8', 'H'), c('2')], { status: 'acting', fromSplit: true }),
      hand([c('8', 'C'), c('9')], { fromSplit: true, bet: 50 }),
    ];
    const v = acting({ turn: { playerId: 'host', handIndex: 2 }, players: { ...acting().players, host: { chips: 800, bet: 50, hands, inRound: true, sittingOut: false, bustedOut: false } }, actions: { canHit: true, canStand: true, canDouble: true, canSplit: false } });
    const html = render(bjRoom(v), 'host');
    expect(attr(tagWith(html, 'my-hands'), 'data-count')).toBe('4');
    const mine = tagsWith(html, 'my-hand');
    expect(mine).toHaveLength(4);
    expect(mine.map((t) => attr(t, 'data-active'))).toEqual(['false', 'false', 'true', 'false']);
    expect(mine.every((t) => attr(t, 'data-bet') === '50')).toBe(true);
    expect(mine.every((t) => attr(t, 'class')?.includes('tbl-hand--big'))).toBe(true);
    expect(attr(mine[2], 'class')).toContain('tbl-hand--active');
    expect(attr(mine[0], 'class')).toContain('tbl-hand--neutral');
    expect(disabled(html, 'action-split')).toBe(true);
    // The line under the banner says which hand is in play.
    expect(attr(tagWith(html, 'table-turn'), 'data-state')).toBe('mine');
    expect(html).toMatch(/data-testid="table-turn"[^>]*><span class="tbl-turn__text">Your turn, hand 3 of 4<\/span>/);
    expect(html).toContain('Your turn, hand 3 of 4');
    // Each hand's stake by its own total, four hands of 50.
    expect(tagsWith(html, 'hand-bet').map((t) => attr(t, 'data-bet'))).toEqual(['50', '50', '50', '50']);
  });

  it('the next betting keeps the settled table up: the dealer turned over, each hand with its outcome and payout', () => {
    const html = render(bjRoom(nextBetting()), 'host');
    expect(attr(tagWith(html, 'bj-table'), 'data-settled')).toBe('true');
    expect(attr(tagWith(html, 'dealer-hand'), 'data-hole-hidden')).toBe('false');
    expect(tagsWith(html, 'dealer-card')).toHaveLength(3);
    const mine = tagWith(html, 'my-hand');
    expect(attr(mine, 'data-outcome')).toBe('win');
    expect(attr(mine, 'data-payout')).toBe('100');
    // The outcome in words beside the pill, every card outlined and the pill in the win colour.
    const myArea = html.slice(html.indexOf('data-testid="my-area"'));
    expect(myArea).toMatch(/<span class="tbl-flag tbl-flag--win"><span data-testid="hand-outcome">Win<\/span> \+100<\/span>/);
    expect(attr(mine, 'class')).toContain('tbl-hand--win');
    expect(myArea).toMatch(/class="tbl-pill tbl-pill--win" data-testid="hand-total"/);
    const seat = tagWith(html, 'seat-hand');
    expect(attr(seat, 'data-outcome')).toBe('loss');
    expect(disabled(html, 'place-bet')).toBe(false);
    expect(attr(tagWith(html, 'round-indicator'), 'data-round')).toBe('3');
  });

  it('the rounds never run out and read "Round N"; a spectator watches with no controls at all', () => {
    const html = render(bjRoom(acting()), 'carol');
    expect(html).toContain('Round 2<');
    expect(html).toContain('You’re watching. You can play the next game.');
    expect(tagsWith(html, 'watching-note')).toHaveLength(1);
    // Not dealt in, I watch the hand in play on the stage, its owner named by its total; their seat leaves its cards to the stage.
    expect(attr(tagWith(html, 'hand-stage'), 'data-player-id')).toBe('host');
    expect(textOf(html, 'stage-owner')).toBe('Hana');
    expect(tagsWith(html, 'stage-hand')).toHaveLength(1);
    const hana = html.slice(html.indexOf('data-name="Hana"'));
    expect(hana.slice(0, hana.indexOf('data-testid="seat-open"'))).not.toContain('data-testid="seat-hand"');
    expect(attr(tagWith(html, 'bj-panel'), 'data-watching')).toBe('true');
    for (const id of ['place-bet', 'bet-input', 'action-hit', 'action-stand', 'action-split', 'action-double', 'sit-out', 'deal-now', 'skip-turn']) expect(tagsWith(html, id), id).toHaveLength(0);
    // A seated player keeps the whole panel.
    expect(tagWith(render(bjRoom(acting()), 'bob'), 'bj-panel')).not.toContain('data-watching');
  });

  it('gives the host the platform’s End game, says it ends after the hand in play, and once asked says so instead', () => {
    expect(tagWith(render(bjRoom(acting()), 'host'), 'end-game')).toBeTruthy();
    expect(tagsWith(render(bjRoom(acting()), 'bob', false), 'end-game')).toHaveLength(0);
    expect(blackjackClient.endGameNote?.(bjRoom(acting()))).toBe('It ends after the hand in play.');
    expect(blackjackClient.endGameNote?.(bjRoom(acting({ phase: 'betting' })))).toBe('Bets on the table go back.');
    expect(blackjackClient.endGameNote?.(bjRoom(acting({ phase: 'results' })))).toBeNull();
    const asked = render(bjRoom(acting({ endRequested: true }), { endRequested: true }), 'host');
    expect(tagWith(asked, 'end-game-requested')).toBeTruthy();
    expect(tagsWith(asked, 'end-game')).toHaveLength(0);
  });
});

describe('the move the panel lights on my turn', () => {
  const all = { canHit: true, canStand: true, canDouble: true, canSplit: true };
  const up = (rank: Card['rank']) => c(rank, 'H');
  it('plays the basic strategy move from my hand and the dealer’s up card', async () => {
    const { suggestedMove } = await import('./lib/advice');
    expect(suggestedMove([c('8'), c('8', 'D')], up('10'), all)).toBe('split');
    expect(suggestedMove([c('A'), c('A', 'D')], up('6'), all)).toBe('split');
    expect(suggestedMove([c('6'), c('5')], up('10'), all)).toBe('double');
    expect(suggestedMove([c('6'), c('4')], up('6'), all)).toBe('double');
    expect(suggestedMove([c('6'), c('4')], up('A'), all)).toBe('hit');
    expect(suggestedMove([c('10'), c('7')], up('A'), all)).toBe('stand');
    expect(suggestedMove([c('10'), c('6')], up('5'), all)).toBe('stand');
    expect(suggestedMove([c('10'), c('6')], up('9'), all)).toBe('hit');
    expect(suggestedMove([c('10'), c('2')], up('4'), all)).toBe('stand');
    expect(suggestedMove([c('10'), c('2')], up('3'), all)).toBe('hit');
    expect(suggestedMove([c('A'), c('7')], up('9'), all)).toBe('hit');
    expect(suggestedMove([c('A'), c('7')], up('8'), all)).toBe('stand');
    expect(suggestedMove([c('A'), c('8')], up('10'), all)).toBe('stand');
    expect(suggestedMove([c('5'), c('3')], up('7'), all)).toBe('hit');
  });

  it('follows the basic strategy chart for every pair', async () => {
    const { suggestedMove } = await import('./lib/advice');
    const pair = (rank: Card['rank'], dealer: Card['rank']) => suggestedMove([c(rank), c(rank, 'D')], up(dealer), all);
    expect(pair('2', '7')).toBe('split');
    expect(pair('2', '8')).toBe('hit');
    expect(pair('3', '2')).toBe('split');
    expect(pair('4', '5')).toBe('split');
    expect(pair('4', '4')).toBe('hit');
    expect(pair('5', '9')).toBe('double');
    expect(pair('5', '10')).toBe('hit');
    expect(pair('6', '2')).toBe('split');
    expect(pair('6', '7')).toBe('hit');
    expect(pair('7', '7')).toBe('split');
    expect(pair('7', '8')).toBe('hit');
    expect(pair('9', '6')).toBe('split');
    expect(pair('9', '7')).toBe('stand');
    expect(pair('9', '9')).toBe('split');
    expect(pair('9', 'A')).toBe('stand');
    expect(pair('K', '6')).toBe('stand');
    expect(suggestedMove([c('K'), c('Q', 'D')], up('5'), all)).toBe('stand');
    expect(pair('8', 'A')).toBe('split');
    expect(pair('A', 'A')).toBe('split');
  });

  it('doubles a hard 9 to 11 and the soft hands where the chart does, and hits 11 against an ace', async () => {
    const { suggestedMove } = await import('./lib/advice');
    expect(suggestedMove([c('5'), c('4')], up('3'), all)).toBe('double');
    expect(suggestedMove([c('5'), c('4')], up('2'), all)).toBe('hit');
    expect(suggestedMove([c('5'), c('4')], up('7'), all)).toBe('hit');
    expect(suggestedMove([c('6'), c('5')], up('A'), all)).toBe('hit');
    // The casino card (six to eight decks): soft 13 and 14 double against a 5 or 6, soft 15 and 16 against a 4 to 6.
    expect(suggestedMove([c('A'), c('2')], up('5'), all)).toBe('double');
    expect(suggestedMove([c('A'), c('2')], up('4'), all)).toBe('hit');
    expect(suggestedMove([c('A'), c('3')], up('6'), all)).toBe('double');
    expect(suggestedMove([c('A'), c('4')], up('4'), all)).toBe('double');
    expect(suggestedMove([c('A'), c('4')], up('3'), all)).toBe('hit');
    expect(suggestedMove([c('A'), c('5')], up('4'), all)).toBe('double');
    expect(suggestedMove([c('A'), c('6')], up('3'), all)).toBe('double');
    expect(suggestedMove([c('A'), c('6')], up('7'), all)).toBe('hit');
    expect(suggestedMove([c('A'), c('7')], up('3'), all)).toBe('double');
    expect(suggestedMove([c('A'), c('7')], up('2'), all)).toBe('stand');
    expect(suggestedMove([c('A'), c('8')], up('6'), all)).toBe('stand');
  });

  it('turns a double the hand cannot take into Hit, or into Stand on a soft 18', async () => {
    const { suggestedMove } = await import('./lib/advice');
    const noDouble = { ...all, canDouble: false, canSplit: false };
    expect(suggestedMove([c('A'), c('2'), c('4')], up('5'), noDouble)).toBe('hit');
    expect(suggestedMove([c('A'), c('3'), c('4')], up('4'), noDouble)).toBe('stand');
    expect(suggestedMove([c('2'), c('3'), c('6')], up('6'), noDouble)).toBe('hit');
    // Split aces take one card each: only Stand (or a re-split of another ace) is on offer.
    expect(suggestedMove([c('A'), c('5')], up('6'), { ...NO_ACTIONS, canStand: true })).toBe('stand');
  });

  it('falls back to Hit, then Stand, when the play is not on offer, and lights nothing off my turn', async () => {
    const { suggestedMove } = await import('./lib/advice');
    // Double only on the first two cards; a split pair with the chips gone.
    expect(suggestedMove([c('6'), c('5')], up('10'), { ...all, canDouble: false })).toBe('hit');
    expect(suggestedMove([c('8'), c('8', 'D')], up('10'), { ...all, canSplit: false })).toBe('hit');
    expect(suggestedMove([c('8'), c('8', 'D')], up('10'), { ...NO_ACTIONS, canStand: true })).toBe('stand');
    expect(suggestedMove([c('10'), c('9')], up('10'), NO_ACTIONS)).toBeNull();
    expect(suggestedMove([], null, { ...all })).toBe('hit');
  });
});

describe('the table controls (no clocks)', () => {
  it('offers Sit out under Bet while my bet is still to place, and says so on the table once I sit out', () => {
    const html = render(bjRoom(view({ controls: { ...NO_CONTROLS, canSitOut: true } })), 'bob');
    const sit = tagWith(html, 'sit-out');
    expect(attr(sit, 'aria-label')).toBe('Sit this hand out');
    expect(html).toContain('>Sit out<');
    expect(tagsWith(html, 'deal-now')).toHaveLength(0);
    // Sitting out: Bet stays lit (a bet brings me back in), the status says I sit this one out.
    const out = view({ waitingFor: ['host'], players: { ...view().players, bob: { chips: 300, bet: 0, hands: [], inRound: true, sittingOut: true, bustedOut: false } } });
    const sat = render(bjRoom(out), 'bob');
    expect(tagsWith(sat, 'sit-out')).toHaveLength(0);
    // The row keeps its place: Sit out stays there, dimmed.
    expect(disabled(sat, 'sit-out-off')).toBe(true);
    expect(attr(tagWith(sat, 'table-turn'), 'data-state')).toBe('sat-out');
    expect(sat).toContain('>You sit this hand out<');
    expect(disabled(sat, 'place-bet')).toBe(false);
    // Everyone else waits on Hana only; the line under the banner counts the bets among those taking part.
    const host = render(bjRoom(out), 'host');
    expect(host).toMatch(/data-testid="bets-count">0 of 1 bets in</);
    expect(attr(tagWith(host, 'table-turn'), 'data-state')).toBe('bets');
  });

  it("gives the host Deal now once a bet is down, and Skip on another player’s turn, never on their own", () => {
    const bet = view({ waitingFor: ['bob'], controls: { ...NO_CONTROLS, canDealNow: true }, players: { ...view().players, host: { chips: 950, bet: 50, hands: [], inRound: true, sittingOut: false, bustedOut: false } } });
    const html = render(bjRoom(bet), 'host');
    expect(attr(tagWith(html, 'deal-now'), 'aria-label')).toBe('Deal now to everyone who has bet');
    expect(html).toContain('>Waiting for Pia<');
    // The view's controls are the viewer's own: a guest gets none.
    expect(tagsWith(render(bjRoom({ ...bet, controls: NO_CONTROLS }), 'bob'), 'deal-now')).toHaveLength(0);

    const theirs = acting({ turn: { playerId: 'bob', handIndex: 0 }, actions: NO_ACTIONS, controls: { ...NO_CONTROLS, canSkip: true } });
    const skip = tagWith(render(bjRoom(theirs), 'host'), 'skip-turn');
    expect(attr(skip, 'aria-label')).toBe('Stand Pia’s hand');
    expect(tagsWith(render(bjRoom(acting()), 'host'), 'skip-turn')).toHaveLength(0);
    expect(tagsWith(render(bjRoom(acting({ actions: NO_ACTIONS })), 'bob'), 'skip-turn')).toHaveLength(0);
  });

  it('keeps the row of table buttons in place with or without one on offer, full width, and never shows a clock', () => {
    for (const html of [render(bjRoom(view()), 'bob'), render(bjRoom(view({ controls: { ...NO_CONTROLS, canSitOut: true } })), 'bob'), render(bjRoom(acting()), 'host')]) {
      expect(html).toMatch(/<div class="tbl-panel__actions"><button type="button" class="btn btn--secondary btn--block tbl-panel__act"/);
      expect(tagsWith(html, 'timer')).toHaveLength(0);
    }
    const css = readFileSync(fileURLToPath(new URL('../../platform/styles/table.css', import.meta.url)), 'utf8');
    expect(css).toMatch(/\.tbl-panel__act \{[^}]*min-height: 44px;/);
    expect(css).not.toContain('tbl-panel__status');
  });

  it('keeps a watching host’s row of table buttons all game long (Deal now or Skip, dimmed when neither is on offer), so the panel and the table over it never change height; other spectators have no row', async () => {
    const { TableAction } = await import('./components/ControlPanel');
    // Quinn watches the whole game and is the host.
    const watchingHost = (game: BlackjackView) => render(bjRoom(game, { hostId: 'carol' }), 'carol', true);
    const row = (html: string) => html.match(/<div class="tbl-panel__actions">(<button[^>]*>[^<]*<\/button>)<\/div>/)?.[1] ?? '';
    // The bets open with none down yet: Deal now, dimmed. Once one is down: Deal now. Another player's turn: Skip.
    const open = watchingHost(view());
    expect(attr(tagWith(open, 'bj-panel'), 'data-watching')).toBe('true');
    expect(row(open)).toContain('data-testid="deal-now-off"');
    expect(disabled(open, 'deal-now-off')).toBe(true);
    expect(row(open)).toContain('>Deal now<');
    expect(row(watchingHost(view({ controls: { ...NO_CONTROLS, canDealNow: true } })))).toContain('data-testid="deal-now"');
    const theirs = acting({ turn: { playerId: 'bob', handIndex: 0 }, actions: NO_ACTIONS, controls: { ...NO_CONTROLS, canSkip: true } });
    expect(row(watchingHost(theirs))).toContain('data-testid="skip-turn"');
    // Nothing may go (the dealer's reveal playing, a tap waiting, the socket down): the same row, dimmed, never gone.
    const held = (game: BlackjackView) => renderToString(TableAction({ view: game, meId: 'carol', turnName: 'Pia', live: false, watching: true, skipped: null, onSkip: () => undefined }));
    expect(disabled(held(theirs), 'skip-turn-off')).toBe(true);
    expect(attr(tagWith(held(theirs), 'skip-turn-off'), 'aria-label')).toBe('Stand Pia’s hand');
    for (const game of [nextBetting(), acting({ phase: 'results', turn: null })]) {
      expect(disabled(held(game), 'deal-now-off')).toBe(true);
      expect(held(game)).not.toContain('Sit out');
    }
    // A spectator who is not the host has no table buttons at all, so no row to keep.
    for (const game of [view(), view({ controls: { ...NO_CONTROLS, canDealNow: true } }), theirs]) expect(render(bjRoom(game), 'carol')).not.toContain('tbl-panel__actions');
  });

  it('sends the new moves to the server', async () => {
    const { socket } = await import('../../platform/net/socket');
    const sent: unknown[] = [];
    const spy = vi.spyOn(socket, 'send').mockImplementation((msg: unknown) => {
      sent.push(msg);
      return true;
    });
    const { sitOut, dealNow, skipTurn } = await import('./actions');
    sitOut(view(), 'host');
    dealNow(view(), 'host');
    skipTurn({ playerId: 'bob', handIndex: 2 }, view(), 'host');
    expect(sent).toEqual([{ t: 'sitOutHand', round: 2 }, { t: 'dealNow', round: 2 }, { t: 'skip', playerId: 'bob', handIndex: 2 }]);
    useBlackjackStore.getState().clearPending();
    spy.mockRestore();
  });

  it('offers a host who has not bet both Sit out and Deal now once a bet is down', () => {
    const bet = view({ waitingFor: ['host'], controls: { canSitOut: true, canDealNow: true, canSkip: false }, players: { ...view().players, bob: { chips: 250, bet: 50, hands: [], inRound: true, sittingOut: false, bustedOut: false } } });
    const html = render(bjRoom(bet), 'host');
    expect(tagsWith(html, 'sit-out')).toHaveLength(1);
    expect(tagsWith(html, 'deal-now')).toHaveLength(1);
    expect(html.indexOf('data-testid="sit-out"')).toBeLessThan(html.indexOf('data-testid="deal-now"'));
    // Side by side under Bet, sharing the row.
    expect(html.indexOf('data-testid="place-bet"')).toBeLessThan(html.indexOf('data-testid="sit-out"'));
    const css = readFileSync(fileURLToPath(new URL('../../platform/styles/table.css', import.meta.url)), 'utf8');
    expect(css).toMatch(/\.tbl-panel__actions \{[^}]*grid-auto-columns: minmax\(0, 1fr\);/);
  });

  it('aims Skip at the hand in play and dims it once tapped, so a second tap never stands the next hand', async () => {
    const { TableAction, turnKey, SKIP_REARM_MS } = await import('./components/ControlPanel');
    const { socket } = await import('../../platform/net/socket');
    const sent: unknown[] = [];
    const spy = vi.spyOn(socket, 'send').mockImplementation((msg: unknown) => {
      sent.push(msg);
      return true;
    });
    const theirs = acting({ turn: { playerId: 'bob', handIndex: 1 }, actions: NO_ACTIONS, controls: { ...NO_CONTROLS, canSkip: true } });
    expect(turnKey(theirs)).toBe('2:bob:1');
    expect(turnKey(view())).toBeNull();
    const skipped: string[] = [];
    const element = (skippedKey: string | null) => {
      const el = TableAction({ view: theirs, meId: 'host', turnName: 'Pia', live: true, skipped: skippedKey, onSkip: (k) => skipped.push(k) });
      if (!el) throw new Error('no Skip');
      return el;
    };
    const live = element(null);
    expect(renderToString(live)).not.toContain('disabled');
    (live.props as { onClick(): void }).onClick();
    expect(sent).toEqual([{ t: 'skip', playerId: 'bob', handIndex: 1 }]);
    expect(skipped).toEqual(['2:bob:1']);
    // Tapped: dimmed, and a second tap sends nothing.
    const dimmed = element('2:bob:1');
    expect(renderToString(dimmed)).toContain('disabled');
    (dimmed.props as { onClick(): void }).onClick();
    expect(sent).toHaveLength(1);
    expect(SKIP_REARM_MS).toBeGreaterThanOrEqual(500);
    spy.mockRestore();
  });
});

describe("the table’s focus and the stage", () => {
  const at = async (v: BlackjackView, meId: string | null, opts: { dealerPlaying?: boolean; shown?: boolean } = {}) => {
    const { focusOf } = await import('./lib/focus');
    return focusOf({ view: v, table: tableOf(v), dealerPlaying: opts.dealerPlaying ?? false, outcomesShown: opts.shown ?? true, meId });
  };

  it('follows the hand being played, with who plays next (the dealer after the last seat)', async () => {
    expect(await at(acting(), 'bob')).toEqual({ kind: 'turn', playerId: 'host', handIndex: 0, mine: false, next: 'bob' });
    expect(await at(acting(), 'host')).toMatchObject({ kind: 'turn', mine: true, next: 'bob' });
    const last = acting({ turn: { playerId: 'bob', handIndex: 0 } });
    expect(await at(last, 'host')).toEqual({ kind: 'turn', playerId: 'bob', handIndex: 0, mine: false, next: null });
  });

  it('follows the dealer while the reveal plays, then my outcome until my next bet goes down', async () => {
    expect(await at(nextBetting(), 'host', { dealerPlaying: true, shown: false })).toEqual({ kind: 'dealer' });
    expect(await at(nextBetting(), 'host')).toEqual({ kind: 'result', playerId: 'host' });
    const placed = nextBetting({ waitingFor: ['bob'], players: { ...nextBetting().players, host: { chips: 1000, bet: 50, hands: [], inRound: true, sittingOut: false, bustedOut: false } } });
    expect(await at(placed, 'host')).toEqual({ kind: 'bets', placed: ['host'], waiting: ['bob'] });
    // A watcher has no outcome of their own: the bets.
    expect(await at(nextBetting(), 'carol')).toMatchObject({ kind: 'bets' });
  });

  it('follows who has bet and who we wait for, a hold, and the end', async () => {
    expect(await at(view(), 'bob')).toEqual({ kind: 'bets', placed: [], waiting: ['host', 'bob'] });
    // Everyone sat out: nobody to wait for, nothing dealt.
    expect(await at(view({ waitingFor: [] }), 'bob')).toEqual({ kind: 'bets', placed: [], waiting: [] });
    expect(await at(view({ phase: 'held' }), 'bob')).toEqual({ kind: 'idle', reason: 'held' });
    // The final table: the last hand's reveal for everyone, then my outcome with the game over (a watcher: the game over).
    expect(await at(nextBetting({ phase: 'ending' }), 'host', { dealerPlaying: true, shown: false })).toEqual({ kind: 'dealer', last: true });
    expect(await at(nextBetting({ phase: 'ending' }), 'carol', { dealerPlaying: true, shown: false })).toEqual({ kind: 'dealer', last: true });
    expect(await at(nextBetting({ phase: 'ending' }), 'host')).toEqual({ kind: 'result', playerId: 'host', over: true });
    expect(await at(nextBetting({ phase: 'ending' }), 'carol')).toEqual({ kind: 'idle', reason: 'over' });
  });

  it('says the focus in one short line under the banner, with a quieter second part', async () => {
    const { focusLine } = await import('./lib/text');
    const names: Record<string, string> = { host: 'Hana', bob: 'Pia', carol: 'Quinn' };
    const s = { nameOf: (id: string) => names[id] ?? 'Someone', meId: 'host', handCount: 1 };
    expect(focusLine({ kind: 'turn', playerId: 'host', handIndex: 0, mine: true, next: 'bob' }, s)).toEqual({ state: 'mine', text: 'Your turn', tone: 'go' });
    expect(focusLine({ kind: 'turn', playerId: 'host', handIndex: 1, mine: true, next: null }, { ...s, handCount: 3 }).text).toBe('Your turn, hand 2 of 3');
    expect(focusLine({ kind: 'turn', playerId: 'bob', handIndex: 0, mine: false, next: 'host' }, s)).toEqual({ state: 'turn', text: "Pia’s turn", tone: 'other', sub: 'Next: You' });
    expect(focusLine({ kind: 'turn', playerId: 'bob', handIndex: 0, mine: false, next: null }, s).sub).toBe('Next: Dealer');
    expect(focusLine({ kind: 'dealer' }, s)).toEqual({ state: 'dealer', text: "Dealer’s turn", tone: 'other', sub: 'Draws to 17' });
    expect(focusLine({ kind: 'bets', placed: ['bob'], waiting: ['host'] }, s)).toEqual({ state: 'bets', text: 'Place your bet', tone: 'go', sub: '1 of 2 bets in' });
    expect(focusLine({ kind: 'bets', placed: ['host'], waiting: ['bob'] }, s).text).toBe('Waiting for Pia');
    expect(focusLine({ kind: 'result', playerId: 'host' }, { ...s, result: { outcome: 'win', back: 100 } })).toEqual({ state: 'result', text: 'You win +100', tone: 'go' });
    expect(focusLine({ kind: 'result', playerId: 'host' }, { ...s, result: { outcome: 'loss', back: 0 } }).tone).toBe('bad');
    expect(focusLine({ kind: 'idle', reason: 'next' }, s).text).toBe('Next round soon');
    // The final table: "Last hand" while its reveal plays, then "Game over", my last outcome beside it, for a watcher too.
    expect(focusLine({ kind: 'dealer', last: true }, s)).toEqual({ state: 'dealer', text: 'Last hand', tone: 'other', sub: "Dealer’s turn" });
    expect(focusLine({ kind: 'result', playerId: 'host', over: true }, { ...s, result: { outcome: 'loss', back: 0 } })).toEqual({ state: 'over', text: 'Game over', tone: 'quiet', sub: 'You lost' });
    expect(focusLine({ kind: 'result', playerId: 'host', over: true }, { ...s, result: { outcome: 'blackjack', back: 250 } }).sub).toBe('Blackjack +250');
    expect(focusLine({ kind: 'idle', reason: 'over' }, s)).toEqual({ state: 'over', text: 'Game over', tone: 'quiet' });
    expect(focusLine({ kind: 'idle', reason: 'over' }, { ...s, standing: 'out' })).toEqual({ state: 'over', text: 'Game over', tone: 'quiet' });
  });

  it('keeps my hands on the stage whenever I am dealt in; not dealt in, the stage shows the hand in play', async () => {
    const { stageOwner, stageKind } = await import('./lib/focus');
    const theirs = { kind: 'turn' as const, playerId: 'bob', handIndex: 0, mine: false, next: null };
    const dealt = { seated: true, dealtIn: true };
    // Dealt in: mine, on my turn, on another player's turn and in every other phase.
    expect(stageOwner(theirs, dealt, 'host')).toBe('host');
    expect(stageOwner({ ...theirs, playerId: 'host', mine: true }, dealt, 'host')).toBe('host');
    expect(stageOwner({ kind: 'dealer' }, dealt, 'host')).toBe('host');
    expect(stageOwner({ kind: 'result', playerId: 'host' }, dealt, 'host')).toBe('host');
    // Seated but not dealt in (sitting out, out of chips, just joined): the hand in play while someone plays, my empty places otherwise.
    const out = { seated: true, dealtIn: false };
    expect(stageOwner(theirs, out, 'host')).toBe('bob');
    expect(stageOwner({ kind: 'bets', placed: [], waiting: [] }, out, 'host')).toBe('host');
    expect(stageOwner({ kind: 'dealer' }, out, 'host')).toBe('host');
    // A watcher: the hand in play, or nobody's.
    const watching = { seated: false, dealtIn: false };
    expect(stageOwner(theirs, watching, 'carol')).toBe('bob');
    expect(stageOwner({ kind: 'dealer' }, watching, 'carol')).toBeNull();
    expect(stageOwner({ kind: 'idle', reason: 'held' }, watching, 'carol')).toBeNull();
    // The stage's kind says what the table follows, whoever's hand it shows.
    expect(stageKind(theirs)).toBe('turn');
    expect(stageKind({ ...theirs, mine: true })).toBe('mine');
    expect(stageKind({ kind: 'dealer' })).toBe('dealer');
    expect(stageKind({ kind: 'bets', placed: [], waiting: [] })).toBe('bets');
    expect(stageKind({ kind: 'result', playerId: 'host' })).toBe('result');
    expect(stageKind({ kind: 'idle', reason: 'over' })).toBe('idle');
  });

  it("counts my bet in as soon as it is on its way, so the line never says less than I did", async () => {
    const { focusOf } = await import('./lib/focus');
    const open = view({ waitingFor: ['host', 'bob'] });
    expect(focusOf({ view: open, table: tableOf(open), dealerPlaying: false, outcomesShown: true, meId: 'host' })).toEqual({ kind: 'bets', placed: [], waiting: ['host', 'bob'] });
    expect(focusOf({ view: open, table: tableOf(open), dealerPlaying: false, outcomesShown: true, meId: 'host', betSent: true })).toEqual({ kind: 'bets', placed: ['host'], waiting: ['bob'] });
    // My last outcome gives way to the bets as soon as my next bet is on its way.
    const settled = nextBetting();
    expect(focusOf({ view: settled, table: tableOf(settled), dealerPlaying: false, outcomesShown: true, meId: 'host', betSent: true })).toMatchObject({ kind: 'bets' });
  });

  it("someone else’s turn: my hand stays big at the bottom with my stake; theirs plays in their seat alone, lit, never on the stage", () => {
    const html = render(bjRoom(acting({ actions: NO_ACTIONS })), 'bob');
    const stage = tagWith(html, 'hand-stage');
    expect(attr(stage, 'data-kind')).toBe('turn');
    expect(attr(stage, 'data-player-id')).toBe('bob');
    expect(attr(tagWith(html, 'my-area'), 'class')).toBe('bj-mine');
    expect(attr(tagWith(html, 'my-hand'), 'class')).toContain('tbl-hand--big');
    expect(attr(tagWith(html, 'hand-bet'), 'data-bet')).toBe('20');
    expect(tagsWith(html, 'stage-hand')).toHaveLength(0);
    // Their cards are on the page once: in their seat, which is ringed.
    const seat = tagWith(html, 'seat');
    expect(attr(seat, 'data-turn')).toBe('true');
    expect(tagsWith(html, 'seat-hand')).toHaveLength(1);
    // No floating columns of faces, names or stakes beside the stage.
    expect(html).not.toContain('tbl-stage__');
    expect(html).not.toContain('bj-mine--aside');
    // Whose turn it is: the line under the banner and the seat's ring; no band across the table.
    expect(html).toMatch(/data-testid="table-turn"[^>]*><span class="tbl-turn__text">Hana’s turn<\/span><span class="tbl-turn__sub" data-testid="turn-sub">Next: You</);
    expect(tagsWith(html, 'spotlight')).toHaveLength(0);
    expect(tagsWith(html, 'timer')).toHaveLength(0);
  });

  it('my turn: my hand big on the stage and lit; top to bottom the dealer, the banner, the seats, the stage', () => {
    const html = render(bjRoom(acting()), 'host');
    expect(attr(tagWith(html, 'hand-stage'), 'data-kind')).toBe('mine');
    expect(attr(tagWith(html, 'my-area'), 'class')).toBe('bj-mine');
    expect(tagsWith(html, 'my-hand')).toHaveLength(1);
    expect(attr(tagWith(html, 'my-hand'), 'data-active')).toBe('true');
    expect(attr(tagWith(html, 'my-hand'), 'class')).toContain('tbl-hand--big');
    const at = (id: string) => html.indexOf(`data-testid="${id}"`);
    expect(at('dealer-area')).toBeLessThan(at('table-ribbon'));
    expect(at('table-ribbon')).toBeLessThan(at('seats'));
    expect(at('seats')).toBeLessThan(at('hand-stage'));
    // The shoe tucked in the corner, the discards just past the other one.
    expect(attr(tagWith(html, 'shoe'), 'class')).toBe('tbl-deck tbl-deck--corner');
    expect(attr(tagWith(html, 'discard-tray'), 'class')).toBe('tbl-discard-corner');
  });

  it("the dealer’s play: the dealer’s cards stay at the top of the table, the line under the banner says so", () => {
    const me = 'host';
    usePlatformStore.getState().handleServerMessage(welcome(me, bjRoom(acting())));
    // The server is already on the next bets.
    const betting = nextBetting();
    blackjackClient.onRoom?.(bjRoom(acting()), null);
    blackjackClient.onRoom?.(bjRoom(betting), bjRoom(acting()));
    const html = render(bjRoom(betting), me);
    expect(attr(tagWith(html, 'hand-stage'), 'data-kind')).toBe('dealer');
    expect(html).toContain('>Dealer’s turn<');
    expect(html).toContain('>Draws to 17<');
    // No countdown anywhere: the next bets wait for the players.
    expect(tagsWith(html, 'timer')).toHaveLength(0);
    expect(tagsWith(html, 'dealer-hand')).toHaveLength(1);
    // My hands stay where they are too.
    expect(tagsWith(html, 'my-area')).toHaveLength(1);
  });

  it('keeps the dealer and the stage in the same place, in the same markup, through every phase', () => {
    const phases: [string, BlackjackView][] = [
      ['betting', view()],
      ['my turn', acting()],
      ["another player’s turn", acting({ turn: { playerId: 'bob', handIndex: 0 }, actions: NO_ACTIONS })],
      ['the settled table', nextBetting()],
    ];
    for (const [label, v] of phases) {
      const html = render(bjRoom(v), 'host');
      expect(tagsWith(html, 'dealer-area'), label).toHaveLength(1);
      expect(tagsWith(html, 'hand-stage'), label).toHaveLength(1);
      expect(tagsWith(html, 'my-area'), label).toHaveLength(1);
      expect(attr(tagWith(html, 'dealer-area'), 'class'), label).toBe('bj-dealer');
      expect(attr(tagWith(html, 'hand-stage'), 'class'), label).toMatch(/^tbl-stage tbl-stage--(mine|other)$/);
    }
  });

  it('sizes the dealer and the stage from the screen and, on a phone, the room the round’s seats leave: fixed rows, never the phase', () => {
    const css = readFileSync(fileURLToPath(new URL('./blackjack.css', import.meta.url)), 'utf8');
    // The calm table's fixed first and last rows (table.css) are the dealer's and the stage's.
    expect(css).toMatch(/\.bj-table \{[^}]*--tbl-head-h: calc\(var\(--bj-label-h\) \+ var\(--bj-fan-h\)\);\s*--tbl-stage-h: calc\(var\(--bj-fan-h\) \+ var\(--tbl-stage-more, 0px\)\);/);
    // A hand there is its pill's height and 1.67 card widths (table.css --hand-k): the pill comes down over the cards only as far as
    // their corners begin, so it never covers a rank or a suit; a row of hands sizes its cards to that rule too.
    expect(css).toMatch(/--bj-fan-h: calc\(var\(--tbl-pill-h\) \+ var\(--bj-card-w\) \* var\(--hand-k\) \+ 4px\);/);
    expect(css).toMatch(/--fit-h: calc\(\(100cqh - var\(--tbl-pill-h\) - 4px\) \/ var\(--hand-k\)\);/);
    expect(css).not.toMatch(/pill-h\) \* 0\.7|\* 1\.77|3\.54/);
    // The cards go by the room the table has (cq units), worked out once on the table.
    expect(css).toMatch(/@property --bj-card-w \{\s*syntax: '<length>';\s*inherits: true;/);
    expect(css).toMatch(/\.bj-table \{\s*--bj-card-w: clamp\(64px, 13cqh, 132px\);/);
    // On a phone the least card is 11% of the table's height, up to 60px (the shortest phones pin it at 30px: their seats need
    // every pixel). Over it the cards take the room the seats leave (--tbl-spare, worked out by the table from the seats the
    // round was dealt with: room.ts useSeatRoom), shared by the dealer's hand and mine, 1.67 card widths each (table.css --hand-k:
    // 3.34px a card pixel), up to 76px and the widest card whose four in the dealer's row (1.6 card widths right of the middle)
    // and the shoe beside them, as wide as a card, fit the half of the table right of the middle with 18px to spare: 61.9px on a
    // 390px phone (73.8px beside the 34px shoe before). --tbl-grow tells the table how much taller the two rows are for it, so it
    // reads the seats' room with the cards at their least size however big they are.
    expect(css).toMatch(/@property --bj-card-base \{\s*syntax: '<length>';\s*inherits: true;/);
    const phone = css.slice(css.indexOf('@media (max-width: 760px), (min-aspect-ratio: 3/2) and (max-height: 520px)'));
    expect(phone).toMatch(
      /\.bj-table \{\s*(\/\*[^*]*(\*(?!\/)[^*]*)*\*\/\s*)?--bj-card-base: clamp\(30px, 11cqh, 60px\);\s*--bj-card-w: clamp\(var\(--bj-card-base\), calc\(var\(--bj-card-base\) \+ var\(--tbl-spare\) \/ \(2 \* var\(--hand-k\)\)\), max\(var\(--bj-card-base\), min\(76px, calc\(\(50cqw - var\(--tbl-pad\) - 18px\) \/ 2\.6\)\)\)\);\s*--tbl-grow: calc\(\(var\(--bj-card-w\) - var\(--bj-card-base\)\) \* 2 \* var\(--hand-k\)\);/,
    );
    expect(css.slice(css.indexOf('@media (max-width: 760px) and (max-height: 620px)'))).toMatch(/\.bj-table \{\s*--bj-card-base: 30px;/);
    // The shoe is the size of the cards it deals wherever the dealer's four cards leave it the room (always on a phone, whose
    // cards stop where they would not), never under its least: a crowded phone's 34px (28px on the shortest), a desktop's old size.
    expect(css).toMatch(/\.bj-table \{[^}]*--bj-deck-least: clamp\(44px, 6cqh, 60px\);\s*--tbl-deck-w: max\(var\(--bj-deck-least\), min\(calc\(var\(--bj-card-w\) \* 0\.7\), calc\(50cqw - var\(--tbl-pad\) - 18px - var\(--bj-card-w\) \* 1\.6\)\)\);/);
    expect(phone).toMatch(/\.bj-table \{[^}]*--bj-deck-least: 34px;/);
    expect(css.slice(css.indexOf('@media (max-width: 760px) and (max-height: 620px)'))).toMatch(/\.bj-table \{[^}]*--bj-deck-least: 28px;/);
    expect(css.slice(css.indexOf('/* ---------- Dealer'))).not.toMatch(/--tbl-deck-w:/);
    // Only the phone's rule takes the seats' room: a desktop's cards go by the table alone.
    expect(css.slice(0, css.indexOf('@media (max-width: 760px), (min-aspect-ratio: 3/2) and (max-height: 520px)'))).not.toMatch(/var\(--tbl-spare\)/);
    // The banner goes on every phone (table.css hides it under 761px tall already): its 30px go to the cards or the seats.
    expect(phone).toMatch(/\.bj-table\.tbl-felt--calm \.tbl-ribbon__band \{\s*display: none;/);
    // A watcher's table is taller by the bet controls their one-line panel has not got: the seats have that room first, the cards
    // what they leave, so the felt says nothing of who is watching.
    expect(css).not.toMatch(/watching/);
    expect(attr(tagWith(render(bjRoom(acting()), 'carol'), 'bj-table'), 'class')).not.toContain('watching');
    // The felt says how many seats the round was dealt with (the others: Pia for the host, both players for a watcher), and on
    // the server render nothing has been worked out yet: the cards at their least size.
    expect(attr(tagWith(render(bjRoom(acting()), 'host'), 'bj-table'), 'data-seats')).toBe('1');
    expect(attr(tagWith(render(bjRoom(acting()), 'carol'), 'bj-table'), 'data-seats')).toBe('2');
    expect(attr(tagWith(render(bjRoom(acting()), 'host'), 'bj-table'), 'style')).toBeUndefined();
    // The dealer's long draw shrinks to the room from the fan's start to the shoe: the dealer's
    // content box begins where the fan does (its padding centres the first two cards), so its whole
    // inline size is that room (half of it once left a 6-card draw at 17px beside 80px of felt).
    expect(css).toMatch(/\.bj-dealer \.tbl-hand \{\s*(\/\*[^*]*(\*(?!\/)[^*]*)*\*\/\s*)?--bj-room: calc\(100cqw - var\(--tbl-deck-w\) - 20px\);/);
    expect(render(bjRoom(view()), 'host')).toContain('tbl-felt tbl-felt--calm bj-table');
    // The crowd on show never resizes the dealer's cards or the stage's: only the seats the round began with do.
    for (const rule of css.match(/[^{}]*tbl-crowd--[^{}]*\{[^}]*\}/g) ?? []) {
      expect(rule).not.toMatch(/--bj-(card-w|card-base|fan-h|label-h)|--tbl-spare/);
    }
    // The fan keeps one height however many cards (the step down shrinks past four).
    const table = readFileSync(fileURLToPath(new URL('../../platform/styles/table.css', import.meta.url)), 'utf8');
    expect(table).toMatch(/\.tbl-fan \{[^}]*height: calc\(var\(--tbl-w\) \* 1\.77\);/);
    expect(table).toMatch(/--fan-dy: min\(calc\(var\(--tbl-w\) \* 0\.09\), calc\(var\(--tbl-w\) \* 0\.27 \/ max\(1, var\(--fan, 2\) - 1\)\)\);/);
  });

  it('another player’s split hands sit in their tile as a row like mine on the stage: each its cards and its total, sized for the tile', () => {
    const split = acting({
      turn: { playerId: 'bob', handIndex: 1 },
      actions: NO_ACTIONS,
      players: { ...acting().players, bob: { chips: 260, bet: 20, hands: [hand([c('8'), c('3'), c('10')], { total: 21, status: 'stood', fromSplit: true }), hand([c('8'), c('2')], { total: 10, status: 'acting', fromSplit: true })], inRound: true, sittingOut: false, bustedOut: false } },
    });
    const html = render(bjRoom(split), 'host');
    const row = tagWith(html, 'seat-hands-row');
    expect(attr(row, 'class')).toBe('bj-hands bj-hands--seat scroll-fade scroll-fade--x bj-hands--side');
    expect(attr(row, 'data-count')).toBe('2');
    // Every hand is there with its own total (the row slides to the one in play, lit), none left out or cut.
    expect(tagsWith(html, 'seat-hand')).toHaveLength(2);
    expect(html).toMatch(/data-testid="seat-hand"[^>]*data-index="1"[^>]*data-active="true"/);
    expect(html.slice(html.indexOf('data-testid="seat-hands-row"'), html.indexOf('data-testid="seat-open"')).match(/data-testid="hand-total"/g)).toHaveLength(2);
    // The tile sizes the cards for its longest hand and keeps room for the next hand to peek in (table.css).
    expect(html).toContain('<span class="tbl-tile__cards" style="--tile-fan:3;--tile-hands:2">');
    const css = readFileSync(fileURLToPath(new URL('./blackjack.css', import.meta.url)), 'utf8');
    expect(css).toMatch(/\.bj-hands--seat > \.bj-slot \{\s*display: flex;\s*flex: none;\s*\}/);
  });

  it("another player’s split hands share the stage when I watch, the line under the banner says which is in play", () => {
    const split = acting({
      turn: { playerId: 'bob', handIndex: 1 },
      actions: NO_ACTIONS,
      players: { ...acting().players, bob: { chips: 260, bet: 20, hands: [hand([c('8'), c('3'), c('10')], { total: 21, status: 'stood', fromSplit: true }), hand([c('8'), c('2'), c('5')], { total: 15, status: 'acting', fromSplit: true })], inRound: true, sittingOut: false, bustedOut: false } },
    });
    const html = render(bjRoom(split), 'carol');
    expect(tagsWith(html, 'stage-hand')).toHaveLength(2);
    expect(tagWith(html, 'stage-hands-row')).toContain('style="--hands:2;--fan:3');
    // Each slot keeps the room its own hand's words reach left of its own fan: by its own cards, not the row's longest hand
    // (a two-card hand beside a five-card one once let its stake run 23px off the stage), the words ending 3px inside the hand's
    // box (taken as 6px, two hands with the same words over them ran 2.6px off the stage during the deal).
    // (The seats' tiles hold rows of slots too, ahead of the stage: only the stage's are read here.)
    const onStage = (h: string) => h.slice(h.indexOf('data-testid="hand-stage"'));
    expect(onStage(html).match(/<div class="bj-slot" style="--slot-fan:(\d+)">/g)).toEqual(['<div class="bj-slot" style="--slot-fan:3">', '<div class="bj-slot" style="--slot-fan:3">']);
    const css = readFileSync(fileURLToPath(new URL('./blackjack.css', import.meta.url)), 'utf8');
    expect(css).toMatch(/\.bj-hands--mine > \.bj-slot,\s*\.bj-hands--stage > \.bj-slot \{\s*--bj-fan-w: calc\(6px \+ var\(--tbl-w\) \* \(1 \+ var\(--fan-step\) \* \(var\(--slot-fan, 2\) - 1\)\)\);\s*--bj-head-room: max\(0px, calc\(var\(--bj-head-w, 0px\) - 3px - var\(--tbl-w\) \* \(1 \+ var\(--fan-step\) \* \(var\(--slot-fan, 2\) - 1\)\)\)\);/);
    const long = render(bjRoom(acting({ players: { ...acting().players, bob: { chips: 260, bet: 20, hands: [hand([c('8'), c('3')], { total: 11, status: 'stood', fromSplit: true }), hand([c('8'), c('2'), c('A'), c('2'), c('3')], { total: 16, status: 'acting', fromSplit: true })], inRound: true, sittingOut: false, bustedOut: false } }, turn: { playerId: 'bob', handIndex: 1 }, actions: NO_ACTIONS })), 'carol');
    expect(onStage(long).match(/--slot-fan:\d+/g)).toEqual(['--slot-fan:2', '--slot-fan:5']);
    // Their name rides on the hand in play, by its total.
    expect(html).toMatch(/data-testid="stage-hand"[^>]*data-index="1"[\s\S]*?<span class="tbl-hand__owner" data-testid="stage-owner">Pia<\/span>/);
    expect(tagsWith(html, 'stage-owner')).toHaveLength(1);
    expect(html).toContain('>Pia’s turn, hand 2 of 2<');
    // Dealt in, I keep my own hand on the stage and theirs stays in their seat.
    const mine = render(bjRoom(split), 'host');
    expect(tagsWith(mine, 'stage-hand')).toHaveLength(0);
    expect(tagsWith(mine, 'my-hand')).toHaveLength(1);
  });

  it('after the settle: my outcome on my hand and in the line under the banner, in its colour', () => {
    const html = render(bjRoom(nextBetting()), 'host');
    expect(attr(tagWith(html, 'hand-stage'), 'data-kind')).toBe('result');
    expect(attr(tagWith(html, 'table-turn'), 'class')).toBe('tbl-turn tbl-turn--go');
    expect(html).toContain('>You win +100<');
    expect(tagsWith(html, 'my-hands')).toHaveLength(1);
  });

  it('on the final table: the line says the game is over, my last outcome beside it, and a watcher reads it too', () => {
    const final = bjRoom(nextBetting({ phase: 'ending', round: 2, waitingFor: [] }));
    const html = render(final, 'host');
    expect(attr(tagWith(html, 'table-turn'), 'data-state')).toBe('over');
    expect(attr(tagWith(html, 'table-turn'), 'class')).toBe('tbl-turn tbl-turn--quiet');
    expect(html).toMatch(/data-testid="table-turn"[^>]*><span class="tbl-turn__text">Game over<\/span><span class="tbl-turn__sub" data-testid="turn-sub">You win \+100</);
    // The outcome stays on my hand, and the seats keep theirs.
    expect(attr(tagWith(html, 'my-hand'), 'data-outcome')).toBe('win');
    expect(html).toMatch(/data-testid="seat"[^>]*data-name="Pia"[\s\S]*?>Lost</);
    const watching = render(final, 'carol', false);
    expect(attr(tagWith(watching, 'table-turn'), 'data-state')).toBe('over');
    expect(watching).toMatch(/data-testid="table-turn"[^>]*><span class="tbl-turn__text">Game over<\/span><\/p>/);
  });
});

describe('many hands', () => {
  const css = () => readFileSync(fileURLToPath(new URL('./blackjack.css', import.meta.url)), 'utf8');

  it('brings the hand in play to the middle of a row that scrolls, as far as the row goes', () => {
    // Eight hands 100px wide with 8px between them (856px) in a 290px row: the fifth hand's centre to the row's.
    expect(H.scrollToHand({ left: 432, width: 100 }, 290, 856)).toBe(337);
    // The first hands sit at the start, the last at the end: never past either.
    expect(H.scrollToHand({ left: 0, width: 100 }, 290, 856)).toBe(0);
    expect(H.scrollToHand({ left: 108, width: 100 }, 290, 856)).toBe(13);
    expect(H.scrollToHand({ left: 756, width: 100 }, 290, 856)).toBe(566);
    // Every hand in view: the row never scrolls.
    expect(H.scrollToHand({ left: 150, width: 140 }, 290, 290)).toBe(0);
  });

  it('fades the ends of a sideways row that has more hands past them', () => {
    // The row's width is its hands as laid out (laidOutWidth), never a dealt card still in the air.
    expect(sideFade(0, 290, 856)).toBe('right');
    expect(sideFade(200, 290, 856)).toBe('left right');
    expect(sideFade(566, 290, 856)).toBe('left');
    expect(sideFade(0, 290, 290)).toBe('');
    // A box that scrolls down keeps its top and bottom.
    expect(fadeOf({ scrollTop: 10, clientHeight: 100, scrollHeight: 300 } as HTMLElement)).toBe('top bottom');
  });

  it('sizes one hand by the whole row, shrinks split hands together to fit, and scrolls only past the least card', () => {
    const sheet = css();
    // A hand on its own goes by the whole row and its height; split hands take HandRow's --bj-fit when that is smaller.
    expect(sheet).toMatch(/--fit-w: max\(14px, calc\(\(100cqw - 8px\) \/ \(1 \+ var\(--fan-step\) \* \(var\(--fan, 2\) - 1\)\)\)\);/);
    expect(sheet).toMatch(/--bj-solo-w: min\(var\(--bj-card-w\), var\(--fit-w\), var\(--fit-h\)\);/);
    expect(sheet).toMatch(/--tbl-w: min\(var\(--bj-solo-w\), var\(--bj-fit, 9999px\)\);/);
    // My split hands wrap into a grid of equal cells, never a scrolling row.
    expect(sheet).toMatch(/\.bj-hands--grid \{\s*flex-wrap: wrap;/);
    // An equal share of the row while the hands fit, never narrower than its own hand: past that the row scrolls sideways, a hand to a snap, no scrollbar.
    expect(sheet).toMatch(/flex: 0 1 max\(var\(--bj-hand-least\), calc\(\(100cqw - \(var\(--hands, 1\) - 1\) \* 8px\) \/ var\(--hands, 1\)\)\);\s*min-width: var\(--bj-hand-least\);/);
    expect(sheet).toMatch(/\.bj-hands\.scroll-fade--x \{[^}]*overflow-x: auto;\s*overflow-y: hidden;\s*overscroll-behavior-x: contain;\s*scrollbar-width: none;/);
    // No snapping and no layout containment: a snap chased a card in flight past the last hand, and
    // containing each slot's layout left stale card trails on screen in Chrome on Windows.
    expect(sheet).not.toMatch(/scroll-snap|contain: layout/);
    // No hand ever folds into a number.
    expect(sheet).not.toContain('bj-chip');
  });

  it('shows every hand as its cards, the row a sideways scroll-fade box, the hand in play lit', () => {
    const hands = Array.from({ length: 12 }, (_, i) => hand([c('8'), c(i % 2 ? '3' : '9', 'H')], { status: i === 4 ? 'acting' : i < 4 ? 'stood' : 'waiting', fromSplit: true, bet: 10 }));
    const v = acting({ turn: { playerId: 'host', handIndex: 4 }, players: { ...acting().players, host: { chips: 800, bet: 10, hands, inRound: true, sittingOut: false, bustedOut: false } } });
    const html = render(bjRoom(v), 'host');
    const row = tagWith(html, 'my-hands-row');
    expect(row).toMatch(/class="bj-hands bj-hands--mine scroll-fade scroll-fade--x bj-hands--side bj-hands--grid"/);
    expect(attr(row, 'data-count')).toBe('12');
    expect(tagsWith(html, 'my-hand')).toHaveLength(12);
    expect(tagsWith(html, 'my-hand').map((t) => attr(t, 'data-active')).indexOf('true')).toBe(4);
    expect(html).not.toContain('bj-chip');
  });

  it('never opens the seat sheet on my own hands: they are my row on the stage', () => {
    const hands = Array.from({ length: 6 }, (_, i) => hand([c('8'), c('9', 'H')], { status: i === 0 ? 'acting' : 'waiting', fromSplit: true, bet: 10 }));
    const v = acting({ players: { ...acting().players, host: { chips: 800, bet: 10, hands, inRound: true, sittingOut: false, bustedOut: false } } });
    useBlackjackStore.getState().openSeat('host');
    const html = render(bjRoom(v), 'host');
    // Asked for my own seat, the sheet stays shut; my six hands are my row on the stage.
    expect(tagsWith(html, 'detail-hand')).toHaveLength(0);
    expect(tagsWith(html, 'my-hand')).toHaveLength(6);
  });
});

describe('the players grid', () => {
  /** A table of `n` seats, seat p<k> on turn; rendered for p0. */
  function bigTable(n: number, turn: number) {
    const ids = Array.from({ length: n }, (_, i) => `p${i}`);
    const players = Object.fromEntries(ids.map((id) => [id, { chips: 1000, bet: 10, hands: [hand([c('9'), c('7')], { total: 16, bet: 10 })], inRound: true, sittingOut: false, bustedOut: false }]));
    const big = acting({ order: ids, turn: { playerId: `p${turn}`, handIndex: 0 }, players, actions: NO_ACTIONS });
    return { ...bjRoom(big), players: ids.map((id, i) => player(id, { name: `Seat ${i}`, joinOrder: i })) };
  }

  it('steps the tiles down as the table grows, every other seat in seat order, the seat on turn ringed', () => {
    const cases: [number, string, boolean][] = [
      [2, 'full', true],
      [7, 'full', true],
      [9, 'compact', false],
      [12, 'small', false],
      [24, 'small', false],
      [25, 'dense', false],
      [50, 'dense', false],
    ];
    for (const [n, tier, cards] of cases) {
      const html = render(bigTable(n, n - 1), 'p0');
      const grid = tagWith(html, 'seats');
      expect(attr(grid, 'data-tier'), `${n} seats`).toBe(tier);
      const tiles = tagsWith(html, 'seat');
      expect(tiles, `${n} seats`).toHaveLength(n - 1);
      expect(tiles.map((t) => attr(t, 'data-player-id'))).toEqual(Array.from({ length: n - 1 }, (_, i) => `p${i + 1}`));
      const turn = tiles.filter((t) => attr(t, 'data-turn') === 'true');
      expect(turn.map((t) => attr(t, 'data-player-id')), `${n} seats`).toEqual([`p${n - 1}`]);
      expect(attr(turn[0], 'aria-current')).toBe('true');
      expect(turn[0]).toContain('tbl-tile--turn');
      expect(tagsWith(html, 'seat-hand').length > 0, `${n} seats: cards on the tiles`).toBe(cards);
      // Every tile shows the total, the stack and the bet; my own hands keep the stage.
      expect(tagsWith(html, 'seat-total')).toHaveLength(n - 1);
      expect(tagsWith(html, 'seat-chips')).toHaveLength(n - 1);
      expect(tagsWith(html, 'seat-bet')).toHaveLength(n - 1);
      expect(attr(tagWith(html, 'hand-stage'), 'data-player-id')).toBe('p0');
    }
  });

  it('tells the stack and the bet apart on every tile: the stack quiet on the left with its chip, "bet 10" on the right with its chips', () => {
    const drawn = render(bigTable(2, 1), 'p0');
    const marks = drawn.slice(drawn.indexOf('data-testid="seats"'), drawn.indexOf('</ul>')).match(/class="tbl-chipmark"/g) ?? [];
    expect(marks.length).toBeGreaterThanOrEqual(2);
    const full = drawn.replace(/<span class="tbl-chipmark" aria-hidden="true">(?:<svg.*?<\/svg>)+<\/span>/g, '');
    expect(full).toContain('<span class="tbl-tile__chips" data-testid="seat-chips" data-chips="1000">1,000</span><span class="tbl-tile__bet" data-testid="seat-bet" data-bet="10">bet 10</span>');
    const tiles = full.slice(full.indexOf('data-testid="seats"'), full.indexOf('</ul>'));
    expect(tiles).not.toContain('tbl-stake');
    // The panel's line says my stack in words.
    expect(full).toMatch(/data-testid="my-chips" data-chips="1000" aria-label="Balance 1000 chips"><span class="tbl-stackcount"[^>]*><span class="tbl-stackcount__value">1,000<\/span>/);
  });

  it('never lets 1,040 read like 1,000 on a tile: figures under 10,000 read whole, bigger ones short', () => {
    const table = bigTable(4, 1);
    const game = table.game;
    if (!game) throw new Error('no game');
    const at = (chips: number, bet: number) => ({ chips, bet, hands: [hand([c('9'), c('7')], { total: 16, bet })] });
    const view = { ...game, players: { ...game.players, p2: { ...game.players.p2, ...at(1040, 1040) }, p3: { ...game.players.p3, ...at(1_250_000, 50_000) } } };
    const html = render({ ...table, game: view }, 'p0').replace(/<span class="tbl-chipmark" aria-hidden="true">(?:<svg.*?<\/svg>)+<\/span>/g, '');
    expect(textOf(html.slice(html.indexOf('data-player-id="p2"')), 'seat-bet')).toBe('bet 1,040');
    const big = html.slice(html.indexOf('data-player-id="p3"'));
    expect(textOf(big, 'seat-chips')).toBe('1.3M');
    expect(textOf(big, 'seat-bet')).toBe('bet 50k');
    expect(tileFigures('small')).toBe('short');
  });

  it('a small or dense tile shows one total for split hands (the hand in play), a full or compact one joins them', async () => {
    const { tileTotal } = await import('./components/Seats');
    const split = acting({ turn: { playerId: 'bob', handIndex: 1 }, players: { ...acting().players, bob: { chips: 980, bet: 10, hands: [hand([c('10'), c('9'), c('2')], { total: 21, status: 'stood', fromSplit: true }), hand([c('10'), c('5')], { total: 15, status: 'acting', fromSplit: true })], inRound: true, sittingOut: false, bustedOut: false } } });
    const hands = tableOf(split)?.hands.bob ?? [];
    const tl = T.snapTimeline(tableOf(split), NOW);
    // Joined, the total carries the hand in play as its short form; one total alone has none.
    expect(tileTotal('bob', hands, tl, NOW, true, 1)).toMatchObject({ text: '21/15', short: '15' });
    expect(tileTotal('bob', hands, tl, NOW, true, 1, true)).toEqual({ text: '15', tone: 'active' });
    // Off turn: the best hand still standing.
    expect(tileTotal('bob', hands, tl, NOW, false, 0)).toMatchObject({ text: '21/15', short: '21' });
    expect(tileTotal('bob', hands, tl, NOW, false, 0, true)?.text).toBe('21');
    // On the tiles: a full tile and a compact one join both; a small one shows the hand in play's.
    for (const [n, tier, text] of [[3, 'full', '21/15'], [9, 'compact', '21/15'], [13, 'small', '15']] as const) {
      const table = bigTable(n, 1);
      const game = table.game;
      if (!game) throw new Error('no game');
      const p1 = { ...game.players.p1, hands: [hand([c('10'), c('9'), c('2')], { total: 21, bet: 10, status: 'stood', fromSplit: true }), hand([c('10'), c('5')], { total: 15, bet: 10, status: 'acting', fromSplit: true })] };
      const html = render({ ...table, game: { ...game, turn: { playerId: 'p1', handIndex: 1 }, players: { ...game.players, p1 } } }, 'p0');
      expect(attr(tagWith(html, 'seats'), 'data-tier'), `${n} seats`).toBe(tier);
      const tile = html.slice(html.indexOf('data-player-id="p1"'), html.indexOf('data-player-id="p2"'));
      expect(textOf(tile, 'seat-total'), `${n} seats`).toBe(text);
    }
  });

  it('marks each seat: on turn, still to act, done, bust, a natural, and the outcome once settled', async () => {
    const { seatLine, seatMark } = await import('./components/Seats');
    const v = acting({ order: ['host', 'bob'], turn: { playerId: 'bob', handIndex: 0 } });
    const hostHands = tableOf(v)?.hands.host ?? [];
    expect(seatMark(seatLine(v, 'bob', tableOf(v)?.hands.bob ?? [], false), [], false)).toBe('turn');
    expect(seatMark(seatLine(v, 'host', hostHands, false), hostHands, false)).toBe('done');
    const bust = hostHands.map((h) => ({ ...h, status: 'bust' as const }));
    expect(seatMark({ state: 'done', text: 'Bust', tone: 'quiet' }, bust, false)).toBe('loss');
    const settled = tableOf(nextBetting())?.hands.bob ?? [];
    expect(seatMark(seatLine(nextBetting(), 'bob', settled, true), settled, true)).toBe('loss');
    expect(seatMark(seatLine(view(), 'bob', [], false), [], false)).toBe('waiting');
  });

  it('a settled seat takes its outcome colour; tapping a tile opens its hands in a sheet', () => {
    const html = render(bjRoom(nextBetting()), 'host');
    const bob = tagWith(html, 'seat');
    expect(attr(bob, 'data-result')).toBe('loss');
    expect(bob).toContain('tbl-tile--loss');
    useBlackjackStore.getState().openSeat('bob');
    const open = render(bjRoom(nextBetting()), 'host');
    expect(attr(tagWith(open, 'seat-sheet'), 'aria-label')).toBe('Pia');
    expect(tagsWith(open, 'detail-hand')).toHaveLength(1);
  });
});

describe('settings rows', () => {
  const settings = { contentMode: 'family' as const, ...DEFAULT_BLACKJACK_SETTINGS };
  const fields = (s: typeof settings) => {
    if (!blackjackClient.SettingsFields) throw new Error('no settings fields');
    return renderToString(createElement(blackjackClient.SettingsFields, { settings: s, patch: () => undefined }));
  };

  it('has the starting chips as its only row: no house rules, rounds, bet limits, clocks or decks', () => {
    const host = fields(settings);
    const retired = ['blackjackPayout', 'dealerHitsSoft17', 'allowDouble', 'allowSplit', 'rounds', 'unlimitedRounds', 'minBet', 'maxBet', 'betSeconds', 'actSeconds', 'resultsSeconds', 'decks'];
    for (const id of retired) expect(tagsWith(host, `settings-${id}`), id).toHaveLength(0);
    expect(tagWith(host, 'settings-startingChips')).toBeTruthy();
    expect(host.match(/data-testid="settings-row-/g)).toHaveLength(1);
    expect(host).not.toMatch(/four hands|shoe|reshuffl|soft 17|6 to 5/i);
  });

  it('renders from a room stored with the retired keys, which it ignores', () => {
    const stored = { ...settings, blackjackPayout: '6:5', dealerHitsSoft17: true, allowDouble: false, allowSplit: false };
    expect(fields(stored)).toBe(fields(settings));
    const html = render(bjRoom(view(), { settings: stored }), 'host');
    expect(html).toContain('Blackjack pays 3 to 2');
    expect(html).toContain('Dealer stands on 17');
  });

  it('echoes no value beside a title: the chosen preset and the field show the chips', () => {
    const host = fields(settings);
    expect(host).not.toContain('setting__value');
    expect(tagsWith(host, 'settings-value-startingChips')).toHaveLength(0);
    expect(attr(tagWith(host, 'settings-startingChips-1000'), 'aria-pressed')).toBe('true');
  });
});

describe('player-list hooks', () => {
  it('badges the acting player and the busted out, and tags the bets', () => {
    const state = bjRoom(acting());
    const hana = state.players[0];
    expect(renderToString(createElement('div', null, blackjackClient.playerBadge?.(state, hana)))).toContain('Playing their hand');
    expect(blackjackClient.playerClassName?.(state, hana)).toBe('player--acting');
    expect(renderToString(createElement('div', null, blackjackClient.playerMeta?.(state, hana)))).toContain('bet 50');
    const out = bjRoom(view({ players: { ...view().players, bob: { chips: 5, bet: 0, hands: [], inRound: false, sittingOut: false, bustedOut: true } } }));
    expect(blackjackClient.playerClassName?.(out, out.players[1])).toBe('player--out');
  });
});

describe('a tap waiting for its answer', () => {
  function recordSends(): unknown[] {
    const sent: unknown[] = [];
    vi.spyOn(socket, 'send').mockImplementation((msg: unknown) => {
      sent.push(msg);
      return true;
    });
    return sent;
  }

  it('aims a move at the round, the hand in play and the cards I hold', () => {
    const sent = recordSends();
    expect(P.moveTarget(acting(), 'host')).toEqual({ round: 2, handIndex: 0, cards: 2 });
    A.playMove('hit', acting(), 'host');
    expect(sent).toEqual([{ t: 'hit', round: 2, handIndex: 0, cards: 2 }]);
    vi.restoreAllMocks();
  });

  it('holds every control, the pressed move shown pressed, until a snapshot answers it', () => {
    recordSends();
    A.playMove('hit', acting(), 'host');
    const pending = useBlackjackStore.getState().pending;
    expect(pending).toMatchObject({ kind: 'hit' });
    const html = render(bjRoom(acting()), 'host');
    for (const id of ['action-hit', 'action-stand', 'action-split', 'action-double']) expect(disabled(html, id), id).toBe(true);
    expect(attr(tagWith(html, 'action-hit'), 'data-sent')).toBe('true');
    // The same table again is no answer; my new card is.
    if (!pending) throw new Error('no pending move');
    expect(P.answered(pending, acting(), 'host')).toBe(false);
    const hit = acting({ players: { ...acting().players, host: { ...acting().players.host, hands: [hand([c('8'), c('8', 'D'), c('2')], { total: 18, status: 'acting' })] } } });
    expect(P.answered(pending, hit, 'host')).toBe(true);
    blackjackClient.onRoom?.(bjRoom(hit), bjRoom(acting()));
    expect(useBlackjackStore.getState().pending).toBeNull();
    // Answered: nothing is shown pressed any more (the new card still slides in before the moves light up).
    expect(attr(tagWith(render(bjRoom(hit), 'host'), 'action-hit'), 'data-sent')).toBeUndefined();
    vi.restoreAllMocks();
  });

  it('lets go of the controls on its own after PENDING_MS, on a refusal and on a rejoin', async () => {
    vi.useFakeTimers();
    const { PENDING_MS } = await import('./store');
    recordSends();
    A.playMove('stand', acting(), 'host');
    vi.advanceTimersByTime(PENDING_MS - 1);
    expect(useBlackjackStore.getState().pending).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(useBlackjackStore.getState().pending).toBeNull();
    A.playMove('stand', acting(), 'host');
    blackjackClient.onError?.('NOT_ALLOWED', 'You cannot double this hand.');
    expect(useBlackjackStore.getState().pending).toBeNull();
    A.playMove('stand', acting(), 'host');
    blackjackClient.onWelcome?.(undefined);
    expect(useBlackjackStore.getState().pending).toBeNull();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('shows Bet placed the moment Bet is tapped, and sends the round with it', () => {
    const sent = recordSends();
    A.placeBet(50, view(), 'host');
    expect(sent).toEqual([{ t: 'bet', amount: 50, round: 2 }]);
    const html = render(bjRoom(view()), 'host');
    expect(textOf(html, 'place-bet')).toBe('Bet placed');
    expect(disabled(html, 'place-bet')).toBe(true);
    expect(attr(tagWith(html, 'place-bet'), 'data-sent')).toBe('true');
    // The table counts my bet in at once: the line and Bet never disagree.
    expect(textOf(html, 'bets-count')).toBe('1 of 2 bets in');
    expect(html).not.toContain('>Place your bet<');
    vi.restoreAllMocks();
  });

  it('takes a Bet tapped once the outcomes are up, before the bets open, and sends it as they open', () => {
    const sent = recordSends();
    const results = nextBetting({ phase: 'results', round: 2, order: [], waitingFor: [] });
    A.queueBet(40, results);
    expect(useBlackjackStore.getState().queuedBet).toEqual({ round: 3, amount: 40 });
    expect(textOf(render(bjRoom(results), 'host'), 'place-bet')).toBe('Bet placed');
    expect(sent).toEqual([]);
    // The bets open: it goes out at once, for that round.
    blackjackClient.onRoom?.(bjRoom(nextBetting()), bjRoom(results));
    expect(sent).toEqual([{ t: 'bet', amount: 40, round: 3 }]);
    expect(useBlackjackStore.getState().queuedBet).toBeNull();
    vi.restoreAllMocks();
  });

  it('drops a queued bet the game moved past (it ended instead)', () => {
    const sent = recordSends();
    const results = nextBetting({ phase: 'results', round: 2, order: [], waitingFor: [] });
    render(bjRoom(results), 'host');
    A.queueBet(40, results);
    blackjackClient.onRoom?.(bjRoom(nextBetting({ phase: 'ending', round: 2 })), bjRoom(results));
    expect(useBlackjackStore.getState().queuedBet).toBeNull();
    expect(sent).toEqual([]);
    vi.restoreAllMocks();
  });

  it('takes a Bet tapped while the reveal still plays: one bet goes out at once, or waits for the bets to open', async () => {
    const { betTap } = await import('./components/ControlPanel');
    const sent = recordSends();
    const settled = nextBetting();
    // The reveal is planned from the hand in play to the settled table: the outcomes are not up yet.
    useBlackjackStore.getState().applyView(acting(), Date.now(), true, true);
    useBlackjackStore.getState().applyView(settled, Date.now(), false, true);
    const html = render(bjRoom(settled), 'bob');
    expect(html).toContain('>Dealer’s turn<');
    expect(disabled(html, 'place-bet')).toBe(false);
    expect(attr(tagWith(html, 'place-bet'), 'aria-disabled')).toBeUndefined();
    // The server already takes bets: the tap places one now.
    const opts = { canSend: true, held: false, queued: false };
    expect(betTap(settled, 'bob', 50, opts)).toBe('place');
    A.placeBet(50, settled, 'bob');
    expect(sent).toEqual([{ t: 'bet', amount: 50, round: 3 }]);
    expect(textOf(render(bjRoom(settled), 'bob'), 'place-bet')).toBe('Bet placed');
    // A second tap finds Bet held: still one bet.
    expect(betTap(settled, 'bob', 50, { ...opts, held: useBlackjackStore.getState().pending !== null })).toBeNull();
    // Outcomes on the server, bets not open yet: the tap is kept for them.
    const results = nextBetting({ phase: 'results', round: 2, order: [], waitingFor: [] });
    expect(betTap(results, 'host', 40, opts)).toBe('queue');
    expect(betTap(results, 'host', 40, { ...opts, queued: true })).toBeNull();
    // Not on offer at all: on my turn, offline, or with nothing to bet.
    expect(betTap(acting(), 'host', 40, opts)).toBeNull();
    expect(betTap(settled, 'host', 40, { ...opts, canSend: false })).toBeNull();
    expect(betTap(settled, 'host', null, opts)).toBeNull();
    vi.restoreAllMocks();
  });

  it('waits for my own cards only before my moves go', () => {
    const at = Date.now();
    useBlackjackStore.getState().applyView(view(), at, true, true);
    useBlackjackStore.getState().applyView(acting(), at, false, true);
    const { timeline, table } = useBlackjackStore.getState();
    expect(T.myHandLanded(timeline, table, 'host', 0, at)).toBe(false);
    // The host's two cards and the dealer's up card land before bob's second card and the hole card.
    const mine = ['host/0/0/8S', 'd0', 'host/0/1/8D'].map((key) => (timeline.arrivals[key] ?? 0) + T.DEAL_MS);
    const ready = Math.max(...mine);
    expect(T.myHandLanded(timeline, table, 'host', 0, ready)).toBe(true);
    expect(ready).toBeLessThan(timeline.endsAt);
  });

  it('does not hold the next deal for the last outcomes when my own bet dealt it', () => {
    const at = Date.now();
    const store = useBlackjackStore.getState();
    store.applyView(acting(), at, true, true);
    store.applyView(nextBetting(), at, false, true);
    const outcomes = T.outcomesAt(useBlackjackStore.getState().timeline) ?? at;
    recordSends();
    A.placeBet(50, nextBetting(), 'host');
    const deal = acting({ round: 3 });
    useBlackjackStore.getState().applyView(deal, outcomes, false, true);
    expect(useBlackjackStore.getState().timeline.discard?.from).toBe(outcomes);
    vi.restoreAllMocks();
  });

  it('shows a seat the table waits on whose phone went quiet as away, and says so on their turn', () => {
    const quiet = acting({ turn: { playerId: 'bob', handIndex: 0 }, away: ['bob'], controls: { ...NO_CONTROLS, canSkip: true } });
    const html = render(bjRoom(quiet), 'host');
    expect(html).toContain('>Pia is away<');
    expect(tagsWith(html, 'skip-turn')).toHaveLength(1);
    expect(seatLine(quiet, 'bob', [], false)).toMatchObject({ state: 'away', text: 'Away' });
    expect(seatLine(quiet, 'host', [], false).state).not.toBe('away');
  });
});

describe('my split hands in a grid (planGrid)', () => {
  const base = { solo: 96, step: 0.44, handK: 1.67, pill: 36, foot: 18, least: 85, gapX: 8, gapY: 6 };
  const fits = (fit: Parameters<typeof H.planGrid>[0], p: ReturnType<typeof H.planGrid>) => {
    expect(p.cols * p.cell + (p.cols - 1) * fit.gapX).toBeLessThanOrEqual(fit.width);
    expect(p.height).toBeLessThanOrEqual(fit.height);
    expect(p.cell).toBeGreaterThanOrEqual(Math.max(fit.least, 6 + p.card * (1 + fit.step * (Math.max(...fit.fans) - 1))) - 1);
    expect(p.cols * p.rows).toBeGreaterThanOrEqual(fit.fans.length);
  };
  it('keeps two hands that fit in one row at the solo size', () => {
    const fit = { ...base, width: 760, height: 260, fans: [2, 2] };
    expect(H.planGrid(fit)).toMatchObject({ cols: 2, rows: 1, card: 96 });
  });
  it('wraps six hands on a wide stage into rows, with cards far larger than one row allows (the screenshot)', () => {
    const fit = { ...base, width: 760, height: 560, fans: [2, 2, 3, 2, 2, 2] };
    const p = H.planGrid(fit);
    expect(p.rows).toBeGreaterThan(1);
    expect(p.card).toBeGreaterThanOrEqual(64);
    fits(fit, p);
  });
  it('stays in one row where the height does not pay for a second', () => {
    const fit = { ...base, width: 760, height: 230, fans: [2, 2, 2, 2] };
    expect(H.planGrid(fit).rows).toBe(1);
  });
  it('never takes a row whose cells are narrower than a hand\'s words while more rows fit them', () => {
    const fit = { ...base, pill: 24, foot: 12, least: 59, width: 356, height: 173, fans: Array(6).fill(2) };
    const p = H.planGrid(fit);
    expect(p.cell).toBeGreaterThanOrEqual(59);
    fits(fit, p);
  });
  it('fits eight hands on a 320px phone with no row scrolling', () => {
    const fit = { ...base, pill: 22, foot: 11, least: 55, width: 304, height: 300, fans: Array(8).fill(3) };
    const p = H.planGrid(fit);
    expect(p.card).toBeGreaterThanOrEqual(24);
    fits(fit, p);
  });
});

describe('a move picked before my turn', () => {
  const bobTurn = (actions: Partial<BlackjackActions>, overrides: Partial<BlackjackView> = {}) =>
    acting({
      turn: { playerId: 'bob', handIndex: 0 },
      players: { ...acting().players, host: { ...acting().players.host, hands: [hand([c('8'), c('8', 'D')], { total: 16, status: 'stood' })] }, bob: { ...acting().players.bob, hands: [hand([c('9'), c('10', 'C')], { total: 19, bet: 20, status: 'acting' })] } },
      actions: { ...NO_ACTIONS, ...actions },
      ...overrides,
    });
  function recordSends(): unknown[] {
    const sent: unknown[] = [];
    vi.spyOn(socket, 'send').mockImplementation((msg: unknown) => {
      sent.push(msg);
      return true;
    });
    return sent;
  }

  it('can be picked only while I am dealt in and someone else plays', () => {
    expect(PM.canPremove(acting(), 'bob')).toBe(true);
    expect(PM.canPremove(acting(), 'host')).toBe(false);
    expect(PM.canPremove(view(), 'bob')).toBe(false);
  });

  it('plays the moment my turn starts', () => {
    const sent = recordSends();
    usePlatformStore.setState({ playerId: 'bob' });
    useBlackjackStore.getState().setPremove({ kind: 'stand', round: 2 });
    blackjackClient.onRoom?.(bjRoom(bobTurn({ canHit: true, canStand: true, canDouble: true })), bjRoom(acting()));
    expect(sent).toEqual([{ t: 'stand', round: 2, handIndex: 0, cards: 2 }]);
    expect(useBlackjackStore.getState().premove).toBeNull();
    vi.restoreAllMocks();
  });

  it('drops an illegal pick without a word: Split with no pair', () => {
    const sent = recordSends();
    usePlatformStore.setState({ playerId: 'bob' });
    useBlackjackStore.getState().setPremove({ kind: 'split', round: 2 });
    blackjackClient.onRoom?.(bjRoom(bobTurn({ canHit: true, canStand: true, canDouble: true })), bjRoom(acting()));
    expect(sent).toEqual([]);
    expect(useBlackjackStore.getState().premove).toBeNull();
    vi.restoreAllMocks();
  });

  it('is for my first hand only, and a new round clears it', () => {
    expect(PM.premoveStep({ kind: 'hit', round: 2 }, bobTurn({ canHit: true }, { turn: { playerId: 'bob', handIndex: 1 } }), 'bob')).toBe('drop');
    expect(PM.premoveStep({ kind: 'hit', round: 2 }, acting(), 'bob')).toBe('keep');
    expect(PM.premoveStep({ kind: 'hit', round: 2 }, view({ round: 3 }), 'bob')).toBe('drop');
  });

  it('the moves light for a pick off my turn, the pick ticked with aria-pressed and a label for my turn', () => {
    useBlackjackStore.getState().setPremove({ kind: 'stand', round: 2 });
    const html = render(bjRoom(acting()), 'bob');
    for (const id of ['action-hit', 'action-stand', 'action-split', 'action-double']) expect(disabled(html, id), id).toBe(false);
    expect(attr(tagWith(html, 'action-stand'), 'aria-pressed')).toBe('true');
    expect(attr(tagWith(html, 'action-stand'), 'data-queued')).toBe('true');
    expect(attr(tagWith(html, 'action-hit'), 'aria-pressed')).toBe('false');
    expect(attr(tagWith(html, 'action-stand'), 'aria-label')).toBe('Stand when it’s my turn');
  });
});
