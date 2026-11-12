/**
 * The faces players picked for their footballers (skin, haircut, eyes,
 * beard: one number, see apps/web/src/lib/face.ts). It is how he is drawn,
 * nothing more: no rating, no payout and no rule reads it, so it lives here
 * and not on chain. Saved only when signed with a key of the account that
 * plays the footballer. Stored as one JSON file (a Fly volume in production).
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** Faces go from 0 to FACE_MAX - 1 (6 skins x 8 cuts x 8 hair colours x 8 faces x 5 beards). */
export const FACE_MAX = 6 * 8 * 8 * 8 * 5;

export class Faces {
  private data: Record<string, number> = {};

  constructor(private file: string | null) {
    if (!file) return;
    try {
      this.data = JSON.parse(readFileSync(file, "utf8")) as Record<string, number>;
    } catch {
      this.data = {};
    }
  }

  all(): Record<string, number> {
    return this.data;
  }

  put(tokenId: string, face: number) {
    this.data[tokenId] = face;
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data));
    renameSync(tmp, this.file);
  }
}
