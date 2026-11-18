// Role icons: shape tells the roles apart, never a hue.
document.body.insertAdjacentHTML("afterbegin", `
<svg width="0" height="0" style="position:absolute">
  <symbol id="i-plan" viewBox="0 0 16 16"><path d="M3 3h10M3 8h7M3 13h4"/><circle cx="13" cy="13" r="1.6"/></symbol>
  <symbol id="i-do" viewBox="0 0 16 16"><path d="M2.5 4l4 4-4 4M8.5 12.5h5"/></symbol>
  <symbol id="i-check" viewBox="0 0 16 16"><rect x="1.5" y="5" width="13" height="6"/><path d="M4.5 5v2.5M7.5 5v3.5M10.5 5v2.5M13 5v1.5"/></symbol>
  <symbol id="i-critic" viewBox="0 0 16 16"><path d="M1.5 8.5C4 4.5 12 4.5 14.5 8.5C12 12.5 4 12.5 1.5 8.5Z"/><path d="M2.5 7.2h11" /><circle cx="8" cy="9.4" r="1.6"/></symbol>
  <symbol id="i-decide" viewBox="0 0 16 16"><path d="M8 1.8L14.2 8 8 14.2 1.8 8Z"/><path d="M8 5.5v5M5.5 8h5"/></symbol>
  <symbol id="i-memory" viewBox="0 0 16 16"><rect x="2" y="2.5" width="12" height="3.5"/><rect x="2" y="6" width="12" height="3.5"/><rect x="2" y="9.5" width="12" height="4"/></symbol>
  <symbol id="i-you" viewBox="0 0 16 16"><circle cx="8" cy="5" r="2.6"/><path d="M2.8 14.2C3.5 10.6 12.5 10.6 13.2 14.2"/></symbol>
  <symbol id="i-one" viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5"/><path d="M8 5.5v5"/></symbol>
  <symbol id="i-loop" viewBox="0 0 16 16"><path d="M12.5 5.5A5 5 0 1 0 13 9"/><path d="M13 2.5v3.2H9.8"/></symbol>
  <symbol id="i-many" viewBox="0 0 16 16"><circle cx="4" cy="5" r="2"/><circle cx="12" cy="5" r="2"/><circle cx="4" cy="11.5" r="2"/><circle cx="12" cy="11.5" r="2"/></symbol>
  <symbol id="i-flag" viewBox="0 0 16 16"><path d="M3.5 14.5V2M3.5 2.5h9l-2 3 2 3h-9"/></symbol>
  <symbol id="i-q" viewBox="0 0 16 16"><path d="M5.5 5.5a2.5 2.5 0 1 1 3.5 2.3c-.8.4-1 1-1 1.7v.8"/><path d="M8 12.6v.4"/></symbol>
  <symbol id="i-cause" viewBox="0 0 16 16"><circle cx="3.5" cy="12.5" r="1.6"/><circle cx="12.5" cy="3.5" r="1.6"/><path d="M4.8 11.2l6.4-6.4M8 4h3.2v3.2"/></symbol>
</svg>`);
