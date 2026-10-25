import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { coachFallback, isDiagramRequest, languageCue } from "@/lib/voice/studio";
import { officeToText } from "@/lib/materials/office";

describe("classroom studio", () => {
  it("hears an explicit diagram request and ignores a figure of speech", () => {
    expect(isDiagramRequest("Can you draw a diagram of the nephron?")).toBe(true);
    expect(isDiagramRequest("draw adiagram")).toBe(true);
    expect(isDiagramRequest("Let me draw a conclusion about the dose.")).toBe(false);
  });

  it("follows a spoken language change", () => {
    expect(languageCue("ok vamos a hablar en español")).toBe("Spanish");
    expect(languageCue("现在我们用中文")).toBe("Simplified Chinese");
    expect(languageCue("the dose is 5 milligrams")).toBe(null);
  });

  it("keeps a coaching line short enough to say once", () => {
    expect(coachFallback("kidneys filter").split(/\s+/).length).toBeLessThan(16);
    expect(coachFallback("The kidney filters blood and sends it back into circulation. Does that match your notes?")).toMatch(/board/i);
  });
});

describe("office files", () => {
  it("reads slide text and word text", async () => {
    const slides = new JSZip();
    slides.file("ppt/slides/slide1.xml", `<p:sld><a:t>Week 1: Cardiac drugs</a:t></p:sld>`);
    const pptx = await slides.generateAsync({ type: "uint8array" });
    expect(await officeToText(pptx, "pptx")).toBe("Week 1: Cardiac drugs");

    const word = new JSZip();
    word.file("word/document.xml", `<w:document><w:t>PHARM 201</w:t><w:t>syllabus</w:t></w:document>`);
    const docx = await word.generateAsync({ type: "uint8array" });
    expect(await officeToText(docx, "docx")).toBe("PHARM 201 syllabus");
  });
});
