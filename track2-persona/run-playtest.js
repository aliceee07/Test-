/**
 * track2-persona/run-playtest.js
 *
 * 入口脚本：一次性跑完全部角色的所有 scenario，输出 JSON 报告。
 *
 * 用法：
 *   node track2-persona/run-playtest.js
 *   node track2-persona/run-playtest.js --char=char1
 *   node track2-persona/run-playtest.js --char=char1 --scenario=C1-5
 *   node track2-persona/run-playtest.js --model=gemini-2.5-flash-lite
 *   node track2-persona/run-playtest.js --char=char1 --scenario=C1-5 --model=gemini-2.5-pro
 *
 * 环境变量：
 *   GEMINI_API_KEY   必填，Gemini API Key
 *   GEMINI_MODEL     可选，优先级低于 --model 参数，低于 config.local.js
 *
 * 模型优先级（高→低）：
 *   --model= 参数 > GEMINI_MODEL 环境变量 > NPC-/config.local.js > 默认值 gemini-2.5-flash-lite
 *
 * 输出：
 *   reports/persona/YYYY-MM-DD_HH-MM-SS/
 *     ├── summary.json          所有 scenario 的摘要
 *     ├── char1_C1-1_套路能否穿透.json
 *     ├── char1_C1-2_真实性能否触碰.json
 *     └── ...（每个 scenario 一个文件）
 */

import { readFileSync, mkdirSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

import { runScenario } from "./playtest-runner.js";
import { getCharacterById } from "../shared/characters-data.js";
import { char1Scenarios } from "./char1-scenarios.js";
import { char2Scenarios } from "./char2-scenarios.js";
import { char3Scenarios } from "./char3-scenarios.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── 配置 ───────────────────────────────────────────────────────────────────

function readConfigLocal() {
  try {
    const configPath = resolve(__dirname, "../../NPC-/config.local.js");
    const content = readFileSync(configPath, "utf-8");

    // 单 key：GEMINI_PRESET_KEY = "xxx"
    const keyMatch = content.match(/GEMINI_PRESET_KEY\s*=\s*["']([^"']+)["']/);

    // 多 key：GEMINI_PRESET_KEYS = ["key1", "key2", ...]
    const keysMatch = content.match(/GEMINI_PRESET_KEYS\s*=\s*\[([^\]]+)\]/);
    let keys = [];
    if (keysMatch) {
      keys = [...keysMatch[1].matchAll(/["']([^"']+)["']/g)].map((m) => m[1]).filter(Boolean);
    }

    const modelMatch = content.match(/GEMINI_PRESET_MODEL\s*=\s*["']([^"']+)["']/);
    return {
      key:   keyMatch?.[1] ?? null,
      keys,
      model: modelMatch?.[1] ?? null,
    };
  } catch {
    return { key: null, keys: [], model: null };
  }
}

/**
 * 合并所有来源的 key，去重后返回数组。
 * 优先级：环境变量 > GEMINI_PRESET_KEYS 数组 > GEMINI_PRESET_KEY 单个
 */
function getApiKeys(configLocal) {
  const all = [
    ...(process.env.GEMINI_API_KEY ? [process.env.GEMINI_API_KEY] : []),
    ...configLocal.keys,
    ...(configLocal.key ? [configLocal.key] : []),
  ];
  // 去重（保持顺序）
  return [...new Set(all.filter(Boolean))];
}

function getModelName(configLocal, argModel) {
  // 优先级：--model 参数 > 环境变量 > config.local.js > 默认值
  return (
    argModel ||
    process.env.GEMINI_MODEL ||
    configLocal.model ||
    "gemini-2.5-flash-lite"
  );
}

function parseArgs() {
  const charArg     = process.argv.find((a) => a.startsWith("--char="));
  const modelArg    = process.argv.find((a) => a.startsWith("--model="));
  const scenarioArg = process.argv.find((a) => a.startsWith("--scenario="));
  return {
    charFilter:     charArg     ? charArg.split("=")[1]     : null,
    modelArg:       modelArg    ? modelArg.split("=")[1]    : null,
    scenarioFilter: scenarioArg ? scenarioArg.split("=")[1] : null,
  };
}

// ─── 报告目录 ────────────────────────────────────────────────────────────────

