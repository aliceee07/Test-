/**
 * track1-ui/ui-runner.js
 *
 * Track 1 UI 行为测试执行器。
 * 使用 Puppeteer 启动真实 Chromium，拦截 Gemini API fetch 请求注入 Mock 数据，
 * 依次执行 ui-cases.js 中定义的每个 case，输出 JSON 报告。
 *
 * 使用前提：
 *   需要本地启动 NPC Demo 服务器，或填写已部署的 URL。
 *   运行 `npx serve ../NPC-` 后，默认地址为 http://localhost:3000
 *
 * 用法：
 *   node track1-ui/ui-runner.js
 *   node track1-ui/ui-runner.js --url=http://localhost:3000
 *   node track1-ui/ui-runner.js --case=C2         （只跑指定 case）
 *
 * 输出：
 *   reports/ui/report_YYYY-MM-DD_HH-MM-SS.json
 */

import puppeteer from "puppeteer";
import { writeFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

import { uiCases } from "./ui-cases.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── 配置 ───────────────────────────────────────────────────────────────────

const DEFAULT_URL = "http://localhost:3000";
const GEMINI_URL_PATTERN = "https://generativelanguage.googleapis.com";

function parseArgs() {
  const urlArg = process.argv.find((a) => a.startsWith("--url="));
  const caseArg = process.argv.find((a) => a.startsWith("--case="));
  return {
    demoUrl: urlArg ? urlArg.split("=")[1] : DEFAULT_URL,
    caseFilter: caseArg ? caseArg.split("=")[1] : null,
  };
}

function makeReportPath() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const ts = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  const dir = resolve(__dirname, "../reports/ui");
  mkdirSync(dir, { recursive: true });
  return resolve(dir, `report_${ts}.json`);
}

// ─── Puppeteer 初始化 ────────────────────────────────────────────────────────

async function createPage(browser, demoUrl, mockApiResponse, mockDelay = 0) {
  const page = await browser.newPage();
  page.setDefaultTimeout(15000);

  // 拦截所有 Gemini API 请求
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    if (req.url().startsWith(GEMINI_URL_PATTERN)) {
      if (mockApiResponse === null) {
        // 不 Mock：直接继续（测空消息时不会发请求）
        req.continue();
        return;
      }
      // 延迟后返回 Mock 数据
      setTimeout(() => {
        req.respond({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(mockApiResponse),
        });
      }, mockDelay);
    } else {
      req.continue();
    }
  });

  // 导航到 Demo 页面
  await page.goto(demoUrl, { waitUntil: "networkidle0" });

  // 跳过介绍遮罩
  await skipIntroOverlay(page);

  return page;
}

async function skipIntroOverlay(page) {
  try {
    // 最多点击4次，跳过所有介绍行
    for (let i = 0; i < 5; i++) {
      const overlayVisible = await page.evaluate(() => {
        const el = document.getElementById("intro-overlay");
        return el && !el.classList.contains("dismissed") &&
               getComputedStyle(el).display !== "none" &&
               parseFloat(getComputedStyle(el).opacity) > 0;
      });
      if (!overlayVisible) break;
      await page.click("#intro-overlay").catch(() => {});
      await page.waitForTimeout(400);
    }
    // 等待遮罩消失（最多等 15s）
    await page.waitForFunction(
      () => {
        const el = document.getElementById("intro-overlay");
        if (!el) return true;
        return el.classList.contains("dismissed") ||
               parseFloat(getComputedStyle(el).opacity) < 0.01;
      },
      { timeout: 15000 }
    );
  } catch {
    // 遮罩可能已经消失，忽略超时错误
  }
}

// ─── 单个 case 执行 ──────────────────────────────────────────────────────────

async function runCase(browser, demoUrl, testCase) {
  const startTime = Date.now();
  console.log(`\n  [${testCase.id}] ${testCase.name}`);
  console.log(`  节点: ${testCase.node} | ${testCase.description}`);

  let page;
  try {
    page = await createPage(
      browser,
      demoUrl,
      testCase.mockApiResponse,
      testCase.mockDelay ?? 0
    );
  } catch (err) {
    return {
      id: testCase.id,
      name: testCase.name,
      node: testCase.node,
      setup_error: `页面加载失败: ${err.message}`,
      assertions: [],
      elapsed_ms: Date.now() - startTime,
    };
  }

  let stepData = {};
  let stepError = null;
  try {
    stepData = await testCase.steps(page);
  } catch (err) {
    stepError = err.message;
    console.error(`  steps 执行错误: ${err.message}`);
  }

  let assertions = [];
  if (!stepError) {
    try {
      assertions = await testCase.assertions(page, stepData);
    } catch (err) {
      console.error(`  assertions 执行错误: ${err.message}`);
      assertions = [{ id: "assertion-error", desc: err.message, pass: false }];
    }
  }

  await page.close();

  const allPassed = assertions.length > 0 && assertions.every((a) => a.pass);
  const elapsed = Date.now() - startTime;

  // 控制台输出
  for (const a of assertions) {
    const icon = a.pass ? "✓" : "✗";
    console.log(`    ${icon} ${a.desc}${a.actual ? ` (${a.actual})` : ""}`);
  }
  console.log(`  → ${allPassed ? "PASS" : "FAIL"} (${elapsed}ms)`);

  return {
    id: testCase.id,
    name: testCase.name,
    node: testCase.node,
    description: testCase.description,
    pass: allPassed,
    step_error: stepError ?? null,
    assertions,
    elapsed_ms: elapsed,
  };
}

// ─── 主流程 ──────────────────────────────────────────────────────────────────

async function main() {
  const { demoUrl, caseFilter } = parseArgs();
  const reportPath = makeReportPath();

  console.log("═══════════════════════════════════════════════");
  console.log("NPC UI 行为测试 — Track 1");
  console.log(`Demo URL: ${demoUrl}`);
  if (caseFilter) console.log(`筛选 case: ${caseFilter}`);
  console.log("═══════════════════════════════════════════════");

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
  } catch (err) {
    console.error(`Puppeteer 启动失败: ${err.message}`);
    process.exit(1);
  }

  const casesToRun = caseFilter
    ? uiCases.filter((c) => c.id === caseFilter)
    : uiCases;

  if (casesToRun.length === 0) {
    console.error(`未找到 case: ${caseFilter}`);
    await browser.close();
    process.exit(1);
  }

  const results = [];
  for (const testCase of casesToRun) {
    const result = await runCase(browser, demoUrl, testCase);
    results.push(result);
    // case 间短暂停顿
    await new Promise((r) => setTimeout(r, 300));
  }

  await browser.close();

  // 统计
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass).length;
  const total = results.length;

  // 写入报告
  const report = {
    ran_at: new Date().toISOString(),
    demo_url: demoUrl,
    total,
    passed,
    failed,
    results,
  };
  writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf-8");

  // 最终摘要
  console.log("\n═══════════════════════════════════════════════");
  console.log(`UI 测试完成: ${passed}/${total} PASS, ${failed} FAIL`);
  console.log(`报告: ${reportPath}`);
  console.log("═══════════════════════════════════════════════\n");

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
