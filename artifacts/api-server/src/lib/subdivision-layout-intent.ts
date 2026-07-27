export function isSubdivisionLayoutRequest(text: string): boolean {
  return /\b(?:visuali[sz]e|show|generate|create|draw|view|see|explore)\b.{0,48}\b(?:subdivision|subdivide|lot|site)\b.{0,32}\b(?:layout|options?|scheme|plan|design)\b|\b(?:subdivision|subdivide|lot|site)\b.{0,48}\b(?:layout|options?|scheme|plan|design)\b|(?:一键生成|生成|查看|展示|可视化|視覺化).{0,24}(?:分割|细分|細分).{0,16}(?:布局|方案|规划|規劃)|(?:分割|细分|細分).{0,24}(?:布局|方案|规划|規劃)/i.test(text);
}
