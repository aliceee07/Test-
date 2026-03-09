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
async function callGemini({ apiKey, modelName = "gemini-2.0-flash", systemPrompt, history, userMessage, responseSchema }) {
  const url = `${GEMINI_BASE_URL}/${modelName}:generateContent?key=${apiKey}`;

  // 将内部历史格式转换为 Gemini contents 格式
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

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const candidates = data?.candidates;
  if (!candidates || candidates.length === 0) {
    throw new Error("Gemini returned no candidates");
  }

  const parts = candidates[0]?.content?.parts || [];
  // 过滤掉 thought 部分，只取实际 JSON 输出
  const textParts = parts.filter((p) => !p.thought);
  const rawText = textParts.map((p) => p.text).join("");

  try {
    return JSON.parse(rawText);
  } catch {
    throw new Error(`Failed to parse Gemini response as JSON: ${rawText}`);
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
 * @param {object} character  来自 characters-data.js 的角色对象（已深拷贝）
 * @param {object} scenario   scenario 定义对象，格式见 char*-scenarios.js
 * @param {string} apiKey     Gemini API Key
 * @returns {Promise<ScenarioResult>}
 */
export async function runScenario(character, scenario, apiKey) {
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
        apiKey,
        modelName: "gemini-2.0-flash",
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
  }

  return {
    scenario_id: scenario.id,
    scenario_name: scenario.name,
    character_id: character.id,
    character_name: character.name,
    intent: scenario.intent,
    expected: scenario.expected,
    final_candor: currentChar.currentCandor,
    final_closing_streak: closingStreak,
    character_closed: closingStreak >= CLOSE_THRESHOLD,
    turns,
    ran_at: new Date().toISOString(),
  };
}
