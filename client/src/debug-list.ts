/**
 * Renders label/value rows into a <dl>. Rows are created once per label and
 * then only their text is updated, so calling set() every frame is cheap.
 */
export class DebugList {
  private readonly values = new Map<string, HTMLElement>();

  constructor(private readonly list: HTMLElement) {}

  set(rows: readonly (readonly [label: string, value: string])[]): void {
    for (const [label, value] of rows) {
      let dd = this.values.get(label);
      if (!dd) {
        const dt = document.createElement("dt");
        dt.textContent = label;
        dd = document.createElement("dd");
        this.list.append(dt, dd);
        this.values.set(label, dd);
      }
      if (dd.textContent !== value) dd.textContent = value;
    }
  }
}
