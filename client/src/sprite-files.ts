import type * as Phaser from "phaser";
import { spriteKeyFromPath } from "./sprites";

// Every sprite PNG under assets/sprites, as the URL Vite serves it at.
// Adding a file is enough to load it; no list to keep in sync.
const FILES = import.meta.glob<string>("./assets/sprites/*/*/*.png", {
  eager: true,
  query: "?url",
  import: "default",
});

/** Queues every sprite image on a scene's loader (call from `preload`). */
export function loadSprites(load: Phaser.Loader.LoaderPlugin): void {
  for (const [path, url] of Object.entries(FILES)) {
    const key = spriteKeyFromPath(path);
    if (!key) {
      throw new Error(
        `Sprite file ${path} is not <character>/<state>/<direction>.png`,
      );
    }
    load.image(key, url);
  }
}
