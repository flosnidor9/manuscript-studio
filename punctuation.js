const HANGING_PUNCTUATION = new Set('.,!?;:。．｡、､，·！？；：⋯…”’」』）)]}〉》】〕］｝');
const SHORT_HANGING_PUNCTUATION = new Set('.,。．｡、､，');

export const isHangingPunctuation = character => HANGING_PUNCTUATION.has(character);
export const isTrailingPunctuation = (text, index) => isHangingPunctuation(text[index]) || (['"', "'"].includes(text[index]) && index > 0 && isHangingPunctuation(text[index - 1]));
export const canHangPunctuation = run => run.length === 1 && SHORT_HANGING_PUNCTUATION.has(run);
