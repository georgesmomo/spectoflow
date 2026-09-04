'use strict';
// Small inline-SVG line-icon set for the header nav and quick actions.
// Line style, 16-18px viewBox units, stroke=currentColor so icons inherit tab/text color.
(function (root) {
  const wrap = (inner, extra) => `<svg viewBox="0 0 18 18" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra ? ' ' + extra : ''}>${inner}</svg>`;

  const ICON = {
    // kanban columns
    board: wrap('<rect x="2" y="3" width="4" height="12" rx="1"/><rect x="7" y="3" width="4" height="8" rx="1"/><rect x="12" y="3" width="4" height="10" rx="1"/>'),
    // inbox tray — tasks awaiting a decision
    requests: wrap('<path d="M2.6 10h3.2l1.4 2h3.6l1.4-2h3.2"/><path d="M2.6 10 3.9 4.6a1 1 0 0 1 1-.8h7.2a1 1 0 0 1 1 .8L14.4 10"/><path d="M2.6 10v3a1 1 0 0 0 1 1h9.8a1 1 0 0 0 1-1v-3"/>'),
    // stacked list
    backlog: wrap('<line x1="3" y1="5" x2="15" y2="5"/><line x1="3" y1="9" x2="15" y2="9"/><line x1="3" y1="13" x2="10.5" y2="13"/>'),
    // connected nodes — pipeline
    workflow: wrap('<circle cx="3.4" cy="9" r="1.7"/><circle cx="9" cy="9" r="1.7"/><circle cx="14.6" cy="9" r="1.7"/><line x1="5.1" y1="9" x2="7.3" y2="9"/><line x1="10.7" y1="9" x2="12.9" y2="9"/>'),
    // two people — agents & skills
    agents: wrap('<circle cx="6.4" cy="6.1" r="2.1"/><path d="M2.6 15c0-2.5 1.7-4 3.8-4s3.8 1.5 3.8 4"/><circle cx="13.1" cy="7.1" r="1.7"/><path d="M10.9 15c.2-2 1.5-3.1 3.1-3.1 1.8 0 3.4 1.3 3.4 3.1"/>'),
    // speech bubble
    chat: wrap('<path d="M3 4.4h12a1 1 0 0 1 1 1V11a1 1 0 0 1-1 1H8.2l-3.3 2.6a.4.4 0 0 1-.65-.31V12H3a1 1 0 0 1-1-1V5.4a1 1 0 0 1 1-1z"/>'),
    // info circle
    info: wrap('<circle cx="9" cy="9" r="6.4"/><line x1="9" y1="8.3" x2="9" y2="12.2"/><circle cx="9" cy="5.7" r="0.9" fill="currentColor" stroke="none"/>'),
    // play triangle — run
    run: wrap('<path d="M5.4 3.6v10.8l9-5.4z" fill="currentColor" stroke="none"/>'),
    // flag — points needing attention
    attention: wrap('<line x1="4.5" y1="2.4" x2="4.5" y2="15.6"/><path d="M4.5 3.4h8.2l-1.7 2.6 1.7 2.6H4.5z"/>'),
    // gear — settings (proper cog with teeth)
    settings: wrap('<circle cx="9" cy="9" r="2.4"/><path d="M9 1.6v2.2M9 14.2v2.2M16.4 9h-2.2M3.8 9H1.6M14.2 3.8l-1.55 1.55M5.35 12.65 3.8 14.2M14.2 14.2l-1.55-1.55M5.35 5.35 3.8 3.8"/>'),
    // open book — documentation
    docs: wrap('<path d="M9 5.4C7.4 4.2 5.2 3.7 2.8 4v9c2.4-.3 4.6.2 6.2 1.4 1.6-1.2 3.8-1.7 6.2-1.4V4c-2.4-.3-4.6.2-6.2 1.4z"/><line x1="9" y1="5.4" x2="9" y2="14.4"/>'),
    // crescent moon — theme toggle
    theme: wrap('<path d="M14.6 10.8A5.6 5.6 0 0 1 7.2 3.4 5.7 5.7 0 1 0 14.6 10.8z"/>'),
  };

  // Representative icons for workflow pipeline steps, resolved from the step name.
  const WF = {
    brainstorm: wrap('<path d="M6.4 12.2a4.3 4.3 0 1 1 5.2 0c-.5.4-.8.9-.9 1.5H7.3c-.1-.6-.4-1.1-.9-1.5z"/><line x1="7.2" y1="15.4" x2="10.8" y2="15.4"/>'),
    analysis:   wrap('<circle cx="7.8" cy="7.8" r="4"/><line x1="10.8" y1="10.8" x2="15" y2="15"/>'),
    spec:       wrap('<path d="M5 2.5h5l3 3v10H5z"/><path d="M10 2.5v3h3"/><line x1="6.8" y1="9" x2="11" y2="9"/><line x1="6.8" y1="11.5" x2="11" y2="11.5"/>'),
    plan:       wrap('<rect x="4" y="3.4" width="10" height="12" rx="1.4"/><path d="M6.8 3.4V3a1.1 1.1 0 0 1 1.1-1.1h2.2A1.1 1.1 0 0 1 11.2 3v.4"/><path d="M6.4 8.2 7.3 9 9 7"/><line x1="10.4" y1="8" x2="11.7" y2="8"/><line x1="6.4" y1="11.6" x2="11.7" y2="11.6"/>'),
    develop:    wrap('<path d="M6.4 5.6 3 9l3.4 3.4"/><path d="M11.6 5.6 15 9l-3.4 3.4"/>'),
    unit:       wrap('<circle cx="9" cy="9" r="6.2"/><path d="M6.2 9.2 8 11l3.9-4.1"/>'),
    integration:wrap('<path d="M7.2 12.1 5.9 13.4a2.4 2.4 0 0 1-3.3-3.3L4 8.7"/><path d="M10.8 5.9 12.1 4.6a2.4 2.4 0 0 1 3.3 3.3L14 9.3"/><line x1="7.4" y1="10.6" x2="10.6" y2="7.4"/>'),
    e2e:        wrap('<rect x="2.8" y="3.6" width="12.4" height="8.2" rx="1.2"/><line x1="7" y1="15" x2="11" y2="15"/><line x1="9" y1="11.8" x2="9" y2="15"/><line x1="2.8" y1="6.4" x2="15.2" y2="6.4"/>'),
    review:     wrap('<path d="M2.4 9S5 4.6 9 4.6 15.6 9 15.6 9 13 13.4 9 13.4 2.4 9 2.4 9z"/><circle cx="9" cy="9" r="2.1"/>'),
    deploy:     wrap('<path d="M15.6 2.4 8.2 9.2"/><path d="M15.6 2.4 11.1 15.6 8.2 9.2 2.4 6.6z"/>'),
    fallback:   wrap('<circle cx="9" cy="9" r="3.4"/>'),
  };
  ICON.wf = function (name) {
    const n = String(name || '').toLowerCase();
    if (/brainstorm|idea/.test(n)) return WF.brainstorm;
    if (/analy/.test(n)) return WF.analysis;
    if (/spec/.test(n)) return WF.spec;
    if (/plan/.test(n)) return WF.plan;
    if (/develop|implement|\bcode\b|build/.test(n)) return WF.develop;
    if (/integration/.test(n)) return WF.integration;
    if (/end.?to.?end|e2e/.test(n)) return WF.e2e;
    if (/unit/.test(n) || /\btest/.test(n)) return WF.unit;
    if (/review/.test(n)) return WF.review;
    if (/deploy|ship|release|publish/.test(n)) return WF.deploy;
    return WF.fallback;
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = ICON;
  else root.ICON = ICON;
})(typeof window !== 'undefined' ? window : globalThis);
