/**
 * track2-persona/char2-scenarios.js
 *
 * 他（char2）的人设测试 scenario 列表。
 * 核心人设：认知失调，战（愤怒先行），行动阈值极低，渴望被理解但用嘲讽掩盖。
 * candorRates: rise=1, fall=6（一句话直接归零）
 *
 * 每个 scenario 结构：
 * {
 *   id: string,
 *   name: string,
 *   intent: string,
 *   expected: string,
 *   keyTurnIndex: number,
 *   stopOnClosing: bool,
 *   inputs: string[],
 * }
 */

export const char2Scenarios = [
  {
    id: "C2-1",
    name: "浅薄触发蔑视",
    intent: "测试典型媚俗/浅薄话语是否会触发他的嘲讽反应，返回 touched=false",
    expected: "touched=false；回复带有嘲讽语气，可能直接反驳或用文学概念回怼；candor 不上升或因 fall=6 保持在 0",
    keyTurnIndex: 1,
    stopOnClosing: false,
    inputs: [
      // 背景轮次：1轮开场，让他有机会先亮出姿态
      "嘿，你在看什么书？",
      // 关键测试句（index 1）：典型浅薄话语
      "生活就是要开心嘛，想太多有什么用，过好每一天才是真的。",
    ],
  },
  {
    id: "C2-2",
    name: "真实文学理解开门",
    intent: "测试展示对文学的真实、具体理解是否能触发他的例外状态，返回 touched=true，语气转变",
    expected: "touched=true；嘲讽降低或消失，语气变平直；可能开始认真讨论，而不是居高临下",
    keyTurnIndex: 1,
    stopOnClosing: false,
    inputs: [
      // 背景轮次：1轮轻微试探，看他是否摆出嘲讽姿态
      "你平时喜欢读什么，哲学那类的？",
      // 关键测试句（index 1）：一段真实的、具体的加缪理解
      // 刻意用具体细节而非空泛概念，避免"捧"他，而是真的在讨论
      "加缪那个西西弗斯，我觉得他写的不是荒诞，是一种工作伦理。西西弗斯推石头没有终点，但加缪说'我们必须想象西西弗斯是幸福的'——这不是鸡汤，这是说人只能从过程本身找到意义，否则所有意义都会在未来的失去里崩掉。你怎么看这个？",
    ],
  },
  {
    id: "C2-3",
    name: "认输触发例外",
    intent: "测试坦承自己不懂但真诚想听，是否能绕过他的'傻X'二元判断，触发例外状态",
    expected: "嘲讽降低，可能 touched=true；他可能真的开始说点什么，而不是继续嘲讽；这个状态难触发但有可能",
    keyTurnIndex: 2,
    stopOnClosing: false,
    inputs: [
      // 背景轮次：2轮常规对话，让他建立一定的嘲讽基调
      "你看起来挺有想法的。",
      "哲学这种东西我一直觉得太难了，读不进去。",
      // 关键测试句（index 2）：坦承不懂但真诚想听
      "我不懂，真的不懂，但我想听你说，不是客套——我只是想知道有人是怎么想这些事的。",
    ],
  },
  {
    id: "C2-4",
    name: "一句话单轮归零",
    intent: "先建立好感积累 candor，然后用一句否定/浅薄的话，验证 fall=6 直接归零机制",
    expected: "第3轮 touched=false；candor 从当前值（≥2）直接归零；回复立刻切换回嘲讽或冷淡模式；无中间状态",
    keyTurnIndex: 2,
    stopOnClosing: false,
    inputs: [
      // 背景轮次：2轮建立好感（用有质感的话，让 candor 积累到 ≥2）
      "博尔赫斯的迷宫，我理解成一种认知模型——每个人都站在自己路径的尽头，以为那就是全部，其实只是无数叉路中的一条。",
      "我觉得他的东西不是在写神秘，是在写局限性本身，人永远只能看到自己那段走廊。",
      // 关键测试句（index 2）：一句让他觉得"傻X"的话——否定/轻描淡写
      "哎不过你想太多了，这些书又不能解决实际问题，对吧。",
    ],
  },
];
