/** Format the browser tab title based on the selected session. */
export function formatTabTitle(
  sessions: Array<{ id: string; label: string; status: string }>,
  selectedId: string,
): string {
  const session = sessions.find((s) => s.id === selectedId);
  return session ? `trayce \u2014 ${session.label}` : "trayce";
}
