interface Point { x: number; y: number }
interface Size { width: number; height: number }
interface Bounds { left: number; top: number; right: number; bottom: number }

export function areaCardPosition(point: Point, card: Size, viewport: Bounds, controls: Bounds[]) {
  const inset = 12;
  const minLeft = viewport.left + inset;
  const maxLeft = viewport.right - card.width - inset;
  const top = point.y - card.height - inset;
  if (minLeft > maxLeft || top < viewport.top + inset || point.y > viewport.bottom ||
      point.x < viewport.left || point.x > viewport.right) return null;

  const left = Math.max(minLeft, Math.min(maxLeft, point.x - card.width / 2));
  const right = left + card.width;
  if (controls.some(control => left < control.right && right > control.left &&
      top < control.bottom && point.y > control.top)) return null;

  const pointer = Math.max(inset, Math.min(card.width - inset, point.x - left));
  return { left, top, pointer };
}
