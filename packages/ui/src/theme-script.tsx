import { THEME_ATTRIBUTE, THEME_STORAGE_KEY } from "./theme";

/**
 * The one script that has to run before the first paint.
 *
 * Without it a reader who chose light gets a dark page for as long as it takes
 * React to hydrate, then a flash. The browser cannot know about the stored
 * override until something reads storage, and nothing else in the app runs
 * early enough — so this goes in <head>, inline and blocking, and it is kept
 * to the smallest thing that can possibly work.
 *
 * It writes nothing for "system": theme.css resolves that through a media
 * query, so the absence of the attribute is the instruction. That is also why
 * this does no work at all for most readers, and why the page is still correct
 * with JavaScript switched off entirely.
 *
 * The key and the attribute come from theme.ts rather than being retyped, so
 * the string in the head and the string the toggle writes cannot drift apart.
 */
const SOURCE = [
  "try{",
  `var p=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});`,
  'if(p==="light"||p==="dark")',
  `document.documentElement.setAttribute(${JSON.stringify(THEME_ATTRIBUTE)},p);`,
  "}catch(e){}",
].join("");

export function ThemeScript() {
  // Not next/script: that defers, and anything deferred is a flash.
  return <script dangerouslySetInnerHTML={{ __html: SOURCE }} />;
}
