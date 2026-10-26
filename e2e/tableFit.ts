import { expect, type Page } from '@playwright/test';

/**
 * The card tables' players grid reads at every size: every total badge (Blackjack's hand total,
 * Poker's stack), stack in words, bet pill and seat line ("BB 10") a tile shows sits wholly inside
 * it, is never cut short (an ellipsis, or a figure running out of its box: "100,000 chips" on a full
 * tile three across a 360px phone, "Raise t…" beside a 12k pill) and never lies over another of
 * them or over the name or the dealer button (a bet pill once ran under the hand's total on a 66px
 * phone tile and lost its figure; three chips, a plus and "12,000" once pushed the stack under the
 * name on a 218px tile); the status badge on the avatar keeps at least 1px clear of all of them (a
 * tick once ran into "1,150 chips" on a desktop's final table); and no tile is squeezed under
 * `minHeight` px (a desktop big table once gave its tiles 8 to 14px). A long name may end in an
 * ellipsis.
 */
export async function tilesReadable(page: Page, label: string, minHeight = 0): Promise<void> {
  const read = () =>
    page.evaluate((min) => {
      const tiles = Array.from(document.querySelectorAll('[data-testid="seat"]'));
      const cut: string[] = [];
      let short = 0;
      const truncated: string[] = [];
      const overlap: string[] = [];
      for (const tile of tiles) {
        const t = tile.getBoundingClientRect();
        if (t.height < min) short++;
        const shown: { where: string; r: DOMRect }[] = [];
        // The status pill (the line inside it) is read as one; on a crowd tile, the line alone.
        for (const part of Array.from(tile.querySelectorAll<HTMLElement>('.tbl-tile__name-text, [data-testid="seat-dealer"], [data-testid="seat-total"], [data-testid="seat-chips"], [data-testid="seat-bet"], [data-testid="seat-pill"], [data-testid="seat-line"]:not([data-testid="seat-pill"] *)'))) {
          const r = part.getBoundingClientRect();
          // Hidden by the tile's tier (display: none on it or its box) or empty: nothing to read.
          if (r.width === 0 || r.height === 0) continue;
          const where = `${(tile as HTMLElement).dataset.name}: ${part.dataset.testid ?? part.className} "${part.textContent}"`;
          if (r.left < t.left - 1 || r.right > t.right + 1 || r.top < t.top - 1 || r.bottom > t.bottom + 1) cut.push(where);
          else if (!part.matches('.tbl-tile__name-text') && part.scrollWidth > part.clientWidth + 1) truncated.push(where);
          shown.push({ where, r });
        }
        // The line inside the pill: in full, never cut.
        const inPill = tile.querySelector<HTMLElement>('[data-testid="seat-pill"] [data-testid="seat-line"]');
        if (inPill && inPill.scrollWidth > inPill.clientWidth + 1) truncated.push(`${(tile as HTMLElement).dataset.name}: seat-line "${inPill.textContent}"`);
        // No two of them on top of each other: a half-pixel touch is allowed, any real overlap is not.
        const meet = (a: DOMRect | { left: number; right: number; top: number; bottom: number }, b: DOMRect) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5;
        for (let i = 0; i < shown.length; i++) {
          for (let j = i + 1; j < shown.length; j++) {
            if (meet(shown[i].r, shown[j].r)) overlap.push(`${shown[i].where} over ${shown[j].where}`);
          }
        }
        // The badge on the avatar (a tick, a star, a dot) keeps 1px clear of every one of them.
        const mark = tile.querySelector<HTMLElement>('.tbl-tile__mark');
        const m = mark?.getBoundingClientRect();
        if (mark && m && m.width > 0 && m.height > 0) {
          const near = { left: m.left - 1, right: m.right + 1, top: m.top - 1, bottom: m.bottom + 1 };
          for (const part of shown) if (meet(near, part.r)) overlap.push(`${(tile as HTMLElement).dataset.name}: the ${(tile as HTMLElement).dataset.mark} badge against ${part.where}`);
        }
      }
      return { cut, short, truncated, overlap };
    }, minHeight);
  await expect.poll(read, { message: `${label}: every tile’s name, dealer button, total, stack, bet and line inside it, in full and clear of each other, no tile under ${minHeight}px` }).toEqual({ cut: [], short: 0, truncated: [], overlap: [] });
}

