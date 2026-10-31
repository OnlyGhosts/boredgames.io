/**
 * Poker's server module: no-limit Texas Hold'em as a pure reducer over PokerData. Chips are the
 * score: every chip movement is a score effect, so the results rank the stacks.
 */
import {
  DEFAULT_POKER_SETTINGS,
  normalizePokerSettings,
  pokerClientMessageSchema,
  pokerSettingsSchema,
  type PokerClientMessage,
  type PokerServerMessage,
  type PokerSettings,
  type PokerView,
} from '../../../shared/games/poker/protocol.js';
import { gameById } from '../../../shared/platform/games.js';
import { defineSettings, withDraft, type GameEvent, type GameResult, type GameServerModule, type GameStanding } from '../../platform/game.js';
import { actTimedOut, foldGone, playerMove } from './betting.js';
import { beginHand, endGame, next, resumeIfHeld, seatPlayer, settleDue, snapshotOrResume } from './hand.js';
import { findPlayer, removeSeat, stackedPlayers, type Ctx, type Gx, type PokerData, type SeatData } from './state.js';
import { viewFor } from './view.js';

type Result = GameResult<PokerData, PokerServerMessage>;

function start(ctx: Ctx): Result {
  // The seed is an empty results screen, so the first hand is held like any other should too few be connected.
  const seed: PokerData = {
    phase: { kind: 'results', endsAt: ctx.now, held: false, resumeAt: null },
    hand: 0,
    smallBlind: ctx.settings.smallBlind,
    seats: {},
    order: [],
    dealerId: null,
    dealerOrder: null,
    street: null,
    community: [],
    deck: [],
    highest: 0,
    minRaise: 0,
    toAct: [],
    answered: {},
    stackLeft: false,
    results: null,
    acted: false,
    idleHands: 0,
    lastMove: null,
  };
  return withDraft(seed, (data, effects) => {
    const gx: Gx = { ctx, data, effects, shown: { hand: 0, board: 0 } };
    for (const p of stackedPlayers(ctx, data)) seatPlayer(gx, p.id);
    beginHand(gx);
  });
}

function handle(ctx: Ctx, data: PokerData, event: GameEvent<PokerClientMessage>): Result {
  if (data.phase.kind === 'gameOver') return { data, effects: [] };
  return withDraft(data, (draft, effects) => {
    const gx: Gx = { ctx, data: draft, effects, shown: { hand: draft.hand, board: draft.community.length } };
    switch (event.type) {
      case 'message':
        return onMessage(gx, event.playerId, event.msg);
      case 'chat':
        return;
      case 'playerLeft':
        return onPlayerLeft(gx, event.playerId);
      case 'playerDisconnected':
      case 'playerReconnected':
        // Mid-hand nothing changes: a move waits for its clock. Between hands the hold is re-evaluated.
        if (findPlayer(ctx, event.playerId)) resumeIfHeld(gx);
        return;
      case 'tick':
        return onTick(gx);
    }
  });
}

function onMessage(gx: Gx, playerId: string, msg: PokerClientMessage): void {
  switch (msg.t) {
    case 'fold':
    case 'check':
    case 'call':
    case 'bet':
    case 'raise':
    case 'allIn':
      return playerMove(gx, playerId, msg);
    case 'next':
      return next(gx, playerId, msg.hand);
  }
}

/** A seat in the hand folds and leaves its chips behind; between hands the boundary is re-evaluated. */
function onPlayerLeft(gx: Gx, playerId: string): void {
  const { data } = gx;
  if (data.phase.kind === 'acting' && data.order.includes(playerId)) return foldGone(gx, playerId);
  removeSeat(data, playerId);
  snapshotOrResume(gx);
}

function onTick(gx: Gx): void {
  const { data, ctx } = gx;
  const due = nextDeadline(data);
  if (due === null || ctx.now < due) return;
  switch (data.phase.kind) {
    case 'acting':
      return actTimedOut(gx);
    case 'results':
      return data.phase.held ? settleDue(gx) : beginHand(gx);
    case 'gameOver':
      return;
  }
}

function nextDeadline(data: PokerData): number | null {
  switch (data.phase.kind) {
    case 'acting':
      return data.phase.endsAt;
    case 'results':
      return data.phase.held ? data.phase.resumeAt : data.phase.endsAt;
    case 'gameOver':
      return null;
  }
}

/** Out of chips: the hand they went out in ranks them and says how long they lasted (one out before the hand was kept ranks first out). */
function standing(data: PokerData, playerId: string): GameStanding {
  const seat = data.seats[playerId];
  if (!seat || (seat.outHand === undefined && seat.chips > 0)) return {};
  return seat.outHand === undefined ? { wentOut: 0 } : { wentOut: seat.outHand, note: `Out in hand ${seat.outHand}` };
}

/**
 * A seat's best moment for the results: its highest stack, when that beat the starting stack and
 * the final one (nobody reads "Peaked at 1,000", nor a peak that repeats the score beside it).
 */
function peakOf(seat: SeatData | undefined, start: number): GameStanding {
  return seat?.peak !== undefined && seat.peak > Math.max(start, seat.chips) ? { peak: seat.peak } : {};
}

export const pokerModule: GameServerModule<PokerSettings, PokerData, PokerView, PokerClientMessage, PokerServerMessage> = {
  meta: gameById('poker'),
  settings: defineSettings(pokerSettingsSchema, DEFAULT_POKER_SETTINGS, normalizePokerSettings),
  clientMessageSchema: pokerClientMessageSchema,
  start,
  handle,
  nextDeadline,
  view: viewFor,
  hostMessages: new Set(['next']),
  end: (ctx, data) => withDraft(data, (draft, effects) => endGame({ ctx, data: draft, effects, shown: { hand: draft.hand, board: draft.community.length } })),
  // One deck seats TABLE_SEATS: the extras wait for a seat in join order (stackedPlayers).
  queuesSeats: true,
  // A player who never got a seat never played: they stay out of the results.
  ranks: (data, playerId) => data.seats[playerId] !== undefined,
  // How they went out, with their best moment.
  standing: (data, playerId, settings) => ({ ...standing(data, playerId), ...peakOf(data.seats[playerId], settings.startingChips) }),
  milestone: (data) => `${data.hand}:${data.street ?? ''}:${data.phase.kind}:${data.toAct[0] ?? ''}`,
};

export type { PokerData };
