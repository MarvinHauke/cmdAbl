import type { Ui } from "./ui.js";

// A yes/no question for modules (`api.confirm`): a single-select pick list with
// two rows, so it goes through the same dialog queue and page as every pick.
// It goes straight through `ui.select`, so `onPick` listeners (history) are not
// told: an answer is not a picked object. The cursor starts on the first row,
// "Cancel": a reflex Enter never acts.
// Never throws; a failing or dismissed dialog counts as "no".

export async function confirm(ui: Ui, message: string, confirmLabel: string): Promise<boolean> {
  try {
    const answer = await ui.select({
      title: message,
      multi: false,
      items: [{ label: "Cancel" }, { label: confirmLabel }],
    });
    return Array.isArray(answer) && answer.length === 1 && answer[0] === 1;
  } catch {
    return false;
  }
}
