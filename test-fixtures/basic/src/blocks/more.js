export function square({ VALUE }) {
  return VALUE * VALUE;
}

export function shout({ THING }) {
  const loud = (text) => `${text}!`;
  if (!THING) return "hi";
  return loud(THING);
}
