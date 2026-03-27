import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { type IndexEntry, tokenize } from "./bm25.js"

export function scanSkillsFromFS(directory: string): IndexEntry[] {
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
