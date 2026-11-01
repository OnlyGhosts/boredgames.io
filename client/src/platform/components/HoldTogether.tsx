/** The last character as it shows (an emoji with its modifiers is one), never half of one. */
export function lastGrapheme(text: string): string {
  if (typeof Intl.Segmenter === 'function') {
    let last = '';
    for (const { segment } of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)) last = segment;
    return last;
  }
  return Array.from(text).pop() ?? '';
}

/**
 * A name and the words after it ("Bartholomew Jane" and "wins!") for a headline that may break a
 * long name anywhere to fit (overflow-wrap: anywhere): the first word after the name keeps the
 * name's last character with it and never splits itself, so it is never alone on a line or cut in
 * two ("Bartholomew / Jane wins!", "WWWWWWWWWW / WWWWWW wins!", never "wins!" alone or "wi / ns!").
 */
export function HoldTogether({ before, after }: { before: string; after: string }) {
  const held = lastGrapheme(before);
  const space = after.indexOf(' ');
  const word = space < 0 ? after : after.slice(0, space);
  return (
    <>
      {before.slice(0, before.length - held.length)}
      <span className="hold-together">{`${held} ${word}`}</span>
      {space < 0 ? null : after.slice(space)}
    </>
  );
}
