import { db } from '@/db';
import {
  videoProjects,
  videoScreens,
  screenPromptVersions,
  videoGenerations,
  promptGenerationTasks,
} from '@/db/schema';
import { eq, max } from 'drizzle-orm';
import { callClaude, encodeImageFromPath, loadConversation } from './anthropic';
import { getSkillContent } from '@/lib/ugc-skill';
import { useapiProvider } from '@/providers/useapi/provider';
import type { VideoGenerationProvider } from '@/providers/useapi/interface';

const DEFAULT_MODEL = () => process.env.VIDEO_DEFAULT_MODEL ?? 'omni-flash';
const DEFAULT_DURATION = () => parseInt(process.env.VIDEO_DEFAULT_DURATION ?? '8', 10);

// ── Creative Brief ────────────────────────────────────────────────────────────

export interface CreativeBrief {
  voiceIdentity?: string;
  characterAppearance?: string;
  performanceStyle?: string;
  gestureIntensity?: 'low' | 'medium' | 'high';
  camera?: string;
  setting?: string;
}

export function parseBrief(creativeBriefJson: string | null | undefined): CreativeBrief {
  if (!creativeBriefJson) return {};
  try {
    return JSON.parse(creativeBriefJson) as CreativeBrief;
  } catch {
    return {};
  }
}


function detectFeedbackScope(feedback: string): 'project' | 'scene' {
  const projectIndicators =
    /across all scenes|throughout|in every scene|all scenes|his voice throughout|her voice throughout|the whole project|project.wide|consistently|every scene/i;
  return projectIndicators.test(feedback) ? 'project' : 'scene';
}

// ── Validation ────────────────────────────────────────────────────────────────

export interface ValidationResult {
  issues: string[];
  warnings: string[];
}

