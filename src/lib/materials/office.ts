import JSZip from "jszip";

export const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export function officeKind(filename: string, mime: string): "pptx" | "docx" | null {
  const name = filename.toLowerCase();
  if (mime === PPTX_MIME || name.endsWith(".pptx")) return "pptx";
  if (mime === DOCX_MIME || name.endsWith(".docx")) return "docx";
  return null;
}

/** Pulls the visible text out of a PowerPoint or Word file. Pictures inside the file are left behind. */
export async function officeToText(bytes: Uint8Array, kind: "pptx" | "docx"): Promise<string> {
  const zip = await JSZip.loadAsync(bytes);
  if (kind === "pptx") {
    const names = Object.keys(zip.files)
      .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
      .sort((a, b) => slideNumber(a) - slideNumber(b));
    const lines: string[] = [];
    for (const name of names) {
      const xml = await zip.files[name].async("string");
      for (const chunk of xml.match(/<a:t[^>]*>([^<]*)<\/a:t>/g) ?? []) {
        const text = chunk.replace(/<[^>]+>/g, "").trim();
        if (text) lines.push(text);
      }
    }
    return lines.join("\n");
  }
  const xml = await zip.file("word/document.xml")?.async("string");
  if (!xml) return "";
  return (xml.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) ?? [])
    .map((chunk) => chunk.replace(/<[^>]+>/g, "").trim())
    .filter(Boolean)
    .join(" ");
}

function slideNumber(name: string): number {
  return Number(name.match(/slide(\d+)/i)?.[1] ?? 0);
}
