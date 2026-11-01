/**
 * Short parts joined by dots ("Poker · 2 players · playing now") on a line that wraps only between
 * parts and never leaves a dot at either end of a line: each part after the first carries its dot
 * in front, and a dot that would start a line sits in a margin the box clips (.dot-list). The text
 * still reads "Poker · 2 players · playing now", dots and all.
 */
export function DotList({ parts, as: Tag = 'span', className, testId }: { parts: readonly string[]; as?: 'span' | 'p'; className?: string; testId?: string }) {
  return (
    <Tag className={className ? `dot-list ${className}` : 'dot-list'} data-testid={testId}>
      <span className="dot-list__line">
        {parts.map((part, i) => (
          <span key={i} className="dot-list__part">
            {i > 0 && <span className="dot-list__dot">{' · '}</span>}
            {part}
          </span>
        ))}
      </span>
    </Tag>
  );
}
