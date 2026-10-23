export function stringMarker(dropped: number): string {
  return `…[+${dropped} chars]`;
}

export function arrayMarker(dropped: number): string {
  return `…[+${dropped} items]`;
}

export function objectMarker(keys: number): string {
  return `{…${keys} keys}`;
}

export function pointerSegment(segment: string): string {
  return segment.replace(/~/g, "~0").replace(/\//g, "~1");
}
