# Sentence-based narration — 2026-10-25

New Story Studio narration generates one complete sentence per TTS request instead of restarting the voice every nine words. Paragraphs still define image scenes. Decimal numbers, Unicode sentence punctuation and closing quotation marks are handled by the local sentence segmenter; common titles such as Dr. are kept with the following sentence.

Subtitle presentation is independent: sentences are divided into balanced groups of at most nine words. Each sentence's WAV duration is measured. Subtitle group boundaries are estimated proportionally within that sentence, and animated word timings remain estimates. This is not forced alignment or speech recognition. Sentence and scene endpoints use the measured audio lengths.

For bounded local generation, one sentence may contain at most 60 words and 1000 characters, and a script at most 500 sentences and 500 subtitle groups. Oversized sentences reject before starting TTS with a message to add sentence punctuation. Existing 12,000-character/60-scene/20-minute story limits remain in place. Voice, rate and model settings are unchanged. No automatic silence removal, speed adjustment, model download or provider call is introduced.

New jobs freeze `speechSegmentation=sentence-v1`. Older saved narration and frozen jobs retain their existing phrase/caption behavior. Regenerating creates a separate draft; it does not rewrite a previous draft or replace its audio.

## The Light Behind the Door comparison

A separate isolated draft was generated with the current saved story's script, imported voice, Chatterbox Nano model and normal rate. The source story remained at revision 4, and its project, narration and local TTS settings were verified unchanged by SHA-256.

- Existing saved story: 8 speech requests, 17.64 seconds.
- Revised narration: 6 sentence requests, 17.04 seconds; 8 short subtitle groups.
- At a -38 dB silence threshold with a 0.18-second minimum, detected quiet intervals over 0.4 seconds decreased from 6 in the saved story to 3 in the revision.
- The user-supplied download is a different-duration WAV (20.091 seconds), with 7 such intervals. It is also preserved in the comparison folder.

These measurements describe quiet intervals, not perceived quality, pronunciation accuracy or semantic correctness. Listen to the two versions before selecting one. No revised audio, caption timing, image timing or timeline change was applied to the existing story.

See `sentence-tts-verification.json` for tests and the absolute comparison artifact paths. Restart Agent Cut to use sentence generation for future jobs.
