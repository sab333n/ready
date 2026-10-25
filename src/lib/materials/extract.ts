import { extractText, getDocumentProxy } from "unpdf";
import { getLlm, LlmError, type LlmImage } from "@/lib/llm";
import { loadPrompt } from "@/lib/prompts";
import { heuristicExtract } from "./heuristic";
import { officeKind, officeToText, DOCX_MIME, PPTX_MIME } from "./office";
import { MaterialExtraction } from "./schema";

export type UploadedFile = { filename: string; mime: string; bytes: Uint8Array };
export type ExtractResult = { text: string; extraction: MaterialExtraction; usedLlm: boolean };

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
export const ACCEPTED_TYPES = ["application/pdf", PPTX_MIME, DOCX_MIME, ...IMAGE_TYPES];
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** Pages are separated by a form feed so chunking can keep page numbers for citations. */
export const PAGE_BREAK = "\n\f\n";

export async function pdfToText(bytes: Uint8Array): Promise<string> {
  // pdf.js transfers the buffer it is given; pass a copy so callers keep theirs.
  const pdf = await getDocumentProxy(bytes.slice());
  const { text } = await extractText(pdf, { mergePages: false });
  return text.join(PAGE_BREAK);
}

/** Reads a syllabus PDF or a screenshot and pulls out deadlines and topics. */
export async function extractMaterial(file: UploadedFile, now = new Date()): Promise<ExtractResult> {
  if (file.bytes.byteLength > MAX_UPLOAD_BYTES) throw new LlmError("Files must be 10 MB or smaller.");
  const llm = getLlm();
  const today = now.toISOString().slice(0, 10);

  if (IMAGE_TYPES.has(file.mime)) {
    if (!llm) throw new LlmError("Reading screenshots needs the AI reader. Set LLM_PROVIDER=gemini, or upload a PDF instead.");
    const prompt = loadPrompt("extract-course-material", 1, {
      today,
      filename: file.filename,
      text: "(The material is the attached screenshot.)",
    });
    const image: LlmImage = { mediaType: file.mime as LlmImage["mediaType"], base64: Buffer.from(file.bytes).toString("base64") };
    const extraction = await llm.generateObject({ promptId: prompt.id, system: prompt.system, prompt: prompt.user, schema: MaterialExtraction, images: [image] });
    return { text: summarizeAsText(extraction), extraction, usedLlm: true };
  }

  const office = officeKind(file.filename, file.mime);
  if (office) {
    const text = await officeToText(file.bytes, office);
    if (text.trim().length < 20) throw new LlmError("We couldn't find text in that file. If the slides are pictures, upload a screenshot.");
    return extractPlainText(file.filename, text, now);
  }

  if (file.mime !== "application/pdf") throw new LlmError("Upload a PDF, a PowerPoint, a Word file, or an image (PNG, JPG).");
  const text = await pdfToText(file.bytes);
  if (text.trim().length < 20) {
    throw new LlmError("We couldn't find text in that PDF. If it's a scan, upload a screenshot of the schedule instead.");
  }
  return extractPlainText(file.filename, text, now);
}

/** Reads syllabus or notes that are already text (a Canvas syllabus page, or a .txt file). */
export async function extractPlainText(filename: string, text: string, now = new Date()): Promise<ExtractResult> {
  const body = text.slice(0, 80_000);
  const llm = getLlm();
  if (!llm) return { text: body, extraction: heuristicExtract(body, now), usedLlm: false };
  const prompt = loadPrompt("extract-course-material", 1, { today: now.toISOString().slice(0, 10), filename, text: body });
  try {
    const extraction = await llm.generateObject({ promptId: prompt.id, system: prompt.system, prompt: prompt.user, schema: MaterialExtraction });
    return { text: body, extraction, usedLlm: true };
  } catch (err) {
    // Never lose the upload because the model call failed; fall back to the offline reader.
    console.error("LLM extraction failed, using heuristic", err);
    return { text: body, extraction: heuristicExtract(body, now), usedLlm: false };
  }
}

// For screenshots we store a readable text version of what was extracted, since
// later phases (the classroom) use stored text as the source of truth.
function summarizeAsText(x: MaterialExtraction): string {
  const lines = [
    [x.course.code, x.course.name].filter(Boolean).join(" "),
    ...x.deadlines.map((d) => `${d.date}${d.time ? ` ${d.time}` : ""} - ${d.title} (${d.kind})`),
    ...x.topics.map((t) => `Topic: ${t.name}`),
  ];
  return lines.filter(Boolean).join("\n");
}
