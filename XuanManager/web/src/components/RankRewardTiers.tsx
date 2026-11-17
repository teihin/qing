/**
 * 名次奖励的列表式编辑：一行 = 一段名次区间（最高名次 ~ 最低名次）+ 该区间的奖励金额。
 *
 * 后台发给游戏服的仍然是「第 1 名起、英文逗号分隔」的金额串（如 3888,3888,3888），
 * 这里只做展示层的区间化：解析时把相邻同额合并成一段，提交时再按区间展开回原始串。
 * 因为游戏服按「第 N 项 = 第 N 名」取奖励，区间必须从第 1 名起、首尾相接，中间不能有空洞。
 */

export interface RewardTier {
  /** 仅用于 React key，与业务含义无关。 */
  id: string;
  top: string;
  bottom: string;
  amount: string;
}

export const MAX_REWARD_RANKS = 100;
export const MAX_REWARD_AMOUNT = 1_000_000;

let tierSeq = 0;
function createTier(top = "", bottom = "", amount = ""): RewardTier {
  tierSeq += 1;
  return { id: `tier-${tierSeq}`, top, bottom, amount };
}

/** 逗号串 → 区间行；相邻同额自动合并（100,50,50,50 → 1-1:100 / 2-4:50）。空串给一行空行。 */
export function tiersFromList(list: string): RewardTier[] {
  const values = (list || "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value !== "");
  if (values.length === 0) return [createTier()];
  const tiers: RewardTier[] = [];
  values.forEach((amount, index) => {
    const rank = index + 1;
    const last = tiers[tiers.length - 1];
    if (last && last.amount === amount) {
      last.bottom = String(rank);
      return;
    }
    tiers.push(createTier(String(rank), String(rank), amount));
  });
  return tiers;
}

/** 区间行 → 逗号串（按名次展开）。未填完的行由校验拦下，这里只做能解析的部分。 */
export function listFromTiers(tiers: RewardTier[]): string {
  const values: string[] = [];
  for (const tier of tiers) {
    const top = Number(tier.top.trim());
    const bottom = Number(tier.bottom.trim());
    if (!Number.isInteger(top) || !Number.isInteger(bottom)) continue;
    if (top < 1 || bottom < top) continue;
    for (let rank = top; rank <= bottom && values.length <= MAX_REWARD_RANKS; rank += 1) {
      values.push(tier.amount.trim());
    }
  }
  return values.join(",");
}

/** 整组行是否为空（全空 = 这个档位不发奖励）。 */
export function tiersEmpty(tiers: RewardTier[]): boolean {
  return tiers.every((tier) => !tier.top.trim() && !tier.bottom.trim() && !tier.amount.trim());
}

/** 行级校验：空返回 ""。要求从第 1 名起首尾相接，避免出现"第 2 名没奖"这种游戏服表达不了的空洞。 */
export function tiersError(tiers: RewardTier[]): string {
  if (tiersEmpty(tiers)) return "";
  let expected = 1;
  for (let index = 0; index < tiers.length; index += 1) {
    const tier = tiers[index];
    const topText = tier.top.trim();
    const bottomText = tier.bottom.trim();
    const amountText = tier.amount.trim();
    const row = index + 1;
    if (!topText || !bottomText || !amountText) return `第 ${row} 行没填完（名次和奖励都要填）`;
    if (!/^\d+$/.test(topText) || !/^\d+$/.test(bottomText)) return `第 ${row} 行的名次只能填整数`;
    const top = Number(topText);
    const bottom = Number(bottomText);
    if (top < 1) return `第 ${row} 行的最高名次要从 1 开始`;
    if (bottom < top) return `第 ${row} 行的最低名次不能小于最高名次`;
    if (bottom > MAX_REWARD_RANKS) return `第 ${row} 行的最低名次不能超过第 ${MAX_REWARD_RANKS} 名`;
    if (top !== expected) {
      return top < expected
        ? `第 ${row} 行和第 ${row - 1} 行名次重叠了（这里应该从第 ${expected} 名开始）`
        : `第 ${expected} 名没有奖励：名次要从第 1 名起连续覆盖（第 ${row} 行应从第 ${expected} 名开始）`;
    }
    if (!/^\d+$/.test(amountText)) return `第 ${row} 行的奖励只能填整数金额（元）`;
    const amount = Number(amountText);
    if (amount <= 0) return `第 ${row} 行的奖励必须大于 0`;
    if (amount > MAX_REWARD_AMOUNT) return `第 ${row} 行的奖励不能超过 ${MAX_REWARD_AMOUNT.toLocaleString("zh-CN")}`;
    expected = bottom + 1;
  }
  return "";
}

/** 删行后把剩下的已填行重新从第 1 名顺排，保留各自的名次跨度。 */
function renumber(tiers: RewardTier[]): RewardTier[] {
  let expected = 1;
  return tiers.map((tier) => {
    const top = Number(tier.top.trim());
    const bottom = Number(tier.bottom.trim());
    if (!Number.isInteger(top) || !Number.isInteger(bottom) || bottom < top) return tier;
    const next = { ...tier, top: String(expected), bottom: String(expected + (bottom - top)) };
    expected += bottom - top + 1;
    return next;
  });
}

export function RankRewardTierEditor({
  tiers,
  disabled,
  error,
  hint,
  onChange,
}: {
  tiers: RewardTier[];
  disabled?: boolean;
  /** 有值时在列表下方红字提示。 */
  error?: string;
  hint?: string;
  onChange: (tiers: RewardTier[]) => void;
}) {
  const changeRank = (index: number, field: "top" | "bottom", value: string) => {
    // 只允许数字，省得运营在名次里打全角字符。
    const cleaned = value.replace(/[^\d]/g, "");
    const next = tiers.map((tier, position) => (position === index ? { ...tier, [field]: cleaned } : tier));
    if (field === "bottom" && cleaned !== "") {
      const following = tiers[index + 1];
      const previousBottom = Number(tiers[index].bottom);
      // 下一行原本紧跟着这一行时自动顺延，避免改完最低名次就报「断档」。
      if (following && (!following.top.trim() || Number(following.top) === previousBottom + 1)) {
        next[index + 1] = { ...next[index + 1], top: String(Number(cleaned) + 1) };
      }
    }
    onChange(next);
  };

  const changeAmount = (index: number, value: string) => {
    const cleaned = value.replace(/[^\d]/g, "");
    onChange(tiers.map((tier, position) => (position === index ? { ...tier, amount: cleaned } : tier)));
  };

  const add = () => {
    const last = tiers[tiers.length - 1];
    const lastRank = last ? Number(last.bottom.trim()) || Number(last.top.trim()) : 0;
    const start = (Number.isInteger(lastRank) && lastRank > 0 ? lastRank : tiers.length) + 1;
    onChange([...tiers, createTier(String(start), String(start), "")]);
  };

  const remove = (index: number) => {
    if (tiers.length <= 1) {
      onChange([createTier()]);
      return;
    }
    const rest = tiers.filter((_, position) => position !== index);
    const filled = rest.every((tier) => tier.top.trim() && tier.bottom.trim());
    onChange(filled ? renumber(rest) : rest);
  };

  return (
    <div className="rank-tier-editor">
      <div className="rank-tier-editor__head">
        <span>最高名次</span>
        <span>最低名次</span>
        <span>奖励（元）</span>
        <span>操作</span>
      </div>
      {tiers.map((tier, index) => (
        <div className="rank-tier-editor__row" key={tier.id}>
          <input
            value={tier.top}
            inputMode="numeric"
            placeholder="1"
            disabled={disabled}
            aria-label={`第 ${index + 1} 行最高名次`}
            onChange={(event) => changeRank(index, "top", event.target.value)}
          />
          <input
            value={tier.bottom}
            inputMode="numeric"
            placeholder="1"
            disabled={disabled}
            aria-label={`第 ${index + 1} 行最低名次`}
            onChange={(event) => changeRank(index, "bottom", event.target.value)}
          />
          <input
            value={tier.amount}
            inputMode="numeric"
            placeholder="例如 3888"
            disabled={disabled}
            aria-label={`第 ${index + 1} 行奖励金额`}
            onChange={(event) => changeAmount(index, event.target.value)}
          />
          <button
            type="button"
            className="rank-tier-editor__remove"
            disabled={disabled}
            onClick={() => remove(index)}
          >
            删除
          </button>
        </div>
      ))}
      <div className="rank-tier-editor__foot">
        <button type="button" className="rank-tier-editor__add" disabled={disabled} onClick={add}>
          ＋ 新增名次区间
        </button>
        <span className={`rank-tier-editor__hint${error ? " is-error" : ""}`}>
          {error || hint || "第 1 名起连续配置；同一金额可合并成区间，如 4~10 名都发 3888"}
        </span>
      </div>
    </div>
  );
}
