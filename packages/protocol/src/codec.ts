import type { GameState } from '@claudeline/sim';
import type {
  ClientMessage,
  DecodeResult,
  EventBatch,
  FirstMessage,
  ServerMessage,
  SessionMessage,
} from './messages';

// Stubs: the tests of the codec come first and are red against these.
export function decodeFirstMessage(_text: string): DecodeResult<FirstMessage> {
  throw new Error('not implemented');
}
export function decodeClientMessage(_text: string): DecodeResult<SessionMessage> {
  throw new Error('not implemented');
}
export function decodeServerMessage(_text: string): DecodeResult<ServerMessage> {
  throw new Error('not implemented');
}
export function encodeClientMessage(_message: ClientMessage): string {
  throw new Error('not implemented');
}
export function encodeServerMessage(_message: ServerMessage): string {
  throw new Error('not implemented');
}
export function snapshotStateJson(_state: GameState): string {
  throw new Error('not implemented');
}
export function encodeSnapshot(
  _tick: number,
  _ack: number,
  _stateJson: string,
  _events: readonly EventBatch[],
): string {
  throw new Error('not implemented');
}
