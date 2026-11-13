/** `node:fs` and `node:path`: the enclave has no files. */
const none = () => {
  throw new Error("no files in the enclave");
};
export const mkdirSync = none;
export const readFileSync = none;
export const renameSync = none;
export const writeFileSync = none;
export const dirname = none;
