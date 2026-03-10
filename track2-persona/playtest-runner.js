/**
 * track2-persona/playtest-runner.js
 *
 * 核心执行器：
 * 1. 接收一个角色对象 + 一个 scenario 定义
 * 2. 按 scenario 中定义的多轮输入序列，依次调用真实 Gemini API
 * 3. 本地模拟 candor / closingStreak 状态机（镜像 dialogue.js 逻辑）
 * 4. 返回完整的多轮记录供写入报告
 *
 * 使用方式：
 *   import { runScenario } from './playtest-runner.js';
 *   const result = await runScenario(character, scenario, apiKey);
 */

import fetch from "node-fetch";
import { stepCandorAndColor } from "../shared/characters-data.js";

const GEMINI_BASE_URL =
  "https://generativelanguage.googleapis.com/v1beta/models";

const CLOSE_THRESHOLD = 3;

// ─── Gemini API 调用 ────────────────────────────────────────────────────────

/**
 * 调用 Gemini API，返回解析后的 JSON 对象。
 * @param {object} opts
 * @param {string} opts.apiKey
 * @param {string} opts.modelName
 * @param {string} opts.systemPrompt
 * @param {Array<{role: string, text: string}>} opts.history  已有对话历史
 * @param {string} opts.userMessage  本轮用户输入
 * @param {object} opts.responseSchema  JSON Schema
 * @returns {Promise<object>}  解析后的 JSON
 */
/**
 * 从 429 响应体中提取建议的等待秒数
 * 返回 { waitMs, isDaily }
 *   isDaily=true  表示日配额耗尽（retryDelay > 120s），应切换 key
 *   isDaily=false 表示分钟限速，等待后可用同一 key 重试
 */
function parseRetryInfo(errBody) {
  try {
    const obj = JSON.parse(errBody);
    const details = obj?.error?.details ?? [];
    for (const d of details) {
      if (d["@type"]?.includes("RetryInfo") && d.retryDelay) {
        const seconds = parseInt(d.retryDelay, 10);
        if (!isNaN(seconds)) {
          return {
            waitMs: (seconds + 5) * 1000,
            isDaily: seconds > 120,
          };
        }
      }
    }
  } catch { /* 解析失败忽略 */ }
  return { waitMs: 65000, isDaily: false };
}

/**
 * 调用 Gemini API，支持多 key 自动轮换。
 *
 * @param {object} opts
 * @param {string[]} opts.apiKeys     API Key 数组（至少1个）
 * @param {object}  opts.keyState     共享可变对象 { index: number }，跨调用保持 key 位置
 * @param {string}  opts.modelName
 * @param {string}  opts.systemPrompt
 * @param {Array}   opts.history
 * @param {string}  opts.userMessage
 * @param {object}  opts.responseSchema
 */
