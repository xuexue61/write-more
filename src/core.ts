export interface WritingTheme {
  title: string;
  prompt: string;
}

export const PRACTICE_TYPES = ["剧情练习", "文笔练习", "角色练习", "节奏练习", "脑洞练习", "随便写写"] as const;

export type PracticeType = (typeof PRACTICE_TYPES)[number];

export const DEFAULT_PRACTICE_TYPE: PracticeType = "随便写写";

export const GENERATION_PROVIDERS = ["vercel-proxy", "custom-key"] as const;

export type GenerationProvider = (typeof GENERATION_PROVIDERS)[number];

export const DEFAULT_GENERATION_PROVIDER: GenerationProvider = "vercel-proxy";

export const ALLOWED_DEEPSEEK_MODELS = ["deepseek-v4-flash", "deepseek-v4-pro"] as const;

export type DeepSeekModel = (typeof ALLOWED_DEEPSEEK_MODELS)[number];

export const DEFAULT_DEEPSEEK_MODEL: DeepSeekModel = "deepseek-v4-flash";

export const THEME_GENERATION_SYSTEM_PROMPT = [
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

export function pad2(value: number): string {
  return value.toString().padStart(2, "0");
}

export function getLocalDateKey(date = new Date()): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function normalizePracticeType(value: unknown): PracticeType {
  return typeof value === "string" && PRACTICE_TYPES.includes(value as PracticeType)
    ? (value as PracticeType)
    : DEFAULT_PRACTICE_TYPE;
}

export function normalizeGenerationProvider(value: unknown): GenerationProvider {
  return typeof value === "string" && GENERATION_PROVIDERS.includes(value as GenerationProvider)
    ? (value as GenerationProvider)
    : DEFAULT_GENERATION_PROVIDER;
}

export function isAllowedDeepSeekModel(value: unknown): value is DeepSeekModel {
  return typeof value === "string" && ALLOWED_DEEPSEEK_MODELS.includes(value as DeepSeekModel);
}

export function normalizeDeepSeekModel(value: unknown): DeepSeekModel {
  return isAllowedDeepSeekModel(value) ? value : DEFAULT_DEEPSEEK_MODEL;
}

export function normalizeThemeCount(themeCount: unknown): number {
  const numericValue = typeof themeCount === "number" ? themeCount : Number(themeCount);
  const rounded = Number.isFinite(numericValue) ? Math.round(numericValue) : 1;
  return Math.min(10, Math.max(1, rounded));
}

export function createClientId(): string {
  const randomId = globalThis.crypto?.randomUUID?.();
  if (randomId) {
    return `wod-${randomId}`;
  }

  return `wod-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function buildThemeGenerationPrompt(themeCount: number, practiceType: PracticeType): string {
  const safeCount = normalizeThemeCount(themeCount);
  const normalizedType = normalizePracticeType(practiceType);

  return [
    `请生成 ${safeCount} 个适合今天开始写作的中文小说主题。`,
    `本次练习类型是「${normalizedType}」。`,
    PRACTICE_TYPE_GUIDANCE[normalizedType],
    "标题要短、有画面感；prompt 用 2 到 4 句给出具体写作方向。",
    "只返回 JSON：{\"themes\":[{\"title\":\"...\",\"prompt\":\"...\"}]}。"
  ].join("");
}

export function isThemeCacheCurrent(
  today: string,
  selectedPracticeType: PracticeType,
  cacheDate: string,
  cachePracticeType: unknown
): boolean {
  return today === cacheDate && normalizePracticeType(cachePracticeType) === selectedPracticeType;
}

export function stripFrontmatter(content: string): string {
  if (!content.startsWith("---")) {
    return content;
  }

  return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
}

export function countWritingUnits(content: string): number {
  const body = stripFrontmatter(content);
  const matches = body.match(/[\p{Script=Han}]|[A-Za-z0-9]+(?:[-_'][A-Za-z0-9]+)*/gu);
  return matches?.length ?? 0;
}

export function sanitizeFileName(title: string): string {
  const cleaned = title
    .replace(/[\\/:*?"<>|#^[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);

  return cleaned.length > 0 ? cleaned : "未命名主题";
}

export function normalizeFolderPath(folder: string): string {
  return folder.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "").trim();
}

export function buildNotePath(folder: string, dateKey: string, title: string): string {
  const fileName = `${dateKey} ${sanitizeFileName(title)}.md`;
  const normalizedFolder = normalizeFolderPath(folder);
  return normalizedFolder.length > 0 ? `${normalizedFolder}/${fileName}` : fileName;
}

export function makeUniquePath(basePath: string, exists: (path: string) => boolean): string {
  if (!exists(basePath)) {
    return basePath;
  }

  const extensionIndex = basePath.toLowerCase().endsWith(".md") ? basePath.length - 3 : basePath.length;
  const stem = basePath.slice(0, extensionIndex);
  const extension = basePath.slice(extensionIndex);

  let counter = 2;
  let candidate = `${stem}-${counter}${extension}`;
  while (exists(candidate)) {
    counter += 1;
    candidate = `${stem}-${counter}${extension}`;
  }

  return candidate;
}

export function parseThemesResponse(content: string, limit: number): WritingTheme[] {
  const parsed = parseJsonObject(content);
  return extractThemesFromPayload(parsed, limit);
}

export function extractThemesFromPayload(payload: unknown, limit: number): WritingTheme[] {
  const parsed = typeof payload === "object" && payload !== null ? (payload as { themes?: unknown }) : {};
  const rawThemes = Array.isArray(parsed.themes) ? parsed.themes : [];
  const themes = rawThemes
    .map((item) => ({
      title: typeof item?.title === "string" ? item.title.trim() : "",
      prompt: typeof item?.prompt === "string" ? item.prompt.trim() : ""
    }))
    .filter((item) => item.title.length > 0 && item.prompt.length > 0)
    .slice(0, Math.max(1, limit));

  if (themes.length === 0) {
    throw new Error("DeepSeek 返回中没有可用主题。");
  }

  return themes;
}

function parseJsonObject(content: string): { themes?: unknown } {
  const cleaned = content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");

  try {
    return JSON.parse(cleaned);
  } catch {
    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
    }
    throw new Error("DeepSeek 返回的 JSON 无法解析。");
  }
}
