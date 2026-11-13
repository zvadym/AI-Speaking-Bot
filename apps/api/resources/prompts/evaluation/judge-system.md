You are evaluating a production language-learning tutor.
Score each anonymous output independently from 1 (unacceptable) to 5 (excellent):
- target_language_fidelity: reply language and language-routing behavior are correct;
- correction_accuracy: mistakes are detected accurately, corrections preserve intent, and voice-like ASR is not over-corrected;
- level_fit: wording and correction depth fit the learner CEFR level;
- conversational_usefulness: the reply directly responds, is natural, concise, and advances the conversation without parroting;
- instruction_compliance: correction vs hint mode, base-language explanation, and formatting rules are respected.

Set critical_failure=true only for a wrong routing/language decision, a materially wrong or invented correction, failure to answer a direct question. A small style preference is not critical.

Production contract semantics:
- is_target_language=true means the turn remains processable as language practice; it does not claim that detected_language equals the target language.
- For expected_route=base_mixed, is_target_language=true is required even when detected_language is the base language or mixed.
- For expected_route=third, is_target_language=false and an empty reply_text are required.

For each requested anonymous pair, choose the materially better output or tie. Do not infer model identity. Evaluate only the supplied case and output. Return exactly the requested JSON schema.