/**
 * Every card's corner (its rank and suit) on the stage, and with `dealer` on the dealer's row too,
 * reads whole: nothing else there lies over it (the hand's total, the stake pill, how the hand ended,
 * an owner's name, the dealer button, where I stand, a folded hand's chip), no later card of its fan
 * covers it, and it is inside the stage. A "10" once lost its top under a "+12k" pill on a 360px phone.
 */
export async function cornersClear(page: Page, label: string, { dealer = false }: { dealer?: boolean } = {}): Promise<void> {
  const read = () =>
    page.evaluate((withDealer) => {
      const covered: string[] = [];
      const scopes = [document.querySelector<HTMLElement>('[data-testid="hand-stage"]'), withDealer ? document.querySelector<HTMLElement>('[data-testid="dealer-area"]') : null];
      const meet = (a: { left: number; right: number; top: number; bottom: number }, b: DOMRect) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5;
      const shown = (el: Element) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      for (const scope of scopes) {
        if (!scope) continue;
        const box = scope.getBoundingClientRect();
        const words = Array.from(scope.querySelectorAll('.tbl-hand__head > *, .tbl-hand__head .tbl-stake, .tbl-hand__head .pk-dealer, .bj-chip, .bj-empty__stake')).filter(shown);
        for (const card of Array.from(scope.querySelectorAll<HTMLElement>('.playing-card[data-face="up"]'))) {
          const parts = Array.from(card.querySelectorAll('.playing-card__corner > *')).map((p) => p.getBoundingClientRect());
          if (parts.length === 0) continue;
          const corner = { left: Math.min(...parts.map((p) => p.left)), right: Math.max(...parts.map((p) => p.right)), top: Math.min(...parts.map((p) => p.top)), bottom: Math.max(...parts.map((p) => p.bottom)) };
          const name = `${scope.dataset.testid}: ${card.dataset.rank}${card.dataset.suit}`;
          for (const w of words) if (meet(corner, w.getBoundingClientRect())) covered.push(`${name} under "${(w as HTMLElement).innerText?.replace(/\s+/g, ' ') ?? w.className}"`);
          const fan = Array.from(card.closest('.tbl-fan')?.querySelectorAll('.playing-card') ?? []);
          for (const later of fan.slice(fan.indexOf(card) + 1)) if (meet(corner, later.getBoundingClientRect())) covered.push(`${name} under a later card`);
          // A card in a row that scrolls sideways (Blackjack's hands) is in its place anywhere the row scrolls to.
          const row = card.closest<HTMLElement>('.scroll-fade--x');
          const rowBox = row && scope.contains(row) ? row.getBoundingClientRect() : null;
          const reach = row && rowBox ? { left: rowBox.left - row.scrollLeft, right: rowBox.left - row.scrollLeft + row.scrollWidth, top: box.top, bottom: box.bottom } : box;
          if (corner.left < reach.left - 0.5 || corner.right > reach.right + 0.5 || corner.top < reach.top - 0.5 || corner.bottom > reach.bottom + 0.5) covered.push(`${name} off its place`);
        }
      }
      return covered;
    }, dealer);
  await expect.poll(read, { message: `${label}: every card’s rank and suit in full, nothing over them` }).toEqual([]);
}

/** My hand at the bottom of the table is wholly on screen. */
export async function myAreaOnScreen(page: Page, testId: string, label: string): Promise<void> {
  const read = () =>
    page.evaluate((id) => {
      const el = document.querySelector(`[data-testid="${id}"]`);
      if (!el) return true;
      const r = el.getBoundingClientRect();
      return r.top >= -1 && r.bottom <= window.innerHeight + 1 && r.left >= -1 && r.right <= window.innerWidth + 1;
    }, testId);
  await expect.poll(read, { message: `${label}: my hand is on screen` }).toBe(true);
}

