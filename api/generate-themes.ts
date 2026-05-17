import {
  ALLOWED_DEEPSEEK_MODELS,
  PRACTICE_TYPES,
  THEME_GENERATION_SYSTEM_PROMPT,
  buildThemeGenerationPrompt,
  isAllowedDeepSeekModel,
  normalizeThemeCount,
  parseThemesResponse
} from "../src/core";
import type { PracticeType } from "../src/core";

const DEEPSEEK_API_URL = "https://api.deepseek.com/chat/completions";
const MAX_CLIENT_ID_LENGTH = 120;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "no-store"
};

interface GenerateThemesRequest {
  practiceType?: unknown;
  themeCount?: unknown;
  model?: unknown;
  clientId?: unknown;
}

export function OPTIONS(): Response {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS
  });
}

export function GET(): Response {
  return jsonResponse({ error: "Method not allowed." }, 405);
}

export async function POST(request: Request): Promise<Response> {
  let body: GenerateThemesRequest;

  try {
    body = (await request.json()) as GenerateThemesRequest;
  } catch {
    return jsonResponse({ error: "Invalid JSON body." }, 400);
  }

  if (!isObject(body)) {
    return jsonResponse({ error: "Invalid request body." }, 400);
  }

  if (typeof body.practiceType !== "string" || !PRACTICE_TYPES.includes(body.practiceType as PracticeType)) {
    return jsonResponse({ error: "Invalid practice type." }, 400);
  }
  const practiceType = body.practiceType as PracticeType;

  if (!isAllowedDeepSeekModel(body.model)) {
    return jsonResponse({ error: `Invalid model. Allowed models: ${ALLOWED_DEEPSEEK_MODELS.join(", ")}.` }, 400);
  }

  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) {
    return jsonResponse({ error: "Server is missing DeepSeek configuration." }, 500);
  }

  const themeCount = normalizeThemeCount(body.themeCount);
  const clientId = typeof body.clientId === "string" ? body.clientId.slice(0, MAX_CLIENT_ID_LENGTH) : "";
  void clientId;

  try {
    const response = await fetch(DEEPSEEK_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: body.model,
        messages: [
          {
            role: "system",
            content: THEME_GENERATION_SYSTEM_PROMPT
          },
          {
            role: "user",
            content: buildThemeGenerationPrompt(themeCount, practiceType)
          }
        ],
        thinking: { type: "disabled" },
        response_format: { type: "json_object" },
        stream: false,
        max_tokens: 1200
      })
    });

    if (!response.ok) {
      return jsonResponse({ error: "DeepSeek request failed.", status: response.status }, 502);
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = payload.choices?.[0]?.message?.content;

    if (!content) {
      return jsonResponse({ error: "DeepSeek returned no content." }, 502);
    }

    const themes = parseThemesResponse(content, themeCount);
    return jsonResponse({ themes }, 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to generate themes.";
    return jsonResponse({ error: message }, 502);
  }
}

function jsonResponse(payload: unknown, status: number): Response {
  return Response.json(payload, {
    status,
    headers: CORS_HEADERS
  });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
