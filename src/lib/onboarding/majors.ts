// Suggested "bigger goal" per major. We only use this to phrase the question;
// the student always chooses. Unknown majors get a generic question.
type MajorHint = { match: RegExp; exam?: string; career?: string };

const HINTS: MajorHint[] = [
  { match: /nurs|bsn|\brn\b/i, exam: "the NCLEX", career: "a summer externship" },
  { match: /pharm/i, exam: "the NAPLEX", career: "a pharmacy internship" },
  { match: /account/i, exam: "the CPA exam", career: "a busy-season internship" },
  { match: /pre-?med|medicine/i, exam: "the MCAT", career: "clinical or research hours" },
  { match: /pre-?law/i, exam: "the LSAT" },
  { match: /engineer/i, exam: "the FE exam", career: "an internship or co-op" },
  { match: /computer|software|\bcs\b|data science/i, career: "an internship" },
];

export function hintForMajor(major: string | undefined): MajorHint | undefined {
  if (!major) return undefined;
  return HINTS.find((h) => h.match.test(major));
}
