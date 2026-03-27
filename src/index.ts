import { type Plugin, tool } from "@opencode-ai/plugin"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

// ─── Stop Words ──────────────────────────────────────────────────────────────
const STOP_WORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "shall", "can", "to", "of", "in", "for",
  "on", "with", "at", "by", "from", "as", "into", "through", "during",
  "and", "or", "but", "not", "no", "if", "then", "than", "that", "this",
])

// ─── Tokenizer ───────────────────────────────────────────────────────────────
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[\s\-_.,;:!?()[\]{}"'`/\\|<>@#$%^&*+=~]+/)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t))
}

// ─── BM25 Index ──────────────────────────────────────────────────────────────
interface IndexEntry {
  id: string
  name: string
  description: string
  extra: string
  source: string
  tokens: string[]
}

class BM25Index {
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

// ─── Skill Scanner ───────────────────────────────────────────────────────────
function scanSkillsFromFS(directory: string): IndexEntry[] {
  const entries: IndexEntry[] = []
  const home = process.env.HOME ?? ""
  const skillDirs = [
    // OpenCode native
    join(directory, ".opencode", "skills"),
    join(home, ".config", "opencode", "skills"),
    // Claude-compatible
    join(directory, ".claude", "skills"),
    join(home, ".claude", "skills"),
    // Agent-compatible
    join(directory, ".agents", "skills"),
    join(home, ".agents", "skills"),
    // Installed skill packs
    join(home, ".cache", "opencode", "node_modules", "superpowers", "skills"),
  ]
  for (const dir of skillDirs) {
    try {
      if (!existsSync(dir)) continue
      for (const sub of readdirSync(dir, { withFileTypes: true })) {
        if (!sub.isDirectory()) continue
        const skillFile = join(dir, sub.name, "SKILL.md")
        try {
          if (!existsSync(skillFile)) continue
          const content = readFileSync(skillFile, "utf-8")
          const fm = parseFrontmatter(content, sub.name)
          entries.push({
            id: fm.name,
            name: fm.name,
            description: fm.description,
            extra: skillFile,
            source: "skill",
            tokens: tokenize(`${fm.name} ${fm.description}`),
          })
        } catch { /* skip */ }
      }
    } catch { /* skip */ }
  }
  return entries
}

function parseFrontmatter(content: string, fallback: string): { name: string; description: string } {
  const m = content.match(/^---\s*\n([\s\S]*?)\n---/)
  if (!m) return { name: fallback, description: "" }
  const fm = m[1]
  const nameMatch = fm.match(/^name:\s*(.+)$/m)
  const descMatch = fm.match(/^description:\s*["']?([\s\S]*?)["']?\s*$/m)
  return {
    name: nameMatch?.[1]?.trim() ?? fallback,
    description: descMatch?.[1]?.trim() ?? "",
  }
}

// ─── Plugin Entry ────────────────────────────────────────────────────────────
export const SkillSearchPlugin: Plugin = async ({ directory }) => {
  const skillIndex = new BM25Index()
  let skillsReady = false

  const ensureSkills = () => {
    if (skillsReady) return
    try {
      const skills = scanSkillsFromFS(directory)
      skillIndex.rebuild(skills)
    } catch { /* index stays empty */ }
    skillsReady = true
  }

  return {
    tool: {
      skill_search: tool({
        description:
          "Search for available skills by keyword. " +
          "Use this to find skills before loading them with the skill tool.",
        args: {
          query: tool.schema.string().describe("Keywords to search for skills"),
          max_results: tool.schema
            .number()
            .optional()
            .describe("Maximum number of results to return (default: 5)"),
        },
        async execute(args) {
          ensureSkills()
          const maxResults = Math.min(Math.max(args.max_results ?? 5, 1), 50)
          const query = args.query.trim().slice(0, 500)
          const results = skillIndex.search(query, maxResults)

          if (results.length === 0) {
            return `No matching skills found for "${query}". Try different keywords.`
          }

          const lines: string[] = [`Found ${results.length} skill(s):\n`]
          for (const r of results) {
            lines.push(`## ${r.name}`)
            lines.push(`**Description**: ${r.description}`)
            lines.push(`**Location**: ${r.extra}`)
            lines.push("")
          }
          return lines.join("\n")
        },
      }),
    },

    "experimental.chat.system.transform": async (input, output) => {
      // Skip non-agentic models (title, summary, compaction agents)
      if (!input.model?.capabilities?.toolcall) return
      output.system.push(
        "<important>\n" +
        "Before executing any non-trivial task, use `skill_search` with multiple relevant keywords to discover matching skills. " +
        "Always prefer loading a matching skill over handling the task from scratch.\n" +
        "</important>",
      )
    },

    "tool.definition": async (input, output) => {
      if (input.toolID === "skill") {
        const desc = output.description
        // Replace only the "## Available Skills" section, preserving anything after the next heading
        const marker = "## Available Skills"
        const idx = desc.indexOf(marker)
        if (idx !== -1) {
          const afterMarker = desc.slice(idx + marker.length)
          const nextHeading = afterMarker.search(/\n## /)
          const rest = nextHeading !== -1 ? afterMarker.slice(nextHeading) : ""
          output.description =
            desc.slice(0, idx) +
            "## Available Skills\n\n" +
            "Use the `skill_search` tool to discover available skills by keyword.\n" +
            "Example: skill_search({query: \"testing\"}) to find testing-related skills." +
            rest
        }
      }
    },
  }
}

export default SkillSearchPlugin
