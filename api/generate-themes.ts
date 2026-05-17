const DEEPSEEK_API_URL = "https://api.deepseek.com/chat/completions";
const MAX_CLIENT_ID_LENGTH = 120;
const ALLOWED_DEEPSEEK_MODELS = ["deepseek-v4-flash", "deepseek-v4-pro"] as const;
const PRACTICE_TYPES = ["剧情练习", "文笔练习", "角色练习", "节奏练习", "脑洞练习", "随便写写"] as const;

type DeepSeekModel = (typeof ALLOWED_DEEPSEEK_MODELS)[number];
type PracticeType = (typeof PRACTICE_TYPES)[number];

interface WritingTheme {
  title: string;
  prompt: string;
}

interface GenerateThemesRequest {
  practiceType?: unknown;
  themeCount?: unknown;
  model?: unknown;
  clientId?: unknown;
}

const THEME_GENERATION_SYSTEM_PROMPT = [
  "你是一位专业的中文小说写作教练，专注于创意小说写作训练。你的任务是生成有针对性的小说写作练习命题。",
  "",
  "要求：",
  "",
  "标题：8字以内，有画面感，能激发想象",
  "prompt：2-4句话，给出具体场景和写作方向，避免抽象描述",
  "只输出 JSON，结构：{\"themes\":[{\"title\":\"...\",\"prompt\":\"...\"}]}"
].join("\n");

const PRACTICE_TYPE_GUIDANCE: Record<PracticeType, string> = {
  剧情练习:
    "主题要帮助用户练习小说情节设计和冲突构建。每个prompt要提供：一个明确的情境、一个待解决的问题、以及“从哪个瞬间开始写”。每个prompt要指定一个剧情练习重点（如：悬念设置、情节反转、冲突升级、多线交织等）。",
  文笔练习:
    "主题要帮助用户练习小说语言表达。每个prompt要包含：一个具体的描写对象、一种文笔技巧（如：五感描写、通感修辞、留白、长短句交错、以动写静等）、以及一个明确的练习目标（如：写出压抑感、写出孤独感、写出紧张感等）。",
  角色练习:
    "主题要帮助用户练习塑造立体小说人物。每个prompt要包含：一个具体角色设定（身份、背景）、一个核心矛盾或秘密、以及一个具体场景。prompt要明确告诉用户“在这个场景中，通过什么方式展现人物”（如：一段对话、一个决定、一次内心挣扎）。",
  节奏练习:
    "主题要帮助用户练习控制小说叙事节奏。每个prompt要包含：一个适合该节奏的场景、一种明确的节奏要求、以及具体的实现技巧提示（如：多用短句、减少形容词、插入环境描写来放缓、用破折号制造停顿等）。",
  脑洞练习:
    "主题要帮助用户练习创意发散和非常规思维。每个prompt要包含：一个打破常规的设定或假设（如：如果重力突然消失、如果谎言会变成实体、如果记忆可以交易等）。prompt要指定一个脑洞方向（如：世界观脑洞、规则脑洞、反转脑洞、荒诞脑洞等），并给出一个具体的故事起点，让用户从这个点展开想象。",
  随便写写:
    "主题可以自由发散，但必须是具体的小说写作练习命题。每个prompt要兼顾角色、场景、冲突和画面感，让用户不用额外构思就能马上开始写。"
};

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "no-store"
};

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

  if (!isPracticeType(body.practiceType)) {
    return jsonResponse({ error: "Invalid practice type." }, 400);
  }

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
            content: buildThemeGenerationPrompt(themeCount, body.practiceType)
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

function buildThemeGenerationPrompt(themeCount: number, practiceType: PracticeType): string {
  const safeCount = normalizeThemeCount(themeCount);

  return [
    `请生成 ${safeCount} 个适合今天开始写作的中文小说主题。`,
    `本次练习类型是「${practiceType}」。`,
    PRACTICE_TYPE_GUIDANCE[practiceType],
    "标题要短、有画面感；prompt 用 2 到 4 句给出具体写作方向。",
    "只返回 JSON：{\"themes\":[{\"title\":\"...\",\"prompt\":\"...\"}]}。"
  ].join("");
}

function parseThemesResponse(content: string, limit: number): WritingTheme[] {
  const cleaned = content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
  const parsed = JSON.parse(cleaned) as { themes?: unknown };
  const rawThemes = Array.isArray(parsed.themes) ? parsed.themes : [];
  const themes = rawThemes
    .map((item) => ({
      title: typeof item?.title === "string" ? item.title.trim() : "",
      prompt: typeof item?.prompt === "string" ? item.prompt.trim() : ""
    }))
    .filter((item) => item.title.length > 0 && item.prompt.length > 0)
    .slice(0, normalizeThemeCount(limit));

  if (themes.length === 0) {
    throw new Error("DeepSeek response did not include usable themes.");
  }

  return themes;
}

function normalizeThemeCount(themeCount: unknown): number {
  const numericValue = typeof themeCount === "number" ? themeCount : Number(themeCount);
  const rounded = Number.isFinite(numericValue) ? Math.round(numericValue) : 1;
  return Math.min(10, Math.max(1, rounded));
}

function isAllowedDeepSeekModel(value: unknown): value is DeepSeekModel {
  return typeof value === "string" && ALLOWED_DEEPSEEK_MODELS.includes(value as DeepSeekModel);
}

function isPracticeType(value: unknown): value is PracticeType {
  return typeof value === "string" && PRACTICE_TYPES.includes(value as PracticeType);
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
