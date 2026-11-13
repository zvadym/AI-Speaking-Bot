// Read only top-level fields from a partially received structured response.
// Never expose JSON syntax, explanations, or reasoning as a conversation draft.
export function partialConversationReply(source: string): string {
  let index = 0;
  const spaces = () => { while (/\s/u.test(source[index] || '') && index < source.length) index++; };
  const string = (): { value: string; complete: boolean } | null => {
    if (source[index++] !== '"') return null;
    let encoded = '"';
    while (index < source.length) {
      const ch = source[index++];
      if (ch === '"') return { value: JSON.parse(encoded + '"'), complete: true };
      if (ch === '\\') {
        if (index >= source.length) break;
        const escape = source[index++];
        if (escape === 'u') {
          if (source.length - index < 4) break;
          encoded += '\\u' + source.slice(index, index + 4);
          index += 4;
        } else encoded += '\\' + escape;
      } else encoded += ch;
    }
    const value: string = JSON.parse(encoded + '"');
    return { value: value.replace(/[\uD800-\uDBFF]$/u, ''), complete: false };
  };
  try {
    spaces();
    if (source[index++] !== '{') return '';
    let target = false;
    let reply = '';
    while (index < source.length) {
      spaces();
      const key = string();
      if (!key?.complete) break;
      spaces();
      if (source[index++] !== ':') break;
      spaces();
      if (source[index] === '"') {
        const value = string();
        if (key.value === 'reply_text') reply = value?.value || '';
        if (!value?.complete) break;
      } else {
        const token = /^(true|false|null)(?=\s*[,}])/u.exec(source.slice(index));
        if (!token) break;
        if (key.value === 'is_target_language') target = token[1] === 'true';
        index += token[1].length;
      }
      spaces();
      if (source[index++] !== ',') break;
    }
    return target ? reply : '';
  } catch {
    return '';
  }
}
