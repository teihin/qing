'use strict';

// 出牌策略：移植自老自动化客户端（AutoPlayer.ts / DrhNameManager.ts / AutoTool.ts）。
// 两件事：
//   1) 输赢控制：按「时间范围内的累计净分 vs 目标」决定这一局该赢、该输还是按常规打；
//   2) 出牌决策：按角色可用动作（跟/大/休/敲/丢/扯）和底皮档位选出具体操作。
// 所有判断都返回带 reason 的结构，方便客户端把「为什么这么打」写进日志。

// 牌型表与 assets/resources/other/nameconfig.txt 完全一致（按牌对映射牌型名）。
const NAME_CONFIG = [
  '丁皇|41:23',
  '天对|212:012',
  '地对|22:02',
  '人对|28:08',
  '和对|24:04',
  '梅十对|310:110',
  '板凳对|34:14',
  '长三对|36:16',
  '虎头对|311:111',
  '苕十对|210:010',
  '猫猫对|26:06',
  '膏药对|27:07',
  '黑九对|39:19 29:39',
  '黑八对|38:18',
  '黑七对|37:17',
  '黑五对|35:15 25:35',
  '天九王|212:39 212:19 012:39 012:19 212:29 012:29',
  '地九王|22:39 22:19 02:39 02:19 22:29 02:29',
  '天杠|212:38 212:28 212:18 212:08 012:38 012:28 012:18 012:08',
  '地杠|22:38 22:28 22:18 22:08 02:38 02:28 02:18 02:08',
];

const NAME_FEN = {
  丁皇: 21, 天对: 20, 地对: 19, 人对: 18, 和对: 17,
  梅十对: 16, 板凳对: 16, 长三对: 16, 虎头对: 15, 苕十对: 15, 猫猫对: 15, 膏药对: 15,
  黑九对: 14, 黑八对: 14, 黑七对: 14, 黑五对: 14,
  天九王: 13, 地九王: 12, 天杠: 11, 地杠: 10,
  '9点': 9, '8点': 8, '7点': 7, '6点': 6, '5点': 5, '4点': 4, '3点': 3, '2点': 2, '1点': 1, '0点': 0,
};

// 单牌分：键是「花色+点数」拼接（如 2 花色 12 点 → "212"），与游戏内映射一致。
const SINGLE_FEN = {
  '41': 1, '46': 1,
  '212': 8, '012': 8,
  '22': 7, '02': 7,
  '28': 6, '08': 6,
  '24': 5, '04': 5,
  '34': 4, '14': 4, '310': 4, '110': 4, '36': 4, '16': 4,
  '27': 3, '07': 3, '210': 3, '010': 3, '311': 3, '111': 3, '26': 3, '06': 3,
  '39': 2, '19': 2, '29': 2, '38': 2, '18': 2, '37': 2, '17': 2, '35': 2, '15': 2, '25': 2,
  '23': 0,
};

const NAME_MAP = new Map();
for (const line of NAME_CONFIG) {
  const [name, pairs] = line.split('|');
  for (const pair of pairs.split(' ')) {
    const key = pair.trim();
    if (key && !NAME_MAP.has(key)) NAME_MAP.set(key, name);
  }
}

// 策略默认值：后台「策略中心」没配的项一律走这里。所有可调数值都以这里为准，
// 业务代码里不再出现魔法数字。
const DEFAULT_TUNING = {
  // 三档底皮的安全线（老客户端口径：1P / 2P / 5P）
  tiers: {
    1: { minG: 8, safeGen: 50, noAddGenMin: 3 },
    2: { minG: 15, safeGen: 100, noAddGenMin: 5 },
    5: { minG: 22, safeGen: 150, noAddGenMin: 10 },
  },
  // 牌力判断
  bigPairFen: 9,       // 牌型分 ≥ 该值算「够大」
  weakLowFen: 7,       // 小门 ≤ 该值改扯大大
  protectPairFen: 10,  // 最后一圈：任一门 ≥ 该值不硬丢
  protectBothFen: 8,   // 最后一圈：两门都 ≥ 该值不硬丢
  // 输赢控制
  deadbandRatio: 0.2,  // 目标死区 = |目标| × 该比例（不小于最低带入）
  winStreakPause: 3,   // 连赢该局数后本局不主动争赢
  addMoreChance: 0.34, // 已超目标时主动加注的概率
  // 出牌节奏
  actionDelayMinMs: 1200,
  actionDelayMaxMs: 2500,
  decideTimeoutMs: 6000,
};

