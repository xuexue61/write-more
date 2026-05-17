import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_GENERATION_PROVIDER,
  DEFAULT_PRACTICE_TYPE,
  THEME_GENERATION_SYSTEM_PROMPT,
  buildNotePath,
  buildThemeGenerationPrompt,
  countWritingUnits,
  createClientId,
  extractThemesFromPayload,
  isAllowedDeepSeekModel,
  isThemeCacheCurrent,
  makeUniquePath,
  normalizeDeepSeekModel,
  normalizeGenerationProvider,
  normalizePracticeType,
  normalizeThemeCount,
  parseThemesResponse,
  sanitizeFileName,
  stripFrontmatter
} from "../src/core";

test("stripFrontmatter removes YAML frontmatter", () => {
  assert.equal(stripFrontmatter("---\ntitle: Test\n---\n正文"), "正文");
});

test("countWritingUnits counts Han characters and latin/number runs", () => {
  const content = "---\ntitle: Test\n---\n你好 world 123 GPT-4";
  assert.equal(countWritingUnits(content), 5);
});

test("sanitizeFileName removes invalid path characters and falls back", () => {
  assert.equal(sanitizeFileName("  早晨/雨:声?  "), "早晨雨声");
  assert.equal(sanitizeFileName("///???"), "未命名主题");
});

test("buildNotePath uses the target folder and safe file name", () => {
  assert.equal(buildNotePath("写作主题/", "2026-05-16", "雨/夜"), "写作主题/2026-05-16 雨夜.md");
});

test("makeUniquePath appends numeric suffixes", () => {
  const existing = new Set(["写作主题/2026-05-16 雨夜.md", "写作主题/2026-05-16 雨夜-2.md"]);
  assert.equal(
    makeUniquePath("写作主题/2026-05-16 雨夜.md", (path) => existing.has(path)),
    "写作主题/2026-05-16 雨夜-3.md"
  );
});

test("parseThemesResponse reads JSON and code fences", () => {
  const themes = parseThemesResponse(
    '```json\n{"themes":[{"title":"雨夜","prompt":"写一个雨夜里的选择。"}]}\n```',
    5
  );

  assert.deepEqual(themes, [{ title: "雨夜", prompt: "写一个雨夜里的选择。" }]);
});

test("extractThemesFromPayload reads proxy JSON payloads", () => {
  assert.deepEqual(extractThemesFromPayload({ themes: [{ title: "雪灯", prompt: "从雪夜点灯开始写。" }] }, 5), [
    { title: "雪灯", prompt: "从雪夜点灯开始写。" }
  ]);
});

test("buildThemeGenerationPrompt includes the selected practice type guidance", () => {
  const prompt = buildThemeGenerationPrompt(5, "角色练习");

  assert.match(prompt, /5 个/);
  assert.match(prompt, /中文小说主题/);
  assert.match(prompt, /本次练习类型是「角色练习」/);
  assert.match(prompt, /具体角色设定/);
  assert.match(prompt, /核心矛盾或秘密/);
  assert.match(prompt, /一个具体场景/);
  assert.match(prompt, /通过什么方式展现人物/);
});

test("THEME_GENERATION_SYSTEM_PROMPT defines novel coach and JSON constraints", () => {
  assert.match(THEME_GENERATION_SYSTEM_PROMPT, /专业的中文小说写作教练/);
  assert.match(THEME_GENERATION_SYSTEM_PROMPT, /创意小说写作训练/);
  assert.match(THEME_GENERATION_SYSTEM_PROMPT, /8字以内/);
  assert.match(THEME_GENERATION_SYSTEM_PROMPT, /\{"themes":\[\{"title":"\.\.\.","prompt":"\.\.\."\}\]\}/);
});

test("buildThemeGenerationPrompt includes novel guidance for every practice type", () => {
  assert.match(buildThemeGenerationPrompt(3, "剧情练习"), /待解决的问题/);
  assert.match(buildThemeGenerationPrompt(3, "剧情练习"), /从哪个瞬间开始写/);
  assert.match(buildThemeGenerationPrompt(3, "剧情练习"), /冲突升级/);
  assert.match(buildThemeGenerationPrompt(3, "节奏练习"), /适合该节奏的场景/);
  assert.match(buildThemeGenerationPrompt(3, "节奏练习"), /实现技巧提示/);
  assert.match(buildThemeGenerationPrompt(3, "节奏练习"), /用破折号制造停顿/);
  assert.match(buildThemeGenerationPrompt(3, "文笔练习"), /具体的描写对象/);
  assert.match(buildThemeGenerationPrompt(3, "文笔练习"), /五感描写/);
  assert.match(buildThemeGenerationPrompt(3, "文笔练习"), /明确的练习目标/);
  assert.match(buildThemeGenerationPrompt(3, "脑洞练习"), /创意发散/);
  assert.match(buildThemeGenerationPrompt(3, "脑洞练习"), /打破常规的设定或假设/);
  assert.match(buildThemeGenerationPrompt(3, "脑洞练习"), /世界观脑洞/);
  assert.match(buildThemeGenerationPrompt(3, "脑洞练习"), /具体的故事起点/);
  assert.match(buildThemeGenerationPrompt(3, "随便写写"), /具体的小说写作练习命题/);
  assert.match(buildThemeGenerationPrompt(3, "随便写写"), /马上开始写/);
});

test("normalizePracticeType falls back to the default practice type", () => {
  assert.equal(normalizePracticeType("剧情练习"), "剧情练习");
  assert.equal(normalizePracticeType("脑洞练习"), "脑洞练习");
  assert.equal(normalizePracticeType("未知练习"), DEFAULT_PRACTICE_TYPE);
  assert.equal(normalizePracticeType(undefined), DEFAULT_PRACTICE_TYPE);
});

test("generation provider, model, theme count, and client id helpers normalize safely", () => {
  assert.equal(normalizeGenerationProvider("vercel-proxy"), "vercel-proxy");
  assert.equal(normalizeGenerationProvider("custom-key"), "custom-key");
  assert.equal(normalizeGenerationProvider("unknown"), DEFAULT_GENERATION_PROVIDER);
  assert.equal(isAllowedDeepSeekModel("deepseek-v4-flash"), true);
  assert.equal(isAllowedDeepSeekModel("bad-model"), false);
  assert.equal(normalizeDeepSeekModel("deepseek-v4-pro"), "deepseek-v4-pro");
  assert.equal(normalizeDeepSeekModel("bad-model"), "deepseek-v4-flash");
  assert.equal(normalizeThemeCount(0), 1);
  assert.equal(normalizeThemeCount(12), 10);
  assert.equal(normalizeThemeCount(4.6), 5);
  assert.match(createClientId(), /^wod-/);
});

test("isThemeCacheCurrent treats old caches as default practice type", () => {
  assert.equal(isThemeCacheCurrent("2026-05-16", "随便写写", "2026-05-16", undefined), true);
  assert.equal(isThemeCacheCurrent("2026-05-16", "角色练习", "2026-05-16", undefined), false);
});

test("isThemeCacheCurrent does not reuse same-day cache for another practice type", () => {
  assert.equal(isThemeCacheCurrent("2026-05-16", "文笔练习", "2026-05-16", "剧情练习"), false);
  assert.equal(isThemeCacheCurrent("2026-05-16", "文笔练习", "2026-05-16", "文笔练习"), true);
});
