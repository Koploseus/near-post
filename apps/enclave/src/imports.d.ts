declare module "near:rpc/api@0.1.0" {
  export function view(contractId: string, method: string, argsJson: string, finality: string): [string, string];
  export function viewAccount(accountId: string, finality: string): [string, string];
  export function viewAccessKey(accountId: string, publicKey: string, finality: string): [string, string];
  export function block(finality: string): [string, string];
  export function sendTx(signedTxBase64: string, waitUntil: string): [string, string];
}
declare module "near:storage/api@0.2.0" {
  export function set(key: string, value: Uint8Array): string;
  export function get(key: string): [Uint8Array, string];
}
declare module "outlayer:encryption-keys/api@0.1.0" {
  export function mac(path: string, vault: string | undefined, data: Uint8Array): Uint8Array;
}
declare module "wasi:cli/stdin@0.2.12" {
  export function getStdin(): { blockingRead(n: bigint): Uint8Array };
}
declare module "wasi:cli/stdout@0.2.12" {
  export function getStdout(): { checkWrite(): bigint; write(bytes: Uint8Array): void; blockingFlush(): void };
}
declare module "wasi:cli/environment@0.2.12" {
  export function getEnvironment(): [string, string][];
}
declare module "wasi:http/types@0.2.12" {
  type Stream = { blockingWriteAndFlush(bytes: Uint8Array): void; [Symbol.dispose]?: () => void };
  export class Fields {
    static fromList(entries: [string, Uint8Array][]): Fields;
  }
  export class OutgoingBody {
    write(): Stream;
    static finish(body: OutgoingBody, trailers: undefined): void;
  }
  export class OutgoingRequest {
    constructor(headers: Fields);
    setMethod(m: { tag: string }): void;
    setScheme(s: { tag: string }): void;
    setAuthority(a: string): void;
    setPathWithQuery(p: string): void;
    body(): OutgoingBody;
  }
  export interface IncomingResponse {
    status(): number;
    consume(): { stream(): { blockingRead(n: bigint): Uint8Array } };
  }
}
declare module "wasi:http/outgoing-handler@0.2.12" {
  import type { OutgoingRequest } from "wasi:http/types@0.2.12";
  export function handle(request: OutgoingRequest, options: undefined): { subscribe(): { block(): void }; get(): unknown };
}