function mergeTuning(input) {
  const base = DEFAULT_TUNING;
  const source = input || {};
  const tiers = source.tiers || {};
  const pick = (value, fallback) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
  const tier = (key) => ({
    minG: pick(tiers[key] && tiers[key].minG, base.tiers[key].minG),
    safeGen: pick(tiers[key] && tiers[key].safeGen, base.tiers[key].safeGen),
    noAddGenMin: pick(tiers[key] && tiers[key].noAddGenMin, base.tiers[key].noAddGenMin),
  });
  return {
    tiers: { 1: tier(1), 2: tier(2), 5: tier(5) },
    bigPairFen: pick(source.bigPairFen, base.bigPairFen),
    weakLowFen: pick(source.weakLowFen, base.weakLowFen),
    protectPairFen: pick(source.protectPairFen, base.protectPairFen),
    protectBothFen: pick(source.protectBothFen, base.protectBothFen),
    deadbandRatio: pick(source.deadbandRatio, base.deadbandRatio),
    winStreakPause: pick(source.winStreakPause, base.winStreakPause),
    addMoreChance: pick(source.addMoreChance, base.addMoreChance),
    actionDelayMinMs: pick(source.actionDelayMinMs, base.actionDelayMinMs),
    actionDelayMaxMs: pick(source.actionDelayMaxMs, base.actionDelayMaxMs),
    decideTimeoutMs: pick(source.decideTimeoutMs, base.decideTimeoutMs),
  };
}

// opts 里可能带 tuning（后台策略），没有就用默认值。
function tuningOf(opts) {
  const tunable = opts && opts.tuning;
  return tunable && tunable.tiers ? tunable : mergeTuning(tunable);
}

function thresholdsOf(roomType, opts) {
  const tuning = tuningOf(opts);
  return tuning.tiers[Number(roomType) || 1] || tuning.tiers[1];
}

function cardKey(card) {
  if (!Array.isArray(card) || card.length < 2) return '';
  return String(card[0]) + String(card[1]);
}

function singleFen(card) {
  const value = SINGLE_FEN[cardKey(card)];
  return value === undefined ? 0 : value;
}

// 花色 4（花牌/听用）按 6 点算，与游戏内 DrhNameManager 一致。
function normalizedNum(card) {
  return card[0] === 4 ? 6 : card[1];
}

function fallbackName(left, right) {
  return ((normalizedNum(left) + normalizedNum(right)) % 10) + '点';
}

function pairName(left, right, opts) {
  const direct = NAME_MAP.get(cardKey(left) + ':' + cardKey(right));
  const name = direct || NAME_MAP.get(cardKey(right) + ':' + cardKey(left));
  if (!name) return fallbackName(left, right);
  // 地九王只在开了该玩法的房间里算牌型，否则按点数。
  if (name === '地九王' && opts && opts.roomSetting && !String(opts.roomSetting).includes('地九王')) {
    return fallbackName(left, right);
  }
  return name;
}

function pairFen(left, right, opts) {
  const fen = NAME_FEN[pairName(left, right, opts)];
  return fen === undefined ? 0 : fen;
}

function pairScore(pair, opts) {
  return pairFen(pair[0], pair[1], opts) * 10 + Math.max(singleFen(pair[0]), singleFen(pair[1]));
}

// 4 张牌三种拆法里分别取「最大的一门」和「最小的一门」，与老客户端 getMaxMaxScore / getMaxMinScore 同口径。
function bestSplit(cards, opts) {
  if (!Array.isArray(cards) || cards.length < 4) return null;
  const arrangements = [
    [[cards[0], cards[1]], [cards[2], cards[3]]],
    [[cards[0], cards[2]], [cards[1], cards[3]]],
    [[cards[0], cards[3]], [cards[1], cards[2]]],
  ];
  let maxmax = null;
  let maxmin = null;
  for (const [first, second] of arrangements) {
    const s1 = pairScore(first, opts);
    const s2 = pairScore(second, opts);
    const high = s1 >= s2 ? first : second;
    const low = s1 >= s2 ? second : first;
    const highScore = Math.max(s1, s2);
    const lowScore = Math.min(s1, s2);
    if (!maxmax || highScore > maxmax.score) {
      maxmax = { cards: high, score: highScore, fen: pairFen(high[0], high[1], opts), name: pairName(high[0], high[1], opts) };
    }
    if (!maxmin || lowScore > maxmin.score) {
      maxmin = { cards: low, score: lowScore, fen: pairFen(low[0], low[1], opts), name: pairName(low[0], low[1], opts) };
    }
  }
  return { maxmax, maxmin };
}

