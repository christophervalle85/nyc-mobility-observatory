import { dateLabel } from './mobility-months.ts';

export interface TrendDay {
  date: string;
  taxi: number | null;
  subway: number | null;
  subwayPartial: boolean;
}

const number = new Intl.NumberFormat('en-US');

export function dailyTrend(section: HTMLElement, selectDay: (date: string) => void) {
  const track = section.querySelector<HTMLElement>('#mobility-trend-days')!;
  let buttons: HTMLButtonElement[] = [];
  let lastDays: readonly TrendDay[] = [];
  let currentDate = '';

  function reveal(button: HTMLButtonElement) {
    const row = track.getBoundingClientRect();
    const cell = button.getBoundingClientRect();
    if (cell.left < row.left + 4) track.scrollLeft += cell.left - row.left - 4;
    else if (cell.right > row.right - 4) track.scrollLeft += cell.right - row.right + 4;
  }

  function makeBar(mode: 'taxi' | 'subway', value: number | null, max: number, partial = false) {
    const bar = document.createElement('span');
    bar.className = `trend-bar ${mode}-trend-bar`;
    bar.toggleAttribute('data-gap', value === null);
    bar.toggleAttribute('data-zero', value === 0);
    bar.toggleAttribute('data-partial', partial && value !== null);
    if (value !== null) bar.style.setProperty('--trend-height', `${max > 0 ? value / max * 100 : 0}%`);
    const row = document.createElement('span');
    row.className = `trend-bar-row ${mode}-trend-row`;
    row.append(bar);
    return row;
  }

  function describe(value: number | null, name: string) {
    return value === null ? `${name} unavailable` : `${number.format(value)} ${name}`;
  }

  function makeButton(day: TrendDay, taxiScale: number, subwayScale: number) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'trend-day';
    button.dataset.date = day.date;
    const taxi = describe(day.taxi, 'taxi dropoffs');
    const subway = describe(day.subway, 'estimated subway entries');
    const partial = day.subway !== null && day.subwayPartial ? ' (partial)' : '';
    button.setAttribute('aria-label', `${dateLabel(day.date, 'full')}, ${taxi}, ${subway}${partial}`);
    button.title = button.getAttribute('aria-label')!;
    const bars = document.createElement('span');
    bars.className = 'trend-bars';
    bars.setAttribute('aria-hidden', 'true');
    bars.append(
      makeBar('taxi', day.taxi, taxiScale),
      makeBar('subway', day.subway, subwayScale, day.subwayPartial),
    );
    const label = document.createElement('span');
    label.className = 'trend-day-label';
    label.textContent = dateLabel(day.date);
    label.setAttribute('aria-hidden', 'true');
    button.append(bars, label);
    button.addEventListener('click', () => selectDay(day.date));
    return button;
  }

  track.addEventListener('keydown', event => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const index = buttons.indexOf(event.target as HTMLButtonElement);
    if (index < 0) return;
    const rtl = getComputedStyle(track).direction === 'rtl';
    let next: number;
    switch (event.key) {
      case 'Home': next = 0; break;
      case 'End': next = buttons.length - 1; break;
      case 'ArrowLeft': next = index + (rtl ? 1 : -1); break;
      case 'ArrowRight': next = index + (rtl ? -1 : 1); break;
      default: return;
    }
    event.preventDefault();
    const button = buttons[Math.max(0, Math.min(buttons.length - 1, next))];
    buttons[index].tabIndex = -1;
    button.tabIndex = 0;
    button.focus({ preventScroll: true });
    reveal(button);
  });

  return {
    render(days: readonly TrendDay[], selected: string) {
      const focusedDate = buttons.includes(document.activeElement as HTMLButtonElement)
        ? (document.activeElement as HTMLButtonElement).dataset.date
        : undefined;
      const changed = days.length !== lastDays.length || days.some((day, index) => {
        const previous = lastDays[index];
        return day.date !== previous.date || day.taxi !== previous.taxi || day.subway !== previous.subway
          || day.subwayPartial !== previous.subwayPartial;
      });
      if (changed) {
        let taxiScale = 0, subwayScale = 0;
        for (const day of days) {
          taxiScale = Math.max(taxiScale, day.taxi ?? 0);
          subwayScale = Math.max(subwayScale, day.subway ?? 0);
        }
        buttons = days.map(day => makeButton(day, taxiScale, subwayScale));
        track.replaceChildren(...buttons);
        lastDays = days;
      }
      const active = buttons.find(button => button.dataset.date === selected) ?? buttons[0];
      const focus = changed && focusedDate
        ? buttons.find(button => button.dataset.date === focusedDate) ?? active
        : undefined;
      const tabStop = focus ?? (changed || currentDate !== selected ? active : buttons.find(button => button.tabIndex === 0) ?? active);
      for (const button of buttons) {
        button.setAttribute('aria-pressed', String(button === active));
        button.tabIndex = button === tabStop ? 0 : -1;
      }
      if (focus) {
        focus.focus({ preventScroll: true });
        reveal(focus);
      } else if (active && (changed || selected !== currentDate)) reveal(active);
      currentDate = selected;
    },
  };
}
