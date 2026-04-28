const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseEmailList(input: string): { valid: string[]; invalid: string[] } {
  const tokens = input
    .split(/[\s,;]+/)
    .map((t) => t.trim())
    .filter(Boolean);
  const valid: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  for (const t of tokens) {
    const lower = t.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    if (EMAIL_RE.test(t)) valid.push(t);
    else invalid.push(t);
  }
  return { valid, invalid };
}

export function parseCsvEmails(text: string): { valid: string[]; invalid: string[] } {
  // Treat anything email-like in the CSV
  return parseEmailList(text);
}
