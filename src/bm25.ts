const STOP_WORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "shall", "can", "to", "of", "in", "for",
  "on", "with", "at", "by", "from", "as", "into", "through", "during",
  "and", "or", "but", "not", "no", "if", "then", "than", "that", "this",
])

export interface IndexEntry {
  id: string
  name: string
  description: string
  extra: string
  source: string
  tokens: string[]
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[\s\-_.,;:!?()[\]{}"'`/\\|<>@#$%^&*+=~]+/)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t))
}

export class BM25Index {
  private entries: IndexEntry[] = []
  private avgDL = 0
  private df = new Map<string, number>()
  private k1 = 0.9
  private b = 0.4

  rebuild(entries: IndexEntry[]): void {
    this.entries = entries
    this.df.clear()
    let totalLen = 0
    for (const entry of entries) {
      const seen = new Set<string>()
      for (const tok of entry.tokens) {
        if (!seen.has(tok)) {
          seen.add(tok)
          this.df.set(tok, (this.df.get(tok) ?? 0) + 1)
        }
      }
      totalLen += entry.tokens.length
    }
    this.avgDL = entries.length > 0 ? totalLen / entries.length : 1
  }

  search(query: string, topK: number): IndexEntry[] {
    const qTokens = tokenize(query)
    if (qTokens.length === 0) return []
    const N = this.entries.length
    const scored: { entry: IndexEntry; score: number }[] = []
    for (const entry of this.entries) {
      let score = 0
      const dl = entry.tokens.length
      const tf = new Map<string, number>()
      for (const tok of entry.tokens) tf.set(tok, (tf.get(tok) ?? 0) + 1)
      for (const qt of qTokens) {
        const docFreq = this.df.get(qt) ?? 0
        const termFreq = tf.get(qt) ?? 0
        if (termFreq === 0) continue
        const idf = Math.log((N - docFreq + 0.5) / (docFreq + 0.5) + 1)
        const tfNorm =
          (termFreq * (this.k1 + 1)) /
          (termFreq + this.k1 * (1 - this.b + this.b * (dl / this.avgDL)))
        score += idf * tfNorm
      }
      if (score > 0) scored.push({ entry, score })
    }
    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, topK).map((s) => s.entry)
  }
}
