import * as fs from 'node:fs';
import * as path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import type { MessageParam } from '@anthropic-ai/sdk/resources/messages';
import { db } from '@/db';
import { claudeConversations } from '@/db/schema';
import { and, eq, isNull } from 'drizzle-orm';

const MODEL = () => process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5-5';

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!_client) {
    _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _client;
}

const SUPPORTED_IMAGE_TYPES = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
} as const;

type SupportedMimeType = (typeof SUPPORTED_IMAGE_TYPES)[keyof typeof SUPPORTED_IMAGE_TYPES];

export interface EncodedImage {
  base64: string;
  mimeType: SupportedMimeType;
}

export function encodeImageFromPath(imagePath: string): EncodedImage {
  if (!fs.existsSync(imagePath)) {
    throw new Error(`Reference image not found: ${imagePath}`);
  }
  const ext = path.extname(imagePath).toLowerCase() as keyof typeof SUPPORTED_IMAGE_TYPES;
  const mimeType = SUPPORTED_IMAGE_TYPES[ext];
  if (!mimeType) {
    throw new Error(
      `Unsupported image format "${ext}" at ${imagePath}. Supported: jpg, png, gif, webp`,
    );
  }
  const data = fs.readFileSync(imagePath);
  return { base64: data.toString('base64'), mimeType };
}

export async function loadConversation(
  videoProjectId: number,
  videoScreenId?: number,
): Promise<MessageParam[]> {
  let row;
  if (videoScreenId) {
    row = db
      .select()
      .from(claudeConversations)
      .where(eq(claudeConversations.videoScreenId, videoScreenId))
      .limit(1)
      .get();
  } else {
    row = db
      .select()
      .from(claudeConversations)
      .where(
        and(
          eq(claudeConversations.videoProjectId, videoProjectId),
          isNull(claudeConversations.videoScreenId),
        ),
      )
      .limit(1)
      .get();
  }
  if (!row) return [];
  return JSON.parse(row.messagesJson) as MessageParam[];
}

export async function saveConversation(
  videoProjectId: number,
  messages: MessageParam[],
  videoScreenId?: number,
): Promise<void> {
  const now = Date.now();
  let existing;
  if (videoScreenId) {
    existing = db
      .select()
      .from(claudeConversations)
      .where(eq(claudeConversations.videoScreenId, videoScreenId))
      .limit(1)
      .get();
  } else {
    existing = db
      .select()
      .from(claudeConversations)
      .where(
        and(
          eq(claudeConversations.videoProjectId, videoProjectId),
          isNull(claudeConversations.videoScreenId),
        ),
      )
      .limit(1)
      .get();
  }

  const json = JSON.stringify(messages);
  if (existing) {
    db.update(claudeConversations)
      .set({ messagesJson: json, updatedAt: now })
      .where(eq(claudeConversations.id, existing.id))
      .run();
  } else {
    db.insert(claudeConversations)
      .values({ videoProjectId, videoScreenId: videoScreenId ?? null, messagesJson: json, updatedAt: now })
      .run();
  }
}

export interface CallClaudeOptions {
  videoScreenId?: number;
  fresh?: boolean;
  image?: EncodedImage; // pre-encoded to avoid re-reading when calling in a loop
}

export async function callClaude(
  videoProjectId: number,
  userMessage: string,
  systemPrompt?: string,
  options?: CallClaudeOptions,
): Promise<string> {
  const { videoScreenId, fresh = false, image } = options ?? {};

  const history = fresh ? [] : await loadConversation(videoProjectId, videoScreenId);

  // Build user content: image block first (if provided), then text
  const userContent: MessageParam['content'] = image
    ? [
        {
          type: 'image' as const,
          source: { type: 'base64' as const, media_type: image.mimeType, data: image.base64 },
        },
        { type: 'text' as const, text: userMessage },
      ]
    : userMessage;

  const messages: MessageParam[] = [
    ...history,
    { role: 'user', content: userContent },
  ];

  const response = await getClient().messages.create({
    model: MODEL(),
    max_tokens: 8192,
    system: systemPrompt,
    messages,
  });

  const assistantText = response.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { type: 'text'; text: string }).text)
    .join('');

  if (!fresh) {
    const updated: MessageParam[] = [
      ...messages,
      { role: 'assistant', content: response.content },
    ];
    await saveConversation(videoProjectId, updated, videoScreenId);
  }

  return assistantText;
}
