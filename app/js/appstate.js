// Screen state shared by the views, sheets and router (not persisted).
import { todayDate, todayISO } from './core.js';

const t = todayDate();
export const ui = {
  tab: 'home',
  profile: null,                    // the unlocked profile object
  month: { y: t.getFullYear(), m: t.getMonth() },
  selected: todayISO(),
  scope: 'month',                   // activity: 'day' | 'month' | 'all'
  filter: 'all',                    // 'all' | 'in' | 'out'
  search: '',
  flash: {},                        // ids to highlight after add/edit
  install: null,                    // deferred install prompt, when the browser offers one
  standalone: false
};

export function resetScreenState() {
  const n = todayDate();
  ui.month = { y: n.getFullYear(), m: n.getMonth() };
  ui.selected = todayISO();
  ui.scope = 'month';
  ui.filter = 'all';
  ui.search = '';
  ui.flash = {};
}
