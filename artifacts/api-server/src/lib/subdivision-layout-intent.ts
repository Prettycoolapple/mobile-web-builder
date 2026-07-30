/**
 * Deterministic backstop for "show me a subdivision layout".
 *
 * The primary signal is semantic — `ChatIntent.wantsSubdivisionLayout`, decided
 * by the intent model, which is what copes with the open-ended ways people ask
 * for this. This file exists for the cases where that signal is unavailable:
 * the intent call timed out, returned unparseable JSON, or fell through to the
 * regex fallback intent.
 *
 * So it is deliberately narrow. A miss here costs the user one tap on the Plan
 * tab; a false positive silently yanks them away from an answer they asked for.
 * When in doubt, do not match — the semantic path is the one carrying the load.
 */

/** "show/visualise/draw … subdivision … layout/scheme" — the explicit ask. */
const VERB_THEN_LAYOUT =
  /\b(?:visuali[sz]e|show|generate|create|draw|view|see|explore)\b.{0,48}\b(?:subdivision|subdivide|lot|site)\b.{0,32}\b(?:layout|options?|scheme|plan|design)\b/i;

/** "subdivision layout", "lot scheme" — the noun phrase on its own. */
const SUBDIVISION_LAYOUT_NOUN =
  /\b(?:subdivision|subdivide|lot|site)\b.{0,48}\b(?:layout|options?|scheme|plan|design)\b/i;

/**
 * A lot COUNT. Wanting a number of lots means wanting to see the arrangement
 * that achieves it — "can this subdivide into 3 lots?", "a 4-lot layout".
 * Requires a subdivision word nearby so "3 lots of work" cannot match.
 */
const LOT_COUNT =
  /\b(?:subdivid\w*|subdivision|split|carve)\b.{0,40}\b\d+\s*(?:lots?|sections?|titles?)\b|\b\d+[-\s]?(?:lot|section)\b.{0,32}\b(?:layout|scheme|subdivision|plan|design|option)/i;

/** Yield maximisation — "subdivide with max yield", "most lots out of this". */
const MAX_YIELD =
  /\b(?:max(?:imum|imise|imize)?|most|highest|best)\b.{0,24}\b(?:yield|lots?|sections?|density|units?)\b|\b(?:yield|lots?)\b.{0,16}\bmax(?:imum|imised|imized)?\b/i;

/** Chinese: 生成/查看/可视化 + 分割 + 布局/方案, plus counts and yield. */
const CHINESE =
  /(?:一键生成|生成|查看|展示|可视化|視覺化).{0,24}(?:分割|细分|細分).{0,16}(?:布局|方案|规划|規劃)|(?:分割|细分|細分).{0,24}(?:布局|方案|规划|規劃)|(?:分割|细分|細分|分成).{0,12}(?:几块|幾塊|几宗|幾宗|几个地块|幾個地塊)|最大化.{0,8}(?:户数|戶數|地块|地塊|产出|產出)/;

/**
 * Yield phrasing alone is ambiguous ("best lots in the area" is discovery), so
 * it only counts when the message is also about subdividing this property.
 */
const SUBDIVISION_CONTEXT = /\b(?:subdivid\w*|subdivision)\b|分割|细分|細分/i;

export function isSubdivisionLayoutRequest(text: string): boolean {
  if (VERB_THEN_LAYOUT.test(text)) return true;
  if (SUBDIVISION_LAYOUT_NOUN.test(text)) return true;
  if (LOT_COUNT.test(text)) return true;
  if (CHINESE.test(text)) return true;
  if (MAX_YIELD.test(text) && SUBDIVISION_CONTEXT.test(text)) return true;
  return false;
}