async function callGemini({ apiKeys, keyState, modelName = "gemini-2.5-flash-lite", systemPrompt, history, userMessage, responseSchema }) {
  const contents = [
    ...history.map((msg) => ({
      role: msg.role === "user" ? "user" : "model",
      parts: [{ text: msg.text }],
    })),
    { role: "user", parts: [{ text: userMessage }] },
  ];

  const body = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents,
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: normalizeSchema(responseSchema),
    },
  };

  // 每个 key 最多重试 3 次（针对分钟限速 + 503 过载）
  const MAX_RETRIES_PER_KEY = 3;
  // 总尝试次数上限 = key数量 × 每key重试次数
  const totalKeys = apiKeys.length;
  let keysTriedFromCurrent = 0;

  while (true) {
    const currentKey = apiKeys[keyState.index];
    const url = `${GEMINI_BASE_URL}/${modelName}:generateContent?key=${currentKey}`;

    let attemptsThisKey = 0;
    let rotated = false;

    for (let attempt = 1; attempt <= MAX_RETRIES_PER_KEY; attempt++) {
      attemptsThisKey++;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      // ── 429 限速 ──────────────────────────────────────────────────────────
      if (res.status === 429) {
        const errText = await res.text();
        const { waitMs, isDaily } = parseRetryInfo(errText);
        const waitSec = Math.round(waitMs / 1000);
        const keyLabel = `key[${keyState.index + 1}/${totalKeys}]`;

        if (isDaily) {
          // 日配额耗尽 → 立即切换下一个 key
          process.stdout.write(`\n  [日配额耗尽 ${keyLabel}] 切换到下一个 key... `);
          rotated = true;
          break;
        } else if (attempt < MAX_RETRIES_PER_KEY) {
          // 分钟限速 → 等待后重试同一 key
          process.stdout.write(`\n  [限速 429 ${keyLabel}] 等待 ${waitSec}s 后重试 (${attempt}/${MAX_RETRIES_PER_KEY})... `);
          await new Promise((r) => setTimeout(r, waitMs));
          continue;
        } else {
          // 同一 key 重试次数耗尽 → 切换
          process.stdout.write(`\n  [限速 429 ${keyLabel}] 重试耗尽，切换到下一个 key... `);
          rotated = true;
          break;
        }
      }

      // ── 503 过载 ──────────────────────────────────────────────────────────
      if (res.status === 503) {
        const errText = await res.text();
        const keyLabel = `key[${keyState.index + 1}/${totalKeys}]`;
        if (attempt < MAX_RETRIES_PER_KEY) {
          const waitMs = Math.min(20000 * Math.pow(2, attempt - 1), 120000);
          const waitSec = Math.round(waitMs / 1000);
          process.stdout.write(`\n  [过载 503 ${keyLabel}] 等待 ${waitSec}s 后重试 (${attempt}/${MAX_RETRIES_PER_KEY})... `);
          await new Promise((r) => setTimeout(r, waitMs));
          continue;
        } else {
          process.stdout.write(`\n  [过载 503 ${keyLabel}] 重试耗尽，切换到下一个 key... `);
          rotated = true;
          break;
        }
      }

      // ── 其他错误 ──────────────────────────────────────────────────────────
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Gemini API error ${res.status}: ${errText}`);
      }

      // ── 成功 ──────────────────────────────────────────────────────────────
      const data = await res.json();
      const candidates = data?.candidates;
      if (!candidates || candidates.length === 0) {
        throw new Error("Gemini returned no candidates");
      }
      const parts = candidates[0]?.content?.parts || [];
      const textParts = parts.filter((p) => !p.thought);
      const rawText = textParts.map((p) => p.text).join("");
      try {
        return JSON.parse(rawText);
      } catch {
        throw new Error(`Failed to parse Gemini response as JSON: ${rawText}`);
      }
    }

    // 需要切换 key
    if (rotated) {
      keysTriedFromCurrent++;
      if (keysTriedFromCurrent >= totalKeys) {
        throw new Error(`所有 ${totalKeys} 个 API Key 均已耗尽配额或不可用，请明天再试。`);
      }
      keyState.index = (keyState.index + 1) % totalKeys;
      process.stdout.write(`→ 切换至 key[${keyState.index + 1}/${totalKeys}]\n`);
    }
  }
}

/** 将 JSON Schema type 值转为大写（Gemini 要求） */
function normalizeSchema(schema) {
  if (!schema || typeof schema !== "object") return schema;
  const result = { ...schema };
  if (result.type && typeof result.type === "string") {
    result.type = result.type.toUpperCase();
  }
  if (result.properties) {
    result.properties = Object.fromEntries(
      Object.entries(result.properties).map(([k, v]) => [k, normalizeSchema(v)])
    );
  }
  if (result.items) result.items = normalizeSchema(result.items);
  return result;
}

// ─── 对话阶段 Schema ────────────────────────────────────────────────────────

const DIALOGUE_SCHEMA = {
  type: "object",
  properties: {
    reply: { type: "string" },
    touched: { type: "boolean" },
    closing_signal: { type: "boolean" },
  },
  required: ["reply", "touched", "closing_signal"],
};

// ─── 核心执行函数 ────────────────────────────────────────────────────────────

/**
 * 执行一个完整的 scenario。
 *
 * @param {object}   character   来自 characters-data.js 的角色对象（已深拷贝）
 * @param {object}   scenario    scenario 定义对象，格式见 char*-scenarios.js
 * @param {string[]} apiKeys     API Key 数组（单个 key 也传 [key]）
 * @param {string}   [modelName] 模型名称，默认 gemini-2.5-flash-lite
 * @param {object}   [keyState]  共享 key 索引状态 { index: number }，跨 scenario 保持
 * @returns {Promise<ScenarioResult>}
 */
export async function runScenario(character, scenario, apiKeys, modelName = "gemini-2.5-flash-lite", keyState = { index: 0 }) {
  let currentChar = { ...character };
  let closingStreak = 0;
  const history = []; // { role: 'user'|'model', text: string }
  const turns = [];

  console.log(`\n  [${character.name}] ${scenario.id}: ${scenario.name}`);
  console.log(`  意图: ${scenario.intent}`);
  console.log(`  预期: ${scenario.expected}\n`);

  for (let i = 0; i < scenario.inputs.length; i++) {
    const input = scenario.inputs[i];
    const isKeyTurn = i === scenario.keyTurnIndex;
    const candorBefore = currentChar.currentCandor;
    const streakBefore = closingStreak;

    process.stdout.write(`  turn ${i + 1}/${scenario.inputs.length} "${input.substring(0, 30)}${input.length > 30 ? "…" : ""}" → `);

    let result;
    try {
      result = await callGemini({
        apiKeys,
        keyState,
        modelName,
        systemPrompt: currentChar.systemPrompt,
        history,
        userMessage: input,
        responseSchema: DIALOGUE_SCHEMA,
      });
    } catch (err) {
      console.error(`\n  ERROR: ${err.message}`);
      turns.push({
        turn: i + 1,
        is_key_turn: isKeyTurn,
        input,
        error: err.message,
        candor_before: candorBefore,
        candor_after: candorBefore,
        closing_streak_before: streakBefore,
        closing_streak_after: streakBefore,
      });
      // 记录到历史但跳过状态更新
      history.push({ role: "user", text: input });
      history.push({ role: "model", text: "[ERROR]" });
      continue;
    }

    // 更新 candor
    currentChar = stepCandorAndColor(currentChar, result.touched);
    const candorAfter = currentChar.currentCandor;

    // 更新 closingStreak
    if (result.closing_signal) {
      closingStreak += 1;
    } else {
      closingStreak = 0;
    }
    const streakAfter = closingStreak;

    // 更新对话历史
    history.push({ role: "user", text: input });
    history.push({ role: "model", text: result.reply });

    const turnRecord = {
      turn: i + 1,
      is_key_turn: isKeyTurn,
      input,
      reply: result.reply,
      touched: result.touched,
      closing_signal: result.closing_signal,
      candor_before: candorBefore,
      candor_after: candorAfter,
      closing_streak_before: streakBefore,
      closing_streak_after: streakAfter,
      character_closed: streakAfter >= CLOSE_THRESHOLD,
    };

    // key turn 携带 reviewer_note
    if (isKeyTurn) {
      turnRecord.reviewer_note = scenario.expected;
    }

    turns.push(turnRecord);

    // 控制台简要输出
    const candorStr = `candor ${candorBefore}→${candorAfter}`;
    const touchedStr = result.touched ? "touched✓" : "touched✗";
    const closingStr = result.closing_signal ? "closing✓" : "";
    console.log(`${touchedStr} ${candorStr} ${closingStr}`);

    // C3-4 镜像全程验证：一旦 closing 触发就终止
    if (scenario.stopOnClosing && streakAfter >= CLOSE_THRESHOLD) {
      console.log("  → closing 触发，终止 scenario");
      break;
    }

    // turn 间隔：免费 tier 5次/分钟 → 每次至少间隔 13 秒
    if (i < scenario.inputs.length - 1) {
      await new Promise((r) => setTimeout(r, 13000));
    }
  }

  return {
    scenario_id: scenario.id,
    scenario_name: scenario.name,
    character_id: character.id,
    character_name: character.name,
    model: modelName,
    intent: scenario.intent,
    expected: scenario.expected,
    final_candor: currentChar.currentCandor,
    final_closing_streak: closingStreak,
    character_closed: closingStreak >= CLOSE_THRESHOLD,
    turns,
    ran_at: new Date().toISOString(),
  };
}
