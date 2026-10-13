// Rate limit for error reports from a loop that runs every frame: each distinct message is reported at once, and the same message
// again only after `interval` ms. The times are kept per message, so two parts failing in turn cannot get around the limit.
export function createErrorGate(interval = 5000) {
  const lastAt = new Map();
  return function shouldReport(message, now) {
    const prev = lastAt.get(message);
    if (prev !== undefined && now - prev < interval) return false;
    if (lastAt.size > 200) lastAt.clear(); // (messages with changing text must not grow the map without bound)
    lastAt.set(message, now);
    return true;
  };
}
