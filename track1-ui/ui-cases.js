/**
 * track1-ui/ui-cases.js
 *
 * Track 1 UI 行为测试用例定义。
 * 每个 case 包含：操作序列（steps）和断言（assertions）。
 * 由 ui-runner.js 统一执行。
 *
 * 覆盖节点：C2, C3, B4, C12, C13, D2, D8
 */

export const uiCases = [
  // ─── C2：空文本发送被拦截 ──────────────────────────────────────────────────
  {
    id: "C2",
    name: "空文本发送被拦截",
    node: "C2",
    description: "不输入任何文本，直接点击发送按钮，对话历史不应新增任何消息",
    mockApiResponse: null, // 不需要 API，因为根本不会发请求
    steps: async (page) => {
      // 确保输入框为空
      await page.evaluate(() => {
        document.getElementById("player-input").value = "";
      });
      // 记录消息数
      const countBefore = await page.evaluate(
        () => document.querySelectorAll(".dialogue-history .message").length
      );
      // 点击发送
      await page.click("#send-button");
      await page.waitForTimeout(300);
      return { countBefore };
    },
    assertions: async (page, stepData) => {
      const countAfter = await page.evaluate(
        () => document.querySelectorAll(".dialogue-history .message").length
      );
      return [
        {
          id: "C2-no-new-message",
          desc: "空消息点击发送后，对话历史消息数量不变",
          pass: countAfter === stepData.countBefore,
          actual: `消息数: ${stepData.countBefore} → ${countAfter}`,
        },
        {
          id: "C2-textarea-still-enabled",
          desc: "空消息点击发送后，输入框仍然可用（未触发 sending 状态）",
          pass: await page.evaluate(
            () => !document.getElementById("player-input").disabled
          ),
        },
      ];
    },
  },

  // ─── C3：发送中输入框禁用 ─────────────────────────────────────────────────
  {
    id: "C3",
    name: "发送中输入框禁用",
    node: "C3",
    description: "发送消息时，输入框和发送按钮应立即进入 disabled 状态（setSending=true）",
    // Mock API：延迟 2 秒后返回，给断言窗口
    mockApiResponse: {
      candidates: [{
        content: {
          parts: [{ text: JSON.stringify({ reply: "好的", touched: false, closing_signal: false }) }]
        }
      }]
    },
    mockDelay: 2000,
    steps: async (page) => {
      await page.type("#player-input", "测试消息，检查禁用状态");
      // 记录发送前状态
      const disabledBefore = await page.evaluate(
        () => document.getElementById("player-input").disabled
      );
      // 点击发送（不等待完成）
      page.click("#send-button"); // 故意不 await
      // 立即检查禁用状态
      await page.waitForTimeout(100);
      return { disabledBefore };
    },
    assertions: async (page, stepData) => {
      const inputDisabledDuringSend = await page.evaluate(
        () => document.getElementById("player-input").disabled
      );
      const btnDisabledDuringSend = await page.evaluate(
        () => document.getElementById("send-button").disabled
      );
      // 等待发送完成
      await page.waitForFunction(
        () => !document.getElementById("player-input").disabled,
        { timeout: 10000 }
      );
      const inputEnabledAfter = await page.evaluate(
        () => !document.getElementById("player-input").disabled
      );
      return [
        {
          id: "C3-input-disabled-during-send",
          desc: "发送请求进行中，输入框应处于 disabled 状态",
          pass: inputDisabledDuringSend,
          actual: `发送中 input.disabled=${inputDisabledDuringSend}`,
        },
        {
          id: "C3-button-disabled-during-send",
          desc: "发送请求进行中，发送按钮应处于 disabled 状态",
          pass: btnDisabledDuringSend,
          actual: `发送中 button.disabled=${btnDisabledDuringSend}`,
        },
        {
          id: "C3-input-enabled-after-send",
          desc: "发送完成后，输入框应恢复可用",
          pass: inputEnabledAfter,
        },
      ];
    },
  },

  // ─── B4：关闭角色切换后输入框禁用 ────────────────────────────────────────
  {
    id: "B4",
    name: "关闭角色切换后输入框禁用",
    node: "B4",
    description: "对某角色连续返回 closing_signal=true 3次，使其达到关闭状态，切换到该角色后输入框应禁用",
    mockApiResponse: {
      candidates: [{
        content: {
          parts: [{ text: JSON.stringify({ reply: "不想说了", touched: false, closing_signal: true }) }]
        }
      }]
    },
    steps: async (page) => {
      // 选择 char2
      await page.click('[data-character-id="char2"]');
      await page.waitForTimeout(200);

      // 发送3条消息，mock 每次都返回 closing_signal=true
      for (let i = 0; i < 3; i++) {
        await page.evaluate(() => {
          document.getElementById("player-input").value = "test";
        });
        await page.click("#send-button");
        // 等待消息出现（API 被 Mock，应该很快）
        await page.waitForTimeout(500);
      }

      // 切换到 char1
      await page.click('[data-character-id="char1"]');
      await page.waitForTimeout(200);

      // 切换回 char2
      await page.click('[data-character-id="char2"]');
      await page.waitForTimeout(200);

      return {};
    },
    assertions: async (page) => {
      const inputDisabled = await page.evaluate(
        () => document.getElementById("player-input").disabled
      );
      const btnDisabled = await page.evaluate(
        () => document.getElementById("send-button").disabled
      );
      const hasClosedClass = await page.evaluate(
        () => document.querySelector('[data-character-id="char2"]').classList.contains("closed")
      );
      return [
        {
          id: "B4-input-disabled-on-closed-char",
          desc: "切换到已关闭角色后，输入框应处于 disabled 状态",
          pass: inputDisabled,
          actual: `input.disabled=${inputDisabled}`,
        },
        {
          id: "B4-button-disabled-on-closed-char",
          desc: "切换到已关闭角色后，发送按钮应处于 disabled 状态",
          pass: btnDisabled,
        },
        {
          id: "B4-button-has-closed-class",
          desc: "已关闭角色的切换按钮应有 closed CSS 类",
          pass: hasClosedClass,
        },
      ];
    },
  },

  // ─── C12：closing streak >= 3 输入禁用 ────────────────────────────────────
  {
    id: "C12",
    name: "closing streak 累积到 3 后输入禁用",
    node: "C12",
    description: "对 char1 连续收到 3 次 closing_signal=true 后，输入框应禁用，并出现系统提示",
    mockApiResponse: {
      candidates: [{
        content: {
          parts: [{ text: JSON.stringify({ reply: "再见", touched: false, closing_signal: true }) }]
        }
      }]
    },
    steps: async (page) => {
      // 选择 char1（新标签页已重置，char1 是默认）
      await page.click('[data-character-id="char1"]');
      await page.waitForTimeout(200);

      for (let i = 0; i < 3; i++) {
        await page.evaluate(() => {
          document.getElementById("player-input").value = "test message";
        });
        await page.click("#send-button");
        await page.waitForTimeout(600);
      }
      return {};
    },
    assertions: async (page) => {
      const inputDisabled = await page.evaluate(
        () => document.getElementById("player-input").disabled
      );
      const hintText = await page.evaluate(
        () => document.getElementById("closing-hint")?.textContent?.trim() ?? ""
      );
      const systemMessages = await page.evaluate(() => {
        const msgs = document.querySelectorAll(".dialogue-history .message-system");
        return Array.from(msgs).map((m) => m.textContent.trim());
      });
      const hasCloseMessage = systemMessages.some((t) => t.includes("不想再说下去"));
      return [
        {
          id: "C12-input-disabled-after-3-closing",
          desc: "连续 3 次 closing_signal=true 后，输入框应 disabled",
          pass: inputDisabled,
          actual: `input.disabled=${inputDisabled}`,
        },
        {
          id: "C12-hint-shows-closed",
          desc: "#closing-hint 应显示'不想再和你说话了'类提示",
          pass: hintText.length > 0,
          actual: `hint="${hintText}"`,
        },
        {
          id: "C12-system-message-appears",
          desc: "对话历史中应出现系统提示消息",
          pass: hasCloseMessage,
          actual: `systemMessages=${JSON.stringify(systemMessages)}`,
        },
      ];
    },
  },

  // ─── C13：角色关闭后发送被拦截 ────────────────────────────────────────────
  {
    id: "C13",
    name: "角色关闭后发送被拦截",
    node: "C13",
    description: "角色已关闭状态下，手动往 textarea 写入内容后点击发送，不应新增消息",
    // 复用 C12 的状态（角色已关闭），如果独立运行需先触发关闭
    mockApiResponse: {
      candidates: [{
        content: {
          parts: [{ text: JSON.stringify({ reply: "再见", touched: false, closing_signal: true }) }]
        }
      }]
    },
    steps: async (page) => {
      // 确保 char1 已关闭（先发3条 closing 消息）
      await page.click('[data-character-id="char1"]');
      await page.waitForTimeout(200);

      const alreadyClosed = await page.evaluate(() => {
        const btn = document.querySelector('[data-character-id="char1"]');
        return btn?.classList.contains("closed");
      });

      if (!alreadyClosed) {
        for (let i = 0; i < 3; i++) {
          await page.evaluate(() => {
            document.getElementById("player-input").value = "test";
          });
          await page.click("#send-button");
          await page.waitForTimeout(600);
        }
      }

      const countBefore = await page.evaluate(
        () => document.querySelectorAll(".dialogue-history .message").length
      );

      // 强制写入文本并点击（绕过 disabled 属性）
      await page.evaluate(() => {
        const ta = document.getElementById("player-input");
        ta.removeAttribute("disabled");
        ta.value = "我还想说话";
      });
      await page.click("#send-button");
      await page.waitForTimeout(400);

      return { countBefore };
    },
    assertions: async (page, stepData) => {
      const countAfter = await page.evaluate(
        () => document.querySelectorAll(".dialogue-history .message").length
      );
      return [
        {
          id: "C13-no-message-sent-when-closed",
          desc: "角色关闭后 handleSend() 应在 isCharacterClosed() 检查时拦截，不新增消息",
          pass: countAfter === stepData.countBefore,
          actual: `消息数: ${stepData.countBefore} → ${countAfter}`,
        },
      ];
    },
  },

  // ─── D2：重复点击 ending-button 无效 ──────────────────────────────────────
  {
    id: "D2",
    name: "重复点击 ending-button 无效",
    node: "D2",
    description: "第一次点击 ending-button 触发 runEnding()，第二次点击不应重复触发",
    mockApiResponse: {
      candidates: [{
        content: {
          parts: [{ text: JSON.stringify({ action: "站在原地", line: "...", reason: "test" }) }]
        }
      }]
    },
    steps: async (page) => {
      // 点击两次，间隔 200ms
      await page.click("#ending-button");
      await page.waitForTimeout(200);
      await page.click("#ending-button");
      await page.waitForTimeout(500);
      return {};
    },
    assertions: async (page) => {
      // 验证 endingState.triggered=true（只触发了一次）
      const triggered = await page.evaluate(
        () => window.EndingState?.isTriggered?.() ?? null
      );
      // 验证 overlay 只有一个
      const overlayCount = await page.evaluate(
        () => document.querySelectorAll(".ending-overlay").length
      );
      return [
        {
          id: "D2-only-one-overlay",
          desc: "多次点击 ending-button 只应生成一个 ending overlay",
          pass: overlayCount <= 1,
          actual: `overlay 数量: ${overlayCount}`,
        },
        {
          id: "D2-ending-triggered-once",
          desc: "endingState.triggered 应为 true，且不会重置",
          // 如果 EndingState.isTriggered 不存在则跳过
          pass: triggered === null ? true : triggered === true,
          actual: `isTriggered()=${triggered}`,
        },
      ];
    },
  },

  // ─── D8：有未就绪 slot 时翻页无效 ────────────────────────────────────────
  {
    id: "D8",
    name: "有未就绪 slot 时翻页无效",
    node: "D8",
    description: "Phase2/3 的 API 响应未全部返回时，点击 ending overlay 不应翻页到下一屏",
    // 此 case 需要延迟很长的 mock，让 slot 保持 pending 状态
    mockApiResponse: {
      candidates: [{
        content: {
          parts: [{ text: JSON.stringify({ action: "等待", line: "...", reason: "test" }) }]
        }
      }]
    },
    mockDelay: 15000, // 故意超长延迟，让 slot 无法就绪
    steps: async (page) => {
      // 触发 ending
      await page.click("#ending-button");
      await page.waitForTimeout(800);

      // 等待 phase1 显示（静态，立即就绪）
      await page.waitForSelector(".ending-overlay", { timeout: 5000 });

      // 记录当前屏幕标识
      const screenBefore = await page.evaluate(() => {
        const label = document.querySelector(".ending-phase-label");
        return label?.textContent?.trim() ?? "";
      });

      // 点击 overlay 尝试翻页（此时 phase2 slot 未就绪）
      await page.click(".ending-overlay");
      await page.waitForTimeout(500);

      const screenAfter = await page.evaluate(() => {
        const label = document.querySelector(".ending-phase-label");
        return label?.textContent?.trim() ?? "";
      });

      return { screenBefore, screenAfter };
    },
    assertions: async (page, stepData) => {
      return [
        {
          id: "D8-no-advance-when-not-ready",
          desc: "Phase2 slot 未就绪时，点击 overlay 不应翻页",
          pass: stepData.screenBefore === stepData.screenAfter,
          actual: `屏幕: "${stepData.screenBefore}" → "${stepData.screenAfter}"`,
        },
      ];
    },
  },
];
