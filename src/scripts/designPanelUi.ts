/**
 * Panelen som ritas INNE PA SIDAN av designPanel.ts.
 *
 * ⚠️ Funktionen serialiseras och korrs i webblasaren. Den far darfor inte
 * anvanda nagot utanfor sig sjalv - ingen import, ingen variabel fran
 * modulen. Allt den behover kommer in som argument.
 *
 * Panelen ligger i en egen shadow root, sa kundens CSS inte kan rita om den
 * och vi inte kan rita om kundens sajt.
 */

export type PanelOptions = {
  groups: { title: string; kind: "color" | "text"; variables: string[] }[];
  values: Record<string, string>;
  categories: string[];
  visibility: Record<string, string>;
  minimum: number;
  filePath: string;
};

declare global {
  interface Window {
    seosSetVariable: (name: string, value: string) => Promise<void>;
    seosContrast: (a: string, b: string) => Promise<number | null>;
    seosSave: () => Promise<{ ok: boolean; message: string }>;
    seosPublish: () => Promise<{ ok: boolean; message: string }>;
    seosSetVisibility: (key: string, value: string) => Promise<void>;
  }
}

export function buildPanel(options: PanelOptions): void {
  const HOST_ID = "cookie-sectionId"; // bannerns vardelement
  const PANEL_ID = "seos-design-panel";

  if (document.getElementById(PANEL_ID)) return;

  // Kontrastpar som betyder nagot for lasbarheten. Bannern har fler ytor, men
  // de har ar de som avgor om texten gar att lasa.
  const PAIRS: { label: string; fg: string; bg: string }[] = [
    { label: "Brodtext", fg: "text-main", bg: "bg-main" },
    { label: "Dampad text", fg: "text-muted", bg: "bg-main" },
    { label: "Knapptext", fg: "btn-accent-text", bg: "accent-color" },
    { label: "Policylank", fg: "policy-link-color", bg: "bg-main" },
    { label: "Ikontext", fg: "badge-text-color", bg: "bg-logo-wrapper" },
  ];

  const CATEGORY_LABELS: Record<string, string> = {
    necessary: "Nodvandiga",
    functional: "Funktionella",
    analytics: "Analys",
    marketing: "Marknadsforing",
  };

  const panel = document.createElement("div");
  panel.id = PANEL_ID;
  panel.style.cssText =
    "position:fixed;top:16px;right:16px;z-index:2147483647;width:340px;" +
    "max-height:calc(100vh - 32px);";
  const root = panel.attachShadow({ mode: "open" });
  document.body.appendChild(panel);

  const style = document.createElement("style");
  style.textContent = `
    :host, * { box-sizing: border-box; }
    .panel {
      font: 13px/1.4 system-ui, sans-serif; color: #1a1a1a; background: #fff;
      border: 1px solid #d0d0d0; border-radius: 10px; overflow: hidden;
      box-shadow: 0 8px 24px rgba(0,0,0,.18); display: flex; flex-direction: column;
      max-height: calc(100vh - 32px);
    }
    header { padding: 10px 12px; background: #1f2d3d; color: #fff; }
    header b { display: block; font-size: 13px; }
    header span { font-size: 11px; opacity: .75; word-break: break-all; }
    .body { overflow-y: auto; padding: 4px 12px 12px; }
    h4 { margin: 14px 0 6px; font-size: 11px; text-transform: uppercase;
         letter-spacing: .06em; color: #667; }
    .row { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
    .row label { flex: 1; font-size: 12px; color: #333; }
    .row input[type=text] { width: 120px; font: 11px monospace; padding: 3px 5px;
      border: 1px solid #ccc; border-radius: 4px; }
    .row input[type=color] { width: 28px; height: 24px; padding: 0; border: 1px solid #ccc;
      border-radius: 4px; background: #fff; }
    .row.changed label::after { content: " •"; color: #b8860b; }
    .contrast { display: flex; justify-content: space-between; font-size: 12px;
      padding: 2px 0; }
    .contrast .fail { color: #b00020; font-weight: 600; }
    .contrast .pass { color: #1a7f37; }
    select { width: 118px; font-size: 12px; padding: 2px; }
    footer { padding: 10px 12px; border-top: 1px solid #e5e5e5; background: #fafafa; }
    button { font: 12px system-ui, sans-serif; padding: 6px 10px; border-radius: 6px;
      border: 1px solid #1f2d3d; cursor: pointer; }
    button.primary { background: #1f2d3d; color: #fff; }
    button.ghost { background: #fff; color: #1f2d3d; }
    .status { margin-top: 8px; font-size: 11px; color: #444; min-height: 14px; }
  `;
  root.appendChild(style);

  const wrapper = document.createElement("div");
  wrapper.className = "panel";
  root.appendChild(wrapper);

  wrapper.innerHTML =
    "<header><b>SEOS design</b><span>" +
    options.filePath +
    "</span></header><div class='body'></div>";
  const body = wrapper.querySelector(".body") as HTMLDivElement;

  /** Bannerns vardelement. Finns forst nar bannern ritats. */
  const host = (): HTMLElement | null => document.getElementById(HOST_ID);

  /** Det varde som galler just nu - satt av oss, eller bannerns basvarde. */
  const current = (name: string): string => {
    if (options.values[name]) return options.values[name]!;
    const element = host();
    if (!element) return "";
    return getComputedStyle(element).getPropertyValue("--" + name).trim();
  };

  // --- Kontrast ---------------------------------------------------------
  const contrastBox = document.createElement("div");
  body.appendChild(contrastBox);

  const drawContrast = async () => {
    const rows: string[] = ["<h4>Kontrast (krav " + options.minimum + ":1)</h4>"];
    for (const pair of PAIRS) {
      const ratio = await window.seosContrast(current(pair.fg), current(pair.bg));
      const text =
        ratio === null
          ? "<span>—</span>"
          : "<span class='" +
            (ratio >= options.minimum ? "pass" : "fail") +
            "'>" +
            ratio.toFixed(1) +
            ":1</span>";
      rows.push("<div class='contrast'><span>" + pair.label + "</span>" + text + "</div>");
    }
    contrastBox.innerHTML = rows.join("");
  };

  // --- Faltet per variabel ----------------------------------------------
  const fields: { name: string; text: HTMLInputElement; color: HTMLInputElement | null }[] = [];
  for (const group of options.groups) {
    const heading = document.createElement("h4");
    heading.textContent = group.title;
    body.appendChild(heading);

    for (const name of group.variables) {
      const row = document.createElement("div");
      row.className = "row" + (options.values[name] ? " changed" : "");

      const label = document.createElement("label");
      label.textContent = name;
      row.appendChild(label);

      const text = document.createElement("input");
      text.type = "text";
      text.value = current(name);
      text.placeholder = "basvarde";
      row.appendChild(text);

      let color: HTMLInputElement | null = null;
      if (group.kind === "color") {
        color = document.createElement("input");
        color.type = "color";
        if (/^#[0-9a-f]{6}$/i.test(text.value)) color.value = text.value;
        row.insertBefore(color, text);
      }

      const apply = async (value: string) => {
        const element = host();
        if (element) {
          if (value) element.style.setProperty("--" + name, value);
          else element.style.removeProperty("--" + name);
        }
        await window.seosSetVariable(name, value);
        row.className = "row" + (value ? " changed" : "");
        await drawContrast();
      };

      text.addEventListener("change", () => void apply(text.value.trim()));
      if (color) {
        color.addEventListener("input", () => {
          text.value = color!.value;
          void apply(color!.value);
        });
      }

      fields.push({ name, text, color });
      body.appendChild(row);
    }
  }

  // --- Kategorier: forhandsvisning, inget publiceras ---------------------
  const categoryHeading = document.createElement("h4");
  categoryHeading.textContent = "Kategorier (bara forhandsvisning)";
  body.appendChild(categoryHeading);

  for (const key of options.categories) {
    const row = document.createElement("div");
    row.className = "row";

    const label = document.createElement("label");
    label.textContent = CATEGORY_LABELS[key] ?? key;
    row.appendChild(label);

    const select = document.createElement("select");
    select.innerHTML =
      "<option value=''>som i databasen</option>" +
      "<option value='toggle'>reglage</option>" +
      "<option value='notice'>besked</option>";
    select.value = options.visibility[key] ?? "";
    // Bannern ritar korten en gang, sa bytet kraver en omladdning.
    select.addEventListener("change", async () => {
      await window.seosSetVisibility(key, select.value);
      location.reload();
    });

    row.appendChild(select);
    body.appendChild(row);
  }

  // --- Spara och publicera ----------------------------------------------
  const footer = document.createElement("footer");
  footer.innerHTML =
    "<button class='ghost' id='spara'>Spara till fil</button> " +
    "<button class='primary' id='publicera'>Spara och publicera</button>" +
    "<div class='status'></div>";
  wrapper.appendChild(footer);

  const status = footer.querySelector(".status") as HTMLDivElement;

  (footer.querySelector("#spara") as HTMLButtonElement).addEventListener("click", async () => {
    status.textContent = "Sparar...";
    const result = await window.seosSave();
    status.textContent = result.message;
  });

  (footer.querySelector("#publicera") as HTMLButtonElement).addEventListener(
    "click",
    async () => {
      if (!confirm("Spara till filen och publicera till databasen?")) return;
      status.textContent = "Publicerar...";
      const result = await window.seosPublish();
      status.textContent = result.message;
    },
  );

  // Bannern kan vara pa vag in. Rita om kontrasten nar vardelementet dykt upp,
  // annars visar panelen tomma streck for varden som finns.
  let tries = 0;
  const wait = setInterval(() => {
    tries++;
    if (host() || tries > 40) {
      clearInterval(wait);
      // Falten ritades innan bannern fanns och star da tomma. Nu gar
      // basvardena att lasa ur vardelementet.
      for (const field of fields) {
        if (field.text.value) continue;
        const value = current(field.name);
        field.text.value = value;
        if (field.color && /^#[0-9a-f]{6}$/i.test(value)) field.color.value = value;
      }
      void drawContrast();
    }
  }, 500);

  void drawContrast();
}
