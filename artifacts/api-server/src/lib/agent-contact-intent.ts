export function hasExplicitAgentContactSignal(text: string): boolean {
  const lower = text.toLowerCase();
  const signals = [
    "agent", "listing agent", "sales agent", "selling agent", "realtor",
    "who is selling", "who listed", "contact agent", "call agent",
    "agent phone", "agent number", "open home", "viewing", "inspection",
    "谁是 agent", "誰是 agent", "agent 是谁", "agent 是誰",
    "中介", "经纪", "經紀", "销售中介", "銷售中介", "房产中介", "房產中介",
    "谁在卖", "誰在賣", "谁卖", "誰賣", "联系销售", "聯繫銷售",
    "联系中介", "聯繫中介", "看房", "开放日",
  ];
  return signals.some((signal) => lower.includes(signal.toLowerCase()));
}
