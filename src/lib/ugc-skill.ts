const SKILL_V1 = `# UGC Video Prompt Skill

Converts ad scripts into structured, scene-by-scene video generation prompts optimised for Google Flow / Omni Flash. Each prompt is production-ready — character locked, dialogue split by character count, pacing controlled, audio described.

---

## Step 1 — Lock the Character

Before splitting any dialogue, extract and lock the character description from the reference image (if provided). Output as a single paragraph, no bullets.

**What to include:**
- Nationality/ethnicity as told by the user (e.g. "Indian woman", "Brazilian woman", "Korean woman") + age range
- Hair (length, texture, color)
- Skin tone
- Outfit (every visible item — top, bottom, accessories, nails)
- Prop in hand if any (mic, hanger, phone, product, baby, etc.)
- Framing style (handheld selfie, medium shot, close crop, etc.)
- Background note: the reference image is sent in R2V mode and locks the character's appearance, not the background.

**What NOT to include:**
- Room description (Google Flow generates its own background in R2V mode)
- Any detail that could drift between scenes
- Assume nationality — always wait for user to specify or ask if not provided

**Example output:**
> Brazilian woman, 28, long wavy dark hair, warm olive skin, natural minimal makeup. Wearing a white linen crop top and high-waisted beige trousers, gold hoop earrings. Hands relaxed at sides. Confident, relaxed energy.

---

## Step 2 — Split Dialogue by Character Count

Never split by word count or feel. Always split by **character count** to control pacing accurately.

**Available time slots:** 4 sec, 6 sec, 8 sec, 10 sec (Google Flow max per clip is 8 sec — flag if user picks 10 sec).

**Formula:**
- Count total characters in the full script
- Divide by total seconds across all scenes
- That gives chars/sec (usually ~11–13)
- Multiply by each scene's seconds to get target char count per scene

**Show the split first** before writing prompts. Example:
\`\`\`
Total chars: 420 | Chars/sec: 12
Scene 1 → 4 sec → 48 chars → "The easiest way to upgrade a man's look—"
Scene 2 → 6 sec → 72 chars → "start with the pants. The right color..."
\`\`\`

Ask user to confirm split before building full prompts.

---

## Step 3 — Write Scene Prompts

Each scene uses this exact format — no deviation:

\`\`\`
**Scene [N] — [Timecode start] to [Timecode end]**

**Character**
[Single para character description. Omit if user says "character stays same" — just write: Same character.]

**Dialogue**
*"[Exact dialogue for this scene]"*

**Expression**
[What her face and body do during this dialogue. Be specific — which word triggers which gesture/expression. No generic instructions.]

**Audio**
[Voice quality, pace, energy, room tone. Always end with: No music, no reverb.]
\`\`\`

---

## Expression Writing Rules

These are the core patterns that make prompts feel real vs. fake:

**DO:**
- Tie every expression note to a specific word in the dialogue: "eyebrows up on 'Men'" not "looks surprised"
- Use dry/understated delivery for confident moments: "states it like a fact, not a performance"
- Describe gesture precisely: "index finger sweeps left to right across top row, then drops to bottom row"
- Note energy shifts within a scene: "quick on hook, slows into the story"
- For finger/hand gestures: always describe direction, timing, and what triggers the drop

**DON'T:**
- "Big performative smile" — too fake
- "Excited energy" without specifics
- Generic: "she looks happy" / "she nods"
- Over-describe expressions that should be subtle

**Common expression patterns by scene type:**

| Scene type | Expression note |
|---|---|
| Hook / scroll-stopper | Dry, direct, one eyebrow up. No smile. |
| Story / recall | Soft smile, slight lean forward, eyes warm |
| Product reveal | Genuine impressed nod, not salesy |
| Feature list | Tick off fingers, one per feature |
| Cultural humour moment | Small real laugh, quick gesture relevant to the culture — ask user if unsure |
| CTA | Direct eye contact, point at lens on "yours/today", warm but not big |

---

## Audio Writing Rules

Always write audio as its own section. Key rules:

- **Selfie/handheld:** "Clean handheld selfie audio — voice close, warm, intimate, right in your ear. No echo, no reverb."
- **Seated/room:** "Clean warm indoor room audio. [Tone descriptor] voice — [confident / warm / conversational]. No music, no reverb."
- **Vlogging mic:** "Small black handheld vlogging mic held close to chin — voice warm, present, zero reverb. Soft natural room tone. No music."
- Always describe the emotional tone of the voice, not just the technical setup
- Match voice descriptor to the character's nationality and persona as specified by user (e.g. "warm Brazilian accent", "composed British voice", "upbeat Australian tone")
- If baby is in scene: explicitly write "Baby quiet and settled in arms — no crying, no fussing"
- If green screen: "Clean handheld audio" — never describe room ambience

---

## Special Scenarios

### Hook with finger gesture (green screen or layout)
When model is pointing to images that will be added in edit:
> Free hand comes up — index finger points to top left of frame — sweeps right across top row — drops down and sweeps across bottom row — like she's presenting pictures the editor will place on screen. Hand drops naturally after the last word.

### Model holding product on hanger
> Holding [product] on wooden hanger up in right hand at shoulder height, facing camera clearly. Never puts it down. Free left hand gestures for emphasis.

### Walk-in hook
> She takes one casual step forward, raises [mic/phone] to her mouth and delivers the line. Lands in frame with [expression].

### No background description rule
Never describe the room in the prompt body. The reference image is submitted in R2V mode and locks the character's appearance. Google Flow generates its own background.

---

## Timing Reference

| Chars | Approx seconds |
|---|---|
| 44–52 | 4 sec |
| 65–78 | 6 sec |
| 88–104 | 8 sec |
| 110–130 | 10 sec |

Google Flow hard limit: **8 seconds per clip**. If user requests 10 sec, flag it and suggest splitting into two 5-sec clips.

---

## Output Rules

- Never describe the background in scene prompts — only in environment variant prompts
- Never write "big performative smile" or "excited energy" without specifics
- Always show the character count split before writing full prompts (user can correct)
- If user says "next" — give the next scene only, same format
- If user says "combine scene X and Y" — merge dialogue, merge expression beats, keep single audio section
- If user says "only changed scenes" — compare old vs new script, output only scenes where dialogue changed
- If user says "give para description" — output character as single clean paragraph, no bullets`;

