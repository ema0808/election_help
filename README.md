# Failure Story: Citations Showing Wrong Sources

**Symptom:** For device-setup questions, the UI showed 3-4 source chips, but only one section actually contained the answer. The extra chips looked like a retrieval ranking bug — irrelevant chunks outranking the right one.

**Initial hypothesis (wrong):** Treated it as a ranking problem and tuned retrieval scoring. This didn't fix it, because the diagnosis was wrong.

**Actual root cause:** The chips were rendering raw retrieval candidates, not citations. Any chunk mentioning the same device name got surfaced, whether or not Claude actually used it to answer. Ranking was never the bug — the system had no concept of "used to answer" versus "retrieved."

## Fix

- Tagged each chunk with an `id` in the context sent to the model.
- Switched `/api/ask` to structured outputs (JSON schema) so the response is `{ answer, usedSourceIds }` instead of free text.
- System prompt explicitly instructs the model not to list sections it didn't draw from, even if they mention the same device.
- Only `usedSourceIds` render as chips.

**Edge case caught during testing:** when the manuals don't cover a question, the model correctly returns an empty `usedSourceIds` list. My first fallback logic mistook "empty" for "failed" and substituted 3 irrelevant sources, which was worse than showing none. Fixed by treating empty as meaningful and only falling back on genuinely unparseable responses (e.g. truncation).

## Verification, not assumption

- Confirmed structured outputs work on this SDK/model combo by testing in isolation with a deliberate decoy source before shipping.
- Ran targeted cases: assembly (1 source, correct), PIN limits (2 sources, correctly spanning both devices), paper jam (2), off-topic (0).

**Result:** For the query that surfaced the bug, sources went from 4 chips to the 1 that was actually used (Fizičko sklapanje, str. 2-7).

## Lesson

Retrieval quality and citation faithfulness are separate problems. A search-relevance fix can be entirely correct and still not fix a bug that lives in how results are presented as "sources" downstream.
