import assert from "node:assert/strict";
import test from "node:test";
import { DeepSeekPressureNarrativeProviderV1 } from "./narrative-provider";

test("turn presentation streams sceneText before returning the complete JSON candidate", async () => {
  const requestBodies: Record<string, unknown>[] = [];
  const chunks = [
    '{"sceneText":"第一句真正的AI剧情。',
    '\\n\\n第二段继续生成。","question":"怎么办？","options":[],"usedFactRefs":[],"claims":[]}',
  ];
  const fetchImpl: typeof fetch = async (_url, init) => {
    requestBodies.push(JSON.parse(String(init?.body ?? "{}")));
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            choices: [{ delta: { content: chunk } }],
          })}\n\n`));
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    return new Response(body, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  };
  const provider = new DeepSeekPressureNarrativeProviderV1({
    apiKey: "test-key",
    endpoint: "https://api.deepseek.com/chat/completions",
    model: "deepseek-v4-flash",
    fetchImpl,
  });
  const updates: string[] = [];
  const result = await provider.renderTurnPresentation(
    { contextHash: "a".repeat(64) } as never,
    (sceneText) => updates.push(sceneText),
  ) as Record<string, unknown>;
  assert.equal(requestBodies[0]?.stream, true);
  assert.deepEqual(requestBodies[0]?.stream_options, { include_usage: true });
  assert.ok(updates.length >= 2);
  assert.match(updates[0] ?? "", /第一句真正的AI剧情/u);
  assert.match(updates.at(-1) ?? "", /第二段继续生成/u);
  assert.equal(result.sceneText, "第一句真正的AI剧情。\n\n第二段继续生成。");
  assert.equal(result.question, "怎么办？");
});

test("chapter summary streams closingNarrative before returning the complete summary", async () => {
  const requestBodies: Record<string, unknown>[] = [];
  const chunks = [
    '{"closingNarrative":"九堰的最后一道命令已经送出。',
    '\\n\\n泥水中的得失开始汇成结论。","playerActions":[],"actualResults":[],"completedObjectives":[],"incompleteObjectives":[],"metricChanges":[],"remainingPressures":[],"nextChapterHook":"进入下一章。"}',
  ];
  const fetchImpl: typeof fetch = async (_url, init) => {
    requestBodies.push(JSON.parse(String(init?.body ?? "{}")));
    const encoder = new TextEncoder();
    return new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: chunk } }] })}\n\n`));
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    }), { status: 200, headers: { "content-type": "text/event-stream" } });
  };
  const provider = new DeepSeekPressureNarrativeProviderV1({
    apiKey: "test-key",
    endpoint: "https://api.deepseek.com/chat/completions",
    model: "deepseek-v4-flash",
    fetchImpl,
  });
  const updates: string[] = [];
  const result = await provider.renderOneCallStory(
    { mode: "CHAPTER_SUMMARY" },
    (text) => updates.push(text),
  ) as Record<string, unknown>;
  assert.equal(requestBodies[0]?.stream, true);
  assert.match(updates[0] ?? "", /最后一道命令/u);
  assert.match(updates.at(-1) ?? "", /汇成结论/u);
  assert.match(String(result.closingNarrative), /泥水中的得失/u);
});