const SKILL_V2 = `# UGC Video Prompt Skill v2

Converts UGC ad scripts into Google Flow / Omni Flash video prompts using R2V (Reference-to-Video) mode. The character reference image locks appearance, not the background.

---

## 1. Reference Image Handling

The reference image is submitted via referenceImage_1 (R2V mode). It locks the character's appearance across all scenes. It does not pin or lock the background.

When writing the Character section:
- Describe what is visible in the reference image: hair, skin tone, outfit, accessories, props held, framing
- Use one phrase for overall energy: "confident and direct", "warm and conversational", etc.
- Do not describe the background or room

Do not describe nationality unless the creator specifies it. Do not guess from the image or name.

---

## 2. Scene Timing by Word Count

Count spoken words. Use these estimates:

| Words | Duration |
|---|---|
| 10-15 | 4 seconds |
| 18-24 | 6 seconds |
| 28-36 | 8 seconds |
| 38-50 | 10 seconds |

All four durations (4, 6, 8, 10 seconds) are supported by omni-flash.

For Hinglish or bilingual scripts: add 10-15% to the estimate. Language switches and pauses add time.

Split dialogue at natural spoken units: complete thoughts, sentence ends, natural pauses. Never split mid-phrase or mid-sentence.

---

## 3. Voice Identity

Every project has a consistent voice. Establish it in Scene 1 and carry it through all scenes.

Describe in three dimensions:
- Texture: warm, dry, breathy, direct, conversational
- Pace: unhurried, measured, energetic, quick
- Accent or register: only if specified by the creator

In subsequent scenes, reference the same voice. Only note shifts when the script's tone clearly changes (e.g., a CTA that is more urgent than the body copy).

---

## 4. Scene Prompt Format

\`\`\`
**Scene [N] - [duration]s**

**Character**
[Scene 1: full description from the reference image. Scenes 2+: "Same character." unless something changes - outfit swap, prop change, or different framing.]

**Dialogue**
*"[Exact dialogue verbatim. No paraphrasing or summarising.]"*

**Expression**
[One or two specific, purposeful notes - or write: No deliberate gesture. Default is restrained: natural delivery, no added movement.]

**Audio**
[Voice texture, pace, and delivery. Two sentences. End with: No music, no reverb.]
\`\`\`

---

## 5. Expression Rules

The default is restrained. Do not add movement for its own sake.

Add an expression only when:
- The line is a genuine question or reveal and a natural reaction would be expected
- The line references a physical product and a brief, natural gesture fits the moment
- The scene is a CTA and directness is called for

Expression rules:
- Maximum two specific actions per scene
- No smile unless warmth is natural to the line
- No word-by-word choreography (tying every gesture to a specific word)
- No generic energy descriptions: not "excited", not "enthusiastic", not "animated"

**Avoid:**
- "Big smile"
- "Excited energy"
- "Gestures enthusiastically"
- Any expression that reads as performative or overly rehearsed

---

## 6. Feedback Interpretation

When asked to revise a prompt, follow these rules:

1. Identify exactly what was criticised. Assume everything else is fine.
2. Change only what was criticised. Preserve: character description, dialogue, timing, audio format.
3. If feedback uses "across all scenes", "throughout", "in every scene", "his voice throughout", or similar language: apply the change to this scene and note it may be project-wide.
4. Do not creatively interpret ambiguous feedback. Ask one clarifying question if the meaning is genuinely unclear.
5. Return the complete revised prompt, not just the changed section.

Common phrases and how to handle them:
- "More energy" - increase pace descriptor in Audio; optionally add one restrained expression note
- "Less gestures" or "tone it down" - remove or simplify Expression section
- "Sounds scripted" or "too rehearsed" - simplify Expression to default restrained baseline
- "Voice feels off" - revise Audio tone and texture description
- "Wrong vibe" - ask one clarifying question before revising

---

## 7. Validation Checklist

Before returning any prompt, verify:
- Dialogue section contains the full dialogue verbatim
- Scene duration is consistent with the word count
- No contradictory directions in the same scene (e.g., "intimate whisper" and "projects loudly to camera")
- Expression has at most two specific actions, or is written as "No deliberate gesture"
- Audio voice description is consistent with the established voice identity
- No background or room description in any scene section`;

const SKILLS: Record<string, string> = {
  v1: SKILL_V1,
  v2: SKILL_V2,
};

export function getSkillContent(version: string): string {
  const content = SKILLS[version];
  if (!content) {
    throw new Error(`Unknown UGC skill version: "${version}". Available: ${Object.keys(SKILLS).join(', ')}`);
  }
  return content;
}

export const AVAILABLE_SKILL_VERSIONS = Object.keys(SKILLS);
export const DEFAULT_SKILL_VERSION = 'v1';
