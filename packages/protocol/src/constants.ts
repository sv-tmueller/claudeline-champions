/** The one integer both sides must share. A server and a client that differ refuse each other. */
export const PROTOCOL_VERSION = 1;

/** The error codes of online design section 6, in the order of its table. */
export const ERROR_CODES = [
  'version',
  'badMessage',
  'roomNotFound',
  'roomFull',
  'matchRunning',
  'badToken',
  'notHost',
  'notInLobby',
  'teamFull',
] as const;

/** The bot tiers. Declared here because protocol cannot import bots (online design section 3). */
export const DIFFICULTIES = ['easy', 'normal', 'hard'] as const;

/** The letters and digits without 0, O, 1, I and L: 31 characters. */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 5;

/** The size limit of a client message in UTF-8 bytes; the socket's `maxPayload` is the same number. */
export const MAX_CLIENT_MESSAGE_BYTES = 1024;
/** Each of aimX and aimY is whole centimeters within +-this many cm, both bounds included. */
export const MAX_AIM_CM = 100000;
/** A name is 1 to this many code points after trimming. */
export const NAME_MAX = 16;
/** The OR of the sim's `Button` bits. A new button bit is a deliberate protocol version decision. */
export const BUTTONS_MAX = 255;
/** A snapshot goes out every this many ticks. */
export const SNAPSHOT_EVERY = 3;
/** The client draws this many ticks behind the newest snapshot. */
export const RENDER_DELAY_TICKS = 6;