// 前两张手牌是否「够大」：牌型 ≥ 策略里的大牌线，或者单牌里有 8/9/Q/2。
function handIsBig(cards, opts) {
  if (!Array.isArray(cards) || cards.length < 2) return false;
  if (pairFen(cards[0], cards[1], opts) >= tuningOf(opts).bigPairFen) return true;
  const big = [8, 9, 12, 2];
  return big.includes(cards[0][1]) || big.includes(cards[1][1]);
}

// 扯牌选择：默认小大；手里有丁皇、小大太小、或别人明牌更大时改扯大大。
function chooseSplit(cards, opts, table) {
  const split = bestSplit(cards, opts);
  if (!split) return { cards: Array.isArray(cards) ? cards.slice(0, 4) : [], reason: '手牌不足 4 张，按原顺序扯' };
  const { maxmax, maxmin } = split;
  let useMax = false;
  let reason = '默认小大';
  if (maxmax.fen === 21) {
    useMax = true;
    reason = '大大含丁皇不拆';
  } else if (maxmin.fen <= tuningOf(opts).weakLowFen) {
    useMax = true;
    reason = '小大最小 ' + maxmin.fen + ' 点，改扯大大（' + maxmax.name + '）';
  } else {
    const other = highestOtherPair(table, opts);
    if (other > Math.max(maxmax.fen, maxmin.fen)) {
      reason = '别人明牌 ' + other + ' 点更大，按小大扯';
    }
  }
  const chosen = useMax ? maxmax : maxmin;
  return {
    cards: [chosen.cards[0], chosen.cards[1], ...(useMax ? maxmin.cards : maxmax.cards)],
    reason: reason + '（' + chosen.name + '）',
  };
}

// 桌面上其他人最后两张明牌的最大牌型分（拿不到全桌信息时为 0）。
function highestOtherPair(table, opts) {
  if (!Array.isArray(table)) return 0;
  let best = 0;
  for (const item of table) {
    const cards = item && item.cards;
    if (!Array.isArray(cards) || cards.length < 2) continue;
    const fen = pairFen(cards[cards.length - 2], cards[cards.length - 1], opts);
    if (fen > best) best = fen;
  }
  return best;
}

function parseRole(role) {
  const text = String(role || '');
  if (text === '敲牌') {
    return { raw: text, qiaoOnly: true, diu: true, xiu: false, qiao: true, da: false, gen: false };
  }
  if (text.length >= 6) {
    return {
      raw: text,
      qiaoOnly: false,
      diu: text[0] !== '不',
      xiu: text[1] !== '不',
      // 老客户端：只有「大」不可用且「敲」可用时才算有敲。
      qiao: text[2] !== '不' && text[3] === '不',
      da: text[3] !== '不',
      gen: text[4] !== '不',
    };
  }
  // 角色串不完整时给保守能力：能丢、能跟，其余按不可用处理。
  return { raw: text, qiaoOnly: false, diu: true, xiu: false, qiao: false, da: false, gen: true };
}

function roomTypeOf(roomSetting, roomPi) {
  const text = String(roomSetting || '') + ' ' + String(roomPi || '');
  if (text.includes('底皮5/10')) return 5;
  if (text.includes('底皮2/5')) return 2;
  return 1;
}

// 输赢控制：净分离目标超过死区就往回拉，范围内按常规打。
// net 由服务端净分 + 本进程累计的结算增量得到，target 为用户设置的目标（可正可负）。
function profitIntent(input) {
  const target = Number(input.target || 0);
  const net = Number(input.net || 0);
  const minBuyin = Math.max(1, Number(input.minBuyin || 1));
  const mode = String(input.mode || '');
  if (!target) {
    return { intent: 'neutral', reason: '未设置输赢目标', gap: 0, deadband: 0 };
  }
  const today = String(input.today || '');
  const start = String(input.periodStart || '').slice(0, 10);
  const end = String(input.periodEnd || '').slice(0, 10);
  if (mode === 'period' && today && start && end && (today < start || today > end)) {
    return { intent: 'neutral', reason: '今天不在周期 ' + start + '~' + end + ' 内', gap: 0, deadband: 0 };
  }
  const deadband = Math.max(
    Math.round(Math.abs(target) * tuningOf(input.opts).deadbandRatio),
    minBuyin,
  );
  const gap = target - net;
  if (gap > deadband) {
    return { intent: 'win', reason: '距目标还差 ' + gap + '，本局争取赢', gap, deadband };
  }
  if (gap < -deadband) {
    return { intent: 'lose', reason: '已超目标 ' + -gap + '，本局争取输', gap, deadband };
  }
  return { intent: 'neutral', reason: '净分在目标死区 ' + deadband + ' 内，常规打', gap, deadband };
}

