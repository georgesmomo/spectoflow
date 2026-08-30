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
    // gear — settings
    settings: wrap('<circle cx="9" cy="9" r="2.3"/><path d="M9 1.8v2M9 14.2v2M16.2 9h-2M3.8 9h-2M14.1 3.9l-1.4 1.4M5.3 12.7l-1.4 1.4M14.1 14.1l-1.4-1.4M5.3 5.3 3.9 3.9"/>'),
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = ICON;
  else root.ICON = ICON;
})(typeof window !== 'undefined' ? window : globalThis);
