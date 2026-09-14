/** Display-only formatting. Amounts and reward results remain server-owned. */
export function jackpotAmount(value: any): string {
    if (value === null || value === undefined || value === "") return "—";
    const raw = String(value).trim().replace(/,/g, "");
    const match = /^([+-]?)(\d+)(\.\d+)?$/.exec(raw);
    if (!match) return "—";
    return match[1] + match[2].replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (match[3] || "");
}

export function jackpotTier(setting: string): string {
    const match = /底皮\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/.exec(setting || "");
    return match ? "底皮" + match[1] + "/" + match[2] : "";
}

export function jackpotTime(value: any, multiline = false): string {
    const raw = value === null || value === undefined ? "" : String(value).trim();
    const match = /^(?:\d{4}[-/])?(\d{2})[-/](\d{2})[ T]+(\d{2}:\d{2})(?::\d{2})?$/.exec(raw);
    return match ? match[1] + "-" + match[2] + (multiline ? "\n" : "  ") + match[3] : raw || "—";
}