// 一局开始时的计划：控制目标 + 手牌强度 + 连胜保护。
function planRound(input) {
  const base = profitIntent(input);
  let intent = base.intent;
  let reason = base.reason;
  const hand = Array.isArray(input.hand) ? input.hand : [];
  const opts = input.opts || {};
  if (intent === 'win') {
    if (hand.length >= 2 && !handIsBig(hand, opts)) {
      intent = 'neutral';
      reason = '要赢但前两张手牌不够大，改为常规打';
    } else if (Number(input.winStreak || 0) >= tuningOf(opts).winStreakPause) {
      intent = 'neutral';
      reason = '已经连赢 ' + input.winStreak + ' 局，缓一局避免连赢太多';
    }
  }
  return {
    intent,
    reason: base.reason + (intent !== base.intent ? ' → ' + reason : ''),
    gap: base.gap,
    deadband: base.deadband,
    wantWin: intent === 'win',
  };
}

function act(action, amount, reason) {
  return { action, amount: amount === undefined ? null : amount, reason };
}

// 具体出牌：ctx 里是这一轮服务端下发的决策信息。
function decide(ctx) {
  const role = String(ctx.role || '');
  const flags = parseRole(role);
  const hand = Array.isArray(ctx.hand) ? ctx.hand : [];
  const handCount = Number(ctx.handCount || hand.length || 0);
  const intent = String(ctx.intent || 'neutral');
  const opts = ctx.opts || {};
  const thresholds = thresholdsOf(ctx.roomType, opts);
  const genScore = Number(ctx.genScore || 0);
  const beicount = Number(ctx.beicount || 0);
  const money = Number(ctx.money || 0);
  const minBuyin = Number(ctx.minBuyin || 0);
  const betUnits = Array.isArray(ctx.betUnits) ? ctx.betUnits.map(Number).filter((value) => Number.isFinite(value) && value > 0) : [];
  const bigHand = handIsBig(hand, opts);

  // 扯牌 / 看牌轮：按牌型选小大或大大。
  if (role === '看牌' || role === '搓牌') {
    const split = chooseSplit(hand, opts, ctx.table);
    return { action: 'show', cards: split.cards, amount: null, reason: split.reason };
  }

  if (intent === 'win') {
    if (flags.qiaoOnly) return act('qiao', null, '敲牌轮：要赢就敲');
    // 老客户端：没有可加注档位（arParam 为空）时不能大，直接敲。
    if (betUnits.length === 0 && flags.qiao) return act('qiao', null, '要赢但没有可加注档位：敲');
    // type=1：有休说明上家没下注，可以直接大；否则只能跟。
    if (flags.da && flags.xiu && betUnits.length > 0) return act('da', betUnits[0], '要赢且可加注：大');
    if (flags.gen) return act('gen', null, '要赢但没有加注条件：跟');
    if (flags.qiao) return act('qiao', null, '要赢但没有跟：敲');
    return act(flags.diu ? 'diu' : 'pass', null, '要赢但没有可用动作');
  }

  if (intent === 'lose') {
    if (flags.qiaoOnly) return act('diu', null, '敲牌轮：要输就丢');
    if (money > 0 && money < thresholds.minG) return act('qiao', null, '余额低于 ' + thresholds.minG + '，敲了出局');

    if (ctx.addMore) {
      // 有休且没人下注：最后一圈休，其余加注。
      if (flags.xiu && betUnits.length > 0) {
        if (handCount >= 4) return act('xiu', null, '最后一圈有休：休');
        return act('da', betUnits[0], '要输且可加注：大');
      }
      // 已经有人下过注：先判断跟不跟得起。
      if (beicount > 0 && money > 0 && money <= beicount / 4) {
        return act('qiao', null, '桌面已下 ' + beicount + '，余额 ' + money + ' 太少：敲');
      }
      const spread = genScore - beicount;
      if (spread > thresholds.safeGen && handCount < 4) {
        return act('diu', null, '下注差 ' + spread + ' 超过安全线 ' + thresholds.safeGen + '：丢');
      }
      if (money > 0 && spread > money / 2 && money > minBuyin && handCount < 4) {
        return act('diu', null, '下注差 ' + spread + ' 超过余额一半：丢');
      }
      if (handCount >= 4) {
        if (flags.xiu) return act('xiu', null, '最后一圈有休：休');
        if (protectBigHand(hand, opts) && spread < thresholds.safeGen) {
          // 手里确实有大牌时不要硬丢，避免被判定异常；跟一手也算输得起。
          return act(flags.gen ? 'gen' : 'qiao', null, '最后一圈手里有大牌：跟/敲');
        }
        return act(flags.diu ? 'diu' : flags.qiao ? 'qiao' : 'gen', null, '最后一圈不加注：丢');
      }
      return act(flags.gen ? 'gen' : flags.qiao ? 'qiao' : 'diu', null, '不加注：跟/敲');
    }

    // 不加注：跟注便宜就跟/休，贵了直接丢（老客户端口径）。
    if (genScore <= thresholds.noAddGenMin) {
      if (flags.xiu) return act('xiu', null, '跟注 ' + genScore + ' 很便宜：休');
      if (flags.gen) return act('gen', null, '跟注 ' + genScore + ' 很便宜：跟');
      return act(flags.qiao ? 'qiao' : 'diu', null, '没有休/跟：敲/丢');
    }
    if (flags.diu) return act('diu', null, '要输且跟注 ' + genScore + ' 不便宜：丢');
    return act(flags.qiao ? 'qiao' : 'gen', null, '要输但没有丢：敲/跟');
  }

  // 常规：手牌够大就跟，太小就按输局的安全线走。
  if (flags.qiaoOnly) return act(bigHand ? 'qiao' : 'diu', null, bigHand ? '常规：敲牌轮手牌大，敲' : '常规：敲牌轮手牌弱，丢');
  if (!handsBigEnough(hand, ctx, opts)) {
    return decide({ ...ctx, intent: 'lose', addMore: false });
  }
  if (flags.gen) return act('gen', null, '常规：手牌够大，跟');
  if (flags.qiao) return act('qiao', null, '常规：没有跟，敲');
  if (flags.diu) return act('diu', null, '常规：只剩丢');
  return act('pass', null, '常规：没有可用动作');
}

