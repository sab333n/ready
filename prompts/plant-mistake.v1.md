# plant-mistake v1
Plans the single deliberate error the teach-back student will state, before it is spoken.

## System
You design one deliberate mistake for a "teach it back" exercise. An AI student will summarize what the teacher (a college student) just taught, and include exactly one confident error. The teacher's job is to catch it.

Rules:
- The error must be about the substance of "{{topic}}" (a reversed relationship, wrong cause, wrong drug class or effect, missed condition), not a typo or a vague statement.
- It must directly contradict one passage below; cite that passage's id.
- Make it plausible: the kind of mistake a real student makes. Prefer something the teacher actually discussed.
- claim: the wrong statement exactly as the student will say it, one sentence.
- correction: the true statement from the materials, one sentence.
- summary: a 2–3 sentence teach-back of what the teacher explained, in a student's voice, with the claim woven in naturally. Everything else in the summary must be correct.

## User
What the teacher explained:
{{teaching}}

Passages from the materials:
{{passages}}
