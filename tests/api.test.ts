import test from "node:test";
import assert from "node:assert/strict";
import { GET, POST } from "../api/generate-themes";

const VALID_BODY = {
  practiceType: "剧情练习",
  themeCount: 5,
  model: "deepseek-v4-flash",
  clientId: "wod-test"
};

test("GET returns method not allowed", async () => {
  const response = GET();
  assert.equal(response.status, 405);
});

test("POST rejects invalid practice type and model before reading env", async () => {
  const invalidPracticeResponse = await POST(jsonRequest({ ...VALID_BODY, practiceType: "未知练习" }));
  assert.equal(invalidPracticeResponse.status, 400);

  const invalidModelResponse = await POST(jsonRequest({ ...VALID_BODY, model: "bad-model" }));
  assert.equal(invalidModelResponse.status, 400);
});

test("POST reports missing server DeepSeek configuration without leaking secrets", async () => {
  const previousKey = process.env.DEEPSEEK_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;

  try {
    const response = await POST(jsonRequest(VALID_BODY));
    const payload = (await response.json()) as { error?: string };

    assert.equal(response.status, 500);
    assert.match(payload.error ?? "", /missing DeepSeek configuration/);
    assert.doesNotMatch(JSON.stringify(payload), new RegExp("s" + "k-"));
  } finally {
    restoreEnv(previousKey);
  }
});

test("POST calls DeepSeek with server-side prompt and returns themes", async () => {
  const previousKey = process.env.DEEPSEEK_API_KEY;
  const previousFetch = globalThis.fetch;
  let capturedAuth = "";
  let capturedBody = "";

  process.env.DEEPSEEK_API_KEY = "test-secret";
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    capturedAuth = String(new Headers(init?.headers).get("Authorization"));
    capturedBody = String(init?.body);

    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                themes: [{ title: "雨巷", prompt: "从雨巷尽头传来的脚步声开始写。" }]
              })
            }
          }
        ]
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }) as typeof fetch;

  try {
    const response = await POST(jsonRequest(VALID_BODY));
    const payload = (await response.json()) as { themes?: Array<{ title: string; prompt: string }> };

    assert.equal(response.status, 200);
    assert.equal(capturedAuth, "Bearer test-secret");
    assert.match(capturedBody, /本次练习类型是「剧情练习」/);
    assert.doesNotMatch(capturedBody, /wod-test/);
    assert.deepEqual(payload.themes, [{ title: "雨巷", prompt: "从雨巷尽头传来的脚步声开始写。" }]);
  } finally {
    globalThis.fetch = previousFetch;
    restoreEnv(previousKey);
  }
});

function jsonRequest(body: unknown): Request {
  return new Request("https://example.com/api/generate-themes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

function restoreEnv(value: string | undefined): void {
  if (value === undefined) {
    delete process.env.DEEPSEEK_API_KEY;
    return;
  }

  process.env.DEEPSEEK_API_KEY = value;
}
