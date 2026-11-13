import { TAXI_END, TAXI_MONTH, TAXI_START } from './taxi-data.ts';

const firstDay = Number(TAXI_START.slice(-2));
const lastDay = Number(TAXI_END.slice(-2));
const iso = (day: number) => `${TAXI_MONTH}-${String(day).padStart(2, '0')}`;
const firstWeekday = new Date(`${TAXI_START}T00:00:00Z`).getUTCDay();

export function septemberRangePicker(panel: HTMLElement, change: () => void) {
  const dialog = panel.querySelector<HTMLDialogElement>('#taxi-calendar')!;
  const trigger = panel.querySelector<HTMLButtonElement>('#taxi-range')!;
  const valueLabel = panel.querySelector<HTMLElement>('#taxi-range-value')!;
  const hint = dialog.querySelector<HTMLElement>('#taxi-calendar-hint')!;
  const days = dialog.querySelector<HTMLElement>('.calendar-days')!;
  const apply = dialog.querySelector<HTMLButtonElement>('#taxi-range-apply')!;
  let start = firstDay, end = 7;
  let draftStart = start, draftEnd = end, choosingEnd = false;
  const buttons: HTMLButtonElement[] = [];
  days.style.setProperty('--first-weekday', String(firstWeekday + 1));

  function labelRange(first: number, last: number) {
    return first === last ? `Sep ${first}, 2026` : `Sep ${first}–${last}, 2026`;
  }

  function paint() {
    hint.textContent = choosingEnd ? 'Choose the other date. Select the same day for a one-day range.'
      : `${labelRange(draftStart, draftEnd)} selected. Choose a day to start a new range.`;
    apply.disabled = choosingEnd;
    for (const [index, button] of buttons.entries()) {
      const day = firstDay + index;
      button.setAttribute('aria-pressed', String(day >= draftStart && day <= draftEnd));
      button.toggleAttribute('data-endpoint', day === draftStart || day === draftEnd);
    }
  }

  function focusDay(day: number) {
    for (const [index, button] of buttons.entries()) button.tabIndex = index + firstDay === day ? 0 : -1;
    buttons[day - firstDay].focus();
  }

  for (let day = firstDay; day <= lastDay; day++) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = String(day);
    button.setAttribute('aria-label', `September ${day}`);
    button.tabIndex = -1;
    button.addEventListener('click', () => {
      if (choosingEnd) {
        [draftStart, draftEnd] = [Math.min(draftStart, day), Math.max(draftStart, day)];
      } else draftStart = draftEnd = day;
      choosingEnd = !choosingEnd;
      focusDay(day);
      paint();
    });
    button.addEventListener('keydown', event => {
      const direction = getComputedStyle(days).direction === 'rtl' ? -1 : 1;
      const offsets: Record<string, number> = { ArrowLeft: -direction, ArrowRight: direction, ArrowUp: -7, ArrowDown: 7 };
      const offset = offsets[event.key];
      if (offset === undefined) return;
      event.preventDefault();
      focusDay(Math.max(firstDay, Math.min(lastDay, day + offset)));
    });
    buttons.push(button);
    days.append(button);
  }

  valueLabel.textContent = labelRange(start, end);
  trigger.addEventListener('click', () => {
    draftStart = start;
    draftEnd = end;
    choosingEnd = false;
    paint();
    dialog.showModal();
    focusDay(draftStart);
  });
  dialog.querySelector('#taxi-range-cancel')!.addEventListener('click', () => dialog.close());
  apply.addEventListener('click', () => {
    if (choosingEnd) return;
    start = draftStart;
    end = draftEnd;
    valueLabel.textContent = labelRange(start, end);
    dialog.close();
    change();
  });
  return {
    get value() { return { start: iso(start), end: iso(end) }; },
    close() { if (dialog.open) dialog.close(); },
  };
}
