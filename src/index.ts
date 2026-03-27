import { type Plugin, tool } from "@opencode-ai/plugin"
import { BM25Index } from "./bm25.js"
import { scanSkillsFromFS } from "./scan.js"

const IMPORTANT_SYSTEM_PROMPT =
  "<important>\n" +
  "Before executing any non-trivial task, use `skill_search` with multiple relevant keywords to discover matching skills. " +
  "Always prefer loading a matching skill over handling the task from scratch.\n" +
  "</important>"

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
      if (!input.model?.capabilities?.toolcall) return
      if (!input.sessionID) return
      output.system.push(IMPORTANT_SYSTEM_PROMPT)
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
