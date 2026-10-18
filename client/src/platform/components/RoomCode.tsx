interface Props {
  code: string;
  testId: string;
}

/**
 * The room code as the waiting room shows it and the game bar keeps it: each character on its own
 * lime tile, so it is the first thing anyone sees and easy to read out. Read-only; the group is
 * named for screen readers a letter at a time ("Room code U B R D").
 */
export function RoomCode({ code, testId }: Props) {
  return (
    <span className="room-card__value" data-testid={testId} aria-label={`Room code ${code.split('').join(' ')}`}>
      {code.split('').map((ch, i) => (
        <span key={i} className="room-card__char">
          {ch}
        </span>
      ))}
    </span>
  );
}
