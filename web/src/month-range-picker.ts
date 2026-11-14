import { dateLabel, daysInMonth, monthDate, monthLabel } from './mobility-months.ts';

type Endpoint = 'start' | 'end';

export function monthRangePicker(panel: HTMLElement, change: () => void) {
  const calendar = panel.querySelector<HTMLElement>('#taxi-calendar')!;
  const hint = calendar.querySelector<HTMLElement>('#taxi-calendar-hint')!;
  const title = calendar.querySelector<HTMLElement>('#taxi-calendar-title')!;
  const previous = calendar.querySelector<HTMLButtonElement>('#calendar-previous')!;
  const next = calendar.querySelector<HTMLButtonElement>('#calendar-next')!;
  const days = calendar.querySelector<HTMLElement>('.calendar-days')!;
  const triggers = {
    start: panel.querySelector<HTMLButtonElement>('#taxi-start')!,
    end: panel.querySelector<HTMLButtonElement>('#taxi-end')!,
  };
  const range = { start: '', end: '' };
  let months: readonly string[] = [];
  let viewedMonth = '';
  let endpoint: Endpoint = 'start';
  const buttons: HTMLButtonElement[] = [];
  const isOpen = () => calendar.matches(':popover-open');

  function closeCalendar(restoreFocus = false) {
    if (!isOpen()) return;
    calendar.hidePopover();
    for (const trigger of Object.values(triggers)) trigger.setAttribute('aria-expanded', 'false');
    if (restoreFocus) triggers[endpoint].focus({ preventScroll: true });
  }

  function updateFields() {
    for (const side of ['start', 'end'] as const) {
      triggers[side].querySelector('span')!.textContent = dateLabel(range[side], 'full');
    }
  }

  function bounds() {
    const lastDay = daysInMonth(viewedMonth);
    const other = endpoint === 'start' ? range.end : range.start;
    const month = other.slice(0, 7);
    if (viewedMonth !== month) {
      const validMonth = endpoint === 'start' ? viewedMonth < month : viewedMonth > month;
      return validMonth ? [1, lastDay] : [1, 0];
    }
    const limit = Number(other.slice(8));
    return endpoint === 'start' ? [1, limit] : [limit, lastDay];
  }

  function focusDay(day: number) {
    const button = buttons[day - 1];
    if (!button || button.disabled) return;
    for (const [index, button] of buttons.entries()) button.tabIndex = index + 1 === day ? 0 : -1;
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
      closeCalendar();
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
    if (!range[side]) return;
    if (isOpen() && endpoint === side) {
      closeCalendar();
      return;
    }
    closeCalendar();
    endpoint = side;
    viewedMonth = range[side].slice(0, 7);
    const focusableDay = Number(range[side].slice(8));
    renderMonth(focusableDay);
    calendar.showPopover();
    for (const key of ['start', 'end'] as const) triggers[key].setAttribute('aria-expanded', String(key === side));
    position();
    if (isOpen()) focusDay(focusableDay);
  }

  function makeDay(day: number) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = String(day);
    const value = monthDate(viewedMonth, day);
    const [minimum, maximum] = bounds();
    button.setAttribute('aria-label', dateLabel(value, 'long'));
    button.setAttribute('aria-pressed', String(value === range[endpoint]));
    button.toggleAttribute('data-in-range', value >= range.start && value <= range.end);
    button.disabled = day < minimum || day > maximum;
    button.tabIndex = -1;
    button.addEventListener('click', () => {
      const [minimum, maximum] = bounds();
      if (day < minimum || day > maximum) return;
      range[endpoint] = value;
      updateFields();
      closeCalendar(true);
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
    return button;
  }

  function renderMonth(focusableDay: number) {
    const index = months.indexOf(viewedMonth);
    previous.disabled = index === months.length - 1;
    next.disabled = index === 0;
    const label = monthLabel(viewedMonth);
    title.textContent = label;
    days.setAttribute('aria-label', `${label} dates`);
    const first = new Date(`${monthDate(viewedMonth, 1)}T00:00:00Z`);
    const weekday = first.getUTCDay();
    const last = daysInMonth(viewedMonth);
    hint.textContent = endpoint === 'start'
      ? `Choose a start date on or before ${dateLabel(range.end, 'full')}.`
      : `Choose an end date on or after ${dateLabel(range.start, 'full')}.`;
    buttons.splice(0, buttons.length, ...Array.from({ length: last }, (_, index) => makeDay(index + 1)));
    const focusable = buttons[focusableDay - 1];
    if (focusable && !focusable.disabled) focusable.tabIndex = 0;
    const adjacentDay = (offset: number) => {
      const date = new Date(first);
      date.setUTCDate(1 + offset);
      const cell = document.createElement('span');
      cell.className = 'calendar-other-day';
      cell.textContent = String(date.getUTCDate());
      cell.setAttribute('aria-hidden', 'true');
      return cell;
    };
    const leading = Array.from({ length: weekday }, (_, i) => adjacentDay(i - weekday));
    const trailing = Array.from({ length: (7 - (weekday + last) % 7) % 7 }, (_, i) => adjacentDay(last + i));
    days.replaceChildren(...leading, ...buttons, ...trailing);
  }

  function browse(offset: number, control: HTMLButtonElement) {
    const target = months[months.indexOf(viewedMonth) + offset];
    if (!target) return;
    viewedMonth = target;
    const [minimum, maximum] = bounds();
    const day = Math.max(minimum, Math.min(maximum, Number(range[endpoint].slice(8))));
    renderMonth(day);
    position();
    if (!isOpen()) return;
    if (control.disabled) {
      if (maximum >= minimum) focusDay(day);
      else (control === previous ? next : previous).focus({ preventScroll: true });
    }
  }

  previous.addEventListener('click', () => browse(1, previous));
  next.addEventListener('click', () => browse(-1, next));
  for (const side of ['start', 'end'] as const) triggers[side].addEventListener('click', () => open(side));
  calendar.addEventListener('toggle', () => {
    if (!isOpen()) for (const trigger of Object.values(triggers)) trigger.setAttribute('aria-expanded', 'false');
  });
  function dismissOutside(event: Event) {
    const target = event.target as Node;
    if (isOpen() && !calendar.contains(target) && !triggers.start.contains(target) && !triggers.end.contains(target)) {
      closeCalendar();
    }
  }
  document.addEventListener('focusin', dismissOutside);
  document.addEventListener('pointerdown', dismissOutside);
  calendar.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    closeCalendar(true);
  });
  panel.addEventListener('scroll', position, { passive: true });
  window.addEventListener('scroll', position, { passive: true });
  window.addEventListener('resize', position);
  return {
    get value() { return { ...range }; },
    setMonths(available: readonly string[]) {
      months = available;
      const month = available[0];
      if (!month) return;
      range.start = monthDate(month, 1);
      range.end = monthDate(month, 7);
      updateFields();
      for (const trigger of Object.values(triggers)) trigger.disabled = false;
    },
    close: closeCalendar,
  };
}