/**
 * Every seat's stack and bet, where the tile shows them, are a real size and wholly inside it, and
 * a tile short of room drops them in a fixed order: the stack first, then the bet. A tile that
 * shows the bet of a seat with a stake, or has dropped it, never shows the stack without it.
 */
export async function stakesShown(page: Page, label: string): Promise<void> {
  const read = () =>
    page.evaluate(() => {
      const missing: string[] = [];
      for (const tile of Array.from(document.querySelectorAll<HTMLElement>('[data-testid="seat"]'))) {
        const t = tile.getBoundingClientRect();
        const shown = (el: Element | null) => {
          if (!el) return false;
          const r = el.getBoundingClientRect();
          return r.width > 4 && r.height > 4 && r.left >= t.left - 1 && r.right <= t.right + 1 && r.top >= t.top - 1 && r.bottom <= t.bottom + 1;
        };
        const visible = (el: Element | null) => el !== null && el.getBoundingClientRect().width > 0;
        const chips = tile.querySelector('[data-testid="seat-chips"]');
        const stake = tile.querySelector('[data-testid="seat-bet"]');
        const bet = Number(stake?.getAttribute('data-bet') ?? 0);
        if (visible(chips) && !shown(chips)) missing.push(`${tile.dataset.name}: chips cut`);
        if (bet > 0 && visible(stake) && !shown(stake)) missing.push(`${tile.dataset.name}: bet cut`);
        if (bet > 0 && visible(chips) && !visible(stake)) missing.push(`${tile.dataset.name}: the bet dropped before the stack`);
      }
      return missing;
    });
  await expect.poll(read, { message: `${label}: every seat’s stack and bet on show` }).toEqual([]);
}

/**
 * What every opponent's tile shows, whatever the table's size: its cards (every card it holds, a
 * Blackjack hand with its total, a folded Poker seat's empty places), its bet when it has one and
 * its stack, each wholly inside the tile, never cut, never under or over another of them; the cards
 * at least `card` px wide (24 on a phone, 32 on a desktop), the big total at least 22px, the status
 * pill inside the tile (on a full tile, in its header). A row of split hands too wide for its tile
 * slides to the hand in play: that hand is wholly in view.
 */
