import { html, mount } from '../../utils/dom.js';
import { timelineApi } from '../../api/phase2.js';
import { pageHeader } from '../../components/ui.js';
import { mountTimeline } from '../../components/timeline.js';

export default async function render({ view }) {
  mount(view, html`${pageHeader('My timeline', 'Everything that has happened on your record, newest first.')}<div id="tl"></div>`);
  await mountTimeline(view.querySelector('#tl'), q => timelineApi.mine({ ...q, limit: 30 }));
}
