const JSON_PUNCTUATION = /[{}[\]":,]/g;

export function estimateTokens(text: string): number {
  if (text.length === 0) return 0;

  const punctuation = text.match(JSON_PUNCTUATION)?.length ?? 0;
  const jsonLike = punctuation / text.length > 0.08;
  const charactersPerToken = jsonLike ? 3.2 : 4;

  return Math.ceil(text.length / charactersPerToken);
}