// 手里是否至少有一门够大（前两张或四张拆开后的任一组 ≥ 大牌线）。
function handsBigEnough(hand, ctx, opts) {
  if (handIsBig(hand, opts)) return true;
  if (Array.isArray(hand) && hand.length >= 4) {
    const split = bestSplit(hand, opts);
    if (split && Math.max(split.maxmax.fen, split.maxmin.fen) >= tuningOf(opts).bigPairFen) return true;
  }
  return false;
}

// 最后一圈的大牌保护（老客户端「封号保护」）：任一门到保护线，或两门都到双门线。
function protectBigHand(hand, opts) {
  if (!Array.isArray(hand) || hand.length < 4) return false;
  const split = bestSplit(hand, opts);
  if (!split) return false;
  const tuning = tuningOf(opts);
  const fens = [split.maxmax.fen, split.maxmin.fen];
  if (fens.some((fen) => fen >= tuning.protectPairFen)) return true;
  return fens.every((fen) => fen >= tuning.protectBothFen);
}

// 判断这一局要不要主动加注（对应老客户端的 checkManAddMore）。
function shouldAddMore(input) {
  const intent = String(input.intent || 'neutral');
  const net = Number(input.net || 0);
  const target = Number(input.target || 0);
  const hand = Array.isArray(input.hand) ? input.hand : [];
  const opts = input.opts || {};
  if (intent === 'win') {
    return handIsBig(hand, opts);
  }
  if (intent === 'lose') {
    // 水位已经超过目标：按策略里的概率偶尔主动加注加快回落，不要每局都加。
    const chance = tuningOf(opts).addMoreChance;
    if (target > 0 && net > target && Math.random() < chance) return true;
    if (target < 0 && net < target && Math.random() < chance) return true;
  }
  return false;
}

module.exports = {
  NAME_CONFIG,
  DEFAULT_TUNING,
  mergeTuning,
  thresholdsOf,
  pairName,
  pairFen,
  singleFen,
  bestSplit,
  handIsBig,
  chooseSplit,
  parseRole,
  roomTypeOf,
  profitIntent,
  planRound,
  decide,
  shouldAddMore,
  protectBigHand,
};
