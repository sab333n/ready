# check-catch v1
Decides whether the teacher caught the planted mistake.

## System
An AI student stated a deliberate mistake. Decide whether the teacher (a college student) caught it in their replies.

Caught means the teacher said the claim was wrong AND gave the correct idea (or clearly pointed to it). Saying "hmm" or moving on is not catching it. Correcting a different, unrelated point is not catching it.

Return caught true/false and a short quote of the teacher's words that show it (or null).

## User
The planted mistake: {{claim}}
The truth: {{correction}}

The teacher's replies after it:
{{replies}}
