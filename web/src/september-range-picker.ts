import { TAXI_END, TAXI_MONTH, TAXI_START } from './taxi-data.ts';

const firstDay = Number(TAXI_START.slice(-2));
const lastDay = Number(TAXI_END.slice(-2));
const iso = (day: number) => `${TAXI_MONTH}-${String(day).padStart(2, '0')}`;
const firstWeekday = new Date(`${TAXI_START}T00:00:00Z`).getUTCDay();
type Endpoint = 'start' | 'end';

export function septemberRangePicker(panel: HTMLElement, change: () => void) {
  const calendar = panel.querySelector<HTMLElement>('#taxi-calendar')!;
  const hint = calendar.querySelector<HTMLElement>('#taxi-calendar-hint')!;
  const days = calendar.querySelector<HTMLElement>('.calendar-days')!;
  const triggers = {
    start: panel.querySelector<HTMLButtonElement>('#taxi-start')!,
    end: panel.querySelector<HTMLButtonElement>('#taxi-end')!,
  };
  const range = { start: firstDay, end: 7 };
  let endpoint: Endpoint = 'start';
  const buttons: HTMLButtonElement[] = [];
  const isOpen = () => calendar.matches(':popover-open');
  days.style.setProperty('--first-weekday', String(firstWeekday + 1));

  function updateFields() {
    for (const side of ['start', 'end'] as const) {
      triggers[side].querySelector('span')!.textContent = `Sep ${range[side]}, 2026`;
    }
  }

  function bounds() {
    return endpoint === 'start' ? [firstDay, range.end] : [range.start, lastDay];
  }

  function focusDay(day: number) {
    for (const [index, button] of buttons.entries()) button.tabIndex = index + firstDay === day ? 0 : -1;
    const button = buttons[day - firstDay];
    button.focus({ preventScroll: true });
    const cell = button.getBoundingClientRect();
    const top = calendar.getBoundingClientRect().top + calendar.clientTop;
    const bottom = top + calendar.clientHeight;
    if (cell.top < top + 4) calendar.scrollTop += cell.top - top - 4;
    else if (cell.bottom > bottom - 4) calendar.scrollTop += cell.bottom - bottom + 4;
  }

  function position() {
    if (!isOpen()) return;
    const field = triggers[endpoint].getBoundingClientRect();
    const panelBounds = panel.getBoundingClientRect();
    if (field.bottom <= panelBounds.top || field.top >= panelBounds.bottom) {
      calendar.hidePopover();
      return;
    }
    const { width, height } = calendar.getBoundingClientRect();
    const rtl = getComputedStyle(calendar).direction === 'rtl';
    const alignRight = (endpoint === 'end') !== rtl;
    calendar.style.left = `${Math.max(8, Math.min(alignRight ? field.right - width : field.left, innerWidth - width - 8))}px`;
    const below = field.bottom + 6;
    const above = field.top - height - 6;
    const top = below + height <= innerHeight - 8 || above < 8 ? below : above;
    calendar.style.top = `${Math.max(8, Math.min(top, innerHeight - height - 8))}px`;
  }

  function open(side: Endpoint) {
    if (isOpen() && endpoint === side) {
      calendar.hidePopover();
      return;
    }
    if (isOpen()) calendar.hidePopover();
    endpoint = side;
    const [minimum, maximum] = bounds();
    hint.textContent = side === 'start'
      ? `Choose a start date on or before September ${range.end}.`
      : `Choose an end date on or after September ${range.start}.`;
    for (const [index, button] of buttons.entries()) {
      const day = firstDay + index;
      button.disabled = day < minimum || day > maximum;
      button.setAttribute('aria-pressed', String(day === range[side]));
      button.toggleAttribute('data-in-range', day >= range.start && day <= range.end);
    }
    calendar.showPopover();
    for (const key of ['start', 'end'] as const) triggers[key].setAttribute('aria-expanded', String(key === side));
    position();
    if (isOpen()) focusDay(range[side]);
  }

  for (let day = firstDay; day <= lastDay; day++) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = String(day);
    button.setAttribute('aria-label', `September ${day}`);
    button.tabIndex = -1;
    button.addEventListener('click', () => {
      const [minimum, maximum] = bounds();
      if (day < minimum || day > maximum) return;
      range[endpoint] = day;
      updateFields();
      calendar.hidePopover();
      triggers[endpoint].focus({ preventScroll: true });
      change();
    });
    button.addEventListener('keydown', event => {
      const direction = getComputedStyle(days).direction === 'rtl' ? -1 : 1;
      const offsets: Record<string, number> = { ArrowLeft: -direction, ArrowRight: direction, ArrowUp: -7, ArrowDown: 7 };
      const offset = offsets[event.key];
      if (offset === undefined) return;
      event.preventDefault();
      const [minimum, maximum] = bounds();
      focusDay(Math.max(minimum, Math.min(maximum, day + offset)));
    });
    buttons.push(button);
    days.append(button);
  }

  updateFields();
  for (const side of ['start', 'end'] as const) triggers[side].addEventListener('click', () => open(side));
  calendar.addEventListener('toggle', () => {
    if (!isOpen()) for (const trigger of Object.values(triggers)) trigger.setAttribute('aria-expanded', 'false');
  });
  function dismissOutside(event: Event) {
    const target = event.target as Node;
    if (isOpen() && !calendar.contains(target) && !triggers.start.contains(target) && !triggers.end.contains(target)) {
      calendar.hidePopover();
    }
  }
  document.addEventListener('focusin', dismissOutside);
  document.addEventListener('pointerdown', dismissOutside);
  calendar.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    calendar.hidePopover();
    triggers[endpoint].focus({ preventScroll: true });
  });
  panel.addEventListener('scroll', position, { passive: true });
  window.addEventListener('scroll', position, { passive: true });
  window.addEventListener('resize', position);
  return {
    get value() { return { start: iso(range.start), end: iso(range.end) }; },
    close() { if (isOpen()) calendar.hidePopover(); },
  };
}