export async function seatFloors(page: Page, label: string, card: number): Promise<void> {
  const read = () =>
    page.evaluate((floor) => {
      const bad: string[] = [];
      const inside = (r: DOMRect, b: DOMRect) => r.left >= b.left - 0.5 && r.right <= b.right + 0.5 && r.top >= b.top - 0.5 && r.bottom <= b.bottom + 0.5;
      const meet = (a: DOMRect, b: DOMRect) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5;
      const shown = (el: Element | null): DOMRect | null => {
        const r = el?.getBoundingClientRect();
        return r && r.width > 0 && r.height > 0 ? r : null;
      };
      for (const tile of Array.from(document.querySelectorAll<HTMLElement>('[data-testid="seat"]'))) {
        const name = tile.dataset.name;
        const t = tile.getBoundingClientRect();
        if (!tile.matches('.tbl-tile--full, .tbl-tile--compact')) {
          bad.push(`${name}: a crowd's chip, not a seat tile`);
          continue;
        }
        // The stack, and the bet when there is one: shown, inside the tile, never cut.
        const parts: [string, DOMRect][] = [];
        const chips = tile.querySelector<HTMLElement>('[data-testid="seat-chips"]');
        const c = shown(chips);
        if (!c) bad.push(`${name}: no stack`);
        else if (!inside(c, t)) bad.push(`${name}: the stack off the tile`);
        else parts.push(['stack', c]);
        const stake = tile.querySelector<HTMLElement>('[data-testid="seat-bet"]');
        if (stake && Number(stake.dataset.bet) > 0) {
          const b = shown(stake);
          const text = stake.querySelector<HTMLElement>('.tbl-tile__bet-text');
          if (!b || !text?.textContent) bad.push(`${name}: no bet`);
          else if (!inside(b, t)) bad.push(`${name}: the bet off the tile`);
          else if (text.scrollWidth > text.clientWidth + 1) bad.push(`${name}: the bet cut`);
          else parts.push(['bet', b]);
        }
        // The cards: every one it holds, at least the floor wide, inside the tile and the box that clips them.
        const held = Number(tile.dataset.cards ?? 0);
        const box = tile.querySelector<HTMLElement>('[data-testid="seat-cards"]');
        const bx = shown(box);
        if ((held > 0 || tile.dataset.status === 'folded') && !bx) bad.push(`${name}: no cards`);
        if (bx && box) {
          if (!inside(bx, t)) bad.push(`${name}: the cards off the tile`);
          parts.push(['cards', bx]);
          const row = box.querySelector<HTMLElement>('.scroll-fade--x');
          const slides = row !== null && row.scrollWidth > row.clientWidth + 1;
          const cards = Array.from(box.querySelectorAll<HTMLElement>('.playing-card')).filter((el) => shown(el) && !el.closest('.tbl-flip__back'));
          if (held > 0 && cards.length === 0) bad.push(`${name}: no card drawn`);
          for (const el of cards) {
            const r = el.getBoundingClientRect();
            if (r.width < floor - 0.5) bad.push(`${name}: a ${r.width.toFixed(1)}px card`);
            if (r.top < t.top - 0.5 || r.bottom > t.bottom + 0.5 || r.top < bx.top - 0.5 || r.bottom > bx.bottom + 0.5) bad.push(`${name}: a card cut top or bottom`);
            // In a row that slides, the hand in play is in view; elsewhere every card is.
            const lit = el.closest('.bj-hand[data-active="true"]');
            if ((!slides || lit) && (r.left < bx.left - 0.5 || r.right > bx.right + 0.5)) bad.push(`${name}: a card cut at the side`);
          }
          // A Blackjack hand says its total beside it, big.
          if (box.querySelector('[data-testid="seat-hand"]')) {
            const total = tile.querySelector<HTMLElement>('[data-testid="seat-total"]');
            const r = shown(total);
            if (!r || !total) bad.push(`${name}: no total`);
            else {
              if (!inside(r, t)) bad.push(`${name}: the total off the tile`);
              const text = total.querySelector<HTMLElement>('.tbl-tile__total-text');
              if (text && text.scrollWidth > text.clientWidth + 1) bad.push(`${name}: the total cut`);
              if (!total.hasAttribute('data-long') && parseFloat(getComputedStyle(total).fontSize) < 22) bad.push(`${name}: a ${getComputedStyle(total).fontSize} total`);
              parts.push(['total', r]);
            }
          }
        }
        const head = tile.querySelector('.tbl-tile__head')?.getBoundingClientRect();
        const pill = shown(tile.querySelector('[data-testid="seat-pill"]'));
        if (pill) {
          if (!inside(pill, t)) bad.push(`${name}: the pill off the tile`);
          if (tile.classList.contains('tbl-tile--full') && head && (pill.top < head.top - 0.5 || pill.bottom > head.bottom + 0.5)) bad.push(`${name}: the pill off the header`);
          parts.push(['pill', pill]);
        }
        const nameBox = shown(tile.querySelector('.tbl-tile__name'));
        if (nameBox) parts.push(['name', nameBox]);
        for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) if (meet(parts[i][1], parts[j][1])) bad.push(`${name}: the ${parts[i][0]} over the ${parts[j][0]}`);
      }
      return bad;
    }, card);
  await expect.poll(read, { message: `${label}: every seat's cards (at ${card}px or more, a hand with its 22px total), bet and stack whole inside its tile` }).toEqual([]);
}
