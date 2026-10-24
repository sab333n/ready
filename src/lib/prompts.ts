import { readFileSync } from "node:fs";
import path from "node:path";

// Prompts live in /prompts/<name>.v<version>.md with "## System" and "## User"
// sections and {{placeholders}}. Bump the version file instead of editing in place
// so results stay reproducible.
export function loadPrompt(name: string, version: number, vars: Record<string, string>) {
  const file = path.join(process.cwd(), "prompts", `${name}.v${version}.md`);
  const raw = readFileSync(file, "utf8");
  const fill = (s: string) =>
    s.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
      if (!(key in vars)) throw new Error(`Prompt ${name}.v${version} needs {{${key}}}`);
      return vars[key];
    });
  const system = raw.match(/## System\n([\s\S]*?)(?=\n## User\n)/)?.[1];
  const user = raw.match(/## User\n([\s\S]*)$/)?.[1];
  if (!system || !user) throw new Error(`Prompt ${name}.v${version} must have "## System" and "## User" sections`);
  return { id: `${name}.v${version}`, system: fill(system.trim()), user: fill(user.trim()) };
}
