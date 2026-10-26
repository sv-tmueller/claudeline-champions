// The seam between the net core and a socket, in strings only: the net core never sees a
// WebSocket, an event or a timer, so it runs (and is tested) with no DOM. The browser adapter
// is a later package (P4b or P4c). Design: online design section 9, client.

/** What a transport tells the net core: it opened, a text frame came in, or it is closed. */
export interface TransportHandlers {
  open(): void;
  message(text: string): void;
  closed(): void;
}

/** One connection to a server: JSON text frames out and in. */
export interface Transport {
  /** Sends one text frame. */
  send(text: string): void;
  /** Closes the connection. The `closed` handler runs once it is closed. */
  close(): void;
  /** Sets the handlers, before the first event. A second call replaces the first. */
  setHandlers(handlers: TransportHandlers): void;
}