function makeReportDir() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const timestamp = [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    "_",
    pad(now.getHours()),
    "-",
    pad(now.getMinutes()),
    "-",
    pad(now.getSeconds()),
  ].join("");

  const dir = resolve(__dirname, "../reports/persona", timestamp);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function sanitizeFilename(str) {
  return str.replace(/[/\\?%*:|"<>]/g, "_").replace(/\s+/g, "_");
}

// ─── 主流程 ──────────────────────────────────────────────────────────────────

const ALL_CHAR_SCENARIOS = [
  { charId: "char1", scenarios: char1Scenarios },
  { charId: "char2", scenarios: char2Scenarios },
  { charId: "char3", scenarios: char3Scenarios },
];

async function main() {
  const configLocal = readConfigLocal();
  const { charFilter, modelArg, scenarioFilter } = parseArgs();

  const apiKeys  = getApiKeys(configLocal);
  const modelName = getModelName(configLocal, modelArg);

  if (apiKeys.length === 0) {
    console.error(
      "错误：未找到 Gemini API Key。\n" +
      "方式1: 设置环境变量 GEMINI_API_KEY\n" +
      "方式2: 在 NPC-/config.local.js 中配置 GEMINI_PRESET_KEY（单个）\n" +
      "方式3: 在 NPC-/config.local.js 中配置 GEMINI_PRESET_KEYS（多个数组）"
    );
    process.exit(1);
  }

  // 共享 key 轮换状态，跨所有 scenario 保持 key 索引
  const keyState = { index: 0 };

  const reportDir = makeReportDir();

  console.log("═══════════════════════════════════════════════");
  console.log("NPC 人设表现 Playtest — Track 2");
  console.log(`模型:     ${modelName}`);
  console.log(`API Key:  ${apiKeys.length} 个（自动轮换）`);
  console.log(`报告目录: ${reportDir}`);
  if (charFilter)     console.log(`筛选角色:      ${charFilter}`);
  if (scenarioFilter) console.log(`筛选 scenario: ${scenarioFilter}`);
  console.log("═══════════════════════════════════════════════");

  const summaryRows = [];
  let totalScenarios = 0;
  let errorCount = 0;

  for (const { charId, scenarios } of ALL_CHAR_SCENARIOS) {
    if (charFilter && charFilter !== charId) continue;

    const character = getCharacterById(charId);
    console.log(`\n▶ 角色: ${character.name} (${charId})`);
    console.log("─".repeat(47));

    for (const scenario of scenarios.filter(s => !scenarioFilter || s.id === scenarioFilter)) {
      totalScenarios++;
      let result;

      try {
        result = await runScenario(character, scenario, apiKeys, modelName, keyState);
      } catch (err) {
        console.error(`  FATAL ERROR in ${scenario.id}: ${err.message}`);
        errorCount++;
        result = {
          scenario_id: scenario.id,
          scenario_name: scenario.name,
          character_id: charId,
          character_name: character.name,
          intent: scenario.intent,
          expected: scenario.expected,
          fatal_error: err.message,
          turns: [],
          ran_at: new Date().toISOString(),
        };
      }

      // 写入单个 scenario 的 JSON 文件
      const filename = sanitizeFilename(
        `${charId}_${scenario.id}_${scenario.name}.json`
      );
      const filepath = resolve(reportDir, filename);
      writeFileSync(filepath, JSON.stringify(result, null, 2), "utf-8");

      // 摘要行
      const keyTurn = result.turns?.find((t) => t.is_key_turn);
      summaryRows.push({
        scenario_id: scenario.id,
        scenario_name: scenario.name,
        character_id: charId,
        character_name: character.name,
        intent: scenario.intent,
        expected: scenario.expected,
        final_candor: result.final_candor ?? "?",
        final_closing_streak: result.final_closing_streak ?? "?",
        character_closed: result.character_closed ?? false,
        key_turn_touched: keyTurn?.touched ?? null,
        key_turn_closing_signal: keyTurn?.closing_signal ?? null,
        key_turn_candor_change:
          keyTurn
            ? `${keyTurn.candor_before}→${keyTurn.candor_after}`
            : null,
        fatal_error: result.fatal_error ?? null,
        report_file: filename,
      });

      // scenario 间隔，避免 API 限速（免费 tier 5次/分钟）
      await sleep(15000);
    }
  }

  // 写入摘要
  const summaryPath = resolve(reportDir, "summary.json");
  const summary = {
    ran_at: new Date().toISOString(),
    model: modelName,
    api_key_count: apiKeys.length,
    total_scenarios: totalScenarios,
    error_count: errorCount,
    char_filter: charFilter ?? "all",
    scenarios: summaryRows,
  };
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2), "utf-8");

  // 控制台摘要
  console.log("\n\n═══════════════════════════════════════════════");
  console.log("Playtest 完成");
  console.log(`共跑: ${totalScenarios} 个 scenario，错误: ${errorCount}`);
  console.log(`\n摘要（key turn 结果）：\n`);
  for (const row of summaryRows) {
    const touched =
      row.key_turn_touched === null
        ? "N/A"
        : row.key_turn_touched
        ? "touched✓"
        : "touched✗";
    const candor = row.key_turn_candor_change ?? "?";
    const err = row.fatal_error ? ` [ERROR: ${row.fatal_error.slice(0, 40)}]` : "";
    console.log(
      `  ${row.character_id} ${row.scenario_id.padEnd(5)} ${row.scenario_name.padEnd(12)} | ${touched} candor:${candor}${err}`
    );
  }
  console.log(`\n报告已写入: ${reportDir}`);
  console.log("═══════════════════════════════════════════════\n");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
