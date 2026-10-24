// Generates fake demo data for the Fall 2026 nursing-sophomore persona:
//   fixtures/demo-canvas.ics          Canvas-style calendar feed (also served at /demo/demo-canvas.ics)
//   fixtures/pharm-201-syllabus.pdf   Pharmacology syllabus with a schedule and topics (also served at /demo/)
// Usage: npm run fixtures
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { PDFDocument, StandardFonts } from "pdf-lib";

type Ev = { uid: string; title: string; course: string; due: string; allDay?: boolean };

// Times are local Eastern (UTC-4 until Nov 1, UTC-5 after) written as UTC, the way Canvas exports them.
const EVENTS: Ev[] = [
  { uid: "assignment-1101", title: "Dosage Calculation Practice Set", course: "PHARM 201 - Pharmacology", due: "20261019T035900Z" },
  { uid: "assignment-1102", title: "Quiz 3: Autonomic Drugs", course: "PHARM 201 - Pharmacology", due: "20261023T035900Z" },
  { uid: "assignment-1103", title: "Drug Card Set 4 (Cardiac)", course: "PHARM 201 - Pharmacology", due: "20261027T035900Z" },
  { uid: "assignment-1104", title: "Exam 2: Cardiovascular Drugs", course: "PHARM 201 - Pharmacology", due: "20261029T140000Z" },
  { uid: "assignment-1105", title: "Quiz 4: Anticoagulants", course: "PHARM 201 - Pharmacology", due: "20261106T045900Z" },
  { uid: "assignment-1106", title: "Medication Safety Case Study", course: "PHARM 201 - Pharmacology", due: "20261113T045900Z" },
  { uid: "assignment-1107", title: "Exam 3: Respiratory and GI Drugs", course: "PHARM 201 - Pharmacology", due: "20261119T150000Z" },
  { uid: "assignment-1108", title: "Final Exam", course: "PHARM 201 - Pharmacology", due: "20261210T150000Z" },
  { uid: "event-2001", title: "PHARM 201 Lecture", course: "PHARM 201 - Pharmacology", due: "20261027T140000Z" },
  { uid: "assignment-2101", title: "Head-to-Toe Assessment Video", course: "NURS 210 - Health Assessment", due: "20261030T035900Z" },
  { uid: "assignment-2102", title: "Quiz: Cardiac and Peripheral Vascular", course: "NURS 210 - Health Assessment", due: "20261103T045900Z" },
  { uid: "assignment-2103", title: "Care Plan 2", course: "NURS 210 - Health Assessment", due: "20261110T045900Z" },
  { uid: "assignment-2104", title: "Midterm Skills Check-off", course: "NURS 210 - Health Assessment", due: "20261117", allDay: true },
  { uid: "assignment-3101", title: "Reflection Paper", course: "PSYC 220 - Lifespan Development", due: "20261102T045900Z" },
];

export function demoIcs(events = EVENTS): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Instructure//Canvas//EN", "X-WR-CALNAME:Riley Student Calendar (Canvas)"];
  for (const e of events) {
    const dt = e.allDay ? `DTSTART;VALUE=DATE:${e.due}` : `DTSTART:${e.due}`;
    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.uid}@canvas.demo-university.edu`,
      "DTSTAMP:20261001T120000Z",
      dt,
      e.allDay ? `DTEND;VALUE=DATE:${e.due}` : `DTEND:${e.due}`,
      `SUMMARY:${e.title} [${e.course}]`,
      `URL:https://canvas.demo-university.edu/calendar?event=${e.uid}`,
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

export const SYLLABUS_LINES = [
  "Demo University School of Nursing",
  "PHARM 201: Pharmacology for Nursing Practice",
  "Fall 2026 Syllabus",
  "",
  "Instructor: Dr. A. Rivera (fictional)    Office hours: Tue 2-4pm",
  "",
  "Course description",
  "Principles of pharmacology for safe medication administration, including",
  "pharmacokinetics, pharmacodynamics, and major drug classes by body system.",
  "",
  "Weekly schedule",
  "Week 1: Pharmacology Foundations",
  "Week 2: Pharmacokinetics and Pharmacodynamics",
  "Week 3: Dosage Calculation",
  "Week 4: Autonomic Nervous System Drugs",
  "Week 5: Antihypertensives",
  "Week 6: Cardiac Drugs",
  "Week 7: Anticoagulants",
  "Week 8: Respiratory Drugs",
  "Week 9: Gastrointestinal Drugs",
  "Week 10: Antimicrobials",
  "",
  "Graded work and due dates",
  "Quiz 3: Autonomic Drugs - Thu Oct 22, 11:59pm",
  "Exam 2: Cardiovascular Drugs - Thu Oct 29, 10:00am",
  "Quiz 4: Anticoagulants - Thu Nov 5, 11:59pm",
  "Medication Safety Case Study due Nov 12",
  "Drug interaction mini-project due Nov 24",
  "Exam 3: Respiratory and GI Drugs - Thu Nov 19, 10:00am",
  "Final Exam - Thu Dec 10, 10:00am (cumulative)",
  "",
  "Academic integrity",
  "All graded work must be your own.",
];

export async function syllabusPdf(lines = SYLLABUS_LINES): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let page = doc.addPage([612, 792]);
  let y = 740;
  for (const [i, line] of lines.entries()) {
    if (y < 60) {
      page = doc.addPage([612, 792]);
      y = 740;
    }
    const heading = i === 1 || /^(Weekly schedule|Graded work|Course description|Academic integrity)/.test(line);
    page.drawText(line, { x: 56, y, size: heading ? 13 : 11, font: heading ? bold : font });
    y -= line ? 18 : 10;
  }
  return doc.save();
}

if (process.argv[1]?.endsWith("make-fixtures.ts")) {
  mkdirSync("fixtures", { recursive: true });
  mkdirSync("public/demo", { recursive: true });
  writeFileSync("fixtures/demo-canvas.ics", demoIcs());
  copyFileSync("fixtures/demo-canvas.ics", "public/demo/demo-canvas.ics");
  syllabusPdf().then((bytes) => {
    writeFileSync("fixtures/pharm-201-syllabus.pdf", bytes);
    copyFileSync("fixtures/pharm-201-syllabus.pdf", "public/demo/pharm-201-syllabus.pdf");
    console.log("wrote fixtures/ and public/demo/ (demo-canvas.ics, pharm-201-syllabus.pdf)");
  });
}
