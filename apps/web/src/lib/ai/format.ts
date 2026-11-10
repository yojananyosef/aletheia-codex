/**
 * Normalise the plain-text answer returned by the model.
 *
 * The UI renders this value as text (never as HTML), so the goal here is
 * readability rather than full Markdown support. Models sometimes wrap their
 * answer in thinking-channel tokens or Markdown even when asked not to.
 */
export function cleanAiText(value: string): string {
  let text = value.replace(/\r\n?/g, "\n");

  // Some providers return the internal reasoning channel together with the
  // final answer. Keep only the final answer when the channel is present.
  const finalChannel = text.lastIndexOf("<|channel|>");
  if (finalChannel >= 0) {
    text = text.slice(finalChannel + "<|channel|>".length);
  }
  text = text.replace(/<\|channel>thought[\s\S]*?<\|channel\|>/gi, "");
  text = text.replace(/<\|[^>]*\|>/g, "");
  text = text.split(String.fromCharCode(0)).join("");

  text = text.replace(/^#{1,6}\s+/gm, "");
  text = text.replace(/\*\*(.*?)\*\*/g, "$1");
  text = text.replace(/^\s*[-*]\s+/gm, "• ");
  text = text.replace(/`([^`]+)`/g, "$1");
  text = text.replace(/\n{3,}/g, "\n\n");

  return text.trim();
}