export function validatePrompt(
  promptText: string,
  dialogue: string,
  durationSeconds?: number | null,
  brief?: CreativeBrief | null,
): ValidationResult {
  const issues: string[] = [];
  const warnings: string[] = [];

  // 1. Dialogue present check (compare first 30 chars for robustness)
  const normalizedDialogue = dialogue.trim().replace(/['"''""]/g, '').toLowerCase();
  const normalizedPrompt = promptText.toLowerCase().replace(/['"''""]/g, '');
  if (normalizedDialogue.length > 10) {
    const snippet = normalizedDialogue.substring(0, 30);
    if (!normalizedPrompt.includes(snippet)) {
      issues.push('Scene dialogue does not appear verbatim in the Dialogue section.');
    }
  }

  // 2. Timing estimate
  if (durationSeconds) {
    const wordCount = dialogue.trim().split(/\s+/).filter(Boolean).length;
    const DURATION_RANGES: Record<number, [number, number]> = {
      4: [10, 15],
      6: [18, 24],
      8: [28, 36],
      10: [38, 50],
    };
    const range = DURATION_RANGES[durationSeconds];
    if (range) {
      const [low, high] = range;
      if (wordCount < low * 0.6 || wordCount > high * 1.5) {
        warnings.push(
          `Dialogue has ${wordCount} word${wordCount !== 1 ? 's' : ''} but a ${durationSeconds}s scene typically fits ${low}-${high} words.`,
        );
      }
    }
  }

  // 3. Excessive word-by-word choreography
  const choreographyMatches = promptText.match(/on the word|as (she|he|they) says|when (she|he|they) says|at the word/gi);
  if ((choreographyMatches?.length ?? 0) > 2) {
    warnings.push('Expression section contains detailed word-by-word choreography. Consider simplifying.');
  }

  // 4. Contradictory directions
  const contradictionPairs: [RegExp, RegExp][] = [
    [/whisper|whispered|intimate/i, /projecting|loud(ly)?|shout/i],
    [/close.up|tight.shot|close.crop/i, /wide.shot|full.body|wide.frame/i],
  ];
  for (const [a, b] of contradictionPairs) {
    if (a.test(promptText) && b.test(promptText)) {
      warnings.push('Prompt may contain contradictory directions.');
      break;
    }
  }

  // 5. Missing Audio section
  if (brief?.voiceIdentity && !promptText.toLowerCase().includes('audio')) {
    warnings.push('Prompt appears to be missing an Audio section.');
  }

  return { issues, warnings };
}

// ── Script Analysis ──────────────────────────────────────────────────────────

// Duration guidance aligned with the UGC skill (v2): word-count based estimates.
// 4s: 10-15 words | 6s: 18-24 words | 8s: 28-36 words | 10s: 38-50 words
// For Hinglish/bilingual, add 10-15%. When two durations fit, choose the longer one.
const ANALYSIS_SYSTEM_PROMPT = `You break UGC ad scripts into individual scenes for video production.

Rules:
- Split at natural spoken units: complete thoughts, sentence ends, natural pauses
- Never split mid-phrase or mid-sentence
- Copy dialogue verbatim from the script — no paraphrasing
- Account for all dialogue in the script

Duration assignment — use word count as the primary signal:
- Available durations: 4, 6, 8, 10 seconds (all supported by omni-flash)
- Word-count guide: 10-15 words → 4s; 18-24 words → 6s; 28-36 words → 8s; 38-50 words → 10s
- For Hinglish or bilingual scripts, add 10-15% to the estimate
- Always allow for a natural lead-in and trailing silence
- When a line fits two possible durations, choose the longer one — rushed delivery hurts performance
- Add extra time for: rhetorical questions, dramatic pauses, product reveals, emotional beats

For each scene, also include a one-sentence durationNote explaining why you chose that duration (e.g. word count, language mix, emotional beat).

Typo detection:
- Scan the script for likely spelling mistakes, OCR errors, or unusual words that appear unintentional
- Include them in the JSON output as possibleTypos
- Only flag words that are clearly wrong or suspicious — do not flag proper nouns, brand names, or intentional slang

Respond with valid JSON only, no other text:
{"screens": [{"screenNumber": 1, "dialogue": "...", "durationSeconds": 6, "durationNote": "19 words at comfortable pace"}, ...], "possibleTypos": [{"original": "mo3ney", "suggestion": "money", "context": "keep mo3ney rolling"}]}`;

export interface TypoCandidate {
  original: string;
  suggestion: string;
  context: string;
}

export async function analyzeScript(videoProjectId: number): Promise<{
  screens: Array<{ screenNumber: number; dialogue: string; durationSeconds: number; durationNote?: string }>;
  possibleTypos: TypoCandidate[];
}> {
  const project = db
    .select()
    .from(videoProjects)
    .where(eq(videoProjects.id, videoProjectId))
    .limit(1)
    .get();
  if (!project) throw new Error(`Video project ${videoProjectId} not found`);

  const userMessage = `Script:\n${project.approvedScript ?? project.originalScript}`;

  // Use fresh call (no conversation history) - analysis is standalone
  const response = await callClaude(videoProjectId, userMessage, ANALYSIS_SYSTEM_PROMPT, { fresh: true });

  const jsonMatch = response.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Claude did not return valid JSON for script breakdown');

  const parsed = JSON.parse(jsonMatch[0]) as {
    screens: Array<{ screenNumber: number; dialogue: string; durationSeconds: number; durationNote?: string }>;
    possibleTypos?: TypoCandidate[];
  };

  return {
    screens: parsed.screens,
    possibleTypos: parsed.possibleTypos ?? [],
  };
}

// ── Creative Brief Extraction ─────────────────────────────────────────────────

const EXTRACTION_SYSTEM_PROMPT = `You are extracting the established creative direction for a UGC video project.
You will be given the full calibration history for Scene 1 — the conversation of feedback and revisions — followed by the final approved prompt.
Your job is to synthesize what was calibrated and locked in during that process.

Return ONLY valid JSON with these fields (use null for any field you cannot determine):
{
  "voiceIdentity": "voice texture, pace, tone, and any specific accent or register established",
  "characterAppearance": "character description locked from the reference image and any approved adjustments",
  "performanceStyle": "overall performance energy, delivery approach, and any specific calibration outcomes",
  "gestureIntensity": "low" or "medium" or "high",
  "camera": "framing or shot style confirmed in the approved prompt",
  "setting": "any setting details confirmed",
  "calibrationNotes": "brief summary of what changed between drafts and what was explicitly locked in or ruled out"
}`;

export async function extractAndStoreCreativeBrief(
  videoProjectId: number,
  approvedPromptText: string,
  screen1Id?: number,
): Promise<CreativeBrief> {
  const project = db
    .select()
    .from(videoProjects)
    .where(eq(videoProjects.id, videoProjectId))
    .limit(1)
    .get();
  if (!project) throw new Error(`Project ${videoProjectId} not found`);

  const existingBrief = parseBrief(project.creativeBrief);

  // Load Screen 1 conversation history to capture the full calibration process
  let calibrationContext = '';
  if (screen1Id) {
    const history = await loadConversation(videoProjectId, screen1Id);
    if (history.length > 0) {
      const turns = history
        .map((m) => {
          const role = m.role === 'user' ? 'Creator feedback' : 'Claude revision';
          const text = Array.isArray(m.content)
            ? m.content.filter((b) => (b as { type: string }).type === 'text').map((b) => (b as { type: string; text: string }).text).join('\n')
            : typeof m.content === 'string' ? m.content : '';
          return `${role}:\n${text}`;
        })
        .join('\n\n---\n\n');
      calibrationContext = `Screen 1 calibration history:\n\n${turns}\n\n---\n\n`;
    }
  }

  const rawResponse = await callClaude(
    videoProjectId,
    `${calibrationContext}Final approved Screen 1 prompt:\n\n${approvedPromptText}`,
    EXTRACTION_SYSTEM_PROMPT,
    { fresh: true },
  );

  const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.warn('extractAndStoreCreativeBrief: Claude did not return valid JSON');
    return existingBrief;
  }

  let extracted: Partial<CreativeBrief & { calibrationNotes?: string }> = {};
  try {
    extracted = JSON.parse(jsonMatch[0]);
  } catch {
    console.warn('extractAndStoreCreativeBrief: JSON parse failed');
    return existingBrief;
  }

  const mergedBrief: CreativeBrief = {
    voiceIdentity: (extracted.voiceIdentity as string | undefined) ?? undefined,
    characterAppearance: (extracted.characterAppearance as string | undefined) ?? undefined,
    performanceStyle: (extracted.performanceStyle as string | undefined) ?? undefined,
    gestureIntensity: (extracted.gestureIntensity as CreativeBrief['gestureIntensity']) ?? undefined,
    camera: (extracted.camera as string | undefined) ?? undefined,
    setting: (extracted.setting as string | undefined) ?? undefined,
  };

  db.update(videoProjects)
    .set({ creativeBrief: JSON.stringify(mergedBrief), updatedAt: Date.now() })
    .where(eq(videoProjects.id, videoProjectId))
    .run();

  return mergedBrief;
}

// ── Creative Direction Helpers ────────────────────────────────────────────────

// Google Flow is stateless — each API call is independent with no memory of prior requests.
// This instruction overrides the UGC skill's "Same character." shorthand for scenes 2+.
const SELF_CONTAINED_PROMPT_INSTRUCTION =
  `\n\nCRITICAL — Google Flow receives each scene as an isolated API call with zero memory of previous requests. Every scene 2+ prompt MUST be fully self-contained:\n` +
  `- Character section: write the complete character description from the established creative direction above. NEVER write "Same character." — Google Flow does not know what that refers to.\n` +
  `- Audio section: write the full voice description, accent, tone and delivery style every time. NEVER write "Same voice" or reference Scene 1 — it will be ignored.\n` +
  `The reference image (sent as referenceImage_1 in R2V mode) handles visual appearance. Your prompt must carry everything else explicitly.`;

function buildCreativeDirectionBlock(brief: CreativeBrief, screen1PromptText: string | null): string {
  const parts: string[] = [];

  if (brief.voiceIdentity) parts.push(`Voice: ${brief.voiceIdentity}`);
  if (brief.performanceStyle) parts.push(`Performance: ${brief.performanceStyle}`);
  if (brief.gestureIntensity) parts.push(`Gesture intensity: ${brief.gestureIntensity}`);
  if (brief.camera) parts.push(`Camera/framing: ${brief.camera}`);
  if (brief.characterAppearance) parts.push(`Character: ${brief.characterAppearance}`);

  let block = '';
  if (parts.length > 0) {
    block += `\n\nEstablished creative direction (from Screen 1 approval — apply to all scenes):\n${parts.join('\n')}`;
  }
  if (screen1PromptText) {
    block += `\n\nApproved Screen 1 prompt (reference for tone, format and voice):\n${screen1PromptText}`;
  }
  return block;
}

function getScreen1ApprovedPromptInfo(videoProjectId: number): { promptText: string; versionId: number } | null {
  const screen1 = db
    .select()
    .from(videoScreens)
    .where(eq(videoScreens.videoProjectId, videoProjectId))
    .all()
    .find((s) => s.screenNumber === 1);
  if (!screen1?.approvedGenerationId) return null;

  const approvedGen = db
    .select()
    .from(videoGenerations)
    .where(eq(videoGenerations.id, screen1.approvedGenerationId))
    .limit(1)
    .get();
  if (!approvedGen) return null;

  const promptVersion = db
    .select()
    .from(screenPromptVersions)
    .where(eq(screenPromptVersions.id, approvedGen.promptVersionId))
    .limit(1)
    .get();
  if (!promptVersion) return null;
  return { promptText: promptVersion.promptText, versionId: promptVersion.id };
}

// ── Prompt Generation ────────────────────────────────────────────────────────

export async function generateScreen1Prompt(
  videoProjectId: number,
  videoScreenId: number,
  nlFeedback?: string,
  reviewingGenerationId?: number,
): Promise<{ promptText: string; version: number; validation: ValidationResult; feedbackScope?: string }> {
  const screen = db
    .select()
    .from(videoScreens)
    .where(eq(videoScreens.id, videoScreenId))
    .limit(1)
    .get();
  if (!screen) throw new Error(`Screen ${videoScreenId} not found`);

  const project = db
    .select()
    .from(videoProjects)
    .where(eq(videoProjects.id, videoProjectId))
    .limit(1)
    .get();
  if (!project) throw new Error(`Video project ${videoProjectId} not found`);

  const skillContent = getSkillContent(project.skillVersion);
  const brief = parseBrief(project.creativeBrief);
  const image = encodeImageFromPath(project.baseImagePath);

  let userMessage: string;
  let feedbackScope: string | undefined;

  if (nlFeedback) {
    feedbackScope = detectFeedbackScope(nlFeedback);

    const latestVersion = db
      .select()
      .from(screenPromptVersions)
      .where(eq(screenPromptVersions.videoScreenId, videoScreenId))
      .all()
      .sort((a, b) => b.version - a.version)[0];

    userMessage =
      `Revise the Scene 1 prompt based on this feedback: ${nlFeedback}\n\n` +
      `Full script:\n${project.approvedScript ?? project.originalScript}\n\n` +
      `Scene 1 dialogue: "${screen.dialogue}"` +
      (screen.durationSeconds ? `\nTarget duration: ${screen.durationSeconds} seconds` : '') +
      (latestVersion ? `\n\nCurrent prompt:\n${latestVersion.promptText}` : '');

    if (reviewingGenerationId) {
      db.update(videoGenerations)
        .set({ creatorFeedback: nlFeedback, updatedAt: Date.now() })
        .where(eq(videoGenerations.id, reviewingGenerationId))
        .run();
    }
  } else {
    const creatorDescPart = project.creatorDescription
      ? `\n\nCreator description: ${project.creatorDescription}`
      : '';

    userMessage =
      `Here is the original video script and the reference image of the creator.` +
      `\nUse the reference image to understand the creator's visible appearance.` +
      `\nUsing the UGC skill, generate the Google Flow video prompt for Scene 1 only.` +
      `\nReturn only the formatted scene prompt. Do not include scene breakdown, analysis, or content for other scenes.` +
      `\nPreserve the original dialogue exactly.` +
      creatorDescPart +
      `\n\nFull script:\n${project.approvedScript ?? project.originalScript}` +
      `\n\nScene 1 dialogue: "${screen.dialogue}"` +
      (screen.durationSeconds ? `\nTarget duration: ${screen.durationSeconds} seconds` : '');
  }

  const promptText = await callClaude(videoProjectId, userMessage, skillContent, { videoScreenId, image });
  const version = await insertPromptVersion(videoScreenId, promptText, 'claude', nlFeedback, feedbackScope);
  const validation = validatePrompt(promptText, screen.dialogue, screen.durationSeconds, brief);

  return { promptText, version, validation, feedbackScope };
}

export async function generateInitialScreenPrompt(
  videoProjectId: number,
  videoScreenId: number,
): Promise<{ promptText: string; version: number; validation: ValidationResult }> {
  const screen = db
    .select()
    .from(videoScreens)
    .where(eq(videoScreens.id, videoScreenId))
    .limit(1)
    .get();
  if (!screen) throw new Error(`Screen ${videoScreenId} not found`);

  const project = db
    .select()
    .from(videoProjects)
    .where(eq(videoProjects.id, videoProjectId))
    .limit(1)
    .get();
  if (!project) throw new Error(`Video project ${videoProjectId} not found`);

  const skillContent = getSkillContent(project.skillVersion);
  const brief = parseBrief(project.creativeBrief);
  const image = encodeImageFromPath(project.baseImagePath);
  const screen1Info = getScreen1ApprovedPromptInfo(videoProjectId);
  const creativeDirectionBlock = buildCreativeDirectionBlock(brief, screen1Info?.promptText ?? null);

  const userMessage =
    `Here is the original video script and the reference image of the creator.` +
    `\nUsing the UGC skill, generate the Google Flow video prompt for Scene ${screen.screenNumber} only.` +
    `\nPreserve the original dialogue exactly.` +
    creativeDirectionBlock +
    (screen.screenNumber > 1 ? SELF_CONTAINED_PROMPT_INSTRUCTION : '') +
    `\n\nFull script:\n${project.approvedScript ?? project.originalScript}` +
    `\n\nScene ${screen.screenNumber} dialogue: "${screen.dialogue}"` +
    (screen.durationSeconds ? `\nTarget duration: ${screen.durationSeconds} seconds` : '');

  const promptText = await callClaude(videoProjectId, userMessage, skillContent, { videoScreenId, image });
  const version = await insertPromptVersion(
    videoScreenId, promptText, 'claude', undefined, undefined,
    screen1Info?.versionId ?? null,
    project.creativeBrief ?? null,
  );
  const validation = validatePrompt(promptText, screen.dialogue, screen.durationSeconds, brief);

  return { promptText, version, validation };
}

export async function generateRemainingPrompts(
  videoProjectId: number,
): Promise<Array<{ videoScreenId: number; promptText: string; version: number }>> {
  const screens = db
    .select()
    .from(videoScreens)
    .where(eq(videoScreens.videoProjectId, videoProjectId))
    .all()
    .filter((s) => s.screenNumber > 1)
    .sort((a, b) => a.position - b.position);

  const project = db
    .select()
    .from(videoProjects)
    .where(eq(videoProjects.id, videoProjectId))
    .limit(1)
    .get();
  if (!project) throw new Error(`Video project ${videoProjectId} not found`);

  const skillContent = getSkillContent(project.skillVersion);
  const brief = parseBrief(project.creativeBrief);
  const image = encodeImageFromPath(project.baseImagePath);
  const screen1Info = getScreen1ApprovedPromptInfo(videoProjectId);
  const creativeDirectionBlock = buildCreativeDirectionBlock(brief, screen1Info?.promptText ?? null);

  const results: Array<{ videoScreenId: number; promptText: string; version: number }> = [];

  for (const screen of screens) {
    const userMessage =
      `Here is the original video script and the reference image of the creator.` +
      `\nUsing the UGC skill, generate the Google Flow video prompt for Scene ${screen.screenNumber} only.` +
      `\nPreserve the original dialogue exactly.` +
      creativeDirectionBlock +
      SELF_CONTAINED_PROMPT_INSTRUCTION +
      `\n\nFull script:\n${project.approvedScript ?? project.originalScript}` +
      `\n\nScene ${screen.screenNumber} dialogue: "${screen.dialogue}"` +
      (screen.durationSeconds ? `\nTarget duration: ${screen.durationSeconds} seconds` : '');

    const promptText = await callClaude(videoProjectId, userMessage, skillContent, {
      videoScreenId: screen.id,
      image,
    });
    const version = await insertPromptVersion(
      screen.id, promptText, 'claude', undefined, undefined,
      screen1Info?.versionId ?? null,
      project.creativeBrief ?? null,
    );
    results.push({ videoScreenId: screen.id, promptText, version });
  }

  return results;
}

export async function revisePrompt(
  videoProjectId: number,
  videoScreenId: number,
  nlFeedback: string,
  reviewingGenerationId?: number,
): Promise<{ promptText: string; version: number; validation: ValidationResult; feedbackScope: string }> {
  const screen = db
    .select()
    .from(videoScreens)
    .where(eq(videoScreens.id, videoScreenId))
    .limit(1)
    .get();
  if (!screen) throw new Error(`Screen ${videoScreenId} not found`);

  const project = db
    .select()
    .from(videoProjects)
    .where(eq(videoProjects.id, videoProjectId))
    .limit(1)
    .get();
  if (!project) throw new Error(`Video project ${videoProjectId} not found`);

  const skillContent = getSkillContent(project.skillVersion);
  const brief = parseBrief(project.creativeBrief);
  const feedbackScope = detectFeedbackScope(nlFeedback);
  const image = encodeImageFromPath(project.baseImagePath);

  const latestVersion = db
    .select()
    .from(screenPromptVersions)
    .where(eq(screenPromptVersions.videoScreenId, videoScreenId))
    .all()
    .sort((a, b) => b.version - a.version)[0];

  // For screens 2+, include established creative direction as a reminder
  const creativeDirectionBlock = screen.screenNumber > 1
    ? buildCreativeDirectionBlock(brief, getScreen1ApprovedPromptInfo(videoProjectId)?.promptText ?? null)
    : '';

  const userMessage =
    `Revise the Scene ${screen.screenNumber} prompt based on this feedback: ${nlFeedback}\n\n` +
    `Full script:\n${project.approvedScript ?? project.originalScript}\n\n` +
    `Scene ${screen.screenNumber} dialogue: "${screen.dialogue}"` +
    (screen.durationSeconds ? `\nTarget duration: ${screen.durationSeconds} seconds` : '') +
    creativeDirectionBlock +
    (screen.screenNumber > 1 ? SELF_CONTAINED_PROMPT_INSTRUCTION : '') +
    (latestVersion ? `\n\nCurrent prompt:\n${latestVersion.promptText}` : '');

  // Save feedback against the generation being reviewed
  if (reviewingGenerationId) {
    db.update(videoGenerations)
      .set({ creatorFeedback: nlFeedback, updatedAt: Date.now() })
      .where(eq(videoGenerations.id, reviewingGenerationId))
      .run();
  }

  const promptText = await callClaude(videoProjectId, userMessage, skillContent, { videoScreenId, image });
  const screen1Info = screen.screenNumber > 1 ? getScreen1ApprovedPromptInfo(videoProjectId) : null;
  const version = await insertPromptVersion(
    videoScreenId, promptText, 'claude', nlFeedback, feedbackScope,
    screen1Info?.versionId ?? null,
    screen.screenNumber > 1 ? project.creativeBrief ?? null : null,
  );
  const validation = validatePrompt(promptText, screen.dialogue, screen.durationSeconds, brief);

  return { promptText, version, validation, feedbackScope };
}

// ── Async Prompt Generation Task Queueing ─────────────────────────────────────

export function enqueueScreen1ApprovalTasks(
  videoProjectId: number,
  screen1Id: number,
): { tasksQueued: number } {
  const now = Date.now();

  // Task 1: extract creative brief (must run before generate_prompt tasks)
  db.insert(promptGenerationTasks)
    .values({
      videoProjectId,
      videoScreenId: screen1Id,   // used to load S1 conversation history
      taskType: 'extract_brief',
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    })
    .run();

  // Tasks 2..N: generate prompts for each remaining screen
  const remainingScreens = db
    .select()
    .from(videoScreens)
    .where(eq(videoScreens.videoProjectId, videoProjectId))
    .all()
    .filter((s) => s.screenNumber > 1)
    .sort((a, b) => a.position - b.position);

  for (const screen of remainingScreens) {
    db.insert(promptGenerationTasks)
      .values({
        videoProjectId,
        videoScreenId: screen.id,
        taskType: 'generate_prompt',
        status: 'pending',
        createdAt: now + 1, // ensure extract_brief sorts first
        updatedAt: now + 1,
      })
      .run();
  }

  return { tasksQueued: 1 + remainingScreens.length };
}

// ── Queued Generation Submission ──────────────────────────────────────────────

export async function submitQueuedGeneration(
  generationId: number,
  provider: VideoGenerationProvider = useapiProvider,
): Promise<void> {
  const gen = db
    .select()
    .from(videoGenerations)
    .where(eq(videoGenerations.id, generationId))
    .limit(1)
    .get();
  if (!gen || gen.status !== 'queued') return;

  const screen = db
    .select()
    .from(videoScreens)
    .where(eq(videoScreens.id, gen.videoScreenId))
    .limit(1)
    .get();
  const project = screen
    ? db.select().from(videoProjects).where(eq(videoProjects.id, screen.videoProjectId)).limit(1).get()
    : null;
  const promptVersion = db
    .select()
    .from(screenPromptVersions)
    .where(eq(screenPromptVersions.id, gen.promptVersionId))
    .limit(1)
    .get();

  if (!screen || !project || !promptVersion) {
    db.update(videoGenerations)
      .set({ status: 'failed', errorMessage: 'Missing related records', updatedAt: Date.now() })
      .where(eq(videoGenerations.id, generationId))
      .run();
    return;
  }

  const duration = gen.durationSeconds ?? screen.durationSeconds ?? DEFAULT_DURATION();
  const now = Date.now();

  // Mark as processing so the worker doesn't pick it up twice
  db.update(videoGenerations)
    .set({ status: 'processing', updatedAt: now })
    .where(eq(videoGenerations.id, generationId))
    .run();

  try {
    let referenceImageMediaId = project.baseImageMediaId;
    if (!referenceImageMediaId) {
      if (process.env.MOCK_USEAPI === 'true') {
        referenceImageMediaId = 'mock-media-id';
      } else {
        const uploaded = await provider.uploadReferenceImage({
          imagePath: project.baseImagePath,
          contentType: guessContentType(project.baseImagePath),
          email: process.env.GOOGLE_FLOW_EMAIL!,
        });
        referenceImageMediaId = uploaded.mediaGenerationId ?? null;
        if (referenceImageMediaId) {
          db.update(videoProjects)
            .set({ baseImageMediaId: referenceImageMediaId, updatedAt: now })
            .where(eq(videoProjects.id, project.id))
            .run();
        }
      }
    }

    let jobId: string | undefined;
    if (process.env.MOCK_USEAPI === 'true') {
      jobId = `mock-job-${now}`;
      db.update(videoGenerations)
        .set({ jobId, status: 'completed', updatedAt: now })
        .where(eq(videoGenerations.id, generationId))
        .run();
      return;
    }

    const result = await provider.submitGeneration({
      prompt: promptVersion.promptText,
      model: DEFAULT_MODEL(),
      referenceImageMediaId: referenceImageMediaId!,
      duration,
      aspectRatio: 'portrait',
      correlationId: `screen-${gen.videoScreenId}-v${gen.promptVersionId}-q`,
    });
    jobId = result.jobId;

    if (result.videoUrl) {
      const downloaded = await provider.downloadVideo({
        jobId,
        signedUrl: result.videoUrl,
        outputMediaGenerationId: result.mediaGenerationId ?? null,
        jobCompletedAt: now,
      });
      db.update(videoGenerations)
        .set({ jobId, status: 'completed', videoLocalPath: downloaded.tempPath, updatedAt: now })
        .where(eq(videoGenerations.id, generationId))
        .run();
    } else {
      db.update(videoGenerations)
        .set({ jobId, status: 'pending', updatedAt: now })
        .where(eq(videoGenerations.id, generationId))
        .run();
    }
  } catch (err: unknown) {
    db.update(videoGenerations)
      .set({ status: 'failed', errorMessage: (err instanceof Error ? err.message : String(err)), updatedAt: Date.now() })
      .where(eq(videoGenerations.id, generationId))
      .run();
    throw err;
  }
}

// ── Generate All Scenes ───────────────────────────────────────────────────────

export function enqueueAllSceneGenerations(
  videoProjectId: number,
): { enqueued: number; skipped: number; generationIds: number[] } {
  const screens = db
    .select()
    .from(videoScreens)
    .where(eq(videoScreens.videoProjectId, videoProjectId))
    .all()
    .filter((s) => !s.approvedGenerationId)
    .sort((a, b) => a.position - b.position);

  const now = Date.now();
  const generationIds: number[] = [];
  let skipped = 0;

  for (const screen of screens) {
    // Skip if already has an active or queued generation
    const existingActive = db
      .select()
      .from(videoGenerations)
      .where(eq(videoGenerations.videoScreenId, screen.id))
      .all()
      .find((g) => ['queued', 'pending', 'processing'].includes(g.status));
    if (existingActive) { skipped++; continue; }

    // Get latest prompt version for this screen
    const latestPrompt = db
      .select()
      .from(screenPromptVersions)
      .where(eq(screenPromptVersions.videoScreenId, screen.id))
      .all()
      .sort((a, b) => b.version - a.version)[0];
    if (!latestPrompt) { skipped++; continue; }

    const insertResult = db
      .insert(videoGenerations)
      .values({
        videoScreenId: screen.id,
        promptVersionId: latestPrompt.id,
        jobId: null,
        status: 'queued',
        videoLocalPath: null,
        durationSeconds: screen.durationSeconds ?? DEFAULT_DURATION(),
        createdAt: now,
        updatedAt: now,
      })
      .run();
    generationIds.push(Number(insertResult.lastInsertRowid));
  }

  return { enqueued: generationIds.length, skipped, generationIds };
}

// ── Manual Prompt Edit ───────────────────────────────────────────────────────

export async function saveManualPromptEdit(
  videoScreenId: number,
  promptText: string,
): Promise<{ version: number; validation: ValidationResult }> {
  const screen = db
    .select()
    .from(videoScreens)
    .where(eq(videoScreens.id, videoScreenId))
    .limit(1)
    .get();

  const project = screen
    ? db
        .select()
        .from(videoProjects)
        .where(eq(videoProjects.id, screen.videoProjectId))
        .limit(1)
        .get()
    : null;

  const brief = parseBrief(project?.creativeBrief);

  const screenNumber = screen?.screenNumber ?? 0;
  const screen1Info = screenNumber > 1 && screen && project
    ? getScreen1ApprovedPromptInfo(screen.videoProjectId)
    : null;
  const version = await insertPromptVersion(
    videoScreenId, promptText, 'manual', undefined, undefined,
    screen1Info?.versionId ?? null,
    screenNumber > 1 && project ? project.creativeBrief ?? null : null,
  );
  const validation = validatePrompt(promptText, screen?.dialogue ?? '', screen?.durationSeconds, brief);
  return { version, validation };
}

// ── Video Generation ─────────────────────────────────────────────────────────

export async function submitVideoGeneration(
  videoProjectId: number,
  videoScreenId: number,
  promptVersionId: number,
  durationOverride?: number,
  provider: VideoGenerationProvider = useapiProvider,
): Promise<{ generationId: number }> {
  const project = db
    .select()
    .from(videoProjects)
    .where(eq(videoProjects.id, videoProjectId))
    .limit(1)
    .get();
  if (!project) throw new Error(`Video project ${videoProjectId} not found`);

  const promptVersion = db
    .select()
    .from(screenPromptVersions)
    .where(eq(screenPromptVersions.id, promptVersionId))
    .limit(1)
    .get();
  if (!promptVersion) throw new Error(`Prompt version ${promptVersionId} not found`);

  const screen = db
    .select()
    .from(videoScreens)
    .where(eq(videoScreens.id, videoScreenId))
    .limit(1)
    .get();

  // durationOverride wins, then screen's recommendation, then env default
  const duration = durationOverride ?? screen?.durationSeconds ?? DEFAULT_DURATION();

  // Ensure base image is uploaded and mediaGenerationId is cached
  let referenceImageMediaId = project.baseImageMediaId;
  if (!referenceImageMediaId) {
    if (process.env.MOCK_USEAPI === 'true') {
      referenceImageMediaId = 'mock-media-id';
    } else {
      const uploaded = await provider.uploadReferenceImage({
        imagePath: project.baseImagePath,
        contentType: guessContentType(project.baseImagePath),
        email: process.env.GOOGLE_FLOW_EMAIL!,
      });
      referenceImageMediaId = uploaded.mediaGenerationId ?? null;
      if (referenceImageMediaId) {
        db.update(videoProjects)
          .set({ baseImageMediaId: referenceImageMediaId, updatedAt: Date.now() })
          .where(eq(videoProjects.id, videoProjectId))
          .run();
      }
    }
  }

  const now = Date.now();
  let jobId: string | undefined;

  if (process.env.MOCK_USEAPI === 'true') {
    jobId = `mock-job-${now}`;
  } else {
    const result = await provider.submitGeneration({
      prompt: promptVersion.promptText,
      model: DEFAULT_MODEL(),
      referenceImageMediaId,
      duration,
      aspectRatio: 'portrait',
      correlationId: `screen-${videoScreenId}-v${promptVersionId}`,
    });
    jobId = result.jobId;

    // API may complete generation synchronously — download immediately if so
    if (result.videoUrl) {
      const downloaded = await provider.downloadVideo({
        jobId,
        signedUrl: result.videoUrl,
        outputMediaGenerationId: result.mediaGenerationId ?? null,
        jobCompletedAt: now,
      });
      const insertResult = db
        .insert(videoGenerations)
        .values({
          videoScreenId,
          promptVersionId,
          jobId: jobId ?? null,
          status: 'completed',
          videoLocalPath: downloaded.tempPath,
          durationSeconds: duration,
          createdAt: now,
          updatedAt: now,
        })
        .run();
      return { generationId: Number(insertResult.lastInsertRowid) };
    }
  }

  const insertResult = db
    .insert(videoGenerations)
    .values({
      videoScreenId,
      promptVersionId,
      jobId: jobId ?? null,
      status: process.env.MOCK_USEAPI === 'true' ? 'completed' : 'pending',
      videoLocalPath: null,
      durationSeconds: duration,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  return { generationId: Number(insertResult.lastInsertRowid) };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function insertPromptVersion(
  videoScreenId: number,
  promptText: string,
  source: 'claude' | 'manual',
  nlFeedback: string | undefined,
  feedbackScope: string | undefined,
  screen1PromptVersionId?: number | null,
  creativeBriefSnapshot?: string | null,
): Promise<number> {
  const existing = db
    .select({ maxVersion: max(screenPromptVersions.version) })
    .from(screenPromptVersions)
    .where(eq(screenPromptVersions.videoScreenId, videoScreenId))
    .get();

  const nextVersion = (existing?.maxVersion ?? 0) + 1;

  db.insert(screenPromptVersions)
    .values({
      videoScreenId,
      version: nextVersion,
      promptText,
      source,
      nlFeedback: nlFeedback ?? null,
      feedbackScope: feedbackScope ?? null,
      screen1PromptVersionId: screen1PromptVersionId ?? null,
      creativeBriefSnapshot: creativeBriefSnapshot ?? null,
      createdAt: Date.now(),
    })
    .run();

  return nextVersion;
}

function guessContentType(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase();
  const map: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
  };
  return map[ext ?? ''] ?? 'image/jpeg';
}
